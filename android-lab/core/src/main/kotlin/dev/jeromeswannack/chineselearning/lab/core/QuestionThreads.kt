package dev.jeromeswannack.chineselearning.lab.core

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

/*
 * Ask-Claude questions grouped into per-card conversations. Port of shared/chats/threads.ts
 * (groupQuestionThreads, sqliteToIso) — parity-tested (parity/fixtures/chat.ts).
 */

interface QuestionRowLike {
    val id: String
    val note_id: String
    val asked_at: String
}

data class QuestionThread<T : QuestionRowLike>(
    val id: String,
    val noteId: String,
    /** Oldest first. */
    val questions: List<T>,
    val startedAt: String,
    val lastAt: String,
)

object QuestionThreads {
    /** Two questions on the same card closer than this belong to one thread. */
    const val THREAD_GAP_MS = 30L * 60 * 1000

    /** Date.parse of an ISO string (or SQLite's "YYYY-MM-DD HH:MM:SS", read as UTC); 0 when unparseable. */
    fun time(iso: String): Long = runCatching { Instant.parse(iso).toEpochMilli() }.getOrElse {
        runCatching { LocalDateTime.parse(iso.replace(' ', 'T')).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrDefault(0L)
    }

    /** Port of groupQuestionThreads: newest thread first. */
    fun <T : QuestionRowLike> group(rows: List<T>, gapMs: Long = THREAD_GAP_MS): List<QuestionThread<T>> {
        val sorted = rows.sortedBy { time(it.asked_at) }
        val open = HashMap<String, Int>()
        val threads = mutableListOf<QuestionThread<T>>()
        for (row in sorted) {
            val idx = open[row.note_id]
            if (idx != null) {
                val current = threads[idx]
                if (time(row.asked_at) - time(current.lastAt) <= gapMs) {
                    threads[idx] = current.copy(questions = current.questions + row, lastAt = row.asked_at)
                    continue
                }
            }
            open[row.note_id] = threads.size
            threads += QuestionThread(row.id, row.note_id, listOf(row), row.asked_at, row.asked_at)
        }
        return threads.sortedByDescending { time(it.lastAt) }
    }

    /** Port of sqliteToIso. */
    fun sqliteToIso(value: String): String {
        if (value.isEmpty() || value.contains('T')) return value
        return value.replaceFirst(' ', 'T') + if (value.endsWith("Z")) "" else "Z"
    }
}
