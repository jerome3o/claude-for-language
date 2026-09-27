package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of frontend/src/services/readerFailures.ts (+ `failedReaderTitle` in
 * ReadersListPage.tsx): what the Readers list says about failed story generations.
 * Parity-tested (LessonParityTest).
 */
object ReaderFailures {
    private fun re(p: String) = Regex(p, RegexOption.IGNORE_CASE)
    private val AUTH = re("api ?key|authtoken|authentication|not configured|unauthori[sz]ed|401|403")
    private val TIMEOUT = re("timed? ?out|timeout|deadline")
    private val BUSY = re("rate limit|too many requests|overloaded|429|529|503|busy")
    private val VOCAB = re("not enough|vocabulary|too few")
    private val NETWORK = re("network|fetch failed|econn|socket|offline")

    /** `friendlyReaderError`. */
    fun friendly(raw: String?): String {
        val msg = (raw ?: "").lowercase()
        return when {
            msg.isEmpty() -> "Couldn't write this one."
            AUTH.containsMatchIn(msg) -> "The AI service isn't set up on the server yet."
            TIMEOUT.containsMatchIn(msg) -> "It took too long and was stopped."
            BUSY.containsMatchIn(msg) -> "The AI service was busy — try again in a few minutes."
            VOCAB.containsMatchIn(msg) -> "Not enough learned words to build a story from yet."
            NETWORK.containsMatchIn(msg) -> "The connection dropped while it was being written."
            else -> "Something went wrong while writing this story."
        }
    }

    /** `failedReadersLabel`. */
    fun label(count: Int) = "$count failed generation${if (count == 1) "" else "s"}"

    /** `failedReaderTitle`: most failures are the daily "生成中…" placeholder. */
    fun title(titleChinese: String, titleEnglish: String, topic: String?): String {
        val placeholder = titleChinese == "生成中..." || titleChinese == "生成中…"
        if (!placeholder) return "$titleChinese · $titleEnglish"
        if (!topic.isNullOrEmpty()) return "Story about: $topic"
        if (re("today").containsMatchIn(titleEnglish)) return "Today's story"
        return titleEnglish.replace(Regex("\\.\\.\\.$|…$"), "").ifEmpty { "Story" }
    }
}
