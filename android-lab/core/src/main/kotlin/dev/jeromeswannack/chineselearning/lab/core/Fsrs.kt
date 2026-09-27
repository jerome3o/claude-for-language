package dev.jeromeswannack.chineselearning.lab.core

/**
 * A line-by-line port of the parts of ts-fsrs 5.2.3 the app uses:
 * `fsrs(generatorParameters({...enable_short_term: true}))`, `next()` and
 * `get_retrievability()` with the BasicScheduler, BasicLearningStepsStrategy and
 * the default (time/reps/d·s) fuzz seed.
 *
 * Keep the arithmetic in the same order as the JavaScript — floating point is not
 * associative, and the parity fixtures compare results exactly.
 * Source: node_modules/ts-fsrs/dist/index.mjs.
 */

enum class FsrsState(val value: Int) {
    New(0), Learning(1), Review(2), Relearning(3);

    companion object {
        fun of(value: Int): FsrsState = entries.first { it.value == value }
    }
}

/** ts-fsrs Grade: Again = 1 … Easy = 4. */
object Grade {
    const val AGAIN = 1
    const val HARD = 2
    const val GOOD = 3
    const val EASY = 4
}

data class FsrsCard(
    val due: Long,
    val stability: Double,
    val difficulty: Double,
    val elapsedDays: Long,
    val scheduledDays: Long,
    val learningSteps: Int,
    val reps: Int,
    val lapses: Int,
    val state: FsrsState,
    val lastReview: Long?,
)

data class FsrsParameters(
    val requestRetention: Double,
    val maximumInterval: Double,
    val w: List<Double>,
    val enableFuzz: Boolean,
    val enableShortTerm: Boolean,
    val learningSteps: List<String>,
    val relearningSteps: List<String>,
) {
    companion object {
        /** `generatorParameters(props)` for a 21-weight FSRS-6 parameter set. */
        fun generate(
            requestRetention: Double = 0.9,
            maximumInterval: Double = 36500.0,
            w: List<Double>,
            enableFuzz: Boolean = false,
            enableShortTerm: Boolean = true,
            learningSteps: List<String> = listOf("1m", "10m"),
            relearningSteps: List<String> = listOf("10m"),
        ): FsrsParameters {
            require(w.size == 21) { "Only 21-weight (FSRS-6) parameters are supported" }
            return FsrsParameters(
                requestRetention = requestRetention,
                maximumInterval = maximumInterval,
                w = clipParameters(w, relearningSteps.size, enableShortTerm),
                enableFuzz = enableFuzz,
                enableShortTerm = enableShortTerm,
                learningSteps = learningSteps,
                relearningSteps = relearningSteps,
            )
        }

        private fun clipParameters(parameters: List<Double>, numRelearningSteps: Int, enableShortTerm: Boolean): List<Double> {
            var ceiling = 2.0
            if (Math.max(0, numRelearningSteps) > 1) {
                val value = -(StrictMath.log(parameters[11]) + StrictMath.log(StrictMath.pow(2.0, parameters[13]) - 1) + parameters[14] * 0.3) / numRelearningSteps
                ceiling = clamp(Js.toFixed8(value), 0.01, 2.0)
            }
            val bounds = listOf(
                S_MIN to INIT_S_MAX, S_MIN to INIT_S_MAX, S_MIN to INIT_S_MAX, S_MIN to INIT_S_MAX,
                1.0 to 10.0, 1e-3 to 4.0, 1e-3 to 4.0, 1e-3 to 0.75, 0.0 to 4.5, 0.0 to 0.8,
                1e-3 to 3.5, 1e-3 to 5.0, 1e-3 to 0.25, 1e-3 to 0.9, 0.0 to 4.0, 0.0 to 1.0,
                1.0 to 6.0, 0.0 to ceiling, 0.0 to ceiling,
                (if (enableShortTerm) 0.01 else 0.0) to 0.8,
                0.1 to 0.8,
            )
            return parameters.mapIndexed { i, p -> clamp(p, bounds[i].first, bounds[i].second) }
        }
    }
}

internal const val S_MIN = 1e-3
internal const val S_MAX = 36500.0
private const val INIT_S_MAX = 100.0
private const val DAY_MS = 86_400_000L
private const val MINUTE_MS = 60_000L

internal fun clamp(value: Double, min: Double, max: Double): Double = Math.min(Math.max(value, min), max)

