package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.Serializable

/*
 * "Notes from your tutor" and practising their cards — port of shared/tutor-notes (notes.ts,
 * practice.ts), parity-tested (parity/fixtures/tutor-notes.ts, TutorNotesParityTest).
 */

/** A row of GET /api/me/tutor-notes (every note, seen ones included). */
@Serializable
data class TutorNoteRow(
    val id: String,
    /** 'recording' | 'flag'. */
    val kind: String = "recording",
    val card_id: String? = null,
    val card_type: String? = null,
    val note_id: String,
    val deck_id: String? = null,
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val comment: String = "",
    val tutor_name: String? = null,
    val updated_at: String = "",
    val seen_at: String? = null,
    val recording_url: String? = null,
    val student_message: String? = null,
)

@Serializable
data class TutorNotesPageDto(val notes: List<TutorNoteRow> = emptyList(), val next_cursor: String? = null)

/** A row of the unseen feed (GET /api/me/recording-notes) as the device has it. */
data class UnseenTutorNote(
    val id: String,
    val kind: String,
    val cardId: String?,
    val noteId: String,
    val hanzi: String,
    val comment: String,
    val tutorName: String?,
    val updatedAt: String,
)

data class TutorNotesList(val fresh: List<TutorNoteRow>, val earlier: List<TutorNoteRow>)

object TutorNotesRules {
    private val newestFirst = Comparator<TutorNoteRow> { a, b ->
        if (a.updated_at != b.updated_at) (if (a.updated_at < b.updated_at) 1 else -1)
        else if (a.id < b.id) 1 else if (a.id > b.id) -1 else 0
    }

    /** Port of mergeTutorNotes: the unseen feed decides what is new; the rest is earlier. */
    fun merge(all: List<TutorNoteRow>, unseen: List<UnseenTutorNote>): TutorNotesList {
        val byId = all.associateBy { it.id }
        val freshIds = HashSet<String>()
        val fresh = ArrayList<TutorNoteRow>()
        for (u in unseen) {
            if (!freshIds.add(u.id)) continue
            val full = byId[u.id]
            fresh += full?.copy(comment = u.comment, tutor_name = u.tutorName ?: full.tutor_name, updated_at = u.updatedAt, seen_at = null)
                ?: TutorNoteRow(
                    id = u.id, kind = u.kind, card_id = u.cardId, card_type = null, note_id = u.noteId, deck_id = null,
                    hanzi = u.hanzi, pinyin = "", english = "", comment = u.comment, tutor_name = u.tutorName,
                    updated_at = u.updatedAt, seen_at = null, recording_url = null, student_message = null,
                )
        }
        val earlier = all.filter { it.id !in freshIds }
        return TutorNotesList(fresh.sortedWith(newestFirst), earlier.sortedWith(newestFirst))
    }

    /** Port of tutorNotesHomeLine: "3 new notes from 明慧老师", null when nothing is new. */
    fun homeLine(freshTutorNames: List<String?>): String? {
        if (freshTutorNames.isEmpty()) return null
        val names = freshTutorNames.map { it?.trim().orEmpty() }.toSet()
        val from = if (names.size == 1) names.first().ifEmpty { "your tutor" } else "your tutors"
        val n = freshTutorNames.size
        return "$n new ${if (n == 1) "note" else "notes"} from $from"
    }

    /** Port of tutorNoteLabel. */
    fun label(kind: String): String = if (kind == "flag") "Reply to your flag" else "On your recording"

    /**
     * Port of practiceRatingCounts: a rating is a real review only when the card is due today
     * (isDueByCutoff: learning / review due by the cutoff); NEW or not due = practice only.
     */
    fun practiceRatingCounts(queue: Int, dueMs: Long?, cutoffMs: Long): Boolean {
        if (queue == 0) return false
        return dueMs == null || dueMs <= cutoffMs
    }

    /** Port of practiceAfterRating: Again → to the back; anything else → out. */
    fun practiceAfterRating(queue: List<String>, cardId: String, rating: Int): List<String> {
        val rest = queue.filter { it != cardId }
        return if (rating == 0) rest + cardId else rest
    }

    /** Port of practiceCardIds: the note's card, else hanzi → meaning, else the first; no repeats. */
    fun practiceCardIds(notes: List<Pair<String?, String>>, cardsByNote: Map<String, List<Pair<String, String>>>): List<String> {
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        for ((cardId, noteId) in notes) {
            val cards = cardsByNote[noteId].orEmpty()
            val id = if (cardId != null && cards.any { it.first == cardId }) cardId
            else (cards.firstOrNull { it.second == CardTypes.HANZI_TO_MEANING } ?: cards.firstOrNull())?.first
            if (id != null && seen.add(id)) out += id
        }
        return out
    }

    /** Port of practiceHint. */
    fun practiceHint(counts: Boolean): String =
        if (counts) "Due today — your rating counts as a review" else "Practice only — not due, your schedule stays as it is"
}
