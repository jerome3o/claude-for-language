package dev.jeromeswannack.chineselearning.lab.data

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.core.StudyDay
import dev.jeromeswannack.chineselearning.lab.core.StudyDayInfo
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.ZoneId

@Serializable
data class DayRolloverBody(val day_rollover_hour: Int?)

/**
 * "New day starts at" on this phone — the ONE place the Lab app asks "which study day is it?"
 * (core StudyDay, port of shared/study/studyDay.ts; web services/studyDay.ts). The account's hour
 * (`users.day_rollover_hour`, NULL = 4 am) comes from /api/auth/me and /api/sync/changes into
 * Prefs ([Prefs.dayRolloverHour] keeps [hour] in step), so the study day is right offline. Every
 * "today" of study reads it: the queue's cutoff, introduced-today and the budget, Study more, the
 * review load, the daily reader, the celebration, active time, the resume point, homework's
 * `today`, Home's counts, the streak. docs/STUDY_SESSION.md "When does a new day start".
 */
object StudyDayClock {
    /** The hour in effect (0–6). Prefs sets it at start-up and on every change. */
    val hour = MutableStateFlow(StudyDay.DEFAULT_ROLLOVER_HOUR)

    val rolloverHour: Int get() = hour.value

    fun day(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): StudyDayInfo =
        StudyDay.at(nowMs, rolloverHour, zone)

    /** "Due today": the end of the study day, or an hour from now if later. */
    fun cutoff(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): StudyCutoff =
        StudyQueue.cutoff(nowMs, zone, rolloverHour)

    /** When today's study day started: introduced-today, today's reviews. */
    fun dayStart(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): Long =
        StudyQueue.startOfDay(nowMs, zone, rolloverHour)

    /** Today's study day as a date (day-keyed prefs, homework's `today`). */
    fun today(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): LocalDate =
        StudyDay.date(nowMs, rolloverHour, zone)

    /** Today's study-day key, YYYY-MM-DD. */
    fun todayKey(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String =
        StudyDay.key(nowMs, rolloverHour, zone)

    /** Whether instant `ms` is in today's study day. */
    fun isToday(ms: Long, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): Boolean {
        val d = day(nowMs, zone)
        return ms >= d.startMs && ms < d.endMs
    }

    /**
     * Settings → Study → "New day starts at": Prefs at once (offline too), then the idempotent
     * `PUT /api/profile/day-rollover` through the Outbox. The default (4) is stored as NULL.
     */
    fun save(app: LabApp, next: Int) {
        val before = rolloverHour
        if (next == before) return
        app.prefs.dayRolloverHour = next
        Analytics.track("settings.day_rollover", mapOf("hour" to next, "from" to before, "reset" to (next == StudyDay.DEFAULT_ROLLOVER_HOUR)))
        app.scope.launch {
            runCatching {
                val body = DayRolloverBody(if (next == StudyDay.DEFAULT_ROLLOVER_HOUR) null else next)
                app.outbox.enqueueJson("settings", "PUT", "/api/profile/day-rollover", body, id = "day-rollover-${System.currentTimeMillis()}")
                if (app.online.value) app.outbox.drain() else app.scheduleBackgroundUpload()
            }
        }
    }
}
