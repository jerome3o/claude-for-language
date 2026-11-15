package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/study/readTakeCheck.ts — a read card's take checked by Claude when the device can't accept it
 * (docs/STUDY_SESSION.md "You said" → "Read takes checked by Claude"; Jerome, Nov 2026: 我越学中文，越觉得英文很繁琐。
 * read as 我越学中文，越觉得英语很"繁琐"。 was a flat "✕ Didn't match"). The device judges the take first (quotes and
 * every other punctuation mark never matter, one swallowed 是 / 的 / 了 in a sentence forgiven); when it still says
 * ✗ on a card of two or more characters and the device is online, the lesson answer check reads it as a READ-ALOUD
 * check: correct → ✓ Right, acceptable / almost → ≈ Close with the reason, wrong → ✗ with the tip.
 * Parity-tested (parity/fixtures/read-take-check.ts → ReadTakeCheckParityTest).
 */
object ReadTakeCheck {
    const val CHECK_TYPE = LessonAnswerCheck.READ_ALOUD_TYPE
    const val CARD_TYPE = CardTypes.HANZI_TO_MEANING

    /** The box's chip words for a take Claude checked. */
    val CHIP = mapOf("match" to "Right", "close" to "Close", "miss" to "Didn’t match")

    /** While Claude reads it. */
    const val CHECKING = "Checking…"

    /** Port of hanCount(). */
    fun hanCount(text: String): Int {
        var n = 0
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            if (Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN) n++
            i += Character.charCount(cp)
        }
        return n
    }

    /** Port of readTakeDeviceState(): match | contains | close | miss. */
    fun deviceState(isMatch: Boolean, containsExpected: Boolean, tonesOff: Boolean): String =
        if (isMatch) "match" else if (containsExpected) "contains" else if (tonesOff) "close" else "miss"

    /** Port of readTakeCheckApplies(): a read card, the device said ✗, two or more characters, Chinese heard. */
    fun applies(cardType: String, hanzi: String, transcript: String?, isMatch: Boolean, containsExpected: Boolean, tonesOff: Boolean): Boolean {
        if (cardType != CARD_TYPE) return false
        if (deviceState(isMatch, containsExpected, tonesOff) != "miss") return false
        return hanCount(hanzi) >= 2 && LessonAnswerCheck.hasHan(transcript ?: "")
    }

    /** Port of readTakeCheckInput(): the card's hanzi is the model, his tidied transcript the answer. */
    fun input(hanzi: String, pinyin: String?, english: String?, transcript: String): AnswerCheckInput {
        val h = hanzi.trim()
        return AnswerCheckInput(
            promptEn = (english ?: "").trim().ifEmpty { h },
            modelAnswer = h,
            modelPinyin = pinyin?.trim()?.ifEmpty { null },
            answer = AnswerKey.tidySpokenTranscript(transcript, h),
            exerciseType = CHECK_TYPE,
            input = "spoken",
        )
    }

    /** Port of readTakeClaudeState(): correct = match, acceptable / almost = close, wrong = miss. */
    fun claudeState(verdict: String): String = when (verdict) {
        "correct" -> "match"
        "wrong" -> "miss"
        else -> "close"
    }

    /** The take as every rule downstream reads it (port of readTakeChecked()). */
    data class Take(val isMatch: Boolean, val containsExpected: Boolean, val tonesOff: Boolean)

    /** Port of readTakeChecked(): the device's take, or — for one Claude checked — its verdict as match / tones off / miss. */
    fun checked(take: Take, claude: String?): Take {
        if (claude == null || deviceState(take.isMatch, take.containsExpected, take.tonesOff) != "miss") return take
        val state = claudeState(claude)
        return Take(isMatch = state == "match", containsExpected = false, tonesOff = state == "close")
    }

    /** Port of readTakeReason(): Claude's one-line reason, and for ✗ its first tip. */
    data class Reason(val reason: String, val tip: String?)

    fun reason(check: AnswerCheck): Reason {
        val tip = if (check.verdict == "wrong") check.tips.firstOrNull()?.text else null
        return Reason(check.headline, tip?.takeIf { it != check.headline })
    }
}
