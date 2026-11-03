package dev.jeromeswannack.chineselearning.lab.core

import java.util.Locale

/**
 * "💬 Ask Claude" chats on the Sentence Coach — port of shared/coach/askChat.ts (parity-tested by
 * parity/fixtures/coach-ask.ts → CoachAskParityTest): the conversation kind, the title, which of
 * Claude's messages get ▶ / 🎤 Read it back, the words to recap kept per chat on the phone (tapped
 * + said wrong in a Read it back) and the default ticks of "Make flashcards from this chat".
 */
object CoachAsk {
    const val ACTION = "ask"
    const val ICON = "💬"
    const val LABEL = "Ask Claude"
    const val HINT = "Ask anything — Claude answers in simple Chinese. Tap any word to look it up."
    const val EMPTY_EN = "Ask anything. Claude answers in English here — switch to 中文 for immersion."
    const val PLACEHOLDER_ZH = "用中文问吧… (or English)"
    const val PLACEHOLDER_EN = "Ask anything…"
    const val THINKING_ZH = "想一想… Thinking…"
    const val THINKING_EN = "Thinking…"
    const val MAX_CHARS = 2000
    const val TITLE_MAX = 120
    const val READ_BACK_LABEL = "Read it back"
    const val READ_BACK_LISTENING = "Listening… read Claude’s message aloud"
    const val READ_BACK_MAX_CHARS = 2000
    const val RECAP_MAX = 200

    const val TAPPED = "tapped"
    const val SAID_WRONG = "said_wrong"
    private val REASON_ORDER = listOf(TAPPED, SAID_WRONG)

    /** One word to recap (the web's `AskRecapWord`). */
    data class RecapWord(
        val hanzi: String,
        val sentence: String,
        val reasons: List<String>,
        val pinyin: String? = null,
        val gloss: String? = null,
        val reasonLine: String? = null,
    )

    /** Port of conversationKind: "ask", or the sentence action's id. */
    fun conversationKind(kind: String?, action: String?, inputLanguage: String?): String =
        if (kind == ACTION || action == ACTION) ACTION else CoachActions.conversationAction(action, inputLanguage).id

    private fun cps(s: String): List<String> = s.codePoints().toArray().map { String(Character.toChars(it)) }
    private fun isHanCp(cp: Int) = Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN
    private fun hasHan(s: String) = s.codePoints().anyMatch(::isHanCp)
    private fun jsTrim(s: String) = NoteSearch.jsTrim(s)

    /** JS `s.replace(/\s+/g, rep)`. */
    private fun collapseWs(s: String, rep: String): String {
        val b = StringBuilder()
        var inWs = false
        for (c in s) {
            if (NoteSearch.isJsWhitespace(c)) {
                if (!inWs) b.append(rep)
                inWs = true
            } else {
                b.append(c)
                inWs = false
            }
        }
        return b.toString()
    }

    /** Port of askConversationTitle. */
    fun title(first: String): String {
        val one = jsTrim(collapseWs(first, " "))
        val c = cps(one)
        return if (c.size > TITLE_MAX) c.take(TITLE_MAX - 1).joinToString("") + "…" else one
    }

    /** Port of readBackOffered. */
    fun readBackOffered(role: String, content: String, answerLang: String?, status: String?): Boolean {
        if (role != "assistant" || !status.isNullOrEmpty()) return false
        if (answerLang != "zh") return false
        val text = jsTrim(content)
        return text.isNotEmpty() && text.length <= READ_BACK_MAX_CHARS && hasHan(text)
    }

    /** Port of recapKey: no spaces. */
    fun recapKey(hanzi: String): String = collapseWs(hanzi, "")

    private fun clean(s: String?): String? = s?.let(::jsTrim)?.takeIf { it.isNotEmpty() }

