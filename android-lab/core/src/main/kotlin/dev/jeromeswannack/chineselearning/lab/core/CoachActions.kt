package dev.jeromeswannack.chineselearning.lab.core

/*
 * Sentence Coach buttons. Port of shared/coach/actions.ts — parity-tested (parity/fixtures/coach.ts).
 *
 * Chinese (any Han character) → "Check my sentence" + "Explain"; mixed Chinese + English → the
 * same two; English only → the single "Translate"; empty → the two Chinese buttons, disabled (the
 * widget's ✏️ and the study card's ⋯ → Sentence coach land here without sending anything).
 */

enum class CoachAction(val id: String, val label: String, val busy: String, val icon: String) {
    CHECK("check", "Check my sentence", "Checking…", "✏️"),
    EXPLAIN("explain", "Explain", "Explaining…", "🔍"),
    TRANSLATE("translate", "Translate", "Translating…", "🇬🇧");

    companion object {
        fun of(id: String?): CoachAction? = entries.firstOrNull { it.id == id }
    }
}

data class CoachButtons(val kind: String, val actions: List<CoachAction>, val enabled: Boolean, val hint: String?)

data class CoachSentenceCard(val hanzi: String, val pinyin: String, val english: String, val funFacts: String?)

data class CoachBreakdownWord(val hanzi: String, val pinyin: String, val gloss: String)

object CoachActions {
    /** Port of hasHan: CJK Unified Ideographs, Extension A, compatibility ideographs (UTF-16 units, like the JS regex). */
    fun hasHan(text: String): Boolean = text.any { c -> c in '㐀'..'䶿' || c in '一'..'鿿' || c in '豈'..'﫿' }

    /** Port of hasLatinLetters: ASCII or full-width Latin letters. */
    fun hasLatinLetters(text: String): Boolean = text.any { c -> c in 'A'..'Z' || c in 'a'..'z' || c in 'Ａ'..'Ｚ' || c in 'ａ'..'ｚ' }

    /** Port of coachInputKind: 'empty' | 'chinese' | 'mixed' | 'english'. */
    fun inputKind(text: String): String {
        val t = jsTrim(text)
        if (t.isEmpty()) return "empty"
        if (!hasHan(t)) return "english"
        return if (hasLatinLetters(t)) "mixed" else "chinese"
    }

    /** Port of coachButtons. */
    fun buttons(text: String): CoachButtons = when (val kind = inputKind(text)) {
        "empty" -> CoachButtons(kind, listOf(CoachAction.CHECK, CoachAction.EXPLAIN), false, null)
        "english" -> CoachButtons(kind, listOf(CoachAction.TRANSLATE), true, "🇬🇧 English — I'll show you how to say it in Chinese")
        "mixed" -> CoachButtons(kind, listOf(CoachAction.CHECK, CoachAction.EXPLAIN), true, "🇨🇳 Chinese with some English — check it if you wrote it, or explain it word by word")
        else -> CoachButtons(kind, listOf(CoachAction.CHECK, CoachAction.EXPLAIN), true, "🇨🇳 Chinese — check it if you wrote it, or explain it word by word")
    }

    /** Port of conversationAction: the recorded action, else check (zh) / translate (en). */
    fun conversationAction(action: String?, inputLanguage: String?): CoachAction =
        CoachAction.of(action) ?: if (inputLanguage == "en") CoachAction.TRANSLATE else CoachAction.CHECK

    /** Port of breakdownSentenceCard: every word as 汉字 (pīnyīn) meaning, then the construction. */
    fun sentenceCard(hanzi: String, pinyin: String, translation: String?, words: List<CoachBreakdownWord>, construction: String?): CoachSentenceCard {
        val lines = words.filter { jsTrim(it.hanzi).isNotEmpty() }.map { w ->
            val py = jsTrim(w.pinyin).let { if (it.isNotEmpty()) " ($it)" else "" }
            val gloss = jsTrim(w.gloss).let { if (it.isNotEmpty()) " $it" else "" }
            "${jsTrim(w.hanzi)}$py$gloss"
        }.toMutableList()
        val c = jsTrim(construction ?: "")
        if (c.isNotEmpty()) lines += c
        val funFacts = lines.joinToString("\n")
        return CoachSentenceCard(jsTrim(hanzi), jsTrim(pinyin), jsTrim(translation ?: ""), funFacts.ifEmpty { null })
    }

    /** JS String.prototype.trim: WhiteSpace + LineTerminator (incl. U+FEFF, U+3000, NBSP). */
    internal fun jsTrim(s: String): String = s.trim { it.isWhitespace() || it == '﻿' || it == ' ' }
}
