package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.Serializable
import java.time.DateTimeException
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/*
 * Homework on the student's side (docs/HOMEWORK.md): due labels, the one-off pass, and
 * what the homework screens show. Port of shared/homework (due.ts, pass.ts, items.ts,
 * types.ts) — parity-tested against the TypeScript (parity/fixtures/homework.ts,
 * HomeworkParityTest). The DTOs are the wire shapes of GET /api/me/homework.
 */

@Serializable
data class HomeworkAssignment(
    val id: String,
    val relationship_id: String = "",
    val tutor_id: String = "",
    val student_id: String = "",
    val batch_id: String? = null,
    /** 'deck' | 'lesson' | 'reader' (free text: future kinds). */
    val kind: String,
    /** The STUDENT's copy: deck id / custom_lessons id / graded_readers id. */
    val target_id: String,
    val source_id: String? = null,
    val title: String = "",
    /** 'one_off' | 'fsrs' | 'both'. */
    val mode: String,
    /** 'YYYY-MM-DD' in the student's calendar; null for fsrs-only. */
    val due_date: String? = null,
    val item_ids: List<String>? = null,
    val item_count: Int = 0,
    val part_index: Int = 0,
    val part_count: Int = 1,
    /** 'active' | 'done' | 'cancelled'. */
    val status: String = "active",
    val done_count: Int = 0,
    val completed_at: String? = null,
    val created_at: String = "",
    val updated_at: String = "",
    val tutor_name: String? = null,
)

@Serializable
data class HomeworkEvent(
    /** Client-generated; uploads are idempotent by id. */
    val id: String,
    val assignment_id: String,
    /** Deck: a note id. Lesson / reader: the target id. */
    val item_id: String,
    /** 'right' | 'wrong' | 'done'. */
    val result: String,
    val created_at: String,
)

data class DueLabel(val text: String, val tone: String, val days: Int?)

data class PassProgress(
    val total: Int,
    val done: Int,
    val remaining: List<String>,
    val retrying: Int,
    val complete: Boolean,
)

data class HomeworkItemView(
    val assignment: HomeworkAssignment,
    val progress: PassProgress,
    val due: DueLabel,
    val done: Boolean,
)

data class TitleParts(val base: String, val part: String?)

object Homework {
    private val DATE_RE = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")

    fun hasOneOff(mode: String) = mode == "one_off" || mode == "both"
    fun hasFsrs(mode: String) = mode == "fsrs" || mode == "both"

    private fun parse(value: String): LocalDate? = try {
        LocalDate.of(value.substring(0, 4).toInt(), value.substring(5, 7).toInt(), value.substring(8, 10).toInt())
    } catch (_: DateTimeException) {
        null
    }

    /** Port of isDateString. */
    fun isDateString(value: String?): Boolean = value != null && DATE_RE.matches(value) && parse(value) != null

    /** Port of addDays. */
    fun addDays(date: String, days: Int): String = parse(date)!!.plusDays(days.toLong()).toString()

    /** Port of daysBetween. */
    fun daysBetween(from: String, to: String): Int = ChronoUnit.DAYS.between(parse(from)!!, parse(to)!!).toInt()

    /** Port of localDate: the device's calendar day. */
    fun localDate(today: LocalDate = LocalDate.now()): String = today.toString()

    /** Port of dueLabel. */
    fun dueLabel(due: String?, today: String): DueLabel {
        if (due.isNullOrEmpty() || !isDateString(due)) return DueLabel("", "none", null)
        val days = daysBetween(today, due)
        if (days < 0) return DueLabel("overdue", "overdue", days)
        if (days == 0) return DueLabel("due today", "today", days)
        return DueLabel("due in $days ${if (days == 1) "day" else "days"}", if (days <= 2) "soon" else "later", days)
    }

    /** Port of compareDue: earliest first, undated last. */
    fun compareDue(a: String?, b: String?): Int = when {
        !a.isNullOrEmpty() && !b.isNullOrEmpty() -> a.compareTo(b).coerceIn(-1, 1)
        !a.isNullOrEmpty() -> -1
        !b.isNullOrEmpty() -> 1
        else -> 0
    }

    private val DAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** Port of shortDay: "Tue 14 Oct". */
    fun shortDay(date: String): String {
        if (!isDateString(date)) return date
        val d = parse(date)!!
        return "${DAYS[d.dayOfWeek.value % 7]} ${d.dayOfMonth} ${MONTHS[d.monthValue - 1]}"
    }

    /** Port of passItemIds. */
    fun passItemIds(a: HomeworkAssignment): List<String> = if (a.kind == "deck") a.item_ids ?: emptyList() else listOf(a.target_id)

