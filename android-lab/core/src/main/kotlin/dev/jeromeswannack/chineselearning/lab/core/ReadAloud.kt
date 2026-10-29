package dev.jeromeswannack.chineselearning.lab.core

/**
 * "🎤 Read it aloud" on a graded reader page — a port of shared/reader/readAloud.ts, parity-tested
 * (parity/fixtures/read-aloud.ts → ReadAloudParityTest). The take is judged against the page's own
 * Chinese character by character so the page can be marked IN PLACE: punctuation / spaces / quotes
 * left out, numbers → hanzi, 两 = 二, traditional → simplified; each Han character's syllable in
 * context (automatic pinyin + 一 / 不 over each unbroken run); a weighted edit distance lines the two
 * up (ok 0, same sound 1, tone only 2, another character 3, missed / extra 2). A character is ok,
 * sound (a homophone — right), close (tone only), wrong or missed; extra words are a caret. Practice
 * only — nothing is stored.
 */
object ReadAloud {
    enum class Mark { OK, SOUND, CLOSE, WRONG, MISSED, PLAIN }

    data class Char(val char: String, val mark: Mark, val heard: String, val extraBefore: String)

    data class Result(
        val chars: List<Char>,
        val extraAtEnd: String,
        val total: Int,
        val right: Int,
        val pct: Int,
        val toCheck: Int,
    )

    const val LABEL = "Read it aloud"
    const val AGAIN = "Say it again"
    const val STOP = "Stop — check my reading"
    const val LISTENING = "Listening… read the page aloud"
    const val CHECKING = "Checking your reading…"
    const val OFFLINE = "Needs a connection to check your reading"
    const val EMPTY = "Didn’t catch that — try again."
    const val YOU_SAID = "You said"

    private const val COST_OK = 0
    private const val COST_SOUND = 1
    private const val COST_CLOSE = 2
    private const val COST_WRONG = 3
    private const val COST_GAP = 2

    private fun markable(cp: Int): Boolean = Character.isLetter(cp) || Character.getType(cp) == Character.DECIMAL_DIGIT_NUMBER.toInt()
    private fun isHan(s: String): Boolean = s.isNotEmpty() && Character.UnicodeScript.of(s.codePointAt(0)) == Character.UnicodeScript.HAN
    private fun asciiDigit(s: String): Boolean = s.length == 1 && s[0] in '0'..'9'
    private fun codePoints(s: String): List<String> = s.codePoints().toArray().map { String(Character.toChars(it)) }

    /** `keyOf`: one character's comparison key (lower case, 两 → 二, simplified). */
    private fun keyOf(ch: String): String {
        val lower = ch.lowercase(java.util.Locale.ROOT)
        return PictureHuntMatch.toSimplified(if (lower == "两") "二" else lower)
    }

    private class Keys {
        val keys = ArrayList<String>()
        val breakBefore = ArrayList<Boolean>()
    }

    private class Unit(val start: Int, val end: Int, val firstKey: Int, val keyCount: Int)

    private fun pageKeys(cps: List<String>, units: MutableList<Unit>): Keys {
        val keys = Keys()
        var gap = true
        var i = 0
        while (i < cps.size) {
            val c = cps[i]
            if (asciiDigit(c)) {
                var j = i
                while (j < cps.size && asciiDigit(cps[j])) j++
                val k = codePoints(AnswerKey.normalizeNumbersToHanzi(cps.subList(i, j).joinToString(""))).map(::keyOf)
                units.add(Unit(i, j, keys.keys.size, k.size))
                k.forEachIndexed { n, key ->
                    keys.keys.add(key)
                    keys.breakBefore.add(n == 0 && gap)
                }
                gap = false
                i = j
                continue
            }
            if (markable(c.codePointAt(0))) {
                units.add(Unit(i, i + 1, keys.keys.size, 1))
                keys.keys.add(keyOf(c))
                keys.breakBefore.add(gap)
                gap = false
            } else {
                gap = true
            }
            i++
        }
        return keys
    }

