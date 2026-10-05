package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.Serializable
import java.text.Collator
import java.util.Locale

/*
 * The tutor's homework library (docs/HOMEWORK.md §9): one row per thing she sent a student —
 * a deck copy, a lesson, a reader, a link — with sent date, due date, progress % and status.
 * The worker builds the rows (buildHomeworkLibrary); the Lab displays them with the same
 * rules as the web. Port of shared/homework/library.ts (libraryStatus, statusTone,
 * filterLibrary, libraryCounts, mostRecentHomework, libraryDueText, sortLibrary,
 * dueDateChoices) — parity-tested (parity/fixtures/homework-library.ts,
 * HomeworkLibraryParityTest).
 */

/** Port of LibraryItem — the wire shape of GET …/homework-library rows (DTO and display model). */
@Serializable
data class LibraryItem(
    /** "<kind>:<target_id>" (a link: "link:<assignment id>"). */
    val key: String = "",
    /** 'deck' | 'lesson' | 'reader' | 'link'. */
    val kind: String = "deck",
    val relationship_id: String = "",
    val student_id: String = "",
    val student_name: String = "",
    val title: String = "",
    /** The tutor's master (deck / library item / reader / link); null when gone or unknown. */
    val source_id: String? = null,
    /** The student's copy; a link: the link id. */
    val target_id: String = "",
    /** shared_decks / shared_readers id (decks and readers). */
    val share_id: String? = null,
    /** ISO — when it was sent. */
    val sent_at: String = "",
    /** The open due date (earliest unfinished one-off part), else the last part's; null = none. */
    val due_date: String? = null,
    /** 'one_off' | 'fsrs' | 'both'; null = shared before assignments existed. */
    val mode: String? = null,
    /** 0..100 (a long_term deck: words met, shown as words, never as a %). */
    val percent: Int = 0,
    /** "5 / 12 words", "8 / 20 words met", "done", "not started", "read", "not read yet". */
    val progress: String = "",
    /** 'completed' | 'in_progress' | 'overdue' | 'not_started' | 'long_term'. */
    val status: String = HomeworkLibrary.NOT_STARTED,
    val completed_at: String? = null,
    val assignment_ids: List<String> = emptyList(),
    /** The assignment "Change due date" moves; null = none. */
    val due_assignment_id: String? = null,
    /** Deck: tutor words the student's copy does not have yet. */
    val behind: Int = 0,
    /** Link homework. */
    val url: String? = null,
    val instructions: String? = null,
    val thumbnail_url: String? = null,
    /** The student's note back when marking it done (newest). */
    val student_note: String? = null,
)

object HomeworkLibrary {
    const val COMPLETED = "completed"
    const val IN_PROGRESS = "in_progress"
    const val OVERDUE = "overdue"
    const val NOT_STARTED = "not_started"

    /**
     * A deck sent for long-term review only (fsrs, or shared before assignments): a deck in the
     * student's queue, not homework with an end — no %, never "In progress" (docs/HOMEWORK.md §11).
     */
    const val LONG_TERM = "long_term"

    /** LIBRARY_KINDS. */
    val KINDS = listOf("deck", "lesson", "reader", "link")

    /** LIBRARY_STATUSES (the filter chips' order). */
    val STATUSES = listOf(OVERDUE, IN_PROGRESS, NOT_STARTED, COMPLETED, LONG_TERM)

    /** LIBRARY_STATUS_LABELS. */
    val STATUS_LABELS = mapOf(
        COMPLETED to "Completed",
        IN_PROGRESS to "In progress",
        OVERDUE to "Overdue",
        NOT_STARTED to "Not started",
        LONG_TERM to "In long-term review",
    )

    /** LIBRARY_KIND_LABELS. */
    val KIND_LABELS = mapOf("deck" to "Words", "lesson" to "Lesson", "reader" to "Reader", "link" to "Link")

    /** LIBRARY_KIND_ICONS. */
    val KIND_ICONS = mapOf("deck" to "📚", "lesson" to "🎓", "reader" to "📖", "link" to "🔗")

    fun statusLabel(status: String): String = STATUS_LABELS[status] ?: status
    fun kindLabel(kind: String): String = KIND_LABELS[kind] ?: kind
    fun kindIcon(kind: String): String = KIND_ICONS[kind] ?: "📝"

    /** RECENT_BATCH_MS: items sent within this long of the newest belong to the same "most recent homework". */
    const val RECENT_BATCH_MS = 30 * 60 * 1000L
    const val RECENT_LIMIT = 3

    /**
     * Port of libraryStatus: a long-term deck is `long_term`; else Completed wins; then a due date
     * before today → Overdue; then started → In progress.
     */
    fun libraryStatus(complete: Boolean, started: Boolean, dueDate: String?, today: String, longTerm: Boolean = false): String {
        if (longTerm) return LONG_TERM
        if (complete) return COMPLETED
        if (!dueDate.isNullOrEmpty() && Homework.daysBetween(today, dueDate) < 0) return OVERDUE
        return if (started) IN_PROGRESS else NOT_STARTED
    }

