package dev.jeromeswannack.chineselearning.lab.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * "When does a new day start" — port of shared/study/studyDay.ts, parity-tested
 * (StudyDayParityTest, parity/fixtures/study-day.ts, DST nights included).
 *
 * An instant before the account's rollover hour (0–6, default 4 am; `users.day_rollover_hour`,
 * Settings → Study → "New day starts at") belongs to the previous calendar day. The day runs from
 * its date's rollover hour to the next date's (java.time's gap / overlap rules, which the
 * TypeScript copies). A rollover of 0 = midnight = the old calendar day. FSRS is untouched.
 */
data class StudyDayInfo(
    /** The study day's date, YYYY-MM-DD. */
    val key: String,
    /** The day's rollover instant (inclusive). */
    val startMs: Long,
    /** The next day's rollover instant (exclusive). */
    val endMs: Long,
)

object StudyDay {
    const val DEFAULT_ROLLOVER_HOUR = 4
    const val MIN_ROLLOVER_HOUR = 0
    const val MAX_ROLLOVER_HOUR = 6
    val CHOICES: List<Int> = (MIN_ROLLOVER_HOUR..MAX_ROLLOVER_HOUR).toList()
    private const val HOUR_MS = 3_600_000L
    private const val MINUTE_MS = 60_000L
    private const val DAY_MS = 86_400_000L

    /** Port of isDayRolloverHour(). */
    fun isRolloverHour(value: Int?): Boolean = value != null && value in MIN_ROLLOVER_HOUR..MAX_ROLLOVER_HOUR

    /** Port of dayRolloverHour(): NULL / invalid = the default (4 am). */
    fun rolloverHour(stored: Int?): Int = if (isRolloverHour(stored)) stored!! else DEFAULT_ROLLOVER_HOUR

    /** Port of dayRolloverLabel(): "midnight", "1 am" … "6 am". */
    fun label(hour: Int): String = if (hour == 0) "midnight" else "$hour am"

    /** Port of dayRolloverSummary(). */
    fun summary(hour: Int): String = "New day starts at ${label(hour)}"

    /** Port of studyDayAt(): the study day instant `ms` belongs to in `zone`. */
    fun at(ms: Long, rolloverHour: Int, zone: ZoneId): StudyDayInfo {
        val hour = rolloverHour(rolloverHour)
        val local = Instant.ofEpochMilli(ms).atZone(zone)
        val date = if (local.hour < hour) local.toLocalDate().minusDays(1) else local.toLocalDate()
        return StudyDayInfo(date.toString(), instantOf(date, hour, zone), instantOf(date.plusDays(1), hour, zone))
    }

    /** Port of studyDayKey(). */
    fun key(ms: Long, rolloverHour: Int, zone: ZoneId): String {
        val local = Instant.ofEpochMilli(ms).atZone(zone)
        val date = if (local.hour < rolloverHour(rolloverHour)) local.toLocalDate().minusDays(1) else local.toLocalDate()
        return date.toString()
    }

    /** The study day's date as a LocalDate (what "today" means for day-keyed prefs). */
    fun date(ms: Long, rolloverHour: Int, zone: ZoneId): LocalDate = LocalDate.parse(key(ms, rolloverHour, zone))

    /** Port of localTimeToInstant(): `date` at `hour`:00 in `zone` (gap → later, overlap → earlier). */
    fun instantOf(date: LocalDate, hour: Int, zone: ZoneId): Long =
        date.atTime(LocalTime.of(hour, 0)).atZone(zone).toInstant().toEpochMilli()

    /** Port of studyDayAtOffset(): a fixed UTC offset (minutes, east positive). */
    fun atOffset(ms: Long, rolloverHour: Int, utcOffsetMinutes: Int): StudyDayInfo {
        val hour = rolloverHour(rolloverHour)
        val shifted = ms + utcOffsetMinutes * MINUTE_MS - hour * HOUR_MS
        val dayUtc = Math.floorDiv(shifted, DAY_MS) * DAY_MS
        val start = dayUtc + hour * HOUR_MS - utcOffsetMinutes * MINUTE_MS
        return StudyDayInfo(LocalDate.ofEpochDay(Math.floorDiv(shifted, DAY_MS)).toString(), start, start + DAY_MS)
    }

    /** Port of studyCutoffMs(): the study day's last millisecond, or now + 1 h if later. */
    fun cutoffMs(nowMs: Long, day: StudyDayInfo): Long = maxOf(day.endMs - 1, nowMs + HOUR_MS)

    /** Port of studyDayShiftMinutes(): offset − rollover × 60. */
    fun shiftMinutes(utcOffsetMinutes: Int, rolloverHour: Int): Int = utcOffsetMinutes - rolloverHour(rolloverHour) * 60

    /** The device zone's offset now (minutes, east positive). */
    fun utcOffsetMinutes(ms: Long, zone: ZoneId): Int = zone.rules.getOffset(Instant.ofEpochMilli(ms)).totalSeconds / 60

    /** Port of addDayKeys(). */
    fun addDays(key: String, days: Int): String = LocalDate.parse(key).plusDays(days.toLong()).toString()
}
