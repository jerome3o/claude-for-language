package dev.jeromeswannack.chineselearning.lab.data.bumps

import androidx.room.withTransaction
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.BumpMerge
import dev.jeromeswannack.chineselearning.lab.core.Bumps
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.LeadCard
import dev.jeromeswannack.chineselearning.lab.core.LongTerm
import dev.jeromeswannack.chineselearning.lab.core.StudyToday
import dev.jeromeswannack.chineselearning.lab.core.WordListParser
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueBump
import dev.jeromeswannack.chineselearning.lab.core.QueueBumps
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.StudyBumpEntity
import dev.jeromeswannack.chineselearning.lab.data.api.BumpBody
import dev.jeromeswannack.chineselearning.lab.data.api.BumpItemBody
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBumpDto
import dev.jeromeswannack.chineselearning.lab.data.api.enc
import dev.jeromeswannack.chineselearning.lab.data.homework.LongTermStore
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.PlatformDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.time.ZoneId
import java.util.UUID

/**
 * "⚡ Study it today" — the bump pocket on this phone (core Bumps.kt; web services/studyBumps.ts).
 *
 *  - A bump is written to Room at once (`study_bumps`, pending "add") so the queue, Home and the
 *    widget follow immediately, offline too, and queued in the Outbox as `POST /api/me/bumps`
 *    with the bump's client id (idempotent by client id / note), drained now when online.
 *  - "Remove from today" hides the row at once (pending "clear") and queues
 *    `DELETE /api/me/bumps/:noteId` (idempotent).
 *  - Every sync replaces the synced rows with the server's FULL active list ([replaceFromServer]);
 *    a row whose Outbox item is still pending stays on top as made here.
 *  - The queue's bumps ([queueBumps]): active rows (not pending clear) with their cards' first /
 *    latest review from the local events (events are the truth).
 *  - What one ⚡ tap bumps is ONE rule from everywhere ([bumpNotes] → core StudyToday, shared/decks/
 *    study-today.ts): an unstarted word's listening card (else its lead card), a started word's listening
 *    card, the whole note only without one — a CARD-LEVEL bump (`cardTypes`) sent as `planned`.
 *  - [bumpCardTypes]: the study card's "Practise this word other ways…" (an explicit choice) — only those
 *    card types of the note go in the pocket (core Bumps / OtherCardTypes).
 */
object BumpStore {
    const val OUTBOX_ADD = "study-bump"
    const val OUTBOX_CLEAR = "study-bump-clear"
    const val PENDING_ADD = "add"
    const val PENDING_CLEAR = "clear"

    /**
     * What a bump did: the hanzi of the notes now in the pocket, how many already were, how many matched nothing;
     * [kinds] = what went in per added word (core StudyToday listening / lead / whole, aligned with [added]),
     * [addedNoteIds] their notes, [longTermBefore] the long-term choices the tap replaced (note id → before).
     */
    data class Result(
        val added: List<String>,
        val already: List<String>,
        val notFound: Int,
        val kinds: List<String> = emptyList(),
        val addedNoteIds: List<String> = emptyList(),
        val longTermBefore: Map<String, Int?> = emptyMap(),
    ) {
        val message: String get() = if (added.isEmpty() && already.isEmpty() && notFound > 0) "Not in your decks yet"
        else StudyToday.message(added.mapIndexed { i, h -> h to (kinds.getOrNull(i) ?: StudyToday.WHOLE) }, already.size)
    }

    private fun nowIso(nowMs: Long) = Js.toIsoString(nowMs)

    private val typesSerializer = ListSerializer(String.serializer())
    private val json = Json { ignoreUnknownKeys = true }

    /** The stored JSON → a card-type list (null = the whole note). */
    fun parseCardTypes(raw: String?): List<String>? =
        if (raw.isNullOrBlank()) null else runCatching { Bumps.normalizeBumpCardTypes(json.decodeFromString(typesSerializer, raw)) }.getOrNull()

    private fun encodeCardTypes(types: List<String>?): String? = types?.let { json.encodeToString(typesSerializer, it) }

    /** Active rows (a pending clear is hidden at once). */
    suspend fun active(dao: LabDao): List<StudyBumpEntity> = dao.studyBumps().filter { it.pending != PENDING_CLEAR }

