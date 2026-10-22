package dev.jeromeswannack.chineselearning.lab.ui.today

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.LessonRevision
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

/** Today's reader with what the screens need to show it (titles, pages); the locked lessons. */
data class TodaySnapshot(
    val reader: TodayPlan.Reader,
    /** Today's story when there is one to read. */
    val readerEntry: ReaderEntry?,
    /** The story read today (for "Read ✓ · 小明在巴黎"). */
    val readerDone: ReaderEntry?,
    /** A story is being written (the daily reader or a generate request). */
    val writing: Boolean,
    /** Locked lessons (core LessonUnlocks): "Ready to unlock". */
    val locked: List<LessonEntry> = emptyList(),
) {
    companion object {
        val EMPTY = TodaySnapshot(TodayPlan.Reader.None, null, null, false)
    }
}

/**
 * The reader half of today (Lab-only "today split"): the ONE place that works out today's reader
 * for Home, the reader route and the session (ui/lessons/StudyExtras), and the one place mini
 * lesson / story completions are recorded — the completion event (with its attempt, outcome and
 * recordings, through the Outbox; the outcome decides done forever vs a revision in a week), the
 * reader's finish (read once — never again), the day's reader mark (`markDailyReader`) and the
 * homework `done`. Mini lessons are no longer part of today's study (Oct 2026).
 */
class TodayData(private val app: LabApp) {
    private val runtime get() = LessonRuntime.of(app)

    /** Off the main thread: it decodes the whole readers / lessons lists (MBs), which froze Home and Study. */
    suspend fun snapshot(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): TodaySnapshot =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { snapshotNow(nowMs, zone) }

    private suspend fun snapshotNow(nowMs: Long, zone: ZoneId): TodaySnapshot {
        val cutoff = StudyQueue.cutoff(nowMs, zone)
        val entries = runtime.store.entries()
        val readers = runtime.readers.entries()
        val readerOneOff = runtime.readers.oneOffOnly()
        val readToday = ReaderSchedule.readToday(readers.filter { it.id !in readerOneOff }.flatMap { it.events }, nowMs, zone)
        val picked = runtime.readers.todaysReader(nowMs, cutoff, zone)
        val readerDone = readers.filter { it.id in readToday }.maxByOrNull { r -> r.events.maxOfOrNull { it.at } ?: "" }
        return TodaySnapshot(
            reader = TodayPlan.reader(picked?.item, readToday.isNotEmpty()),
            readerEntry = picked,
            readerDone = readerDone,
            writing = readers.any { it.reader.status == "generating" },
            locked = entries.filter { it.locked }.sortedWith(compareBy({ it.lesson.createdAt }, { it.id })),
        )
    }

    /** `completeCustomLesson` (+ upload soon): its outcome decides done forever vs a revision. Null when it couldn't be written. */
    suspend fun completeLesson(lessonId: String, result: LessonResult, source: String = "lessons_page"): LessonRevision.State? {
        val state = runCatching {
            runtime.store.complete(lessonId, result.correct, result.total, result.attempt, result.recordings, result.outcome, source = source)
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
