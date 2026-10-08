package dev.jeromeswannack.chineselearning.lab.ui.today

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.RevisitState
import dev.jeromeswannack.chineselearning.lab.core.ReaderSchedule
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.core.TodayPlan
import dev.jeromeswannack.chineselearning.lab.data.api.markDailyReader
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderEntry
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult
import kotlinx.coroutines.launch
import java.time.ZoneId

/** Today's lessons and reader with what the screens need to show them (titles, pages). */
data class TodaySnapshot(
    val lessons: TodayPlan.Lessons,
    val lessonEntries: Map<String, LessonEntry>,
    val reader: TodayPlan.Reader,
    /** Today's story when there is one to read. */
    val readerEntry: ReaderEntry?,
    /** The story read today (for "Read ✓ · 小明在巴黎"). */
    val readerDone: ReaderEntry?,
    /** A story is being written (the daily reader or a generate request). */
    val writing: Boolean,
) {
    val toDo: List<LessonEntry> get() = lessons.toDo.mapNotNull { lessonEntries[it.id] }
    val done: List<LessonEntry> get() = lessons.done.mapNotNull { lessonEntries[it] }

    companion object {
        val EMPTY = TodaySnapshot(TodayPlan.Lessons(emptyList(), emptyList()), emptyMap(), TodayPlan.Reader.None, null, null, false)
    }
}

/**
 * The lessons + reader half of today (Lab-only "today split"): the ONE place that works out
 * today's lessons / reader for Home, today's lesson list, the reader route and the session
 * (ui/lessons/StudyExtras), and the one place their completions are recorded — so doing a
 * lesson or the story from Home counts exactly as in the session: the completion event
 * (with its attempt + recordings, through the Outbox), the rating that sets when it comes back
 * ("revisit later") or Done for good, the reader's finish (read once — never again), the day's
 * reader mark (`markDailyReader`) and the homework `done`.
 */
class TodayData(private val app: LabApp) {
    private val runtime get() = LessonRuntime.of(app)

    /** Off the main thread: it decodes the whole readers / lessons lists (MBs), which froze Home and Study. */
    suspend fun snapshot(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): TodaySnapshot =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { snapshotNow(nowMs, zone) }

    private suspend fun snapshotNow(nowMs: Long, zone: ZoneId): TodaySnapshot {
        val cutoff = StudyQueue.cutoff(nowMs, zone)
        val entries = runtime.store.entries()
        val oneOff = runtime.store.homework.oneOffOnly()
        val homeworkPass = runtime.store.homework.homeworkPass()
        val perDay = runtime.store.revisit.settings().newLessonsPerDayInt
        // A lesson opened today and left half-way stays today's (LessonProgressStore.startedToday).
        val started = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore.get(app).startedToday(nowMs)
        val plan = TodayPlan.lessons(entries.map { it.item }, entries.flatMap { it.events }, oneOff, cutoff, nowMs, zone, perDay, homeworkPass, started)
        val readers = runtime.readers.entries()
        val readerOneOff = runtime.readers.oneOffOnly()
        val readToday = ReaderSchedule.readToday(readers.filter { it.id !in readerOneOff }.flatMap { it.events }, nowMs, zone)
        val picked = runtime.readers.todaysReader(nowMs, cutoff, zone)
        val readerDone = readers.filter { it.id in readToday }.maxByOrNull { r -> r.events.maxOfOrNull { it.at } ?: "" }
        return TodaySnapshot(
            lessons = plan,
            lessonEntries = entries.associateBy { it.id },
            reader = TodayPlan.reader(picked?.item, readToday.isNotEmpty()),
            readerEntry = picked,
            readerDone = readerDone,
            writing = readers.any { it.reader.status == "generating" },
        )
    }

    /** `completeCustomLesson` (+ upload soon); `result.retire` = Done for good. Null when it couldn't be written. */
    suspend fun completeLesson(lessonId: String, result: LessonResult, source: String = "session"): RevisitState? {
        val state = runCatching {
            runtime.store.complete(lessonId, result.correct, result.total, result.rating, result.attempt, result.recordings, retire = result.retire, source = source)
        }.getOrNull()
        runtime.uploadSoon()
        return state
    }

    /** `recordReaderFinish` + the day's reader mark (+ upload soon); [how] = finish | listened. False when it couldn't be written. */
    suspend fun finishReader(readerId: String, timeSpentMs: Long, how: String = "finish"): Boolean {
        val ok = runCatching { runtime.readers.finish(readerId, timeSpentMs, how) }.isSuccess
        runtime.uploadSoon()
        if (app.online.value) app.scope.launch { runCatching { app.repo.api.markDailyReader(readerId) } }
        return ok
    }

    /** `ensureDailyReader` (once per local day): true while today's story is being written. */
    suspend fun ensureDailyReader(dueNoteIds: List<String>, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): Boolean =
        runCatching { runtime.readers.ensureDaily(dueNoteIds, nowMs, StudyQueue.cutoff(nowMs, zone), zone, app.online.value) }.getOrDefault(false)
}