    /** The queue's bumps: active rows + the first / latest review of their notes' cards. Null when none. */
    suspend fun queueBumps(dao: LabDao): QueueBumps? {
        val rows = try { active(dao) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Throwable) {
            android.util.Log.w("BumpStore", "bumps unavailable", e); return null
        }
        if (rows.isEmpty()) return null
        val cardIds = rows.map { it.noteId }.chunked(500).flatMap { dao.cardsOfNotes(it) }.map { it.id }
        val spans = cardIds.chunked(500).flatMap { dao.reviewSpans(it) }
        return QueueBumps(
            bumps = rows.map { QueueBump(it.noteId, Js.parseDate(it.createdAt), parseCardTypes(it.cardTypes)) },
            lastReviewMs = spans.associate { it.cardId to Js.parseDate(it.lastAt) },
            firstReviewMs = spans.associate { it.cardId to Js.parseDate(it.firstAt) },
        )
    }

    /** Notes with an active bump whose pocket still has cards (any deck): the deck page / card hub "Remove from today". */
    suspend fun openNoteIds(dao: LabDao, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): Set<String> {
        val bumps = queueBumps(dao) ?: return emptySet()
        val cards = bumps.bumps.map { it.noteId }.chunked(500).flatMap { dao.cardsOfNotes(it) }.map { it.toQueueCard() }
        return Bumps.bumpPocket(cards, bumps, StudyQueue.cutoff(nowMs, zone, dev.jeromeswannack.chineselearning.lab.data.StudyDayClock.rolloverHour).ts).activeNoteIds.toSet()
    }

    /** "⚡ from Minghui" per bumped note (only notes a tutor bumped). */
    suspend fun bumpedBy(dao: LabDao): Map<String, String> = active(dao).mapNotNull { r -> r.bumpedByName?.let { r.noteId to it } }.toMap()

    /** Local notes for [hanzi] (normalised like Paste a list), preferring [preferDeck]; hanzi → note id. */
    suspend fun matchNotes(dao: LabDao, hanzi: List<String>, preferDeck: String? = null): Map<String, String> {
        val wanted = hanzi.associateBy { WordListParser.normalizeHanzi(it) }.filterKeys { it.isNotEmpty() }
        if (wanted.isEmpty()) return emptyMap()
        val out = HashMap<String, String>()
        val notes = dao.allNotes().sortedByDescending { it.deckId == preferDeck }
        for (n in notes) {
            val original = wanted[WordListParser.normalizeHanzi(n.hanzi)] ?: continue
            out.putIfAbsent(original, n.id)
        }
        return out
    }

    /**
     * Bump the local notes spelled [hanzi] (the add-card sheets, the Coach). [justCreated] = hanzi → the note
     * "+ Add as card" just made (the explorer's / a breakdown's): when the sync hasn't brought it down yet it
     * is bumped as an unstarted word ([bumpNotes]) instead of "Not in your decks yet".
     */
    suspend fun bumpHanzi(app: LabApp, hanzi: List<String>, source: String, preferDeck: String? = null, justCreated: Map<String, String> = emptyMap()): Result {
        val local = matchNotes(app.repo.dao, hanzi, preferDeck)
        val fresh = justCreated.filterKeys { it !in local && it in hanzi }
        val matched = local + fresh
        val r = bumpNotes(app, hanzi.mapNotNull { matched[it] }.distinct(), source, track = false, justCreated = fresh.entries.associate { (h, id) -> id to h })
        val out = r.copy(notFound = hanzi.distinct().count { it !in matched })
        track(app, source, out)
        return out
    }

    /** "English → Chinese" applies to [hanzi]: the setting is on and every character is known (core LeadCard). */
    suspend fun knownCharactersLead(app: LabApp, hanzi: String): Boolean = LeadCard.allCharactersKnown(hanzi, knownCharacters(app))

    /** The characters he knows (every Han character of a note with a mature card); empty with "English → Chinese" off. */
    private suspend fun knownCharacters(app: LabApp): Set<String> {
        if (!app.prefs.newCardOrder.knownCharactersEnglishFirst) return emptySet()
        val dao = app.repo.dao
        val knownNotes = LeadCard.knownNoteIds(dao.cards().map { it.toQueueCard() })
        if (knownNotes.isEmpty()) return emptySet()
        val hanziOf = knownNotes.chunked(500).flatMap { dao.notes(it) }.map { it.hanzi }
        return LeadCard.knownCharacters(hanziOf)
    }

