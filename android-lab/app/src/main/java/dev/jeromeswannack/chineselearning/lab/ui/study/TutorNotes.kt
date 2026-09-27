package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.data.api.RecordingNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.recordingNoteSeenPath
import dev.jeromeswannack.chineselearning.lab.data.api.recordingNotes
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
 */
object TutorNotes {
    const val KIND = "study"
    const val NOTES_KEY = "study/recording-notes"
    const val SEEN_KEY = "study/recording-notes-seen"
    const val OUTBOX_KIND = "recording-note-seen"

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

    /** The sync step (registered in FeatureSyncs): runs after the outbox drained the seen posts. */
    val Sync = FeatureSync { ctx: SyncContext ->
        val remote = ctx.api.recordingNotes()
        ctx.cache.put(NOTES_KEY, KIND, remote)
        val seen = ctx.cache.get<Set<String>>(SEEN_KEY).orEmpty()
        val listed = remote.mapTo(HashSet()) { it.event_id }
        val kept = seen.filterTo(HashSet()) { it in listed }
        if (kept.size != seen.size) ctx.cache.put(SEEN_KEY, KIND, kept as Set<String>)
    }
}
