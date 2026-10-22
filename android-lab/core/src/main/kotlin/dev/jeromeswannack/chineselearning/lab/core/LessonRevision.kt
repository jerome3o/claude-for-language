package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.Serializable

/**
 * Mini lessons come back as REVISIONS until everything is right first time — port of
 * shared/study/lessonRevision.ts, parity-tested (parity/fixtures/lesson-revision.ts →
 * LessonRevisionParityTest; docs/STUDY_SESSION.md "Mini lessons: revise until right first time").
 *
 * - A finished run's OUTCOME ([runOutcome], from its attempt's main-pass rows): the scored
 *   exercises it asked and the ones missed first time.
 * - The LATEST run decides: nothing missed → done forever; else a revision, due
 *   [GAP_DAYS] after it.
 * - A revision ([revisionKeys]) = every exercise missed last time + a few the learner got
 *   (20 %, 1–3, seeded, spread across exercise types).
 * - Before Oct 2026: a finish without an outcome follows its rating (Again / Hard → a revision of
 *   the whole lesson, else done); "Done for good" (a retire mark) = done forever, "Bring back" undoes it.
 */
object LessonRevision {
    /** Port of LESSON_REVISION_GAP_DAYS. */
    const val GAP_DAYS = 7
    const val EXTRA_SHARE = 0.2
    const val EXTRA_MIN = 1
    const val EXTRA_MAX = 3
    private const val DAY_MS = 24L * 60 * 60 * 1000

    /** Port of LessonRunOutcome. */
    @Serializable
    data class Outcome(val keys: List<String> = emptyList(), val missed: List<String> = emptyList())

    /** Port of LessonRunRecord: [outcome] null = a legacy finish (its [rating] decides). */
    data class RunRecord(val id: String, val at: String, val outcome: Outcome?, val rating: Int?)

    /** Port of LessonMarkRecord: "retire" | "restore". */
    data class MarkRecord(val id: String, val at: String, val action: String)

    /** Port of LessonLearnState. [status] = "new" | "revision" | "done". */
    data class State(
        val status: String,
        val dueMs: Long?,
        val revision: Int,
        val missed: List<String>,
        val full: Boolean,
        val runs: Int,
        val lastMs: Long?,
        val lastRunId: String?,
    )

    val NEW = State("new", null, 0, emptyList(), false, 0, null, null)

    private val KEY_RE = Regex("^s[0-9]{1,3}e[0-9]{1,3}$")

    /** Port of runOutcome: main-pass scored rows only (a conversation with a missed question is missed). */
    fun runOutcome(attempt: LessonAttemptData?): Outcome? {
        if (attempt == null) return null
        val keys = ArrayList<String>()
        val missed = ArrayList<String>()
        for (row in attempt.exercises) {
            if ((row.retry ?: 0) > 0) continue
            val correct = row.correct ?: continue
            if (row.maxPoints <= 0) continue
            val key = LessonRun.exerciseKey(row.section, row.index)
            if (key in keys) continue
            keys += key
            val wrong = !correct || row.points < row.maxPoints
            if (wrong) missed += key
        }
        return Outcome(keys, missed)
    }

    /** Port of parseRunOutcome over an already-decoded outcome (keys checked, missed ⊆ keys, deduped). */
    fun clean(o: Outcome?): Outcome? {
        if (o == null) return null
        val keys = o.keys.filter { KEY_RE.matches(it) }.take(200)
        val set = keys.toHashSet()
        val missed = o.missed.filter { it in set }
        return Outcome(keys.distinct(), missed.distinct())
    }

    private fun ms(iso: String): Long = runCatching { Js.parseDate(iso) }.getOrDefault(0L)

    private data class Ev(val id: String, val at: String, val run: RunRecord? = null, val mark: MarkRecord? = null)

    private data class Result(val imperfect: Boolean, val missed: List<String>, val full: Boolean)

    private fun runImperfect(run: RunRecord): Result {
        if (run.outcome != null) return Result(run.outcome.missed.isNotEmpty(), run.outcome.missed, false)
        val imperfect = run.rating == 0 || run.rating == 1
        return Result(imperfect, emptyList(), imperfect)
    }

