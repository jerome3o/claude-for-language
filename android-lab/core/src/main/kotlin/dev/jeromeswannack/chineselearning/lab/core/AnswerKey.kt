package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of frontend/src/utils/numberHanzi.ts and the typed-answer comparison in
 * StudyPage's AnswerDiff. JavaScript regex classes are ASCII (`\b`, `\d`, `\w`)
 * while Android's ICU regex treats 个 as a word character, so the boundaries
 * are spelled out explicitly here — "7个" must still become 七个.
 */
object AnswerKey {
    /** JS `\s` / String.prototype.trim whitespace (WhiteSpace + LineTerminator). */
    private const val JS_WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private val TRIM = Regex("^[$JS_WS]+|[$JS_WS]+$")
    private const val W = "A-Za-z0-9_"
    private const val B_START = "(?<![$W])"
    private const val B_END = "(?![$W])"

    private val ANSWER_PUNCTUATION = Regex(
        "[$JS_WS" + "。，、！？．·….,!?;:；：\"\"''\"'()（）【】\\[\\]《》<>「」-]",
    )

    private val ENGLISH = mapOf(
        "zero" to "零", "one" to "一", "two" to "二", "three" to "三", "four" to "四", "five" to "五",
        "six" to "六", "seven" to "七", "eight" to "八", "nine" to "九", "ten" to "十",
        "eleven" to "十一", "twelve" to "十二", "thirteen" to "十三", "fourteen" to "十四", "fifteen" to "十五",
        "sixteen" to "十六", "seventeen" to "十七", "eighteen" to "十八", "nineteen" to "十九",
        "twenty" to "二十", "thirty" to "三十", "forty" to "四十", "fifty" to "五十",
        "sixty" to "六十", "seventy" to "七十", "eighty" to "八十", "ninety" to "九十",
        "hundred" to "百", "thousand" to "千",
    )
    private val ROMAN = mapOf(
        "I" to "一", "II" to "二", "III" to "三", "IV" to "四", "V" to "五",
        "VI" to "六", "VII" to "七", "VIII" to "八", "IX" to "九", "X" to "十",
        "XI" to "十一", "XII" to "十二", "XIII" to "十三", "XIV" to "十四", "XV" to "十五",
        "XVI" to "十六", "XVII" to "十七", "XVIII" to "十八", "XIX" to "十九",
        "XX" to "二十", "XXX" to "三十", "XL" to "四十", "L" to "五十",
        "LX" to "六十", "LXX" to "七十", "LXXX" to "八十", "XC" to "九十", "C" to "百",
    )

    private val THOUSANDS = Regex("([0-9]),(?=[0-9]{3})")
    private val ENGLISH_WORDS = Regex(
        B_START + "(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)" + B_END,
        RegexOption.IGNORE_CASE,
    )
    private val ROMAN_WORDS = Regex(B_START + "[IVXLC]+" + B_END)
    private val PERCENT = Regex("([0-9]+)(?:\\.([0-9]+))?%")
    private val DECIMAL = Regex(B_START + "([0-9]+)\\.([0-9]+)" + B_END)
    private val DIGITS = Regex(B_START + "[0-9]+" + B_END)
    private val LIANG = Regex("两")

    fun jsTrim(s: String): String = TRIM.replace(s, "")

    /** JS toLowerCase is locale-independent. */
    private fun lower(s: String) = s.lowercase(java.util.Locale.ROOT)

