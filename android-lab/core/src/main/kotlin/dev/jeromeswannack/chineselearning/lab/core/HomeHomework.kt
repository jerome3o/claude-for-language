package dev.jeromeswannack.chineselearning.lab.core

/*
 * The student Home's compact homework card — port of shared/homework/home.ts, parity-tested
 * (parity/fixtures/home-homework.ts, HomeHomeworkParityTest). One slim row per active item:
 * title, "5 / 12", due label; a tap opens `route` (a web path, opened natively by LabNav).
 */

/** Port of LongTermHomework: an fsrs-mode assignment, or a deck / lesson a tutor sent before assignments existed. */
data class LongTermHomework(
    /** 'deck' | 'lesson'. */
    val kind: String,
    val targetId: String,
    val title: String,
    val tutorName: String?,
    val sentAt: String,
    val met: Int?,
    val total: Int?,
)

/** Port of HomeHomeworkRow. */
data class HomeHomeworkRow(
    val key: String,
    val kind: String,
    val icon: String,
    val title: String,
    val progress: String,
    val fraction: Double?,
    val due: String,
    val tone: String,
    val route: String,
    val tutorName: String?,
)

data class HomeHomeworkCard(val rows: List<HomeHomeworkRow>, val more: Int, val heading: String)

object HomeHomework {
    const val LIMIT = 4

    private val ICON = mapOf("deck" to "📚", "lesson" to "🎓", "reader" to "📖", "link" to "🔗")
    private val KIND_WORD = mapOf("lesson" to "lesson", "reader" to "reader", "link" to "link")

    /** Port of compactDue: "due in 1 day" reads as "due tomorrow". */
    fun compactDue(due: DueLabel): String = if (due.days == 1) "due tomorrow" else due.text

    /** Port of assignmentRoute: the pass (it hosts the lesson / reader player). */
    fun assignmentRoute(id: String): String = "/homework/$id"

    /** Port of longTermRoute. */
    fun longTermRoute(kind: String, targetId: String): String = if (kind == "deck") "/decks/$targetId" else "/lessons"

    /** Port of longTermActive. */
    fun longTermActive(item: LongTermHomework): Boolean {
        if (item.kind != "deck") return true
        if (item.met == null || item.total == null) return true
        return item.total > 0 && item.met < item.total
    }

    /** Port of wordsMet: notes with a card out of NEW, over all notes. */
    fun wordsMet(cards: List<Pair<String, Int>>, noteIds: List<String>): Pair<Int, Int> {
        val wanted = noteIds.toHashSet()
        val met = HashSet<String>()
        for ((noteId, queue) in cards) if (queue != 0 && noteId in wanted) met += noteId
        return met.size to wanted.size
    }

    /** Port of homeHomework. */
    fun build(todo: List<HomeworkItemView>, longTerm: List<LongTermHomework>, limit: Int = LIMIT, unreadFrom: String? = null): HomeHomeworkCard {
        val rows = ArrayList<HomeHomeworkRow>()
        val covered = HashSet<String>()
        for (item in todo) {
            if (item.done) continue
            val a = item.assignment
            covered += a.target_id
            val (progress, fraction) = if (a.kind != "deck") (KIND_WORD[a.kind] ?: a.kind) to null
            else "${item.progress.done} / ${item.progress.total}" to (if (item.progress.total > 0) item.progress.done.toDouble() / item.progress.total else 0.0)
            rows += HomeHomeworkRow(a.id, a.kind, ICON[a.kind] ?: "📝", a.title, progress, fraction, compactDue(item.due), item.due.tone, assignmentRoute(a.id), a.tutor_name)
        }
        val seen = HashSet<String>()
        val extra = longTerm.filter { it.targetId !in covered && longTermActive(it) }
            .sortedWith { a, b -> b.sentAt.compareTo(a.sentAt).coerceIn(-1, 1) }
        for (l in extra) {
            val key = "${l.kind}:${l.targetId}"
            if (!seen.add(key)) continue
            val known = l.kind == "deck" && l.met != null && l.total != null
            rows += HomeHomeworkRow(
                key = key,
                kind = l.kind,
                icon = ICON[l.kind] ?: "📝",
                title = l.title,
                progress = if (known) "${l.met} / ${l.total}" else if (l.kind == "lesson") "lesson" else "",
                fraction = if (known) (if (l.total!! > 0) l.met!!.toDouble() / l.total else 0.0) else null,
                due = if (l.kind == "deck") "daily review" else "next session",
                tone = "none",
                route = longTermRoute(l.kind, l.targetId),
                tutorName = l.tutorName,
            )
        }
        val shown = rows.take(limit)
        val names = LinkedHashSet<String>()
        for (r in rows) r.tutorName?.takeIf { it.isNotEmpty() }?.let { names += it }
        unreadFrom?.takeIf { it.isNotEmpty() }?.let { names += it }
        return HomeHomeworkCard(shown, rows.size - shown.size, if (names.size == 1) "From ${names.first()}" else "Homework")
    }
}