    /** Port of passProgress: unseen first (in order), then "Not yet" items oldest-wrong first. */
    fun passProgress(itemIds: List<String>, events: List<HomeworkEvent>): PassProgress {
        val wanted = itemIds.toHashSet()
        val right = HashSet<String>()
        val lastWrong = HashMap<String, String>()
        for (e in events) {
            if (e.item_id !in wanted) continue
            if (e.result == "right" || e.result == "done") right += e.item_id
            else if (e.result == "wrong") {
                val prev = lastWrong[e.item_id]
                if (prev == null || e.created_at > prev) lastWrong[e.item_id] = e.created_at
            }
        }
        val unique = LinkedHashSet(itemIds).toList()
        val unseen = unique.filter { it !in right && it !in lastWrong }
        val retry = unique.filter { it !in right && it in lastWrong }.sortedWith { a, b -> lastWrong.getValue(a).compareTo(lastWrong.getValue(b)) }
        val done = unique.count { it in right }
        return PassProgress(unique.size, done, unseen + retry, retry.size, unique.isNotEmpty() && done == unique.size)
    }

    fun nextPassItem(progress: PassProgress): String? = progress.remaining.firstOrNull()

    /** Port of passSummary: "12 words" / "5 of 12 words left" / "done". */
    fun passSummary(progress: PassProgress, kind: String): String {
        if (progress.complete) return "done"
        if (kind != "deck") return "not started"
        val left = progress.total - progress.done
        return if (progress.done == 0) "${progress.total} ${if (progress.total == 1) "word" else "words"}" else "$left of ${progress.total} words left"
    }

    /** Port of toHomeworkItems: one-off assignments with progress and due label. */
    fun toHomeworkItems(assignments: List<HomeworkAssignment>, events: List<HomeworkEvent>, today: String): List<HomeworkItemView> {
        val byAssignment = events.groupBy { it.assignment_id }
        return assignments.filter { it.mode != "fsrs" && it.status != "cancelled" }.map { a ->
            val progress = passProgress(passItemIds(a), byAssignment[a.id].orEmpty())
            HomeworkItemView(a, progress, dueLabel(a.due_date, today), a.status == "done" || progress.complete)
        }
    }

    data class Sorted(val todo: List<HomeworkItemView>, val done: List<HomeworkItemView>)

    /** Port of sortHomeworkItems. */
    fun sortHomeworkItems(items: List<HomeworkItemView>): Sorted {
        val todo = items.filter { !it.done }.sortedWith { x, y ->
            val a = x.assignment
            val b = y.assignment
            compareDue(a.due_date, b.due_date).takeIf { it != 0 }
                ?: (a.part_index - b.part_index).takeIf { it != 0 }
                ?: a.created_at.compareTo(b.created_at)
        }
        val done = items.filter { it.done }.sortedWith { x, y ->
            (y.assignment.completed_at ?: y.assignment.updated_at).compareTo(x.assignment.completed_at ?: x.assignment.updated_at)
        }
        return Sorted(todo, done)
    }

    /** Port of titleParts. */
    fun titleParts(a: HomeworkAssignment): TitleParts {
        if (a.part_count <= 1) return TitleParts(a.title, null)
        val part = "day ${a.part_index + 1} of ${a.part_count}"
        val suffix = " · $part"
        return TitleParts(if (a.title.endsWith(suffix)) a.title.dropLast(suffix.length) else a.title, part)
    }

    private val KIND_WORD = mapOf("lesson" to "mini lesson", "reader" to "reader")
    val KIND_ICON = mapOf("deck" to "📚", "lesson" to "🎓", "reader" to "📖")

    fun kindIcon(kind: String): String = KIND_ICON[kind] ?: "📝"

    /** Port of homeworkRowDetail. */
    fun rowDetail(item: HomeworkItemView, showTutor: Boolean): String {
        val a = item.assignment
        val part = titleParts(a).part
        val progress = if (a.kind == "deck") passSummary(item.progress, "deck") else if (item.done) "done" else KIND_WORD[a.kind] ?: a.kind
        val detail = if (part != null) "${part.replaceFirst(Regex("^d"), "D")} · $progress" else progress
        return detail +
            (if (a.mode == "both" && !item.done) " · then long-term review" else "") +
            (if (showTutor && !a.tutor_name.isNullOrEmpty()) " · from ${a.tutor_name}" else "")
    }

    /** Port of oneOffOnlyTargets: lessons / readers the study mix and daily reader leave out. */
    fun oneOffOnlyTargets(list: List<HomeworkAssignment>): Set<String> {
        val fsrs = list.filter { it.mode != "one_off" }.map { it.target_id }.toHashSet()
        return list.filter { it.mode == "one_off" && it.target_id !in fsrs }.map { it.target_id }.toSortedSet()
    }
}
