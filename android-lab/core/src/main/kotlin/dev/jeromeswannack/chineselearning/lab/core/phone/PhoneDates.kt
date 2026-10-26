package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.Js
import java.time.LocalDate

/** Port of shared/phone/dates.ts: dates and times on the simulated phone ("YYYY-MM-DD" + "HH:MM", no time zones). */
object PhoneDates {
    private val WEEKDAYS_ZH = listOf("周日", "周一", "周二", "周三", "周四", "周五", "周六")
    private val WEEKDAYS_XQ = listOf("星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六")
    private val DATE_RE = Regex("^([0-9]{4})-([0-9]{2})-([0-9]{2})$")
    private val TIME_RE = Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")

    data class Ymd(val y: Int, val m: Int, val day: Int)

    fun parseDate(d: String): Ymd? {
        val m = DATE_RE.matchEntire(d) ?: return null
        return Ymd(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
    }

    /** `isDate`: Date.UTC maps years 0–99 to 1900+, so those never round-trip. */
    fun isDate(d: String?): Boolean {
        if (d == null) return false
        val p = parseDate(d) ?: return false
        if (p.y < 100) return false
        return runCatching { LocalDate.of(p.y, p.m, p.day) }.isSuccess
    }

    fun isTime(t: String?): Boolean = t != null && TIME_RE.matches(t)

    private fun local(d: String): LocalDate {
        val p = parseDate(d)!!
        return LocalDate.of(p.y, 1, 1).plusMonths((p.m - 1).toLong()).plusDays((p.day - 1).toLong())
    }

    /** 0 = Sunday. */
    fun weekday(d: String): Int = local(d).dayOfWeek.value % 7

    fun addDays(d: String, n: Int): String {
        val t = local(d).plusDays(n.toLong())
        return "${t.year.toString().padStart(4, '0')}-${pad2(t.monthValue)}-${pad2(t.dayOfMonth)}"
    }

    fun daysBetween(a: String, b: String): Int = (local(b).toEpochDay() - local(a).toEpochDay()).toInt()

    /** 10月31日 */
    fun zhMonthDay(d: String): String = parseDate(d)?.let { "${it.m}月${it.day}日" } ?: d

    /** 周六 */
    fun zhWeekday(d: String): String = WEEKDAYS_ZH[weekday(d)]

    /** 星期六 */
    fun zhWeekdayLong(d: String): String = WEEKDAYS_XQ[weekday(d)]

    /** 今天 / 明天 / 后天 / 周六, relative to [today]. */
    fun zhRelativeDay(d: String, today: String): String = when (daysBetween(today, d)) {
        0 -> "今天"
        1 -> "明天"
        2 -> "后天"
        else -> zhWeekday(d)
    }

    /** 10月31日 周六 */
    fun zhDateLabel(d: String): String = "${zhMonthDay(d)} ${zhWeekday(d)}"

    fun minutesOf(t: String): Int {
        val parts = t.split(":")
        return parts[0].toInt() * 60 + parts.getOrElse(1) { "0" }.toInt()
    }

    fun timeOf(minutes: Int): String {
        val m = ((minutes % 1440) + 1440) % 1440
        return "${pad2(m / 60)}:${pad2(m % 60)}"
    }

    /** Minutes from [depart] to [arrive] (an earlier arrival is the next day). */
    fun spanMinutes(depart: String, arrive: String): Int {
        val d = minutesOf(arrive) - minutesOf(depart)
        return if (d >= 0) d else d + 1440
    }

    /** 历时 0小时53分 */
    fun zhDuration(minutes: Int): String = "${Math.floorDiv(minutes, 60)}小时${pad2(Math.floorMod(minutes, 60))}分"

    fun minutesUntil(today: String, now: String, date: String, time: String): Int =
        daysBetween(today, date) * 1440 + minutesOf(time) - minutesOf(now)

    /** ¥73.0 → "73" / 18.5 → "18.50". */
    fun yuan(n: Double): String = if (n.isFinite() && n == Math.floor(n)) Js.numberToString(n) else Js.toFixed(n, 2)

    /** Always two decimals (¥86.00). */
    fun yuan2(n: Double): String = Js.toFixed(Js.round(n * 100) / 100, 2)

    fun round2(n: Double): Double = Js.round(n * 100) / 100

    fun pad2(n: Int): String = n.toString().padStart(2, '0')
}