/** ts-fsrs `dateDiffInDays`: whole UTC calendar days from [last] to [cur]. */
internal fun dateDiffInDays(last: Long, cur: Long): Long = Math.floorDiv(cur, DAY_MS) - Math.floorDiv(last, DAY_MS)

private fun dateScheduler(now: Long, t: Long, isDay: Boolean): Long = if (isDay) now + t * DAY_MS else now + t * MINUTE_MS

private fun stepToMinutes(step: String): Long {
    val unit = step.last()
    val value = step.dropLast(1).toLong()
    return when (unit) {
        'm' -> value
        'h' -> value * 60
        'd' -> value * 1440
        else -> error("Invalid step unit: $step")
    }
}

/** The Alea PRNG ts-fsrs uses for interval fuzz. */
internal class Alea(seed: String) {
    private var c = 1.0
    private var s0: Double
    private var s1: Double
    private var s2: Double

    init {
        val mash = Mash()
        s0 = mash(" ")
        s1 = mash(" ")
        s2 = mash(" ")
        s0 -= mash(seed); if (s0 < 0) s0 += 1
        s1 -= mash(seed); if (s1 < 0) s1 += 1
        s2 -= mash(seed); if (s2 < 0) s2 += 1
    }

    fun next(): Double {
        val t = 2091639 * s0 + c * 2.3283064365386963e-10
        s0 = s1
        s1 = s2
        c = Js.toInt32(t)
        s2 = t - c
        return s2
    }

    private class Mash {
        private var n = 4022871197.0
        operator fun invoke(data: String): Double {
            for (ch in data) {
                n += ch.code
                var h = 0.02519603282416938 * n
                n = Js.toUint32(h)
                h -= n
                h *= n
                n = Js.toUint32(h)
                h -= n
                n += h * 4294967296.0
            }
            return Js.toUint32(n) * 2.3283064365386963e-10
        }
    }
}

class Fsrs(val param: FsrsParameters) {
    private val decay: Double = -param.w[20]
    private val factor: Double = Js.toFixed8(StrictMath.exp(StrictMath.pow(decay, -1.0) * StrictMath.log(0.9)) - 1)
    val intervalModifier: Double = run {
        require(param.requestRetention > 0 && param.requestRetention <= 1)
        Js.toFixed8((StrictMath.pow(param.requestRetention, 1 / decay) - 1) / factor)
    }
    internal var seed: String = ""

    fun forgettingCurve(elapsedDays: Double, stability: Double): Double =
        Js.toFixed8(StrictMath.pow(1 + factor * elapsedDays / stability, decay))

    fun initStability(g: Int): Double = Math.max(param.w[g - 1], 0.1)

    fun initDifficulty(g: Int): Double {
        val d = param.w[4] - StrictMath.exp((g - 1) * param.w[5]) + 1
        return Js.toFixed8(d)
    }

    fun applyFuzz(ivl: Double, elapsedDays: Long): Double {
        if (!param.enableFuzz || ivl < 2.5) return Js.round(ivl)
        val fuzzFactor = Alea(seed).next()
        var delta = 1.0
        for ((start, end, f) in FUZZ_RANGES) {
            delta += f * Math.max(Math.min(ivl, end) - start, 0.0)
        }
        val interval = Math.min(ivl, param.maximumInterval)
        var minIvl = Math.max(2.0, Js.round(interval - delta))
        val maxIvl = Math.min(Js.round(interval + delta), param.maximumInterval)
        if (interval > elapsedDays) minIvl = Math.max(minIvl, (elapsedDays + 1).toDouble())
        minIvl = Math.min(minIvl, maxIvl)
        return Math.floor(fuzzFactor * (maxIvl - minIvl + 1) + minIvl)
    }

    fun nextInterval(s: Double, elapsedDays: Long): Long {
        val newInterval = Math.min(Math.max(1.0, Js.round(s * intervalModifier)), param.maximumInterval)
        return applyFuzz(newInterval, elapsedDays).toLong()
    }

    private fun linearDamping(deltaD: Double, oldD: Double): Double = Js.toFixed8(deltaD * (10 - oldD) / 9)

    fun nextDifficulty(d: Double, g: Int): Double {
        val deltaD = -param.w[6] * (g - 3)
        val nextD = d + linearDamping(deltaD, d)
        return clamp(meanReversion(initDifficulty(Grade.EASY), nextD), 1.0, 10.0)
    }

