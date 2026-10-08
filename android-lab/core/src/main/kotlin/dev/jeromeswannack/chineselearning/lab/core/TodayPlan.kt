package dev.jeromeswannack.chineselearning.lab.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max

/**
 * "Today split" — a deliberate **Lab-only UX experiment** (web unchanged pending Jerome's
 * feedback; android-lab/PARITY.md). Today's study is shown as three separate things —
 * flashcards, mini lessons, the graded reader — on Home and in the session, and the
 * flashcard flow no longer interleaves lessons every [LessonSchedule.MIX_INTERVAL] reviews:
 * the extras follow once the cards run out (leftover lessons, then the reader).
 *
 * This file only PRESENTS the parity-tested selectors, it never re-implements them:
 * which lessons are due and their order come from [LessonSchedule.dueLessons], today's
 * reader from [ReaderSchedule.pickTodays] / [ReaderSchedule.readToday], the card counts from
 * StudyQueue. New lessons are paced per local day ("New lessons a day", [LessonSchedule.dueLessons]
 * with the lessons introduced today — the web does the same since Oct 2026).
 */
object TodayPlan {
    /** Today's mini lessons: what's left ([toDo], session order) and what was finished today. */
    data class Lessons(
        val toDo: List<ScheduledItem>,
        /** Lessons with a completion today that aren't due again today. */
        val done: List<String>,
    ) {
        val total: Int get() = toDo.size + done.size
        val isDone: Boolean get() = toDo.isEmpty() && done.isNotEmpty()
    }

    /** Today's graded reader (one a day). */
    sealed interface Reader {
        /** [item] is today's story (new, due, or a learning repeat). */
        data class ToDo(val item: ScheduledItem) : Reader
        /** A reader was read today and nothing is due again. */
        data object Done : Reader
        /** None read, none to read (a story may be being written). */
        data object None : Reader
    }

    /** The three kinds side by side. */
    data class Today(val cardsDue: Int, val cardsReviewed: Int, val lessons: Lessons, val reader: Reader) {
        val readerLeft: Boolean get() = reader is Reader.ToDo
        /** Lessons and the reader still to do today (the session's "extras"). */
        val extrasLeft: Int get() = lessons.toDo.size + if (readerLeft) 1 else 0
        val cardsDone: Boolean get() = cardsDue == 0
        /** Nothing of any kind left today. */
        val allClear: Boolean get() = cardsDue == 0 && extrasLeft == 0
        /** How many of the kinds that exist today are finished ("2 of 3 done"). */
        val kinds: Int get() = 1 + (if (lessons.total > 0) 1 else 0) + (if (reader != Reader.None) 1 else 0)
        val kindsDone: Int get() = (if (cardsDone) 1 else 0) + (if (lessons.isDone) 1 else 0) + (if (reader == Reader.Done) 1 else 0)
    }

    private fun localDate(iso: String, zone: ZoneId): LocalDate = Instant.ofEpochMilli(Js.parseDate(iso)).atZone(zone).toLocalDate()

    /**
     * Today's lessons: [LessonSchedule.todaysLessons] (`pickTodaysLessons`) — due revisits most
     * overdue first, at most two a day, then NEW homework lessons on top of the daily place, then
     * new oldest first, [newPerDay] a day minus the lessons first finished today (homework
     * finishes don't count; a lesson in [startedToday] keeps its place); one-off homework and
     * Done-for-good out. The session (StudyExtras) reads the same snapshot.
     */
    fun lessons(
        all: List<ScheduledItem>,
        events: List<ItemEvent>,
        oneOffOnly: Set<String>,
        cutoff: StudyCutoff,
        nowMs: Long,
        zone: ZoneId,
        newPerDay: Int = Revisit.DEFAULT.newLessonsPerDayInt,
        homeworkPass: Set<String> = emptySet(),
        startedToday: Set<String> = emptySet(),
    ): Lessons {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val regular = all.mapTo(HashSet()) { it.id }.apply { removeAll(oneOffOnly) }
        val byLesson = events.filter { it.itemId in regular }.groupBy { it.itemId }
        val completedToday = byLesson.filterValues { ev -> ev.any { localDate(it.at, zone) == today } }.keys
        // Revisits are capped per day (`lessonRevisitsToday`, every lesson's completions).
        val revisited = LessonSchedule.revisitsToday(events, nowMs, zone)
        val dayStart = today.atStartOfDay(zone).toInstant().toEpochMilli()
        val toDo = LessonSchedule.todaysLessons(all, events, dayStart, cutoff, oneOffOnly, homeworkPass, startedToday, revisited, newPerDay)
        val toDoIds = toDo.mapTo(HashSet()) { it.id }
        val done = all.filter { it.id in completedToday && it.id !in toDoIds }.map { it.id }
        return Lessons(toDo, done)
    }

    /**
     * Today's reader from the existing pick: [picked] = `pickTodaysReader` (null when nothing
     * is offered), [readToday] = `readersReadToday` isn't empty.
     */
    fun reader(picked: ScheduledItem?, readToday: Boolean): Reader = when {
        picked != null -> Reader.ToDo(picked)
        readToday -> Reader.Done
        else -> Reader.None
    }

    /** "about 8 min" at ~20 s a card (the Study button's estimate). */
    fun minutes(cards: Int): Int = max(1, Math.round(cards * 20 / 60f))

    /** "2 mini lessons and today's story" / "1 mini lesson" / "today's story" / "" — what's left after the cards. */
    fun extrasPhrase(lessons: Int, reader: Boolean): String {
        val l = when (lessons) { 0 -> null; 1 -> "1 mini lesson"; else -> "$lessons mini lessons" }
        val r = if (reader) "today's story" else null
        return listOfNotNull(l, r).joinToString(" and ")
    }

    /** The study top bar's chip: "📘2 📖1" (empty when nothing is left). */
    fun chip(lessons: Int, reader: Boolean): String =
        listOfNotNull(if (lessons > 0) "📘$lessons" else null, if (reader) "📖1" else null).joinToString(" ")
}
