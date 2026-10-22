package dev.jeromeswannack.chineselearning.lab.core

/*
 * "How fast am I going?" — the Progress tab's Characters & words chart in Per week mode:
 * newly known characters / words per week (net, so a week can go below zero when cards
 * lapse; the current week is partial) and the pace of the last 4 weeks vs the 4 before.
 * Port of shared/progress/known-rate.ts, parity-tested in KnownRateParityTest — see that
 * file for the definitions and why weekly bars.
 */

data class WeekGain(
    /** Monday 00:00 local, epoch ms. */
    val startMs: Long,
    /** Next Monday 00:00 local, or now for the current week. */
    val endMs: Long,
    val partial: Boolean,
    val characters: Int,
    val words: Int,
)

/** trend: "up" | "down" | "same", null without a comparison. */
data class SeriesPace(val perWeek: Int, val previousPerWeek: Int?, val trend: String?)

data class KnownPace(val characters: SeriesPace, val words: SeriesPace)

data class KnownRate(
    /** Oldest first, at most [KnownRates.MAX_WEEKS], the last one the current (partial) week. */
    val weeks: List<WeekGain>,
    /** null until there are 4 weeks of history. */
    val pace: KnownPace?,
)

data class KnownProgressWithRate(val progress: KnownProgress, val rate: KnownRate)

enum class KnownChartMode(val id: String) {
    Total("total"), Rate("rate");

    companion object {
        /** Port of parseKnownChartMode(). */
        fun parse(raw: String?): KnownChartMode = if (raw == "rate") Rate else Total
    }
}

object KnownRates {
    private const val DAY_MS = 86_400_000L
    const val WEEK_MS = 7 * DAY_MS
    const val MAX_WEEKS = 52
    const val PACE_WEEKS = 4

    /** Port of weekStart(): Monday 00:00 of the week containing [ms], at a fixed offset (minutes east of UTC). */
    fun weekStart(ms: Long, tzOffsetMinutes: Int): Long {
        val off = tzOffsetMinutes * 60_000L
        val day = Math.floorDiv(ms + off, DAY_MS)
        val sinceMonday = Math.floorMod(day + 3, 7L)
        return (day - sinceMonday) * DAY_MS - off
    }

    private fun firstEventMs(events: List<KnownEvent>): Long? {
        var first: Long? = null
        for (e in events) {
            val ms = try { Js.parseDate(e.reviewedAt) } catch (_: Exception) { null } ?: continue
            if (first == null || ms < first) first = ms
        }
        return first
    }

    private fun firstWeek(firstMs: Long, nowMs: Long, tz: Int, maxWeeks: Int): Long {
        val thisWeek = weekStart(nowMs, tz)
        return maxOf(weekStart(minOf(firstMs, nowMs), tz), thisWeek - maxOf(1, maxWeeks) * WEEK_MS)
    }

    /** Port of ratePoints(). */
    fun ratePoints(events: List<KnownEvent>, nowMs: Long, tzOffsetMinutes: Int, maxWeeks: Int = MAX_WEEKS): List<Long> {
        val first = firstEventMs(events) ?: return emptyList()
        val thisWeek = weekStart(nowMs, tzOffsetMinutes)
        val start = firstWeek(first, nowMs, tzOffsetMinutes, maxWeeks)
        val out = sortedSetOf<Long>()
        var w = start
        while (w <= thisWeek) { out += w; w += WEEK_MS }
        for (k in 1..2) {
            val p = nowMs - k * PACE_WEEKS * WEEK_MS
            if (p >= start) out += p
        }
        out += nowMs
        return out.toList()
    }

    private fun perWeek(gain: Int): Int = Math.floor(gain.toDouble() / PACE_WEEKS + 0.5).toInt()

    private fun seriesPace(now: Int, ago4: Int, ago8: Int?): SeriesPace {
        val per = perWeek(now - ago4)
        val prev = ago8?.let { perWeek(ago4 - it) }
        val trend = when {
            prev == null -> null
            per > prev -> "up"
            per < prev -> "down"
            else -> "same"
        }
        return SeriesPace(per, prev, trend)
    }