    private fun meanReversion(init: Double, current: Double): Double =
        Js.toFixed8(param.w[7] * init + (1 - param.w[7]) * current)

    fun nextRecallStability(d: Double, s: Double, r: Double, g: Int): Double {
        val hardPenalty = if (g == Grade.HARD) param.w[15] else 1.0
        val easyBound = if (g == Grade.EASY) param.w[16] else 1.0
        return Js.toFixed8(
            clamp(
                s * (1 + StrictMath.exp(param.w[8]) * (11 - d) * StrictMath.pow(s, -param.w[9]) * (StrictMath.exp((1 - r) * param.w[10]) - 1) * hardPenalty * easyBound),
                S_MIN,
                36500.0,
            ),
        )
    }

    fun nextForgetStability(d: Double, s: Double, r: Double): Double = Js.toFixed8(
        clamp(
            param.w[11] * StrictMath.pow(d, -param.w[12]) * (StrictMath.pow(s + 1, param.w[13]) - 1) * StrictMath.exp((1 - r) * param.w[14]),
            S_MIN,
            36500.0,
        ),
    )

    fun nextShortTermStability(s: Double, g: Int): Double {
        val sinc = StrictMath.pow(s, -param.w[19]) * StrictMath.exp(param.w[17] * (g - 3 + param.w[18]))
        val maskedSinc = if (g >= 3) Math.max(sinc, 1.0) else sinc
        return Js.toFixed8(clamp(s * maskedSinc, S_MIN, 36500.0))
    }

    /** `f.next(card, now, grade).card`. */
    fun next(card: FsrsCard, now: Long, grade: Int): FsrsCard {
        require(grade in 1..4) { "Invalid grade $grade" }
        return BasicScheduler(card, now, this).review(grade)
    }

    /** `f.get_retrievability(card, now, false)`. */
    fun retrievability(card: FsrsCard, now: Long): Double {
        if (card.state == FsrsState.New) return 0.0
        val t = Math.max(Math.floorDiv(now - (card.lastReview ?: now), DAY_MS), 0L)
        return forgettingCurve(t.toDouble(), Js.toFixed8(card.stability))
    }

    private companion object {
        val FUZZ_RANGES = listOf(
            Triple(2.5, 7.0, 0.15),
            Triple(7.0, 20.0, 0.1),
            Triple(20.0, Double.POSITIVE_INFINITY, 0.05),
        )
    }
}

private class StepResult(val scheduledMinutes: Long, val nextStep: Int)

/** ts-fsrs `BasicScheduler` (enable_short_term = true). */
private class BasicScheduler(card: FsrsCard, private val reviewTime: Long, private val algorithm: Fsrs) {
    private val last: FsrsCard = card
    private var current: FsrsCard
    private val elapsedDays: Long

    init {
        var interval = 0L
        if (card.state != FsrsState.New && card.lastReview != null) {
            interval = dateDiffInDays(card.lastReview, reviewTime)
        }
        current = card.copy(lastReview = reviewTime, elapsedDays = interval, reps = card.reps + 1)
        elapsedDays = interval
        // DefaultInitSeedStrategy: `${time}_${reps}_${difficulty * stability}`
        algorithm.seed = "${reviewTime}_${current.reps}_${Js.numberToString(current.difficulty * current.stability)}"
    }

    fun review(grade: Int): FsrsCard = when (last.state) {
        FsrsState.New -> newState(grade)
        FsrsState.Learning, FsrsState.Relearning -> learningState(grade)
        FsrsState.Review -> reviewState(grade)
    }

    private fun newState(grade: Int): FsrsCard {
        val next = current.copy(
            difficulty = clamp(algorithm.initDifficulty(grade), 1.0, 10.0),
            stability = algorithm.initStability(grade),
        )
        return applyLearningSteps(next, grade, FsrsState.Learning)
    }

    private fun learningState(grade: Int): FsrsCard {
        val next = current.copy(
            difficulty = algorithm.nextDifficulty(last.difficulty, grade),
            stability = algorithm.nextShortTermStability(last.stability, grade),
        )
        return applyLearningSteps(next, grade, last.state)
    }