    /** Port of statusTone: 'green' | 'blue' | 'amber' | 'red' | 'grey' (long-term: grey). */
    fun statusTone(status: String, dueDate: String?, today: String): String {
        if (status == LONG_TERM) return "grey"
        if (status == COMPLETED) return "green"
        if (status == OVERDUE) return "red"
        if (!dueDate.isNullOrEmpty() && Homework.daysBetween(today, dueDate) <= 1) return "amber"
        return if (status == IN_PROGRESS) "blue" else "grey"
    }

    private val collator: Collator = Collator.getInstance(Locale.ROOT)

    private val SQLITE_TIME = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}")
    private val HAS_ZONE = Regex("[Zz]|[+-][0-9]{2}:?[0-9]{2}$")

    /** Port of isoTime: SQLite's "2026-10-03 14:12:00" (UTC) → "2026-10-03T14:12:00Z"; anything else as is. */
    fun isoTime(value: String): String =
        if (SQLITE_TIME.containsMatchIn(value)) value.replaceFirst(" ", "T") + (if (HAS_ZONE.containsMatchIn(value)) "" else "Z") else value

    /** Port of sortLibrary: newest sent first by time (unparseable = 0), ties: title (`localeCompare`). */
    fun <T> sortLibrary(items: List<T>, sentAt: (T) -> String, title: (T) -> String): List<T> {
        fun t(x: String): Double = parseMs(isoTime(x)).let { if (it.isNaN()) 0.0 else it }
        return items.sortedWith { a, b ->
            val bySent = t(sentAt(b)).compareTo(t(sentAt(a)))
            if (bySent != 0) bySent else collator.compare(title(a), title(b))
        }
    }

    fun sortLibrary(items: List<LibraryItem>): List<LibraryItem> = sortLibrary(items, { it.sent_at }, { it.title })

    /** Port of filterLibrary: status, kind and free text over title and student name. */
    fun filterLibrary(items: List<LibraryItem>, status: String? = null, kind: String? = null, query: String? = null): List<LibraryItem> {
        val q = NoteSearch.jsLower(NoteSearch.jsTrim(query ?: ""))
        return items.filter { i ->
            (status.isNullOrEmpty() || i.status == status) &&
                (kind.isNullOrEmpty() || i.kind == kind) &&
                (q.isEmpty() || NoteSearch.jsLower(i.title).contains(q) || NoteSearch.jsLower(i.student_name).contains(q))
        }
    }

    /** Port of libraryCounts: how many items per status (every status present, 0 included). */
    fun libraryCounts(items: List<LibraryItem>): Map<String, Int> {
        val counts = linkedMapOf(COMPLETED to 0, IN_PROGRESS to 0, OVERDUE to 0, NOT_STARTED to 0, LONG_TERM to 0)
        for (i in items) counts[i.status] = (counts[i.status] ?: 0) + 1
        return counts
    }

    private fun parseMs(s: String): Double = try {
        Js.parseDate(s).toDouble()
    } catch (_: Exception) {
        Double.NaN
    }

    /** Port of mostRecentHomework: the newest item plus anything sent within 30 minutes of it, at most [limit]. */
    fun <T> mostRecentHomework(items: List<T>, sentAt: (T) -> String, title: (T) -> String, limit: Int = RECENT_LIMIT): List<T> {
        val sorted = sortLibrary(items, sentAt, title)
        if (sorted.isEmpty()) return emptyList()
        val newest = parseMs(sentAt(sorted[0]))
        // JS: `!(newest - Date.parse(sent_at) > RECENT_BATCH_MS)` — NaN keeps the item.
        return sorted.filter { i -> !(newest - parseMs(sentAt(i)) > RECENT_BATCH_MS) }.take(limit)
    }

    fun mostRecentHomework(items: List<LibraryItem>, limit: Int = RECENT_LIMIT): List<LibraryItem> =
        mostRecentHomework(items, { it.sent_at }, { it.title }, limit)

    /** Port of libraryDueText: "Due today" / "Due tomorrow" / "Was due 3 days ago" / "No due date". */
    fun libraryDueText(dueDate: String?, today: String): String {
        if (dueDate.isNullOrEmpty()) return "No due date"
        val days = Homework.daysBetween(today, dueDate)
        return when {
            days == 0 -> "Due today"
            days == 1 -> "Due tomorrow"
            days == -1 -> "Was due yesterday"
            days < 0 -> "Was due ${-days} days ago"
            else -> "Due in $days days"
        }
    }

    /** Port of dueDateChoices: today, tomorrow, +3, +7. */
    fun dueDateChoices(today: String): List<String> = listOf(0, 1, 3, 7).map { Homework.addDays(today, it) }

    /**
     * Port of itemStatus (shared/homework/items.ts): the student's own status chip on /homework
     * (docs/HOMEWORK.md §9 "Students") — complete = done, started = a word right or one to retry.
     */
    fun itemStatus(item: HomeworkItemView, today: String): String =
        libraryStatus(item.done, item.progress.done > 0 || item.progress.retrying > 0, item.assignment.due_date, today)
}