    fun intToHanzi(n: Long): String {
        if (n == 0L) return "零"
        val ones = arrayOf("", "一", "二", "三", "四", "五", "六", "七", "八", "九")
        if (n < 10) return ones[n.toInt()]
        if (n == 10L) return "十"
        if (n < 20) return "十" + ones[(n - 10).toInt()]
        if (n < 100) {
            val one = (n % 10).toInt()
            return ones[(n / 10).toInt()] + "十" + (if (one > 0) ones[one] else "")
        }
        if (n < 1000) {
            val h = (n / 100).toInt()
            val rem = n % 100
            if (rem == 0L) return ones[h] + "百"
            if (rem < 10) return ones[h] + "百零" + ones[rem.toInt()]
            return ones[h] + "百" + intToHanzi(rem)
        }
        if (n < 10000) {
            val t = (n / 1000).toInt()
            val rem = n % 1000
            if (rem == 0L) return ones[t] + "千"
            if (rem < 100) return ones[t] + "千零" + intToHanzi(rem)
            return ones[t] + "千" + intToHanzi(rem)
        }
        if (n < 100000000) {
            val w = n / 10000
            val rem = n % 10000
            if (rem == 0L) return intToHanzi(w) + "万"
            if (rem < 1000) return intToHanzi(w) + "万零" + intToHanzi(rem)
            return intToHanzi(w) + "万" + intToHanzi(rem)
        }
        return Js.numberToString(n.toDouble())
    }

    /** parseInt of a digit run, as a JS number (so huge runs lose precision the same way). */
    private fun parseDigits(s: String): Long? {
        val d = s.toBigInteger().toDouble()
        return if (d <= Long.MAX_VALUE.toDouble()) d.toLong() else null
    }

    private fun intPartToHanzi(s: String): String {
        val n = parseDigits(s)
        return if (n != null) intToHanzi(n) else Js.numberToString(s.toBigInteger().toDouble())
    }

    private fun decimalToHanzi(intPart: String, fracPart: String): String {
        val digits = arrayOf("零", "一", "二", "三", "四", "五", "六", "七", "八", "九")
        return intPartToHanzi(intPart) + "点" + fracPart.map { digits[it - '0'] }.joinToString("")
    }

    fun normalizeNumbersToHanzi(text: String): String {
        var result = THOUSANDS.replace(text, "$1")
        result = ENGLISH_WORDS.replace(result) { m -> ENGLISH[lower(m.value)] ?: m.value }
        result = ROMAN_WORDS.replace(result) { m -> ROMAN[m.value.uppercase(java.util.Locale.ROOT)] ?: m.value }
        result = PERCENT.replace(result) { m ->
            val intPart = m.groupValues[1]
            val frac = m.groups[2]?.value
            "百分之" + (if (!frac.isNullOrEmpty()) decimalToHanzi(intPart, frac) else intPartToHanzi(intPart))
        }
        result = DECIMAL.replace(result) { m -> decimalToHanzi(m.groupValues[1], m.groupValues[2]) }
        result = DIGITS.replace(result) { m -> intPartToHanzi(m.value) }
        return result
    }

    /** `normalizeHanzi`: trim + lowercase. */
    fun normalize(s: String): String = lower(jsTrim(s))

    fun stripPunctuation(s: String): String = ANSWER_PUNCTUATION.replace(lower(jsTrim(s)), "")

    fun hanziAnswerKey(s: String): String =
        ANSWER_PUNCTUATION.replace(LIANG.replace(normalizeNumbersToHanzi(lower(jsTrim(s))), "二"), "")

    /**
     * Port of `AnswerVerdict` (shared/cards/answer.ts). [SOUND] and [CLOSE] only come from
     * [checkSpoken]: other characters with the answer's pinyin (tones included) / the same
     * syllables with other tones.
     */
    enum class Verdict { EXACT, PUNCTUATION_ONLY, ALTERNATIVE, EQUIVALENT, SOUND, CONTAINS, CLOSE, WRONG }

    /**
     * The AnswerDiff decision: exact → punctuation-only → accepted equivalent
     * (numbers / 两 / listed alternatives) → wrong (positional character diff).
     */
    fun check(userAnswer: String, correct: String, alternatives: List<String>): Verdict {
        val user = jsTrim(userAnswer)
        if (normalize(user) == normalize(correct)) return Verdict.EXACT
        if (stripPunctuation(user) == stripPunctuation(correct)) return Verdict.PUNCTUATION_ONLY
        val userKey = hanziAnswerKey(user)
        if (userKey == hanziAnswerKey(correct)) return Verdict.EQUIVALENT
        val normalizedUser = normalize(user)
        if (alternatives.any { normalize(it) == normalizedUser || hanziAnswerKey(it) == userKey }) return Verdict.ALTERNATIVE
        return Verdict.WRONG
    }

