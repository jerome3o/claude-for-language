package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.Serializable

/**
 * A mini lesson RUN — port of shared/study/lessonRun.ts, parity-tested (parity/fixtures/lesson-run.ts
 * → LessonRunParityTest): the exercises it plays, where it stands, the retry round at the end, and the
 * saved copy that lets it continue later (another day, after a restart, offline).
 *
 * Jerome (Oct 2026): "Make sure homework progress isn't lost over multiple days." The Lab app used to
 * drop a saved run on another local day, after 18 h, or when the spec's JSON changed at all (a picture
 * drawn later, a pinyin fix) — `LessonResume`. Now a run waits until it is finished or started over,
 * keyed on the lesson's SHAPE (the exercise types in order).
 *
 * The retry round: every scored exercise answered wrong on the main pass is owed; after the last
 * exercise the owed ones come back until each is right (wrong again → the back of the queue).
 */
object LessonRun {
    /** One exercise in a run's play order. */
    data class Step(val key: String, val section: Int, val index: Int, val type: String, val scored: Boolean)

    /** Where a run stands. [retried] = retries answered so far, right or wrong (a step of the bar each). */
    @Serializable
    data class State(val pos: Int = 0, val owed: List<String> = emptyList(), val fixed: Int = 0, val retried: Int = 0)

    val NEW_RUN = State()

    data class Current(val step: Step, /** "main" | "retry" */ val phase: String)

    /** What an exercise is called in the bar's label. */
    val EXERCISE_UNIT = RetryBarUnit("exercise", "exercises")

    private val SCOREABLE = setOf(
        "scramble", "choice", "translate", "match", "describe_image", "speak", "listen_choice", "listen_translate",
        "sentence_making", "write_typed", "write_handwriting", "dictation", "oral_expression", "conversation",
        "judge", "gap_choice",
    )

    /** Port of exerciseKey. */
    fun exerciseKey(section: Int, index: Int) = "s${section}e$index"

    /** Port of lessonSteps over a spec. */
    fun steps(spec: CustomLessonSpec, only: List<String>? = null): List<Step> =
        stepsOfTypes(spec.sections.map { s -> s.exercises.map { it.type } }, only)

    /** Port of lessonSteps over the exercise types per section: [only] = a revision's scored keys (+ the note before each). */
    fun stepsOfTypes(sections: List<List<String>>, only: List<String>? = null): List<Step> {
        val all = ArrayList<Step>()
        sections.forEachIndexed { si, types -> types.forEachIndexed { i, t -> all += Step(exerciseKey(si, i), si, i, t, t in SCOREABLE) } }
        if (only == null) return all
        val wanted = only.toHashSet()
        val keep = HashSet<String>()
        all.forEachIndexed { n, st ->
            if (st.key !in wanted || !st.scored) return@forEachIndexed
            keep += st.key
            var k = n - 1
            while (k >= 0 && all[k].section == st.section) {
                if (all[k].type == "note") { keep += all[k].key; break }
                k--
            }
        }
        return all.filter { it.key in keep }
    }

    /** Port of lessonShape: the exercise types in order — a saved run continues while it is unchanged. */
    fun shape(spec: CustomLessonSpec): String = shapeOfTypes(spec.sections.map { s -> s.exercises.map { it.type } })

    fun shapeOfTypes(sections: List<List<String>>): String = sections.joinToString("|") { it.joinToString(",") }

    /** Port of runCurrent: what is on screen now; null when the run is finished. */
    fun current(state: State, steps: List<Step>): Current? {
        if (state.pos < steps.size) return Current(steps[state.pos], "main")
        for (key in state.owed) {
            val st = steps.firstOrNull { it.key == key }
            if (st != null) return Current(st, "retry")
        }
        return null
    }

    fun finished(state: State, steps: List<Step>): Boolean = current(state, steps) == null

    /** Port of advanceRun. [correct] = the verdict (null = unscored). */
    fun advance(state: State, steps: List<Step>, correct: Boolean?): State {
        val cur = current(state, steps) ?: return state
        if (cur.phase == "main") {
            val owe = cur.step.scored && correct == false && cur.step.key !in state.owed
            return State(state.pos + 1, if (owe) state.owed + cur.step.key else state.owed, state.fixed, state.retried)
        }
        val rest = state.owed.filter { it != cur.step.key }
        val retried = state.retried + 1
        if (correct == false) return State(state.pos, rest + cur.step.key, state.fixed, retried)
        return State(state.pos, rest, state.fixed + 1, retried)
    }

    /** Port of runRetryBar: the homework pass's retry bar, one slot per showing of an exercise. */
    fun retryBar(state: State, steps: List<Step>): RetryBar {
        val owed = state.owed.count { k -> steps.any { it.key == k } }
        val pos = Math.min(Math.max(0, state.pos), steps.size)
        return RetryBars.retryBar(answered = pos + state.retried, fresh = steps.size - pos, retries = owed, itemsDone = pos - owed, items = steps.size)
    }

    /** Port of verdictWrong: a conversation with any question missed is wrong. */
    fun verdictWrong(correct: Boolean?, points: Int, maxPoints: Int): Boolean {
        if (correct == null || maxPoints <= 0) return false
        return correct == false || points < maxPoints
    }

    /** Port of canResumeRun: same lesson, same shape, something answered — never bounded by day or age. */
    fun canResume(lessonId: String?, shape: String?, state: State?, forLesson: String, forShape: String): Boolean {
        if (state == null || lessonId != forLesson || shape != forShape) return false
        if (state.pos < 0) return false
        return state.pos > 0 || state.fixed > 0
    }

    /** Port of resumeLine: "Continue where you left off (7 of 18)". */
    fun resumeLine(state: State, steps: List<Step>): String {
        if (state.pos < steps.size) return "Continue where you left off (${state.pos + 1} of ${steps.size})"
        val owed = retryBar(state, steps).retries
        if (owed == 0) return "Continue where you left off (all done)"
        return "Continue where you left off ($owed ${if (owed == 1) "mistake" else "mistakes"} to put right)"
    }

    /** Port of retryLine. */
    fun retryLine(owedLeft: Int): String =
        if (owedLeft <= 1) "Let's put this one right · last one" else "Let's put this one right · $owedLeft left"

    /** Port of retryMediaKey. */
    fun retryMediaKey(section: Int, index: Int, retry: Int): String =
        if (retry > 0) "${exerciseKey(section, index)}r$retry" else exerciseKey(section, index)

    /** Port of retryNumber: the retry number the next row of [key] gets. */
    fun retryNumber(attempts: List<ExerciseAttempt>, key: String): Int {
        var n = 0
        for (a in attempts) if ((a.retry ?: 0) > 0 && exerciseKey(a.section, a.index) == key) n = Math.max(n, a.retry ?: 0)
        return n + 1
    }
}