    /**
     * The "⚡ Study it today" plan of one note on this phone (core StudyToday — shared/decks/study-today.ts).
     * [known] = the known characters, shared across one call's notes (read only when a plan needs it).
     */
    suspend fun studyTodayPlan(app: LabApp, note: NoteEntity, cards: List<CardEntity>, deck: DeckEntity?, known: (suspend () -> Set<String>)? = null): StudyToday.Plan {
        val noteCards = cards.map { StudyToday.NoteCard(it.cardType, it.queue) }
        val started = cards.any { it.queue != CardQueue.NEW }
        val inReview = deck?.let { LongTerm.deckInDailyReview(it.newCardsPerDay, it.secondaryCardsPerDay ?: StudyQueue.DEFAULT_SECONDARY_CAP) } ?: true
        val hasAudio = !note.audioUrl.isNullOrBlank()
        // "Start new words by ear": a word just added (its clip still being made) starts with its listening card too.
        val byEar = app.prefs.newCardOrder.newWordsByEar
        val first = StudyToday.plan(noteCards, started, hasAudio, note.longTerm, inReview, newWordsByEar = byEar)
        if (first.kind != StudyToday.LEAD) return first
        val lead = LeadCard.allCharactersKnown(note.hanzi, known?.invoke() ?: knownCharacters(app))
        return StudyToday.plan(noteCards, started, hasAudio, note.longTerm, inReview, { lead }, byEar)
    }

    /**
     * The plan of a note "+ Add as card" just made that isn't on this phone yet: three NEW cards, no clip yet
     * (the server makes it a few seconds after the add), its source deck in daily review — with "Start new
     * words by ear" its listening card, like the regular pool's lead card (web studyBumps.ts, the same rule).
     */
    private suspend fun justCreatedPlan(app: LabApp, hanzi: String, known: suspend () -> Set<String>): StudyToday.Plan {
        val byEar = app.prefs.newCardOrder.newWordsByEar
        val first = StudyToday.plan(emptyList(), started = false, hasAudio = false, longTermPref = null, deckInReview = true, newWordsByEar = byEar)
        if (first.kind != StudyToday.LEAD) return first
        val lead = LeadCard.allCharactersKnown(hanzi, known())
        return StudyToday.plan(emptyList(), false, false, null, true, { lead }, byEar)
    }