    /** Port of `isAcceptedVerdict`: [Verdict.CLOSE] is still wrong. */
    fun isAccepted(verdict: Verdict) = verdict != Verdict.WRONG && verdict != Verdict.CLOSE

    // ---- spoken answers (shared/cards/answer.ts) ----

    private const val TONED = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ"
    private const val BASE = "aaaaeeeeiiiioooouuuuüüüü"
    private val NOT_PINYIN = Regex("[^a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]")

    /** Port of `normalizeSpokenPinyin`: NFC, lower case, letters and tone-marked vowels only. */
    fun normalizeSpokenPinyin(py: String): String =
        NOT_PINYIN.replace(lower(java.text.Normalizer.normalize(py, java.text.Normalizer.Form.NFC)), "")

    /** Port of `tonelessPinyin` (ǚ → ü). */
    fun tonelessPinyin(key: String): String {
        val out = StringBuilder(key.length)
        for (ch in key) {
            val i = TONED.indexOf(ch)
            out.append(if (i >= 0) BASE[i] else ch)
        }
        return out.toString()
    }

    /** Port of `spokenPinyinKey`: the answer key, then the app's automatic pinyin (pinyin-pro + 一 / 不). */
    fun spokenPinyinKey(hanzi: String): String {
        val key = hanziAnswerKey(hanzi)
        if (key.isEmpty()) return ""
        return normalizeSpokenPinyin(ToneChange.applyYiBuToneChanges(key, Pinyin.toPinyin(key)))
    }

