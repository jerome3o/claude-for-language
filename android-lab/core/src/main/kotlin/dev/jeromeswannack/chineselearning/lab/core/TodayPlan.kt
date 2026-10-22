package dev.jeromeswannack.chineselearning.lab.core

import kotlin.math.max

/**
 * "Today split" — a deliberate **Lab-only UX experiment** (web unchanged pending Jerome's
 * feedback; android-lab/PARITY.md). Today's study is shown as separate things — flashcards and
 * the graded reader — on Home and in the session: the story follows once the cards run out. Mini
 * lessons are not today's study any more (Oct 2026): they are on Home's homework card and the
 * Mini Lessons page (core LessonRevision).
 *
 * This file only PRESENTS the parity-tested selectors, it never re-implements them: today's
 * reader from [ReaderSchedule.pickTodays] / [ReaderSchedule.readToday], the card counts from
 * StudyQueue.
 */
object TodayPlan {
    /** Today's graded reader (one a day). */
    sealed interface Reader {
        /** [item] is today's story (new, due, or a learning repeat). */
        data class ToDo(val item: ScheduledItem) : Reader
        /** A reader was read today and nothing is due again. */
        data object Done : Reader
        /** None read, none to read (a story may be being written). */
        data object None : Reader
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
