package dev.jeromeswannack.chineselearning.lab.data.study

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.core.ActiveTime
import dev.jeromeswannack.chineselearning.lab.core.Celebration
import dev.jeromeswannack.chineselearning.lab.core.StudyResume
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.StudyTimeDayBody
import dev.jeromeswannack.chineselearning.lab.data.api.StudyTimeDayTotalDto
import dev.jeromeswannack.chineselearning.lab.data.api.putStudyTime
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * "Today is the session" on this device (docs/STUDY_SESSION.md) — the Lab twin of the web's
 * services/studyTime.ts + services/studyResume.ts, on SharedPreferences:
 *
 * - active study time per local day ([ActiveTime], fed by the study screen: touches, typing,
 *   coming to the front; paused when backgrounded / screen off / leaving Study), reported to
 *   `PUT /api/me/study-time` by [Sync] and when leaving Study; other devices' share of today
 *   comes back with the answer;
 * - the resume point — the card on screen, revealed or not, its typed answer and time so far —
 *   so a process death doesn't lose it either (in-process, the activity-scoped view model
 *   keeps everything, recording and undo included);
 * - the celebration mark (confetti once a day, again only after more cards were cleared).
 */
class StudyDayStore private constructor(context: Context, private val zone: ZoneId = ZoneId.systemDefault()) {
    private val sp = context.getSharedPreferences("lab_study_day", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable private data class LastDto(val at: Long, val day: String)
    @Serializable private data class StateDto(val totals: Map<String, Long> = emptyMap(), val last: LastDto? = null)
    @Serializable private data class PointDto(val day: String, val scope: String, val card_id: String, val revealed: Boolean, val answer: String, val elapsed_ms: Long)
    @Serializable private data class MarkDto(val day: String, val reviews: Int)

    private var state: ActiveTime.State = read<StateDto>(STATE)?.let { d -> ActiveTime.State(d.totals, d.last?.let { ActiveTime.Last(it.at, it.day) }) } ?: ActiveTime.State()
    private var lastSavedAt = 0L
    private var lastReportedAt = 0L

    private inline fun <reified T> read(key: String): T? = sp.getString(key, null)?.let { runCatching { json.decodeFromString<T>(it) }.getOrNull() }
    private inline fun <reified T> write(key: String, value: T?) {
        val text: String? = value?.let { json.encodeToString(kotlinx.serialization.serializer<T>(), it) }
        sp.edit().apply { if (text == null) remove(key) else putString(key, text) }.apply()
    }

    fun today(now: Long = System.currentTimeMillis()): String = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDate().toString()

    /** Random per install; the per-device rows on the server. */
    val deviceId: String by lazy {
        sp.getString(DEVICE, null)?.takeIf { Regex("^[A-Za-z0-9_-]{8,64}$").matches(it) }
            ?: ("lab-" + UUID.randomUUID().toString().replace("-", "").take(24)).also { sp.edit().putString(DEVICE, it).apply() }
    }

    // ---------------- active time ----------------

    @Synchronized
    fun interact(now: Long = System.currentTimeMillis()) {
        state = ActiveTime.interact(state, now, today(now))
        save(now, force = false)
    }

    @Synchronized
    fun pause(now: Long = System.currentTimeMillis()) {
        if (state.last == null) return
        state = ActiveTime.pause(state, now)
        save(now, force = true)
    }

    private fun save(now: Long, force: Boolean) {
        if (!force && now - lastSavedAt < SAVE_EVERY_MS) return
        lastSavedAt = now
        val kept = ActiveTime.prune(state, LocalDate.parse(today(now)).minusDays(ActiveTime.KEEP_DAYS.toLong()).toString())
        write(STATE, StateDto(kept.totals, kept.last?.let { LastDto(it.at, it.day) }))
    }

    /** This device's active ms today (live). */
    @Synchronized
    fun deviceToday(now: Long = System.currentTimeMillis()): Long = ActiveTime.total(state, today(now), now)

    /** Today over every device: the server's other devices + this device's own. */
    @Synchronized
    fun activeToday(now: Long = System.currentTimeMillis()): Long {
        val day = today(now)
        val server = read<List<StudyTimeDayTotalDto>>(SERVER)?.firstOrNull { it.date == day }
        return ActiveTime.acrossDevices(ActiveTime.total(state, day, now), server?.active_ms ?: 0, server?.device_ms ?: 0)
    }

    /** The rows `PUT /api/me/study-time` gets (the last [ActiveTime.KEEP_DAYS] days, > 0 only). */
    @Synchronized
    fun reportDays(now: Long = System.currentTimeMillis()): List<StudyTimeDayBody> {
        val first = LocalDate.parse(today(now)).minusDays(ActiveTime.KEEP_DAYS.toLong()).toString()
        val days = (state.totals.keys + listOfNotNull(state.last?.day)).filter { it >= first }.toSortedSet()
        return days.map { StudyTimeDayBody(it, ActiveTime.total(state, it, now)) }.filter { it.active_ms > 0 }
    }

    /** Sends this device's totals and keeps the server's; never throws. Throttled unless [force]. */
    suspend fun report(api: Api, force: Boolean = false, now: Long = System.currentTimeMillis()) {
        if (!force && now - lastReportedAt < REPORT_EVERY_MS) return
        lastReportedAt = now
        try {
            write(SERVER, api.putStudyTime(deviceId, reportDays(now)))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            lastReportedAt = 0
            android.util.Log.w("StudyTime", "report failed: ${e.message}")
        }
    }

    // ---------------- resume point ----------------

    fun resumePoint(): StudyResume.Point? = read<PointDto>(POINT)?.let { StudyResume.Point(it.day, it.scope, it.card_id, it.revealed, it.answer, it.elapsed_ms) }

    fun saveResumePoint(p: StudyResume.Point) = write(POINT, PointDto(p.day, p.scope, p.cardId, p.revealed, p.answer, p.elapsedMs))

    /** The card was rated / removed: clear its point (another card's point is left alone). */
    fun clearResumePoint(cardId: String? = null) {
        if (cardId != null && resumePoint()?.cardId != cardId) return
        write<PointDto>(POINT, null)
    }

    // ---------------- celebration ----------------

    /** True (and marked) when emptying the queue now deserves the confetti ([Celebration.should]). */
    @Synchronized
    fun claimCelebration(reviewsToday: Int, queueEmpty: Boolean, now: Long = System.currentTimeMillis()): Boolean {
        val day = today(now)
        val mark = read<MarkDto>(MARK)?.let { Celebration.Mark(it.day, it.reviews) }
        if (!Celebration.should(mark, day, reviewsToday, queueEmpty)) return false
        write(MARK, MarkDto(day, reviewsToday))
        return true
    }

    /**
     * Lab "today split": the second, smaller celebration — flashcards, today's mini lessons
     * and today's story all done. Once per local day; true (and marked) the first time.
     */
    @Synchronized
    fun claimAllClear(now: Long = System.currentTimeMillis()): Boolean {
        val day = today(now)
        if (sp.getString(ALL_CLEAR, null) == day) return false
        sp.edit().putString(ALL_CLEAR, day).apply()
        return true
    }

    /** Runs after every sync: report this device's time (throttled). */
    object Sync : FeatureSync {
        override suspend fun sync(ctx: dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext) {
            instance?.report(ctx.api, force = ctx.full)
        }
    }

    companion object {
        private const val STATE = "active_time"
        private const val SERVER = "server_totals"
        private const val DEVICE = "device_id"
        private const val POINT = "resume_point"
        private const val MARK = "celebrated"
        private const val ALL_CLEAR = "all_clear"
        private const val SAVE_EVERY_MS = 5_000L
        private const val REPORT_EVERY_MS = 10 * 60_000L

        @Volatile private var instance: StudyDayStore? = null
        fun get(context: Context): StudyDayStore = instance ?: synchronized(this) {
            instance ?: StudyDayStore(context.applicationContext).also { instance = it }
        }

        /** Tests: a fresh store (and forget the shared one). */
        fun forTest(context: Context, zone: ZoneId): StudyDayStore {
            context.getSharedPreferences("lab_study_day", Context.MODE_PRIVATE).edit().clear().commit()
            return StudyDayStore(context.applicationContext, zone).also { instance = it }
        }

        /** Tests: a new process reading what the last one saved. */
        fun forTestKeeping(context: Context, zone: ZoneId): StudyDayStore =
            StudyDayStore(context.applicationContext, zone).also { instance = it }
    }
}