    /**
     * "⚡ Study it today" — the ONE phone entry point every ⚡ goes through (the explorer, the add-card sheets,
     * word sheets, chat Make flashcards / Paste a list, the deck page, the card hub, Up next, the homework
     * pass, the reader recap, clips, idioms, podcasts): each note follows core StudyToday (shared/decks/
     * study-today.ts) — an unstarted word puts ONLY its listening card in today (else its lead card) and goes
     * into long-term review; a started word its listening card; a word with no listening card (or no audio)
     * the whole note. Written here at once (marked `planned`, so the server stores it as sent), sent through
     * the Outbox.
     */
    suspend fun bumpNotes(
        app: LabApp,
        noteIds: List<String>,
        source: String,
        nowMs: Long = System.currentTimeMillis(),
        track: Boolean = true,
        zone: ZoneId = ZoneId.systemDefault(),
        /** Notes just made here ("+ Add as card", note id → hanzi) the sync hasn't brought down yet: planned as unstarted words. */
        justCreated: Map<String, String> = emptyMap(),
    ): Result {
        val src = Bumps.normalizeBumpSource(source)
        val dao = app.repo.dao
        val ids = noteIds.distinct()
        val open = openNoteIds(dao, nowMs, zone)
        val existing = dao.studyBumps().associateBy { it.noteId }
        val notes = dao.notes(ids).associateBy { it.id }
        val decks = if (notes.isEmpty()) emptyMap() else dao.decks().associateBy { it.id }
        val added = ArrayList<String>()
        val addedIds = ArrayList<String>()
        val kinds = ArrayList<String>()
        val already = ArrayList<String>()
        val items = ArrayList<BumpItemBody>()
        val rows = ArrayList<StudyBumpEntity>()
        val longTerms = LinkedHashMap<String, Int?>()
        val longTermBefore = LinkedHashMap<String, Int?>()
        var knownOnce: Set<String>? = null
        val known: suspend () -> Set<String> = { knownOnce ?: knownCharacters(app).also { knownOnce = it } }
        for (id in ids) {
            val note = notes[id]
            val freshHanzi = if (note == null) justCreated[id] ?: continue else null
            val hanzi = note?.hanzi ?: freshHanzi.orEmpty()
            val cards = if (note != null) dao.cardsOfNotes(listOf(id)) else emptyList()
            val plan = if (note != null) studyTodayPlan(app, note, cards, decks[note.deckId], known) else justCreatedPlan(app, hanzi, known)
            val row = existing[id]
            val types: List<String>?
            val planned = plan.cardTypes
            if (planned != null) {
                val merge = cardLevelMerge(dao, id, row, cards, planned, nowMs, zone)
                if (merge.action == "already") { already += hanzi; continue }
                types = merge.cardTypes
            } else {
                // A card-level bump of the word becomes a whole-note bump (Bumps.mergeBumpCardTypes).
                if (row != null && row.pending != PENDING_CLEAR && id in open && parseCardTypes(row.cardTypes) == null) { already += hanzi; continue }
                types = null
            }
            val clientId = UUID.randomUUID().toString()
            items += BumpItemBody(clientId, id, nowIso(nowMs), src, types, planned = true)
            rows += StudyBumpEntity(id, clientId, nowIso(nowMs), src, bumpedByName = null, pending = PENDING_ADD, cardTypes = encodeCardTypes(types))
            added += hanzi
            addedIds += id
            kinds += if (types == null) StudyToday.WHOLE else StudyToday.kindOfRow(types)
            if (plan.setLongTerm && note != null) {
                longTermBefore[id] = note.longTerm
                longTerms[id] = plan.longTerm
            }
        }
        if (items.isNotEmpty()) {
            withContext(Dispatchers.IO) {
                val outboxId = items.first().id
                app.outbox.enqueueJson(OUTBOX_ADD, "POST", "/api/me/bumps", BumpBody(items), id = outboxId)
                dao.upsertStudyBumps(rows.map { it.copy(outboxId = outboxId) })
            }
            // The long-term opt-in of an unstarted word, so its other cards come later as purple cards.
            for ((noteId, pref) in longTerms) LongTermStore.set(app, noteId, pref)
            app.repo.notifyLocalChange()
            send(app)
        }
        val result = Result(added, already, ids.count { it !in notes && it !in justCreated }, kinds, addedIds, longTermBefore)
        if (track) track(app, src, result)
        return result
    }

    /** A card-level request meets the note's bump row (core Bumps.mergeBumpCardTypes, with the still-open types worked out here). */
    private suspend fun cardLevelMerge(dao: LabDao, noteId: String, row: StudyBumpEntity?, cards: List<CardEntity>, want: List<String>, nowMs: Long, zone: ZoneId): BumpMerge {
        var hasExisting = false
        var existing: List<String>? = null
        var stillOpen: List<String> = emptyList()
        if (row != null && row.pending != PENDING_CLEAR) {
            val spans = dao.reviewSpans(cards.map { it.id })
            val open = Bumps.bumpedCardsForNote(
                cards.map { it.toQueueCard() },
                QueueBump(noteId, Js.parseDate(row.createdAt), parseCardTypes(row.cardTypes)),
                spans.associate { it.cardId to Js.parseDate(it.lastAt) },
                spans.associate { it.cardId to Js.parseDate(it.firstAt) },
                StudyQueue.cutoff(nowMs, zone, dev.jeromeswannack.chineselearning.lab.data.StudyDayClock.rolloverHour).ts,
            )
            // A bump whose cards were all reviewed is finished: start afresh.
            if (open.isNotEmpty()) {
                hasExisting = true
                existing = parseCardTypes(row.cardTypes)
                stillOpen = open.map { it.cardType }
            }
        }
        return Bumps.mergeBumpCardTypes(hasExisting, existing, stillOpen, want)
    }

    /** What [bumpCardTypes] did: [added] false = already in today; [cardTypes] afterwards (null = the whole note). */
    data class CardTypesResult(val added: Boolean, val cardTypes: List<String>?)

