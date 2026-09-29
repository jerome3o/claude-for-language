package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.core.TutorNoteRow
import dev.jeromeswannack.chineselearning.lab.core.TutorNotesList
import dev.jeromeswannack.chineselearning.lab.core.TutorNotesRules
import dev.jeromeswannack.chineselearning.lab.core.UnseenTutorNote
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.recordingNoteSeenPath
import dev.jeromeswannack.chineselearning.lab.data.api.recordingNotes
import dev.jeromeswannack.chineselearning.lab.data.api.tutorNotes
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext

/**
 * Tutor notes on the card back — the Lab twin of frontend/src/services/recording-notes.ts.
 *
 * `GET /api/me/recording-notes` (a tutor's needs-work comment on one of my recordings, or
 * a reply to a card I flagged) is cached in the JSON cache on every sync, so the note shows
 * on the train. Rating the card marks it seen: the id goes into a local "seen" set at once
 * (hidden from then on) and `POST …/seen` is queued in the outbox (idempotent). The sync
 * step keeps a seen id only while the server still lists it, so the set never grows.
 *
 * The Tutor notes page (/tutor-notes, ui/study/TutorNotesScreen.kt — web services/tutorNotes.ts)
 * also lists the SEEN notes: `GET /api/me/tutor-notes?include_seen=1` is cached under [ALL_KEY]
 * by the same sync step, and [list] merges it with the unseen feed (TutorNotesRules.merge — the
 * feed decides what is new).
 */
object TutorNotes {
    const val KIND = "study"
    const val NOTES_KEY = "study/recording-notes"
    const val SEEN_KEY = "study/recording-notes-seen"
    const val OUTBOX_KIND = "recording-note-seen"
    /** Every note, seen ones included (the Tutor notes page, offline). */
    const val ALL_KEY = "study/tutor-notes-all"

    fun toNote(dto: RecordingNoteDto) = TutorNote(
        id = dto.event_id,
        kind = dto.kind ?: "recording",
        cardId = dto.card_id,
        noteId = dto.note_id,
        hanzi = dto.hanzi,
        comment = dto.comment,
        tutorName = dto.tutor_name,
        updatedAt = dto.updated_at,
    )

    /** Unseen notes for this card (services/recording-notes.ts getUnseenRecordingNotesForCard). */
    suspend fun forCard(cache: JsonCache, cardId: String, noteId: String): List<TutorNote> {
        val all = cache.get<List<RecordingNoteDto>>(NOTES_KEY).orEmpty().map(::toNote)
        val seen = cache.get<Set<String>>(SEEN_KEY).orEmpty()
        return CardExtrasLogic.unseenNotesForCard(all, seen, cardId, noteId)
    }

    /** `markRecordingNoteSeen`: hide it here now, tell the server through the outbox. */
    suspend fun markSeen(cache: JsonCache, outbox: Outbox, ids: Collection<String>) {
        if (ids.isEmpty()) return
        val seen = cache.get<Set<String>>(SEEN_KEY).orEmpty()
        val fresh = ids.filter { it !in seen }
        if (fresh.isEmpty()) return
        cache.put(SEEN_KEY, KIND, seen + fresh)
        for (id in fresh) outbox.enqueue(OUTBOX_KIND, "POST", recordingNoteSeenPath(id), id = "seen-$id")
    }

    /** The device's unseen feed (the cached feed minus what was seen here), as the shared merge takes it. */
    suspend fun unseen(cache: JsonCache): List<UnseenTutorNote> {
        val seen = cache.get<Set<String>>(SEEN_KEY).orEmpty()
        return cache.get<List<RecordingNoteDto>>(NOTES_KEY).orEmpty().filter { it.event_id !in seen }.map {
            UnseenTutorNote(it.event_id, it.kind ?: "recording", it.card_id, it.note_id, it.hanzi, it.comment, it.tutor_name, it.updated_at)
        }
    }

    /** "3 new notes from 明慧老师" for Home; null when nothing is new. */
    suspend fun homeLine(cache: JsonCache): String? = TutorNotesRules.homeLine(unseen(cache).map { it.tutorName })

    /**
     * The page's list: new first, then earlier (web loadTutorNotes). Pinyin / meaning a row lacks
     * (a note newer than the last full fetch) come from the local note via [localNote].
     */
    suspend fun list(cache: JsonCache, localNote: suspend (String) -> Pair<String, String>?): TutorNotesList {
        val merged = TutorNotesRules.merge(cache.get<List<TutorNoteRow>>(ALL_KEY).orEmpty(), unseen(cache))
        val filled = HashMap<String, Pair<String, String>?>()
        suspend fun fill(n: TutorNoteRow): TutorNoteRow {
            if (n.pinyin.isNotEmpty() && n.english.isNotEmpty()) return n
            val local = if (filled.containsKey(n.note_id)) filled[n.note_id] else localNote(n.note_id).also { filled[n.note_id] = it }
            val (pinyin, english) = local ?: return n
            return n.copy(pinyin = n.pinyin.ifEmpty { pinyin }, english = n.english.ifEmpty { english })
        }
        return TutorNotesList(merged.fresh.map { fill(it) }, merged.earlier.map { fill(it) })
    }

    /** A page row as the card back shows it (pinned while practising, even when already seen). */
    fun asCardNote(n: TutorNoteRow) = TutorNote(n.id, n.kind, n.card_id, n.note_id, n.hanzi, n.comment, n.tutor_name, n.updated_at)

    /** The sync step (registered in FeatureSyncs): runs after the outbox drained the seen posts. */
    val Sync = FeatureSync { ctx: SyncContext ->
        val remote = ctx.api.recordingNotes()
        ctx.cache.put(NOTES_KEY, KIND, remote)
        val seen = ctx.cache.get<Set<String>>(SEEN_KEY).orEmpty()
        val listed = remote.mapTo(HashSet()) { it.event_id }
        val kept = seen.filterTo(HashSet()) { it in listed }
        if (kept.size != seen.size) ctx.cache.put(SEEN_KEY, KIND, kept as Set<String>)
        // Every note, seen ones too, for the Tutor notes page offline.
        runCatching { ctx.api.tutorNotes() }.getOrNull()?.let { ctx.cache.put(ALL_KEY, KIND, it.notes) }
    }
}