    /** Port of addRecapWord. */
    fun addRecapWord(list: List<RecapWord>, word: RecapWord, max: Int = RECAP_MAX): List<RecapWord> {
        val key = recapKey(word.hanzi)
        if (key.isEmpty() || !hasHan(key)) return list.toList()
        val i = list.indexOfFirst { recapKey(it.hanzi) == key }
        if (i < 0) {
            val fresh = RecapWord(
                hanzi = key,
                sentence = jsTrim(word.sentence),
                reasons = REASON_ORDER.filter { it in word.reasons },
                pinyin = clean(word.pinyin),
                gloss = clean(word.gloss),
                reasonLine = clean(word.reasonLine),
            )
            val next = list + fresh
            return if (next.size > max) next.drop(next.size - max) else next
        }
        val old = list[i]
        val merged = RecapWord(
            hanzi = old.hanzi,
            sentence = old.sentence.ifEmpty { jsTrim(word.sentence) },
            reasons = REASON_ORDER.filter { it in old.reasons || it in word.reasons },
            pinyin = clean(old.pinyin) ?: clean(word.pinyin),
            gloss = clean(old.gloss) ?: clean(word.gloss),
            reasonLine = clean(word.reasonLine) ?: clean(old.reasonLine),
        )
        return list.toMutableList().also { it[i] = merged }
    }

    fun addRecapWords(list: List<RecapWord>, words: List<RecapWord>, max: Int = RECAP_MAX): List<RecapWord> =
        words.fold(list.toList()) { acc, w -> addRecapWord(acc, w, max) }

    /** Port of readBackWordWrong: tone off / wrong / missed (an extra alone isn't a mistake). */
    fun readBackWordWrong(chars: List<ReadAloud.Char>): Boolean =
        chars.any { it.mark == ReadAloud.Mark.CLOSE || it.mark == ReadAloud.Mark.WRONG || it.mark == ReadAloud.Mark.MISSED }

    /** Port of readBackReasonLine. */
    fun readBackReasonLine(chars: List<ReadAloud.Char>): String {
        val parts = chars.mapNotNull { c ->
            when (c.mark) {
                ReadAloud.Mark.CLOSE -> "tone off on ${c.char}${if (c.heard.isNotEmpty()) " (heard ${c.heard})" else ""}"
                ReadAloud.Mark.WRONG -> if (c.heard.isNotEmpty()) "heard ${c.heard} for ${c.char}" else "${c.char} was wrong"
                ReadAloud.Mark.MISSED -> "missed ${c.char}"
                else -> null
            }
        }
        val line = parts.joinToString(" · ")
        return if (line.isEmpty()) "" else line.substring(0, 1).uppercase(Locale.ROOT) + line.substring(1)
    }

    /** Port of readBackMistakeWords: [words] must concatenate to [text], else each character is a word. */
    fun readBackMistakeWords(text: String, words: List<String>, result: ReadAloud.Result): List<RecapWord> {
        val all = cps(text)
        if (result.chars.size != all.size) return emptyList()
        val segments = if (words.isNotEmpty() && words.joinToString("") == text) words else all
        val out = mutableListOf<RecapWord>()
        var cp = 0
        var unit = 0
        for (w in segments) {
            val len = w.codePointCount(0, w.length)
            val chars = result.chars.subList(cp, cp + len)
            if (hasHan(w) && readBackWordWrong(chars)) {
                out += RecapWord(
                    hanzi = recapKey(w),
                    sentence = ReaderWords.sentenceAround(text, unit, unit + w.length),
                    reasons = listOf(SAID_WRONG),
                    reasonLine = readBackReasonLine(chars),
                )
            }
            cp += len
            unit += w.length
        }
        return out
    }

    /** Port of recapCountLabel. */
    fun recapCountLabel(n: Int): String = if (n <= 0) "📝 No words to recap yet" else "📝 $n word${if (n == 1) "" else "s"} to recap"

    /** Port of askCardChecked. */
    fun cardChecked(hanzi: String, alreadyHave: Boolean, recap: List<String>): Boolean {
        if (alreadyHave) return false
        if (recap.isEmpty()) return true
        val key = recapKey(hanzi)
        return recap.any { recapKey(it) == key }
    }

    /** Port of recapFocusWords: distinct keys, the newest 40. */
    fun focusWords(recap: List<String>): List<String> {
        val seen = LinkedHashSet<String>()
        for (h in recap) {
            val k = recapKey(h)
            if (k.isNotEmpty()) seen += k
        }
        val list = seen.toList()
        return if (list.size > 40) list.drop(list.size - 40) else list
    }
}
