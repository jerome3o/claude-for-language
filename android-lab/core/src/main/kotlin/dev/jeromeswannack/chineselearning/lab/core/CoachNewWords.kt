package dev.jeromeswannack.chineselearning.lab.core

/**
 * The Sentence Coach's "➕ Add new words (N)" chip (docs/CHAT.md "Chat ↔ Coach"). Port of
 * shared/coach/newWords.ts — parity-tested (parity/fixtures/coach.ts → CoachParityTest).
 *
 * A word counts when it has a Han character; it is matched like the bump picker
 * ([WordListParser.normalizeHanzi]: spaces / punctuation ignored) against every note; particles
 * (的 了 吗 …) are never offered alone; one row per spelling, in sentence order, at most
 * [MAX]; the picker starts with NOTHING ticked.
 */
object CoachNewWords {
    const val MAX = 20

    /** Port of COACH_SKIP_WORDS. */
    val SKIP_WORDS: Set<String> = setOf("的", "了", "吗", "呢", "吧", "啊", "呀", "啦", "嘛", "着", "过", "地", "得", "嗯", "哦", "哈")

    /** Port of CoachWordCard (null = the field is absent). */
    data class WordCard(
        val hanzi: String,
        val pinyin: String,
        val english: String,
        val sentenceClue: String? = null,
        val sentenceCluePinyin: String? = null,
        val sentenceClueTranslation: String? = null,
    )

    /** `/[\p{Script=Han}〇]/u`, by code point. */
    private fun hasHanScript(s: String): Boolean {
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            if (cp == 0x3007 || Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN) return true
            i += Character.charCount(cp)
        }
        return false
    }

    /** Port of newWordsInSentence: the words of the sentence not in any deck yet, in sentence order. */
    fun newWordsInSentence(words: List<CoachBreakdownWord>, noteHanzi: Iterable<String?>, max: Int = MAX): List<CoachBreakdownWord> {
        val known = HashSet<String>()
        for (h in noteHanzi) {
            val k = WordListParser.normalizeHanzi(h ?: "")
            if (k.isNotEmpty()) known += k
        }
        val seen = HashSet<String>()
        val out = mutableListOf<CoachBreakdownWord>()
        for (w in words) {
            val key = WordListParser.normalizeHanzi(w.hanzi)
            if (key.isEmpty() || !hasHanScript(key) || key in SKIP_WORDS || key in known || key in seen) continue
            seen += key
            out += CoachBreakdownWord(key, NoteSearch.jsTrim(w.pinyin), NoteSearch.jsTrim(w.gloss))
            if (out.size >= max) break
        }
        return out
    }

    /** Port of COACH_NEW_WORDS_LABEL. */
    fun label(n: Int): String = "➕ Add new words ($n)"

    /** Port of COACH_SENTENCE_CARD_LABEL. */
    const val SENTENCE_CARD_LABEL = "🃏 Card for this sentence"

    /** Port of addNewWordsButton: the picker's primary button. */
    fun addButton(ticked: Int): String = when {
        ticked <= 0 -> "Tick the words to add"
        ticked == 1 -> "➕ Add 1 word"
        else -> "➕ Add $ticked words"
    }

    /**
     * Port of newWordCards: hanzi / pinyin / the gloss as the meaning, and the sentence as the
     * example only when it contains the word exactly and is more than the word.
     */
    fun newWordCards(words: List<CoachBreakdownWord>, sentence: String, pinyin: String?, translation: String?): List<WordCard> {
        val s = NoteSearch.jsTrim(sentence)
        return words.filter { NoteSearch.jsTrim(it.hanzi).isNotEmpty() }.map { w ->
            val hanzi = NoteSearch.jsTrim(w.hanzi)
            var card = WordCard(hanzi, NoteSearch.jsTrim(w.pinyin), NoteSearch.jsTrim(w.gloss))
            if (s.isNotEmpty() && s != hanzi && s.contains(hanzi)) {
                val py = NoteSearch.jsTrim(pinyin.orEmpty())
                val tr = NoteSearch.jsTrim(translation.orEmpty())
                card = card.copy(
                    sentenceClue = s,
                    sentenceCluePinyin = py.ifEmpty { null },
                    sentenceClueTranslation = tr.ifEmpty { null },
                )
            }
            card
        }
    }
}