    private fun reviewState(grade: Int): FsrsCard {
        val interval = elapsedDays
        val difficulty = last.difficulty
        val stability = last.stability
        val retrievability = algorithm.forgettingCurve(interval.toDouble(), stability)

        if (grade == Grade.AGAIN) {
            val nextSMin = stability / StrictMath.exp(algorithm.param.w[17] * algorithm.param.w[18])
            val sAfterFail = algorithm.nextForgetStability(difficulty, stability, retrievability)
            val again = current.copy(
                difficulty = algorithm.nextDifficulty(difficulty, Grade.AGAIN),
                stability = clamp(Js.toFixed8(nextSMin), S_MIN, sAfterFail),
            )
            val scheduled = applyLearningSteps(again, Grade.AGAIN, FsrsState.Relearning)
            return scheduled.copy(lapses = scheduled.lapses + 1)
        }

        val hardS = algorithm.nextRecallStability(difficulty, stability, retrievability, Grade.HARD)
        val goodS = algorithm.nextRecallStability(difficulty, stability, retrievability, Grade.GOOD)
        val easyS = algorithm.nextRecallStability(difficulty, stability, retrievability, Grade.EASY)
        var hardInterval = algorithm.nextInterval(hardS, interval)
        var goodInterval = algorithm.nextInterval(goodS, interval)
        hardInterval = Math.min(hardInterval, goodInterval)
        goodInterval = Math.max(goodInterval, hardInterval + 1)
        val easyInterval = Math.max(algorithm.nextInterval(easyS, interval), goodInterval + 1)
        val (s, days) = when (grade) {
            Grade.HARD -> hardS to hardInterval
            Grade.GOOD -> goodS to goodInterval
            else -> easyS to easyInterval
        }
        return current.copy(
            difficulty = algorithm.nextDifficulty(difficulty, grade),
            stability = s,
            scheduledDays = days,
            due = dateScheduler(reviewTime, days, true),
            state = FsrsState.Review,
            learningSteps = 0,
        )
    }

    private fun learningStepsStrategy(state: FsrsState, curStep: Int): Map<Int, StepResult> {
        val steps = if (state == FsrsState.Relearning || state == FsrsState.Review) algorithm.param.relearningSteps else algorithm.param.learningSteps
        if (steps.isEmpty() || curStep >= steps.size) return emptyMap()
        val first = stepToMinutes(steps[0])
        val result = HashMap<Int, StepResult>()
        if (state == FsrsState.Review) {
            result[Grade.AGAIN] = StepResult(stepToMinutes(steps[Math.max(0, curStep)]), 0)
            return result
        }
        result[Grade.AGAIN] = StepResult(first, 0)
        val hard = if (steps.size == 1) Js.roundToLong(first * 1.5) else Js.roundToLong((first + stepToMinutes(steps[1])) / 2.0)
        result[Grade.HARD] = StepResult(hard, curStep)
        val nextInfo = steps.getOrNull(curStep + 1)
        if (nextInfo != null && curStep + 1 >= 0) {
            val nextMin = stepToMinutes(nextInfo)
            if (nextMin != 0L) result[Grade.GOOD] = StepResult(nextMin, curStep + 1)
        }
        return result
    }

    private fun applyLearningSteps(nextCard: FsrsCard, grade: Int, toState: FsrsState): FsrsCard {
        val ls = current.learningSteps
        val curStep = if (current.state == FsrsState.Learning && grade != Grade.AGAIN && grade != Grade.HARD) ls + 1 else ls
        val info = learningStepsStrategy(current.state, curStep)[grade]
        val scheduledMinutes = Math.max(0L, info?.scheduledMinutes ?: 0L)
        val nextSteps = Math.max(0, info?.nextStep ?: 0)
        return if (scheduledMinutes in 1 until 1440) {
            nextCard.copy(
                learningSteps = nextSteps,
                scheduledDays = 0,
                state = toState,
                due = dateScheduler(reviewTime, scheduledMinutes, false),
            )
        } else if (scheduledMinutes >= 1440) {
            nextCard.copy(
                state = FsrsState.Review,
                learningSteps = nextSteps,
                due = dateScheduler(reviewTime, scheduledMinutes, false),
                scheduledDays = scheduledMinutes / 1440,
            )
        } else {
            val interval = algorithm.nextInterval(nextCard.stability, elapsedDays)
            nextCard.copy(
                state = FsrsState.Review,
                learningSteps = 0,
                scheduledDays = interval,
                due = dateScheduler(reviewTime, interval, true),
            )
        }
    }
}