    /**
     * "Practise this word other ways…" (core OtherCardTypes): put these card types of one note in
     * today's pocket — an explicit choice, so the "Study it today" rule doesn't apply. Written here at once
     * and sent through the Outbox. An open card-level bump keeps its types still to review and gains these
     * (re-dated now); a finished one starts afresh; a whole-note bump already covers them. Port of
     * bumpCardTypes() (web).
     */
    suspend fun bumpCardTypes(app: LabApp, noteId: String, cardTypes: List<String>, source: String = "study_card", nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): CardTypesResult {
        val want = Bumps.normalizeBumpCardTypes(cardTypes) ?: return CardTypesResult(false, null)
        val src = Bumps.normalizeBumpSource(source)
        val dao = app.repo.dao
        val row = dao.studyBumps().firstOrNull { it.noteId == noteId }
        val merge = cardLevelMerge(dao, noteId, row, dao.cardsOfNotes(listOf(noteId)), want, nowMs, zone)
        val added = merge.action != "already"
        if (added) {
            val clientId = UUID.randomUUID().toString()
            withContext(Dispatchers.IO) {
                app.outbox.enqueueJson(OUTBOX_ADD, "POST", "/api/me/bumps", BumpBody(listOf(BumpItemBody(clientId, noteId, nowIso(nowMs), src, merge.cardTypes, planned = true))), id = clientId)
                dao.upsertStudyBumps(listOf(StudyBumpEntity(noteId, clientId, nowIso(nowMs), src, bumpedByName = null, pending = PENDING_ADD, outboxId = clientId, cardTypes = encodeCardTypes(merge.cardTypes))))
            }
            app.repo.notifyLocalChange()
            send(app)
        }
        app.analytics.track("study.bump_added", mapOf("source" to src, "count" to (if (added) 1 else 0), "already" to (if (added) 0 else 1), "card_types" to want.size))
        return CardTypesResult(added, merge.cardTypes)
    }

    /** "Remove from today": hidden here at once, `DELETE /api/me/bumps/:noteId` through the Outbox. */
    suspend fun clear(app: LabApp, noteId: String, source: String) {
        val dao = app.repo.dao
        val row = dao.studyBumps().firstOrNull { it.noteId == noteId } ?: return
        withContext(Dispatchers.IO) {
            val outboxId = app.outbox.enqueue(OUTBOX_CLEAR, "DELETE", "/api/me/bumps/${enc(noteId)}")
            dao.upsertStudyBumps(listOf(row.copy(pending = PENDING_CLEAR, outboxId = outboxId)))
        }
        app.analytics.track("study.bump_cleared", mapOf("source" to Bumps.normalizeBumpSource(source)))
        app.repo.notifyLocalChange()
        send(app)
    }

    private fun track(app: LabApp, source: String, r: Result) {
        if (r.added.isEmpty() && r.already.isEmpty()) return
        app.analytics.track("study.bump_added", mapOf("source" to Bumps.normalizeBumpSource(source), "count" to r.added.size, "already" to r.already.size, "card_types" to r.kinds.count { it != StudyToday.WHOLE }))
    }

    private fun send(app: LabApp) {
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } } else app.scheduleBackgroundUpload()
    }

    /**
     * The server's FULL active list replaces the synced rows; a row whose Outbox item is still
     * pending keeps the local change (an add stays, a clear stays hidden). A row whose item has
     * gone (sent, or refused for good) follows the server.
     */
    suspend fun replaceFromServer(db: LabDatabase, platform: PlatformDao, server: List<StudyBumpDto>) {
        val dao = db.dao()
        val pendingOutbox = platform.allOutbox().filter { it.state == Outbox.PENDING }.mapTo(HashSet()) { it.id }
        db.withTransaction {
            val local = dao.studyBumps()
            val keep = local.filter { it.pending != null && it.outboxId != null && it.outboxId in pendingOutbox }
            val kept = keep.mapTo(HashSet()) { it.noteId }
            val fromServer = server.distinctBy { it.note_id }.filter { it.note_id !in kept }.map {
                StudyBumpEntity(
                    it.note_id, it.id, it.created_at, Bumps.normalizeBumpSource(it.source), it.bumped_by_name?.takeIf { n -> n.isNotBlank() },
                    cardTypes = encodeCardTypes(Bumps.normalizeBumpCardTypes(it.card_types)),
                )
            }
            val drop = local.map { it.noteId }.filter { it !in kept }
            drop.chunked(500).forEach { dao.deleteStudyBumps(it) }
            dao.upsertStudyBumps(fromServer)
        }
    }
}