    private fun transcriptKeys(transcript: String): Keys {
        val text = AnswerKey.normalizeNumbersToHanzi(AnswerKey.jsTrim(transcript).lowercase(java.util.Locale.ROOT))
        val keys = Keys()
        var gap = true
        for (c in codePoints(text)) {
            if (markable(c.codePointAt(0))) {
                keys.keys.add(keyOf(c))
                keys.breakBefore.add(gap)
                gap = false
            } else {
                gap = true
            }
        }
        return keys
    }

    /** `syllablesOf`: each key's syllable in context (null for a non-Han key or a run that doesn't line up). */
    private fun syllablesOf(k: Keys): List<String?> {
        val out = MutableList<String?>(k.keys.size) { null }
        var i = 0
        while (i < k.keys.size) {
            if (!isHan(k.keys[i])) { i++; continue }
            var j = i + 1
            while (j < k.keys.size && isHan(k.keys[j]) && !k.breakBefore[j]) j++
            val run = k.keys.subList(i, j).joinToString("")
            val tokens = ToneChange.applyYiBuToneChanges(run, Pinyin.toPinyin(run)).split(" ")
            if (tokens.size == j - i) {
                for (n in tokens.indices) out[i + n] = AnswerKey.normalizeSpokenPinyin(tokens[n]).ifEmpty { null }
            }
            i = j
        }
        return out
    }

    private fun hasToneMark(py: String) = AnswerKey.tonelessPinyin(py) != py

    private fun pairMark(page: String, heard: String, pageSyl: String?, heardSyl: String?): Mark {
        if (page == heard) return Mark.OK
        if (pageSyl != null && heardSyl != null) {
            if (pageSyl == heardSyl) return Mark.SOUND
            if (!hasToneMark(pageSyl) && AnswerKey.tonelessPinyin(heardSyl) == pageSyl) return Mark.SOUND
            if (AnswerKey.tonelessPinyin(pageSyl) == AnswerKey.tonelessPinyin(heardSyl)) return Mark.CLOSE
        }
        return Mark.WRONG
    }

    private fun cost(m: Mark): Int = when (m) {
        Mark.OK -> COST_OK
        Mark.SOUND -> COST_SOUND
        Mark.CLOSE -> COST_CLOSE
        else -> COST_WRONG
    }

    private fun severity(m: Mark): Int = when (m) {
        Mark.OK -> 0
        Mark.SOUND -> 1
        Mark.CLOSE -> 2
        Mark.WRONG -> 3
        else -> 4
    }

    private fun unitMark(marks: List<Mark>): Mark {
        if (marks.all { it == Mark.MISSED }) return Mark.MISSED
        if (marks.any { it == Mark.MISSED || it == Mark.WRONG }) return Mark.WRONG
        var worst = Mark.OK
        for (m in marks) if (severity(m) > severity(worst)) worst = m
        return worst
    }

    /** `readAloudHeardAnything`: does the transcript have a letter or digit to judge? */
    fun heardAnything(transcript: String): Boolean = transcriptKeys(transcript).keys.isNotEmpty()

