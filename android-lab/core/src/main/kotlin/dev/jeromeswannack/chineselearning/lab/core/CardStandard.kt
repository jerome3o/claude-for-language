package dev.jeromeswannack.chineselearning.lab.core

/**
 * The HARD rules of the card standard — port of `cardTextProblems` (shared/cards/standard.ts)
 * and the content service's `noteInputProblem` (worker/src/services/content/notes.ts),
 * parity-tested. The Lab app checks a note form with it before saving, so an edit made
 * offline is refused with the same sentence the server would give.
 */
object CardStandard {
    data class Problem(val field: String, val message: String)

    private val FORBIDDEN_ON_CARD = Regex("[/\\\\|()\\[\\]{}（）【】〔〕<>~*=+#@&^`\"'_]")
    private val ELLIPSIS = Regex("…|\\.\\.\\.|。。。")
    // JS: /[a-zü]+[1-5](?=\s|$)/i — spelled out (no Unicode case folding surprises), JS \s.
    private val TONE_NUMBER = Regex("[a-zA-ZüÜ]+[1-5](?=[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]|$)")

    private fun describeSymbol(text: String): String = FORBIDDEN_ON_CARD.find(text)?.let { "\"${it.value}\"" } ?: "an ellipsis"

    /** `cardTextProblems(fields)`: only the fields that are present (non-null) are checked. */
    fun problems(hanzi: String? = null, pinyin: String? = null, sentenceClue: String? = null): List<Problem> {
        val out = ArrayList<Problem>()
        if (hanzi != null && (FORBIDDEN_ON_CARD.containsMatchIn(hanzi) || ELLIPSIS.containsMatchIn(hanzi))) {
            out += Problem("hanzi", "hanzi \"$hanzi\" contains ${describeSymbol(hanzi)}: the card shows ONE clean form — move alternatives, optional characters or the pattern to fun_facts")
        }
        if (pinyin != null && TONE_NUMBER.containsMatchIn(pinyin)) {
            out += Problem("pinyin", "pinyin \"$pinyin\" uses tone numbers — use tone marks (nǐ hǎo)")
        }
        if (!sentenceClue.isNullOrEmpty() && (FORBIDDEN_ON_CARD.containsMatchIn(sentenceClue) || ELLIPSIS.containsMatchIn(sentenceClue))) {
            out += Problem("sentence_clue", "sentence_clue \"$sentenceClue\" contains ${describeSymbol(sentenceClue)}: write one real sentence with no brackets, slashes or blanks")
        }
        return out
    }

    /** `noteInputProblem(input)` for a new note: required fields, then the hard rules; null = fine. */
    fun newNoteProblem(hanzi: String?, pinyin: String?, english: String?, sentenceClue: String?): String? {
        if (NoteSearch.jsTrim(hanzi.orEmpty()).isEmpty()) return "hanzi is required"
        if (NoteSearch.jsTrim(pinyin.orEmpty()).isEmpty()) return "pinyin is required"
        if (NoteSearch.jsTrim(english.orEmpty()).isEmpty()) return "english is required"
        val p = problems(NoteSearch.jsTrim(hanzi!!), pinyin, sentenceClue)
        return if (p.isEmpty()) null else p.joinToString("; ") { it.message }
    }

    /** `updateNote`'s check of a patch (hanzi trimmed as the service does); null = fine. */
    fun editProblem(hanzi: String?, pinyin: String?, english: String?, sentenceClue: String?): String? {
        if (hanzi != null && NoteSearch.jsTrim(hanzi).isEmpty()) return "hanzi cannot be empty"
        if (pinyin != null && NoteSearch.jsTrim(pinyin).isEmpty()) return "pinyin cannot be empty"
        if (english != null && NoteSearch.jsTrim(english).isEmpty()) return "english cannot be empty"
        val p = problems(hanzi?.let(NoteSearch::jsTrim), pinyin, sentenceClue)
        return if (p.isEmpty()) null else p.joinToString("; ") { it.message }
    }
}
