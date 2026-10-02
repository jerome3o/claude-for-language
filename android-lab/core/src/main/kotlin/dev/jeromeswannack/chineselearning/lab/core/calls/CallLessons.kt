package dev.jeromeswannack.chineselearning.lab.core.calls

/**
 * Port of shared/calls/lessons.ts — calls between the same two people (a tutor relationship, or
 * one person's solo test calls) that follow each other within [LESSON_GAP_MS] are ONE lesson. The
 * server assigns `lesson_id`; the Past calls list shows one entry per lesson ([groupCallsByLesson])
 * and the review page, report and homework cover the whole lesson. Parity-tested against the
 * TypeScript (parity/fixtures/calls-lessons.ts → CallsLessonsParityTest).
 */
object CallLessons {
    const val LESSON_GAP_MS = 20 * 60_000L

    /** A call for [groupIntoLessons]: [scope] = the relationship id, or `solo:<user id>`; [end] null while live. */
    data class LessonCall(val id: String, val scope: String, val start: Long, val end: Long?)

    /** Port of continuesLesson: does a call starting at [start] continue a lesson whose latest call ended at [lastEnd] (null = still live)? */
    fun continuesLesson(lastEnd: Long?, start: Long): Boolean = lastEnd == null || start - lastEnd <= LESSON_GAP_MS

    /** Port of groupIntoLessons: lesson id (= the id of its first call) per call id. */
    fun groupIntoLessons(calls: List<LessonCall>): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        val byScope = LinkedHashMap<String, MutableList<LessonCall>>()
        for (c in calls) byScope.getOrPut(c.scope) { ArrayList() }.add(c)
        for (list in byScope.values) {
            // a.start - b.start || (a.id < b.id ? -1 : 1)
            val sorted = list.sortedWith { a, b -> if (a.start != b.start) a.start.compareTo(b.start) else if (a.id < b.id) -1 else 1 }
            var lesson: String? = null
            var lastEnd: Long? = 0L
            for (c in sorted) {
                if (lesson == null || !continuesLesson(lastEnd, c.start)) {
                    lesson = c.id
                    lastEnd = c.end
                } else if (lastEnd != null) {
                    lastEnd = if (c.end == null) null else maxOf(lastEnd, c.end)
                }
                out[c.id] = lesson
            }
        }
        return out
    }

    /** Port of lessonOpen: is a lesson still open for a new call (last call ended under LESSON_GAP_MS ago, or one is live)? */
    fun lessonOpen(lastEnd: Long?, anyLive: Boolean, now: Long): Boolean = anyLive || (lastEnd != null && now - lastEnd <= LESSON_GAP_MS)

    data class Group<T>(val lessonId: String, val calls: List<T>)

    /**
     * Port of groupCallsByLesson: the Past calls list — one entry per lesson (newest lesson first),
     * its calls oldest first inside. Calls without a lesson id stand alone (`call:<id>`).
     * `created_at` strings are compared like JS `<` (UTF-16 code units = Kotlin String order).
     */
    fun <T> groupCallsByLesson(calls: List<T>, id: (T) -> String, lessonId: (T) -> String?, createdAt: (T) -> String): List<Group<T>> {
        val groups = LinkedHashMap<String, MutableList<T>>()
        for (c in calls) {
            val key = lessonId(c)?.takeIf { it.isNotEmpty() } ?: "call:${id(c)}"
            groups.getOrPut(key) { ArrayList() }.add(c)
        }
        val out = groups.entries.map { (k, list) -> Group(k, list.sortedWith { a, b -> createdAt(a).compareTo(createdAt(b)).coerceIn(-1, 1) }) }
        fun newest(g: Group<T>) = createdAt(g.calls.last())
        return out.sortedWith { a, b -> newest(b).compareTo(newest(a)).coerceIn(-1, 1) }
    }
}