    private fun hasHan(s: String): Boolean {
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            if (Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN) return true
            i += Character.charCount(cp)
        }
        return false
    }

    private fun codePoints(s: String): List<String> = s.codePoints().toArray().map { String(Character.toChars(it)) }

    /**
     * Port of `spokenSyllables`: each character of the answer key with its syllable (automatic
     * pinyin + 一 / 不, normalised); null for a non-Han character.
     */
    fun spokenSyllables(hanzi: String): List<String?> {
        val key = hanziAnswerKey(hanzi)
        if (key.isEmpty()) return emptyList()
        val chars = codePoints(key)
        val tokens = ToneChange.applyYiBuToneChanges(key, Pinyin.toPinyin(key)).split(" ")
        if (tokens.size != chars.size) return chars.map { null }
        return chars.mapIndexed { i, c -> if (hasHan(c)) normalizeSpokenPinyin(tokens[i]).ifEmpty { null } else null }
    }

    private fun allSyllables(xs: List<String?>): Boolean = xs.isNotEmpty() && xs.all { it != null }

    private fun hasToneMark(py: String) = tonelessPinyin(py) != py

    /** Port of `syllablesMatch`: equal, or a neutral syllable of an answer with at least one toned syllable. */
    private fun syllablesMatch(heard: List<String>, target: List<String>): Boolean {
        if (heard.size != target.size) return false
        val neutralOk = target.any(::hasToneMark)
        return heard.indices.all { i -> heard[i] == target[i] || (neutralOk && !hasToneMark(target[i]) && tonelessPinyin(heard[i]) == target[i]) }
    }

    /** Port of `runMatches`: heard syllables against the note's written pinyin run (no boundaries). */
    private fun runMatches(heard: List<String>, run: String): Boolean {
        val toned = hasToneMark(run)
        var pos = 0
        for (h in heard) {
            if (run.startsWith(h, pos)) { pos += h.length; continue }
            val bare = tonelessPinyin(h)
            if (toned && run.startsWith(bare, pos)) { pos += bare.length; continue }
            return false
        }
        return pos == run.length
    }

    private class SpokenTargets(val syllables: List<List<String>>, val runs: List<String>)

    private fun spokenTargets(correct: String, alternatives: List<String>, notePinyin: String): SpokenTargets {
        val syllables = (listOf(correct) + alternatives).map(::spokenSyllables).filter(::allSyllables).map { s -> s.map { it!! } }
        val run = normalizeSpokenPinyin(notePinyin)
        return SpokenTargets(syllables, if (run.isNotEmpty()) listOf(run) else emptyList())
    }

    private fun soundsLike(heard: List<String>, targets: SpokenTargets): Boolean =
        targets.syllables.any { syllablesMatch(heard, it) } || targets.runs.any { runMatches(heard, it) }

    /** How [answerWithin] found the answer inside the transcript. */
    enum class Within { HANZI, SOUND }

    /**
     * Port of `spokenAnswerWithin`: the answer's (or an alternative's) hanzi as one stretch of the
     * transcript's answer key (traditional → simplified for the common characters), else a
     * syllable window that sounds like it. null = not found. Used by [checkSpoken] (CONTAINS) and
     * the read card's "Answer found in your sentence" (ui/study Transcription.compare).
     */
    fun answerWithin(transcript: String, correct: String, alternatives: List<String> = emptyList(), notePinyin: String = ""): Within? {
        if (!hasHan(transcript)) return null
        val heardKey = PictureHuntMatch.toSimplified(hanziAnswerKey(transcript))
        for (t in listOf(correct) + alternatives) {
            val k = PictureHuntMatch.toSimplified(hanziAnswerKey(t))
            if (k.isNotEmpty() && hasHan(k) && heardKey.contains(k)) return Within.HANZI
        }
        val heard = spokenSyllables(transcript)
        val targets = spokenTargets(correct, alternatives, notePinyin)
        if (targets.syllables.isEmpty() && targets.runs.isEmpty()) return null
        for (i in heard.indices) {
            for (j in i + 1..heard.size) {
                val w = heard.subList(i, j)
                if (!allSyllables(w)) break
                if (soundsLike(w.map { it!! }, targets)) return Within.SOUND
            }
        }
        return null
    }

    /**
     * Port of `checkSpokenAnswer`: the typed check first; then by sound — [Verdict.SOUND] when the
     * transcript's toned pinyin is the answer's (an alternative's, or the note's written pinyin; a
     * neutral syllable of the answer matches any tone), [Verdict.CONTAINS] when the answer is said
     * inside a longer sentence ([answerWithin]), [Verdict.CLOSE] when only the toneless syllables of
     * the whole match. Nothing Chinese heard is wrong.
     */
    fun checkSpoken(transcript: String, correct: String, alternatives: List<String> = emptyList(), notePinyin: String = ""): Verdict {
        val typed = check(transcript, correct, alternatives)
        if (typed != Verdict.WRONG) return typed
        if (!hasHan(transcript)) return Verdict.WRONG
        val heard = spokenPinyinKey(transcript)
        if (heard.isEmpty()) return Verdict.WRONG
        val keys = (listOf(correct) + alternatives).map(::spokenPinyinKey) + normalizeSpokenPinyin(notePinyin)
        val live = keys.filter { it.isNotEmpty() }
        if (heard in live) return Verdict.SOUND
        val syllables = spokenSyllables(transcript)
        if (allSyllables(syllables) && soundsLike(syllables.map { it!! }, spokenTargets(correct, alternatives, notePinyin))) return Verdict.SOUND
        if (answerWithin(transcript, correct, alternatives, notePinyin) != null) return Verdict.CONTAINS
        val bare = tonelessPinyin(heard)
        if (live.any { tonelessPinyin(it) == bare }) return Verdict.CLOSE
        return Verdict.WRONG
    }

    /** Port of `spokenVerdictNote`: the line under a spoken answer on the back. */
    fun spokenVerdictNote(verdict: Verdict, correct: String): String? = when (verdict) {
        Verdict.SOUND -> "Sounded right ✓ — written ${jsTrim(correct)}"
        Verdict.CLOSE -> "Close — the tones are off"
        else -> null
    }

    /** The verdict's name in shared/cards/answer.ts (`AnswerVerdict`), for parity tests and analytics. */
    fun verdictName(v: Verdict): String = v.name.lowercase(java.util.Locale.ROOT)
}
