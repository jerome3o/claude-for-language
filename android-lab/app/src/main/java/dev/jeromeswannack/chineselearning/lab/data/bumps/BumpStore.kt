package dev.jeromeswannack.chineselearning.lab.data.bumps

import androidx.room.withTransaction
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Bumps
import dev.jeromeswannack.chineselearning.lab.core.WordListParser
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueBump
import dev.jeromeswannack.chineselearning.lab.core.QueueBumps
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.StudyBumpEntity
import dev.jeromeswannack.chineselearning.lab.data.api.BumpBody
import dev.jeromeswannack.chineselearning.lab.data.api.BumpItemBody
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBumpDto
import dev.jeromeswannack.chineselearning.lab.data.api.enc
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
 *  - A CARD-LEVEL bump ([bumpCardTypes], `cardTypes`): the study card's "Practise this word other
 *    ways…" — only those card types of the note go in the pocket (core Bumps / OtherCardTypes).
 */
object BumpStore {
    const val OUTBOX_ADD = "study-bump"
    const val OUTBOX_CLEAR = "study-bump-clear"
    const val PENDING_ADD = "add"
    const val PENDING_CLEAR = "clear"

    /** What a bump did: the hanzi of the notes now in the pocket, how many already were, how many matched nothing. */
    data class Result(val added: List<String>, val already: List<String>, val notFound: Int) {
        val message: String get() = if (added.isEmpty() && already.isEmpty() && notFound > 0) "Not in your decks yet" else Bumps.bumpedMessage(added, already.size)
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
        return Bumps.bumpPocket(cards, bumps, StudyQueue.cutoff(nowMs, zone).ts).activeNoteIds.toSet()
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

    /** Bump the local notes spelled [hanzi] (the add-card sheets, the Coach). */
    suspend fun bumpHanzi(app: LabApp, hanzi: List<String>, source: String, preferDeck: String? = null): Result {
        val matched = matchNotes(app.repo.dao, hanzi, preferDeck)
        val r = bumpNotes(app, hanzi.mapNotNull { matched[it] }.distinct(), source, track = false)
        val out = r.copy(notFound = hanzi.distinct().count { it !in matched })
        track(app, source, out)
        return out
    }

    /** Bump [noteIds]: written here at once, sent through the Outbox. */
    suspend fun bumpNotes(app: LabApp, noteIds: List<String>, source: String, nowMs: Long = System.currentTimeMillis(), track: Boolean = true): Result {
        val src = Bumps.normalizeBumpSource(source)
        val dao = app.repo.dao
        val open = openNoteIds(dao, nowMs)
        val existing = dao.studyBumps().associateBy { it.noteId }
        val notes = dao.notes(noteIds.distinct()).associateBy { it.id }
        val added = ArrayList<String>()
        val already = ArrayList<String>()
        val items = ArrayList<BumpItemBody>()
        val rows = ArrayList<StudyBumpEntity>()
        for (id in noteIds.distinct()) {
            val note = notes[id] ?: continue
            val row = existing[id]
            // A card-level bump of the word becomes a whole-note bump (Bumps.mergeBumpCardTypes).
            if (row != null && row.pending != PENDING_CLEAR && id in open && parseCardTypes(row.cardTypes) == null) { already += note.hanzi; continue }
            val clientId = UUID.randomUUID().toString()
            items += BumpItemBody(clientId, id, nowIso(nowMs), src)
            rows += StudyBumpEntity(id, clientId, nowIso(nowMs), src, bumpedByName = null, pending = PENDING_ADD)
            added += note.hanzi
        }
        if (items.isNotEmpty()) {
            withContext(Dispatchers.IO) {
                val outboxId = items.first().id
                app.outbox.enqueueJson(OUTBOX_ADD, "POST", "/api/me/bumps", BumpBody(items), id = outboxId)
                dao.upsertStudyBumps(rows.map { it.copy(outboxId = outboxId) })
            }
            app.repo.notifyLocalChange()
            send(app)
        }
        val result = Result(added, already, noteIds.distinct().count { it !in notes })
        if (track) track(app, src, result)
        return result
    }

    /** What [bumpCardTypes] did: [added] false = already in today; [cardTypes] afterwards (null = the whole note). */
    data class CardTypesResult(val added: Boolean, val cardTypes: List<String>?)

    /**
     * "Practise this word other ways…" (core OtherCardTypes): put these card types of one note in
     * today's pocket — a card-level bump, written here at once and sent through the Outbox. An open
     * card-level bump keeps its types still to review and gains these (re-dated now); a finished one
     * starts afresh; a whole-note bump already covers them. Port of bumpCardTypes() (web).
     */
    suspend fun bumpCardTypes(app: LabApp, noteId: String, cardTypes: List<String>, source: String = "study_card", nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): CardTypesResult {
        val want = Bumps.normalizeBumpCardTypes(cardTypes) ?: return CardTypesResult(false, null)
        val src = Bumps.normalizeBumpSource(source)
        val dao = app.repo.dao
        val row = dao.studyBumps().firstOrNull { it.noteId == noteId }?.takeIf { it.pending != PENDING_CLEAR }
        var hasExisting = false
        var existing: List<String>? = null
        var stillOpen: List<String> = emptyList()
        if (row != null) {
            val cards = dao.cardsOfNotes(listOf(noteId))
            val spans = dao.reviewSpans(cards.map { it.id })
            val open = Bumps.bumpedCardsForNote(
                cards.map { it.toQueueCard() },
                QueueBump(noteId, Js.parseDate(row.createdAt), parseCardTypes(row.cardTypes)),
                spans.associate { it.cardId to Js.parseDate(it.lastAt) },
                spans.associate { it.cardId to Js.parseDate(it.firstAt) },
                StudyQueue.cutoff(nowMs, zone).ts,
            )
            // A bump whose cards were all reviewed is finished: start afresh.
            if (open.isNotEmpty()) {
                hasExisting = true
                existing = parseCardTypes(row.cardTypes)
                stillOpen = open.map { it.cardType }
            }
        }
        val merge = Bumps.mergeBumpCardTypes(hasExisting, existing, stillOpen, want)
        val added = merge.action != "already"
        if (added) {
            val clientId = UUID.randomUUID().toString()
            withContext(Dispatchers.IO) {
                app.outbox.enqueueJson(OUTBOX_ADD, "POST", "/api/me/bumps", BumpBody(listOf(BumpItemBody(clientId, noteId, nowIso(nowMs), src, merge.cardTypes))), id = clientId)
                dao.upsertStudyBumps(listOf(StudyBumpEntity(noteId, clientId, nowIso(nowMs), src, bumpedByName = null, pending = PENDING_ADD, outboxId = clientId, cardTypes = encodeCardTypes(merge.cardTypes))))
            }
            app.repo.notifyLocalChange()
            send(app)
        }
        app.analytics.track("study.bump_added", mapOf("source" to src, "count" to (if (added) 1 else 0), "already" to (if (added) 0 else 1)))
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
        app.analytics.track("study.bump_added", mapOf("source" to Bumps.normalizeBumpSource(source), "count" to r.added.size, "already" to r.already.size))
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