    /** `judgeReadAloud`: the page's Chinese read aloud as [transcript]. */
    fun judge(pageText: String, transcript: String): Result {
        val cps = codePoints(pageText)
        val units = ArrayList<Unit>()
        val page = pageKeys(cps, units)
        val heard = transcriptKeys(transcript)
        val ps = syllablesOf(page)
        val hs = syllablesOf(heard)
        val n = page.keys.size
        val m = heard.keys.size
        val dp = Array(n + 1) { IntArray(m + 1) }
        val pair = Array(n) { arrayOfNulls<Mark>(m) }
        for (j in m downTo 0) dp[n][j] = (m - j) * COST_GAP
        for (i in n - 1 downTo 0) {
            dp[i][m] = (n - i) * COST_GAP
            for (j in m - 1 downTo 0) {
                val pm = pairMark(page.keys[i], heard.keys[j], ps[i], hs[j])
                pair[i][j] = pm
                dp[i][j] = minOf(cost(pm) + dp[i + 1][j + 1], COST_GAP + dp[i + 1][j], COST_GAP + dp[i][j + 1])
            }
        }
        val keyMarks = MutableList(n) { Mark.MISSED }
        val keyHeard = MutableList(n) { "" }
        val extraBeforeKey = MutableList(n + 1) { "" }
        var i = 0
        var j = 0
        while (i < n || j < m) {
            if (i < n && j < m && dp[i][j] == cost(pair[i][j]!!) + dp[i + 1][j + 1]) {
                keyMarks[i] = pair[i][j]!!
                keyHeard[i] = heard.keys[j]
                i++
                j++
            } else if (i < n && dp[i][j] == COST_GAP + dp[i + 1][j]) {
                keyMarks[i] = Mark.MISSED
                i++
            } else {
                extraBeforeKey[i] = extraBeforeKey[i] + heard.keys[j]
                j++
            }
        }
        val chars = cps.map { Char(it, Mark.PLAIN, "", "") }.toMutableList()
        var right = 0
        var toCheck = 0
        for (u in units) {
            val mark = unitMark(keyMarks.subList(u.firstKey, u.firstKey + u.keyCount))
            val said = keyHeard.subList(u.firstKey, u.firstKey + u.keyCount).joinToString("")
            val extra = extraBeforeKey.subList(u.firstKey, u.firstKey + u.keyCount).joinToString("")
            for (c in u.start until u.end) chars[c] = Char(cps[c], mark, if (mark == Mark.MISSED) "" else said, if (c == u.start) extra else "")
            if (mark == Mark.OK || mark == Mark.SOUND) right++ else toCheck++
            if (extra.isNotEmpty()) toCheck++
        }
        val extraAtEnd = extraBeforeKey[n]
        if (extraAtEnd.isNotEmpty()) toCheck++
        val total = units.size
        return Result(chars, extraAtEnd, total, right, if (total > 0) right * 100 / total else 0, toCheck)
    }

    /** `readAloudLine`: "✓ 92% — 2 to check". */
    fun line(pct: Int, toCheck: Int): String {
        if (toCheck == 0) return "✓ $pct% — all read right"
        val icon = if (pct >= 90) "✓" else if (pct >= 60) "≈" else "✕"
        return "$icon $pct% — $toCheck to check"
    }

    /** `readAloudTone`: good | some | low. */
    fun tone(pct: Int, toCheck: Int): String = when {
        toCheck == 0 || pct >= 90 -> "good"
        pct >= 60 -> "some"
        else -> "low"
    }

    /** `readAloudBucket`: `reader.read_aloud { result_bucket }`. */
    fun bucket(pct: Int): String = when {
        pct >= 100 -> "all"
        pct >= 90 -> "90"
        pct >= 75 -> "75"
        pct >= 50 -> "50"
        else -> "under_50"
    }

    /** `readAloudCharLabel`: a marked character for a screen reader. */
    fun charLabel(c: Char): String {
        val extra = if (c.extraBefore.isNotEmpty()) "You also said ${c.extraBefore}. " else ""
        return when (c.mark) {
            Mark.SOUND -> "$extra${c.char} — sounded right (heard ${c.heard})"
            Mark.CLOSE -> "$extra${c.char} — tone off (heard ${c.heard})"
            Mark.WRONG -> "$extra${c.char} — heard ${c.heard}"
            Mark.MISSED -> "$extra${c.char} — missed"
            else -> "$extra${c.char}"
        }
    }

    /** `readAloudNeedsLook`: a word needs a look (close / wrong / missed or an extra before it). */
    fun needsLook(chars: List<Char>): Boolean =
        chars.any { it.mark == Mark.CLOSE || it.mark == Mark.WRONG || it.mark == Mark.MISSED || it.extraBefore.isNotEmpty() }

    fun markName(m: Mark): String = m.name.lowercase(java.util.Locale.ROOT)
}
