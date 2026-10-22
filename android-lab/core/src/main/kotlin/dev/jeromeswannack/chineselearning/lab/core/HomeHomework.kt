package dev.jeromeswannack.chineselearning.lab.core

/*
 * The student Home's compact homework card — port of shared/homework/home.ts, parity-tested
 * (parity/fixtures/home-homework.ts, HomeHomeworkParityTest). One slim row per active item:
 * title, "5 / 12", its size ("18 exercises · ~12 min", "12 words", "6 pages"), due label; a tap
 * opens `route` (a web path, opened natively by LabNav). Rows: one-off passes still to do, then
 * mini lesson REVISIONS due (LessonRevision), then NEW mini lessons not in an assignment row —
 * mini lessons are no longer in the study session. Never a long-term deck.
 */

/** Port of HomeLesson: a mini lesson as Home's card sees it. [status] = "new" | "revision" | "done". */
data class HomeLesson(
    val id: String,
    val title: String,
    val createdAt: String,
    val status: String,
    val locked: Boolean,
    val revisionDue: Boolean,
    val revision: Int,
    val dueMs: Long?,
    val size: String,
    val tutorName: String?,
)

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
    /** "18 exercises · ~12 min", "5 questions · ~4 min", "12 words", "6 pages"; "" when unknown. */
    val size: String,
    val fraction: Double?,
    val due: String,
    val tone: String,
    val route: String,
    val tutorName: String?,
)

data class HomeHomeworkCard(val rows: List<HomeHomeworkRow>, val more: Int, val heading: String)

object HomeHomework {
    const val LIMIT = 4

    private val ICON = mapOf("deck" to "📚", "lesson" to "🎓", "reader" to "📖", "link" to "🔗", "revision" to "🔁")

    /** Port of lessonPlayRoute: the run (its revision when one is due). */
    fun lessonPlayRoute(lessonId: String, revision: Boolean, from: String = "home"): String =
        "/lessons/$lessonId/play?from=$from" + (if (revision) "&mode=revision" else "")
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
    fun build(
        todo: List<HomeworkItemView>,
        longTerm: List<LongTermHomework>,
        limit: Int = LIMIT,
        unreadFrom: String? = null,
        sizes: Map<String, String> = emptyMap(),
        lessons: List<HomeLesson> = emptyList(),
    ): HomeHomeworkCard {
        val rows = ArrayList<HomeHomeworkRow>()
        val covered = HashSet<String>()
        for (item in todo) {
            if (item.done) continue
            val a = item.assignment
            covered += a.target_id
            val (progress, fraction) = if (a.kind != "deck") (KIND_WORD[a.kind] ?: a.kind) to null
            else "${item.progress.done} / ${item.progress.total}" to (if (item.progress.total > 0) item.progress.done.toDouble() / item.progress.total else 0.0)
            val size = if (a.kind == "deck") HomeworkSize.deckSizeLabel(item.progress.total) else sizes[a.target_id] ?: ""
            rows += HomeHomeworkRow(a.id, a.kind, ICON[a.kind] ?: "📝", a.title, progress, size, fraction, compactDue(item.due), item.due.tone, assignmentRoute(a.id), a.tutor_name)
        }
        val tutorOf = HashMap<String, String?>()
        for (l in longTerm) if (l.kind == "lesson") tutorOf[l.targetId] = l.tutorName
        val open = lessons.filter { !it.locked && it.id !in covered }
        val byCreated = Comparator<HomeLesson> { a, b ->
            val c = a.createdAt.compareTo(b.createdAt)
            if (c != 0) c.coerceIn(-1, 1) else a.id.compareTo(b.id).coerceIn(-1, 1)
        }
        val revisions = open.filter { it.status == "revision" && it.revisionDue }
            .sortedWith { a, b -> val d = (a.dueMs ?: 0L).compareTo(b.dueMs ?: 0L); if (d != 0) d else byCreated.compare(a, b) }
        for (l in revisions) {
            covered += l.id
            rows += HomeHomeworkRow(
                key = "revision:${l.id}", kind = "revision", icon = ICON["revision"]!!, title = l.title,
                progress = if (l.revision > 0) "Revision ${l.revision}" else "Revision", size = l.size, fraction = null,
                due = "due today", tone = "today", route = lessonPlayRoute(l.id, true), tutorName = l.tutorName ?: tutorOf[l.id],
            )
        }
        for (l in open.filter { it.status == "new" && it.id !in covered }.sortedWith(byCreated)) {
            covered += l.id
            rows += HomeHomeworkRow(
                key = "lesson:${l.id}", kind = "lesson", icon = ICON["lesson"]!!, title = l.title,
                progress = "new", size = l.size, fraction = null,
                due = "", tone = "none", route = lessonPlayRoute(l.id, false), tutorName = l.tutorName ?: tutorOf[l.id],
            )
        }
        val shown = rows.take(limit)
        val names = LinkedHashSet<String>()
        var anyOwn = false
        for (r in rows) {
            val n = r.tutorName
            if (!n.isNullOrEmpty()) names += n else anyOwn = true
        }
        unreadFrom?.takeIf { it.isNotEmpty() }?.let { names += it }
        val heading = when {
            names.size == 1 && !anyOwn -> "From ${names.first()}"
            names.isEmpty() && rows.isNotEmpty() -> "To do"
            else -> "Homework"
        }
        return HomeHomeworkCard(shown, rows.size - shown.size, heading)
    }
}