    /** Port of computeLessonLearnState: the latest run decides; a later Done for good (until a Bring back) makes it done. */
    fun state(runs: List<RunRecord>, marks: List<MarkRecord> = emptyList()): State {
        val events = runs.map { Ev(it.id, it.at, run = it) } + marks.map { Ev(it.id, it.at, mark = it) }
        val sorted = events.sortedWith { a, b ->
            val d = ms(a.at).compareTo(ms(b.at))
            if (d != 0) d else a.id.compareTo(b.id).coerceIn(-1, 1)
        }
        var retired = false
        var count = 0
        var streak = 0
        var last: RunRecord? = null
        var lastResult = Result(false, emptyList(), false)
        for (e in sorted) {
            if (e.run != null) {
                count++
                last = e.run
                lastResult = runImperfect(e.run)
                streak = if (lastResult.imperfect) streak + 1 else 0
                retired = false
            } else if (e.mark != null) {
                retired = e.mark.action == "retire"
            }
        }
        val lastMs = last?.let { ms(it.at) }
        if (retired) return State("done", null, 0, emptyList(), false, count, lastMs, last?.id)
        if (last == null) return NEW
        if (!lastResult.imperfect) return State("done", null, 0, emptyList(), false, count, lastMs, last.id)
        return State("revision", (lastMs ?: 0L) + GAP_DAYS * DAY_MS, streak, lastResult.missed, lastResult.full, count, lastMs, last.id)
    }

    /** Port of isRevisionDue: due by the study cutoff (the end of today). */
    fun isDue(state: State, cutoffMs: Long): Boolean = state.status == "revision" && state.dueMs != null && state.dueMs <= cutoffMs

    /** Port of revisionDaysAway. */
    fun daysAway(state: State, cutoffMs: Long): Int {
        if (state.status != "revision" || state.dueMs == null || state.dueMs <= cutoffMs) return 0
        return Math.ceil((state.dueMs - cutoffMs).toDouble() / DAY_MS).toInt()
    }

    /** Port of fnv1a32 over UTF-16 code units (unsigned). */
    fun fnv1a32(text: String): Long {
        var h = 0x811c9dc5.toInt()
        for (c in text) {
            h = h xor c.code
            h *= 0x01000193
        }
        return h.toLong() and 0xffffffffL
    }

    /** Port of revisionExtraCount. */
    fun extraCount(candidates: Int): Int {
        if (candidates <= 0) return 0
        val n = Math.floor(candidates * EXTRA_SHARE + 0.5).toInt()
        return Math.min(candidates, Math.max(EXTRA_MIN, Math.min(EXTRA_MAX, n)))
    }

    /** Port of revisionKeys: every missed one + [extraCount] of the others, round-robin across types. */
    fun revisionKeys(state: State, steps: List<LessonRun.Step>, lessonId: String): List<String> {
        val scored = steps.filter { it.scored }
        val missedSet = state.missed.toHashSet()
        val missed = scored.filter { it.key in missedSet }
        if (state.full || missed.isEmpty()) return scored.map { it.key }
        val candidates = scored.filter { it.key !in missedSet }
        val want = extraCount(candidates.size)
        val seed = "$lessonId:${state.lastRunId ?: ""}"
        val ranked = candidates.map { it to fnv1a32("$seed|${it.key}") }
            .sortedWith { a, b ->
                val d = a.second.compareTo(b.second)
                if (d != 0) d else a.first.key.compareTo(b.first.key).coerceIn(-1, 1)
            }
        val types = ArrayList<String>()
        val byType = LinkedHashMap<String, MutableList<LessonRun.Step>>()
        for ((s, _) in ranked) {
            val list = byType[s.type]
            if (list != null) list += s else { byType[s.type] = mutableListOf(s); types += s.type }
        }
        val picked = LinkedHashSet<String>()
        var round = 0
        while (picked.size < want) {
            var any = false
            for (t in types) {
                val list = byType[t]!!
                if (round < list.size && picked.size < want) { picked += list[round].key; any = true }
            }
            if (!any) break
            round++
        }
        return scored.filter { it.key in missedSet || it.key in picked }.map { it.key }
    }

    /** Port of revisionTitle: "Revision 2". */
    fun title(state: State): String = if (state.revision > 0) "Revision ${state.revision}" else "Revision"

    /** Port of toGetRightLabel. */
    fun toGetRightLabel(state: State, scoredCount: Int): String {
        val n = if (state.full || state.missed.isEmpty()) scoredCount else state.missed.size
        return "$n to get right"
    }

    /** Port of revisionDueText. */
    fun dueText(state: State, cutoffMs: Long): String {
        val d = daysAway(state, cutoffMs)
        return if (d == 0) "due today" else if (d == 1) "due tomorrow" else "in $d days"
    }

    /** Port of runEndLine. */
    fun runEndLine(outcome: Outcome, revision: Boolean): String {
        if (outcome.missed.isEmpty()) {
            return if (revision) "All right first time — this lesson is done for good! 🎉" else "All right first time — done for good! 🎉"
        }
        val n = outcome.missed.size
        return "Back in a week as a revision: the $n you missed first time + a few you got"
    }
}