    /** Port of knownRate(). */
    fun rate(history: List<KnownPoint>, firstMs: Long?, nowMs: Long, tzOffsetMinutes: Int, maxWeeks: Int = MAX_WEEKS): KnownRate {
        if (firstMs == null || history.isEmpty()) return KnownRate(emptyList(), null)
        val at = HashMap<Long, KnownPoint>()
        for (p in history) at[p.atMs] = p
        val chars = { ms: Long -> at[ms]?.characters?.known ?: 0 }
        val words = { ms: Long -> at[ms]?.words?.known ?: 0 }
        val thisWeek = weekStart(nowMs, tzOffsetMinutes)
        val weeks = ArrayList<WeekGain>()
        var w = firstWeek(firstMs, nowMs, tzOffsetMinutes, maxWeeks)
        while (w <= thisWeek) {
            val partial = w == thisWeek
            val end = if (partial) nowMs else w + WEEK_MS
            weeks += WeekGain(w, end, partial, chars(end) - chars(w), words(end) - words(w))
            w += WEEK_MS
        }
        val shown = weeks.takeLast(maxOf(1, maxWeeks))
        val window = PACE_WEEKS * WEEK_MS
        val pace = if (firstMs <= nowMs - window) {
            val a4 = nowMs - window
            val a8 = if (firstMs <= nowMs - 2 * window) nowMs - 2 * window else null
            KnownPace(
                seriesPace(chars(nowMs), chars(a4), a8?.let(chars)),
                seriesPace(words(nowMs), words(a4), a8?.let(words)),
            )
        } else null
        return KnownRate(shown, pace)
    }

    /** Port of knownProgressWithRate(): the totals and the rate from ONE replay. */
    fun progressWithRate(
        notes: List<KnownNote>,
        cards: List<KnownCard>,
        events: List<KnownEvent>,
        nowMs: Long,
        tzOffsetMinutes: Int,
    ): KnownProgressWithRate {
        val totalPoints = Known.historyPoints(events, nowMs)
        val all = (totalPoints + ratePoints(events, nowMs, tzOffsetMinutes)).toSortedSet().toList()
        val progress = Known.progress(notes, cards, events, all)
        val totalSet = totalPoints.toHashSet()
        return KnownProgressWithRate(
            progress.copy(history = progress.history.filter { it.atMs in totalSet }),
            rate(progress.history, firstEventMs(events), nowMs, tzOffsetMinutes),
        )
    }

    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** Port of weekDayLabel(): "6 Oct". */
    fun weekDayLabel(startMs: Long, tzOffsetMinutes: Int): String {
        val d = java.time.Instant.ofEpochMilli(startMs + tzOffsetMinutes * 60_000L).atZone(java.time.ZoneOffset.UTC)
        return "${d.dayOfMonth} ${MONTHS[d.monthValue - 1]}"
    }

    /** Port of weekLabel(): "Week of 6 Oct", "(so far)" for the current week. */
    fun weekLabel(startMs: Long, partial: Boolean, tzOffsetMinutes: Int): String =
        "Week of ${weekDayLabel(startMs, tzOffsetMinutes)}${if (partial) " (so far)" else ""}"

    private fun grouped(n: Int): String = "%,d".format(java.util.Locale.US, n)

    /** Port of signedCount(): "+38", "−5", "0". */
    fun signedCount(n: Int): String = when {
        n > 0 -> "+${grouped(n)}"
        n < 0 -> "−${grouped(-n)}"
        else -> "0"
    }

    /** Port of weekSummary(): "Week of 6 Oct · +38 characters · +61 words". */
    fun weekSummary(w: WeekGain, tzOffsetMinutes: Int): String =
        "${weekLabel(w.startMs, w.partial, tzOffsetMinutes)} · ${signedCount(w.characters)} characters · ${signedCount(w.words)} words"

    private fun plain(n: Int): String = if (n < 0) "−${grouped(-n)}" else grouped(n)

    /** Port of paceLabel(): "≈ 42 words / week". */
    fun paceLabel(perWeek: Int, noun: String): String = "≈ ${plain(perWeek)} $noun / week"

    /** Port of paceTrendLabel(): "↑ from 30", "↓ from 51", "same as before"; null without a comparison. */
    fun paceTrendLabel(p: SeriesPace): String? {
        val prev = p.previousPerWeek ?: return null
        return when (p.trend) {
            "up" -> "↑ from ${plain(prev)}"
            "down" -> "↓ from ${plain(prev)}"
            "same" -> "same as before"
            else -> null
        }
    }
}
