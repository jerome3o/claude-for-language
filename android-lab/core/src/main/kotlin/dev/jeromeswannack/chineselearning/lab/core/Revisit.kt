package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * "Revisit later" — the schedule of mini lessons (graded readers were on it until Oct 2026;
 * now a story is read once — [DailyReader]), plus how many NEW lessons a day join. Port of
 * shared/study/revisit.ts (parity-tested: parity/fixtures/revisit.ts → RevisitParityTest).
 *
 * The rating after finishing sets the gap until the next visit:
 *   Again → 1 day · Hard → 2 days · Good → 14 days · Easy → 42 days
 * Each later successful visit grows the gap: max(the rating's base gap, previous gap × growth)
 * (Hard grows ×1.2 at most), capped at 180 days. Again resets it to 1 day. "Done for good"
 * retires the item; "Bring back" puts it in rotation again, due at once.
 *
 * Event-sourced: the state is derived from the history (completions + retire / restore
 * events), never stored. The gaps and "New lessons a day" are an account setting.
 */
data class RevisitSettings(
    /** First gap after Hard, in days. */
    val hardDays: Double = 2.0,
    /** First gap after Good, in days. */
    val goodDays: Double = 14.0,
    /** First gap after Easy, in days. */
    val easyDays: Double = 42.0,
    /** How much the gap grows on each later successful visit (Hard grows less). */
    val growth: Double = 2.0,
    /** No gap is ever longer than this, in days. */
    val capDays: Double = 180.0,
    /** At most this many NEW (never-finished) lessons are introduced per local day (0 = none). */
    val newLessonsPerDay: Double = 1.0,
) {
    operator fun get(key: String): Double = when (key) {
        "hard_days" -> hardDays
        "good_days" -> goodDays
        "easy_days" -> easyDays
        "growth" -> growth
        "cap_days" -> capDays
        "new_lessons_per_day" -> newLessonsPerDay
        else -> throw IllegalArgumentException(key)
    }

    fun with(key: String, v: Double): RevisitSettings = when (key) {
        "hard_days" -> copy(hardDays = v)
        "good_days" -> copy(goodDays = v)
        "easy_days" -> copy(easyDays = v)
        "growth" -> copy(growth = v)
        "cap_days" -> copy(capDays = v)
        "new_lessons_per_day" -> copy(newLessonsPerDay = v)
        else -> throw IllegalArgumentException(key)
    }

    /** "New lessons a day" as a count. */
    val newLessonsPerDayInt: Int get() = newLessonsPerDay.toInt()
}

/** One event in an item's history. [kind] rating (a finish; [rating] null = legacy = Good), retire or restore. */
data class RevisitEvent(val id: String, val at: String, val kind: String, val rating: Int? = null) {
    companion object {
        const val RATING = "rating"
        const val RETIRE = "retire"
        const val RESTORE = "restore"
        fun rating(id: String, at: String, rating: Int?) = RevisitEvent(id, at, RATING, rating)
    }
}

data class RevisitState(
    /** new / scheduled / retired. */
    val status: String,
    /** When it is next due (ms since epoch); null when new or retired. */
    val dueMs: Long?,
    /** The current gap in days (0 before the first finish). */
    val gapDays: Double,
    /** The last finish (ms), null before the first. */
    val lastMs: Long?,
    /** How many times it was finished. */
    val finishes: Int,
) {
    val isNew: Boolean get() = status == NEW
    val isRetired: Boolean get() = status == RETIRED
    val isScheduled: Boolean get() = status == SCHEDULED

    companion object {
        const val NEW = "new"
        const val SCHEDULED = "scheduled"
        const val RETIRED = "retired"
        val INITIAL = RevisitState(NEW, null, 0.0, null, 0)
    }
}

/** An update from Settings: a field → a value, or null = back to that field's default. */
typealias RevisitSettingsUpdate = Map<String, Double?>

data class RevisitSettingsPick(val update: RevisitSettingsUpdate, val problems: List<String>)

object Revisit {
    /** `DEFAULT_REVISIT_SETTINGS`. */
    val DEFAULT = RevisitSettings()

    /** `REVISIT_AGAIN_DAYS`: Again always comes back the next day. */
    const val AGAIN_DAYS = 1.0

    /** `REVISIT_HARD_GROWTH`: Hard grows the gap by at most this much. */
    const val HARD_GROWTH = 1.2

    /** `REVISIT_LIMITS`. */
    const val DAYS_MIN = 1.0
    const val DAYS_MAX = 365.0
    const val GROWTH_MIN = 1.0
    const val GROWTH_MAX = 5.0
    const val CAP_MIN = 1.0
    const val CAP_MAX = 3650.0
    const val NEW_LESSONS_MIN = 0.0
    const val NEW_LESSONS_MAX = 20.0

    /** `MAX_LESSON_REVISITS_PER_DAY`. */
    const val MAX_LESSON_REVISITS_PER_DAY = 2

    /** The settings fields in the web's order (`KEYS`). */
    val KEYS = listOf("hard_days", "good_days", "easy_days", "growth", "cap_days", "new_lessons_per_day")

    private const val DAY_MS = 24.0 * 60 * 60 * 1000

    private fun ms(iso: String): Long = runCatching { Js.parseDate(iso) }.getOrDefault(0L)

    private fun round2(n: Double): Double = Js.round(n * 100) / 100

    /** `nextGapDays`: the gap a rating gives after a previous gap of [prevGap] days (0 = first finish). */
    fun nextGapDays(prevGap: Double, rating: Int?, settings: RevisitSettings = DEFAULT): Double {
        val r = rating ?: 2
        if (r <= 0) return AGAIN_DAYS
        val cap = settings.capDays
        val base = when (r) { 1 -> settings.hardDays; 2 -> settings.goodDays; else -> settings.easyDays }
        val growth = if (r == 1) minOf(HARD_GROWTH, settings.growth) else settings.growth
        val grown = if (prevGap > 0) prevGap * growth else 0.0
        return round2(minOf(cap, maxOf(base, grown)))
    }

    /** `sortRevisitEvents`: time order, ties by id (every device replays them the same way). */
    fun sort(events: List<RevisitEvent>): List<RevisitEvent> =
        events.sortedWith { a, b ->
            val d = ms(a.at) - ms(b.at)
            if (d != 0L) d.compareTo(0L) else a.id.compareTo(b.id).coerceIn(-1, 1)
        }

    /** `computeRevisitState`: replay an item's history into its schedule. */
    fun computeState(events: List<RevisitEvent>, settings: RevisitSettings = DEFAULT): RevisitState {
        var gap = 0.0
        var last: Long? = null
        var due: Long? = null
        var retired = false
        var finishes = 0
        for (e in sort(events)) {
            val at = ms(e.at)
            when (e.kind) {
                RevisitEvent.RETIRE -> retired = true
                RevisitEvent.RESTORE -> {
                    // Back in rotation, due at once; the gap it had grown is kept.
                    if (retired) due = at
                    retired = false
                }
                RevisitEvent.RATING -> {
                    gap = nextGapDays(gap, e.rating, settings)
                    last = at
                    due = at + Js.roundToLong(gap * DAY_MS)
                    finishes++
                }
            }
        }
        if (retired) return RevisitState(RevisitState.RETIRED, null, gap, last, finishes)
        if (due == null) return RevisitState(RevisitState.NEW, null, 0.0, null, finishes)
        return RevisitState(RevisitState.SCHEDULED, due, gap, last, finishes)
    }

    /** `isRevisitDue`: should it be offered by [cutoffMs]? New items are "due" too. */
    fun isDue(state: RevisitState, cutoffMs: Long): Boolean {
        if (state.isRetired) return false
        if (state.isNew) return true
        return state.dueMs != null && state.dueMs <= cutoffMs
    }

    /** `revisitPreviews`: the gap each rating button would give now (days). */
    fun previews(state: RevisitState, settings: RevisitSettings = DEFAULT): List<Double> {
        val prev = if (state.isNew) 0.0 else state.gapDays
        return (0..3).map { nextGapDays(prev, it, settings) }
    }

    /** `revisitGapLabel`: "1 day", "2 days", "2 wk", "6 wk", "3 mo", "1.5 yr". */
    fun gapLabel(days: Double): String {
        val d = maxOf(1.0, Js.round(days))
        if (d < 14) return if (d == 1.0) "1 day" else "${Js.numberToString(d)} days"
        if (d < 60) return "${Js.numberToString(Js.round(d / 7))} wk"
        if (d < 365) return "${Js.numberToString(Js.round(d / 30))} mo"
        val y = Js.round((d / 365) * 10) / 10
        return "${Js.numberToString(y)} yr"
    }

    /** The rating buttons' labels as [IntervalPreview]s (the web's `revisitButtonPreviews`). */
    fun buttonPreviews(state: RevisitState, settings: RevisitSettings = DEFAULT): List<IntervalPreview> =
        previews(state, settings).mapIndexed { r, gap -> IntervalPreview(r, gapLabel(gap), gap, CardQueue.REVIEW) }

    // ============ Settings ============

    private fun limitFor(key: String): Pair<Double, Double> = when (key) {
        "growth" -> GROWTH_MIN to GROWTH_MAX
        "cap_days" -> CAP_MIN to CAP_MAX
        "new_lessons_per_day" -> NEW_LESSONS_MIN to NEW_LESSONS_MAX
        else -> DAYS_MIN to DAYS_MAX
    }

    private val JS_DECIMAL = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")
    private val JS_HEX = Regex("^0[xX][0-9a-fA-F]+$")
    private val JS_BIN = Regex("^0[bB][01]+$")
    private val JS_OCT = Regex("^0[oO][0-7]+$")
    private const val JS_SPACE = " \t\n\u000B\u000C\r                 　﻿"

    /** JS `Number(string)` for a non-blank string. */
    private fun jsNumber(raw: String): Double {
        val s = raw.trim { it in JS_SPACE }
        if (s.isEmpty()) return 0.0
        return when {
            JS_DECIMAL.matches(s) -> s.toDouble()
            s == "Infinity" || s == "+Infinity" -> Double.POSITIVE_INFINITY
            s == "-Infinity" -> Double.NEGATIVE_INFINITY
            JS_HEX.matches(s) -> java.math.BigInteger(s.substring(2), 16).toDouble()
            JS_BIN.matches(s) -> java.math.BigInteger(s.substring(2), 2).toDouble()
            JS_OCT.matches(s) -> java.math.BigInteger(s.substring(2), 8).toDouble()
            else -> Double.NaN
        }
    }

    /** `asNumber`: a JSON number as is, a non-blank string through Number(), anything else NaN. */
    private fun asNumber(v: JsonElement?): Double {
        if (v !is JsonPrimitive || v is JsonNull) return Double.NaN
        if (v.isString) return if (v.content.trim { it in JS_SPACE }.isNotEmpty()) jsNumber(v.content) else Double.NaN
        if (v.booleanOrNull != null) return Double.NaN
        return v.doubleOrNull ?: Double.NaN
    }

    private fun isInteger(n: Double) = n.isFinite() && Math.floor(n) == n

    /**
     * `pickRevisitSettingsUpdate`: validate an update from an untrusted body — day fields whole
     * numbers 1–365, growth 1–5, cap 1–3650, new lessons a day 0–20; null = back to that default. Checks the merged
     * result keeps Hard ≤ Good ≤ Easy.
     */
    fun pickUpdate(input: JsonObject?, current: RevisitSettings = DEFAULT): RevisitSettingsPick {
        val update = LinkedHashMap<String, Double?>()
        val problems = ArrayList<String>()
        for (key in KEYS) {
            if (input == null || key !in input) continue
            val v = input[key]
            if (v is JsonNull) { update[key] = null; continue }
            val n = asNumber(v)
            val (min, max) = limitFor(key)
            val minS = Js.numberToString(min)
            val maxS = Js.numberToString(max)
            if (key == "growth") {
                if (!n.isFinite() || n < min || n > max) problems += "growth must be a number between $minS and $maxS"
                else update[key] = round2(n)
            } else if (key == "new_lessons_per_day") {
                if (!isInteger(n) || n < min || n > max) problems += "new_lessons_per_day must be a whole number between $minS and $maxS"
                else update[key] = n
            } else if (!isInteger(n) || n < min || n > max) {
                problems += "$key must be a whole number of days between $minS and $maxS"
            } else {
                update[key] = n
            }
        }
        if (problems.isEmpty()) {
            val merged = applyUpdate(current, update)
            if (!(merged.hardDays <= merged.goodDays && merged.goodDays <= merged.easyDays)) {
                problems += "the gaps must go up: Hard ≤ Good ≤ Easy"
            }
        }
        return RevisitSettingsPick(update, problems)
    }

    /** [pickUpdate] from text fields (Settings' number inputs, like the web's draft strings). */
    fun pickUpdate(draft: Map<String, String>, current: RevisitSettings = DEFAULT): RevisitSettingsPick =
        pickUpdate(JsonObject(draft.mapValues { JsonPrimitive(it.value) }), current)

    /** `applyRevisitSettingsUpdate` (null = that field's default). */
    fun applyUpdate(current: RevisitSettings, update: RevisitSettingsUpdate): RevisitSettings {
        var next = current
        for (key in KEYS) {
            if (key !in update) continue
            next = next.with(key, update[key] ?: DEFAULT[key])
        }
        return next
    }

    /** `parseRevisitSettings`: stored settings (a JSON string or object, maybe partial / garbage) into a full, valid set. */
    fun parse(raw: JsonElement?): RevisitSettings {
        var obj: JsonElement? = raw
        if (raw is JsonPrimitive && raw.isString) {
            obj = runCatching { Json.parseToJsonElement(raw.content) }.getOrNull()
        }
        var out = DEFAULT
        if (obj !is JsonObject) return out
        for (key in KEYS) {
            val n = asNumber(obj[key])
            val (min, max) = limitFor(key)
            if (n.isFinite() && n >= min && n <= max) out = out.with(key, if (key == "growth") round2(n) else Js.round(n))
        }
        if (!(out.hardDays <= out.goodDays && out.goodDays <= out.easyDays)) {
            return DEFAULT.copy(growth = out.growth, capDays = out.capDays, newLessonsPerDay = out.newLessonsPerDay)
        }
        return out
    }

    /** [parse] of a JSON text (what the device cache keeps). */
    fun parse(text: String?): RevisitSettings = parse(text?.let { JsonPrimitive(it) })

    /** `isDefaultRevisitSettings`. */
    fun isDefault(s: RevisitSettings): Boolean = KEYS.all { s[it] == DEFAULT[it] }

    // ============ Pacing ============

    /** `pickRevisitsForToday`: due items, most overdue first, limited to what today still allows. */
    fun <T> pickForToday(items: List<Pair<T, RevisitState>>, cutoffMs: Long, doneToday: Int, perDay: Int = MAX_LESSON_REVISITS_PER_DAY): List<T> {
        val room = maxOf(0, perDay - doneToday)
        return items
            .filter { it.second.isScheduled && isDue(it.second, cutoffMs) }
            .sortedBy { it.second.dueMs ?: 0L }
            .take(room)
            .map { it.first }
    }

    /**
     * `newLessonsIntroducedToday`: lessons whose very FIRST finish is at or after [dayStartMs]
     * (local midnight) — from the completion events, never a counter. [exclude] (one-off
     * homework) doesn't count.
     */
    fun newLessonsIntroducedToday(events: List<Pair<String, String>>, dayStartMs: Long, exclude: Set<String> = emptySet()): Int {
        val first = HashMap<String, Long>()
        for ((lessonId, completedAt) in events) {
            if (lessonId in exclude) continue
            val t = ms(completedAt)
            val f = first[lessonId]
            if (f == null || t < f) first[lessonId] = t
        }
        return first.values.count { it >= dayStartMs }
    }

    /** `pickNewLessonsForToday`: the NEW lessons today still has room for, oldest first (ties by id). */
    fun <T> pickNewForToday(fresh: List<T>, id: (T) -> String, createdAt: (T) -> String, introducedToday: Int, perDay: Int = DEFAULT.newLessonsPerDayInt): List<T> {
        val room = maxOf(0, perDay - introducedToday)
        return fresh.sortedWith(compareBy<T>({ createdAt(it) }, { id(it) })).take(room)
    }

    // ============ Device rows & labels ============

    /** `rowDueMs` (services/revisit.ts): due_timestamp, else next_review_at, else 0. */
    fun rowDueMs(dueTimestamp: Long?, nextReviewAt: String?): Long =
        dueTimestamp ?: nextReviewAt?.let { runCatching { Js.parseDate(it) }.getOrNull() } ?: 0L

    /** `rowRevisitState` (services/revisit.ts): a cached row's state back. */
    fun rowState(queue: Int, retired: Boolean, gapDays: Double, finishes: Int, dueTimestamp: Long?, nextReviewAt: String?, lastReviewedAt: String?): RevisitState = when {
        retired -> RevisitState(RevisitState.RETIRED, null, gapDays, null, finishes)
        queue == CardQueue.NEW -> RevisitState.INITIAL
        else -> RevisitState(RevisitState.SCHEDULED, rowDueMs(dueTimestamp, nextReviewAt), gapDays, lastReviewedAt?.let { runCatching { Js.parseDate(it) }.getOrNull() }, finishes)
    }

    private val SHORT_DAY = java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.ENGLISH)

    private fun shortDate(ms: Long, zone: java.time.ZoneId): String = SHORT_DAY.format(java.time.Instant.ofEpochMilli(ms).atZone(zone))

    /** `revisitChip` (services/revisit.ts): "Next revisit 20 Oct" / "Due today" / "Done for good" / "New". */
    fun chip(state: RevisitState, cutoffMs: Long, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String = when {
        state.isRetired -> "Done for good"
        state.isNew -> "New"
        state.dueMs == null || state.dueMs <= cutoffMs -> "Due today"
        else -> "Next revisit ${shortDate(state.dueMs, zone)}"
    }

    /** `nextRevisitLabel` (utils/revisitLabel.ts): the tutor's "next revisit 20 Oct" / "due now" / "done for good". */
    fun tutorLabel(nextRevisitAt: String?, retired: Boolean, nowMs: Long = System.currentTimeMillis(), zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String? {
        if (retired) return "done for good"
        if (nextRevisitAt.isNullOrEmpty()) return null
        val t = runCatching { Js.parseDate(nextRevisitAt) }.getOrNull() ?: return null
        if (t <= nowMs) return "due now"
        return "next revisit ${shortDate(t, zone)}"
    }

    /** The Settings chain "Good each time: 2 wk → 4 wk → 8 wk → 4 mo → 6 mo" (RevisitSettingsSection's goodChain). */
    fun goodChain(s: RevisitSettings): String {
        val events = ArrayList<RevisitEvent>()
        val gaps = ArrayList<String>()
        for (i in 0 until 5) {
            val at = java.time.LocalDate.of(2026, 1, 1).plusDays(i * 400L).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
            events += RevisitEvent.rating("p$i", Js.toIsoString(at), 2)
            gaps += gapLabel(computeState(events, s).gapDays)
        }
        return gaps.joinToString(" → ")
    }
}
