package dev.jeromeswannack.chineselearning.lab.core

/**
 * "🎤 Read it aloud" on a graded reader page — a port of shared/reader/readAloud.ts, parity-tested
 * (parity/fixtures/read-aloud.ts → ReadAloudParityTest). The take is judged against the page's own
 * Chinese character by character so the page can be marked IN PLACE: punctuation / spaces / quotes
 * left out, numbers → hanzi, 两 = 二, traditional → simplified; each Han character's syllable in
 * context (automatic pinyin + 一 / 不 over each unbroken run); a weighted edit distance lines the two
 * up (ok 0, same sound 1, tone only 2, another character 3, missed / extra 2). A character is ok,
 * sound (a homophone — right), close (tone only), wrong or missed; extra words are a caret. A take
 * stopped early leaves the characters after the last one paired with something heard UNREAD (no
 * mark, no difference, not in the score); a skipped word in the middle is still missed. Practice
 * only — nothing is stored.
 */
object ReadAloud {
    /** UNREAD = after the last character he reached (he stopped early): no mark, not counted. */
    enum class Mark { OK, SOUND, CLOSE, WRONG, MISSED, UNREAD, PLAIN }

    /**
     * One page character as read. [pinyin] = the page's syllable(s) in context ('' for punctuation, an
     * unaligned run or a digit run's later characters), [heardPinyin] the heard one's, [extraBeforePinyin]
     * the extras', [unitCont] = a later character of a digit run ("12").
     */
    data class Char(
        val char: String,
        val mark: Mark,
        val heard: String,
        val extraBefore: String,
        val pinyin: String = "",
        val heardPinyin: String = "",
        val extraBeforePinyin: String = "",
        val unitCont: Boolean = false,
    )

    /** `ReadAloudHeardChar`: a transcript character (numbers as hanzi) and how it lined up — ok | sound | close | wrong | extra | plain. */
    data class HeardChar(val char: String, val mark: String)

    data class Result(
        val chars: List<Char>,
        val extraAtEnd: String,
        val total: Int,
        val right: Int,
        val pct: Int,
        val toCheck: Int,
        val extraAtEndPinyin: String = "",
        val heard: List<HeardChar> = emptyList(),
        /** He stopped before the end of the page: the characters from [unreadFrom] on are UNREAD. */
        val stoppedEarly: Boolean = false,
        /** The code point where the unread rest starts (= the page's length when he read to the end). */
        val unreadFrom: Int = 0,
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

    private fun transcriptText(transcript: String): String =
        AnswerKey.normalizeNumbersToHanzi(AnswerKey.jsTrim(transcript).lowercase(java.util.Locale.ROOT))

    private fun transcriptKeys(transcript: String): Keys {
        val text = transcriptText(transcript)
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
        val keyHeardIdx = IntArray(n) { -1 }
        val extraBeforeKey = MutableList(n + 1) { "" }
        val extraBeforePy = MutableList(n + 1) { "" }
        val heardMark = MutableList(m) { "extra" }
        var i = 0
        var j = 0
        while (i < n || j < m) {
            if (i < n && j < m && dp[i][j] == cost(pair[i][j]!!) + dp[i + 1][j + 1]) {
                keyMarks[i] = pair[i][j]!!
                keyHeard[i] = heard.keys[j]
                keyHeardIdx[i] = j
                heardMark[j] = markName(pair[i][j]!!)
                i++
                j++
            } else if (i < n && dp[i][j] == COST_GAP + dp[i + 1][j]) {
                keyMarks[i] = Mark.MISSED
                i++
            } else {
                extraBeforeKey[i] = extraBeforeKey[i] + heard.keys[j]
                extraBeforePy[i] = extraBeforePy[i] + (hs[j] ?: "")
                j++
            }
        }
        // Stopped early: the units after the last one paired with something heard were never reached.
        var lastPaired = -1
        for (k in 0 until n) if (keyHeardIdx[k] >= 0) lastPaired = k
        val readUnits = if (lastPaired < 0) units.size else units.indexOfFirst { lastPaired < it.firstKey + it.keyCount } + 1
        val stoppedEarly = readUnits < units.size
        val unreadFrom = if (stoppedEarly) units[readUnits].start else cps.size

        val chars = cps.map { Char(it, Mark.PLAIN, "", "") }.toMutableList()
        var right = 0
        var toCheck = 0
        for ((ui, u) in units.withIndex()) {
            val unread = ui >= readUnits
            val mark = if (unread) Mark.UNREAD else unitMark(keyMarks.subList(u.firstKey, u.firstKey + u.keyCount))
            val said = keyHeard.subList(u.firstKey, u.firstKey + u.keyCount).joinToString("")
            val extra = extraBeforeKey.subList(u.firstKey, u.firstKey + u.keyCount).joinToString("")
            val extraPy = StringBuilder()
            val py = StringBuilder()
            val heardPy = StringBuilder()
            for (k in u.firstKey until u.firstKey + u.keyCount) {
                extraPy.append(extraBeforePy[k])
                py.append(ps[k] ?: "")
                if (keyHeardIdx[k] >= 0) heardPy.append(hs[keyHeardIdx[k]] ?: "")
            }
            for (c in u.start until u.end) {
                val first = c == u.start
                chars[c] = Char(
                    cps[c], mark, if (mark == Mark.MISSED || unread) "" else said, if (first) extra else "",
                    pinyin = if (first) py.toString() else "",
                    heardPinyin = if (first && mark != Mark.MISSED && !unread) heardPy.toString() else "",
                    extraBeforePinyin = if (first) extraPy.toString() else "",
                    unitCont = !first,
                )
            }
            if (unread) continue
            if (mark == Mark.OK || mark == Mark.SOUND) right++ else toCheck++
            if (extra.isNotEmpty()) toCheck++
        }
        val extraAtEnd = extraBeforeKey[n]
        if (extraAtEnd.isNotEmpty()) toCheck++
        val total = readUnits
        // The transcript as checked, each of its characters marked by how it lined up.
        val heardChars = ArrayList<HeardChar>()
        var hk = 0
        for (c in codePoints(transcriptText(transcript))) {
            heardChars += if (markable(c.codePointAt(0))) HeardChar(c, heardMark[hk++]) else HeardChar(c, "plain")
        }
        return Result(chars, extraAtEnd, total, right, if (total > 0) right * 100 / total else 0, toCheck, extraBeforePy[n], heardChars, stoppedEarly, unreadFrom)
    }

    // --- the differences, one per word -------------------------------------------------------------

    /** `ReadAloudDifference`: one word of the page that was heard differently (see [differences]). kind = wrong | missed | tone | extra | sound. */
    data class Difference(
        val start: Int,
        val end: Int,
        val page: String,
        val pagePinyin: String,
        val heard: String,
        val heardPinyin: String,
        val kind: String,
        val toCheck: Boolean,
        val reasons: List<String>,
    )

    private val TONE_VOWELS = listOf("āēīōūǖ", "áéíóúǘ", "ǎěǐǒǔǚ", "àèìòùǜ")

    /** `pinyinTone`: 1–4 from the tone mark, 0 = neutral. */
    fun pinyinTone(py: String): Int {
        for (ch in codePoints(py)) for (t in 0 until 4) if (TONE_VOWELS[t].contains(ch)) return t + 1
        return 0
    }

    /** `toneName`: "1st" · "2nd" · "3rd" · "4th" · "neutral". */
    fun toneName(tone: Int): String = listOf("neutral", "1st", "2nd", "3rd", "4th").getOrElse(tone) { "neutral" }

    private fun withPy(text: String, py: String) = if (py.isNotEmpty()) "$text $py" else text

    private fun reasonFor(text: String, c: Char): String = when (c.mark) {
        Mark.SOUND -> "${withPy(text, c.pinyin)} — sounded right (written ${c.heard})"
        Mark.CLOSE -> "${withPy(text, c.pinyin)} → you said ${c.heardPinyin.ifEmpty { c.heard }} (${toneName(pinyinTone(c.heardPinyin))} tone instead of ${toneName(pinyinTone(c.pinyin))})"
        Mark.WRONG -> "${withPy(text, c.pinyin)} → you said ${withPy(c.heard, c.heardPinyin)}"
        Mark.MISSED -> "missed ${withPy(text, c.pinyin)}"
        else -> ""
    }

    private fun kindRank(k: String) = when (k) { "sound" -> 0; "extra" -> 1; "tone" -> 2; "missed" -> 3; else -> 4 }
    private fun kindOf(m: Mark): String? = when (m) { Mark.SOUND -> "sound"; Mark.CLOSE -> "tone"; Mark.WRONG -> "wrong"; Mark.MISSED -> "missed"; else -> null }
    private fun differs(c: Char) = c.mark == Mark.SOUND || c.mark == Mark.CLOSE || c.mark == Mark.WRONG || c.mark == Mark.MISSED || c.extraBefore.isNotEmpty()

    /**
     * `readAloudDifferences`: the take's differences in page order (+ extra words at the end). [words]
     * = the page's word chips (concatenating to the page): a difference covers the whole word; without
     * them each run of differing characters is one. A homophone-only word is listed, not to check.
     */
    fun differences(r: Result, words: List<String>? = null): List<Difference> {
        val chars = r.chars
        val spans = ArrayList<Pair<Int, Int>>()
        val pageText = chars.joinToString("") { it.char }
        if (!words.isNullOrEmpty() && words.joinToString("") == pageText) {
            var at = 0
            for (w in words) {
                val len = w.codePointCount(0, w.length)
                if (len > 0) spans += at to at + len
                at += len
            }
        } else {
            var i = 0
            while (i < chars.size) {
                if (!differs(chars[i])) { i++; continue }
                var j = i + 1
                while (j < chars.size && (differs(chars[j]) || chars[j].unitCont)) j++
                spans += i to j
                i = j
            }
        }
        val out = ArrayList<Difference>()
        for ((start, end) in spans) {
            val span = chars.subList(start, end)
            if (span.none(::differs)) continue
            val page = StringBuilder()
            val pagePy = StringBuilder()
            val heard = StringBuilder()
            val heardPy = StringBuilder()
            var kind = "sound"
            val reasons = ArrayList<String>()
            for ((k, c) in span.withIndex()) {
                page.append(c.char)
                pagePy.append(c.pinyin)
                heard.append(c.extraBefore)
                heardPy.append(c.extraBeforePinyin)
                if (c.unitCont) continue
                if (c.mark != Mark.MISSED) {
                    heard.append(c.heard)
                    heardPy.append(c.heardPinyin)
                }
                var text = c.char
                var n = k + 1
                while (n < span.size && span[n].unitCont) { text += span[n].char; n++ }
                if (c.extraBefore.isNotEmpty()) {
                    reasons += "extra ${withPy(c.extraBefore, c.extraBeforePinyin)}"
                    if (kindRank("extra") > kindRank(kind)) kind = "extra"
                }
                reasonFor(text, c).takeIf { it.isNotEmpty() }?.let { reasons += it }
                kindOf(c.mark)?.let { if (kindRank(it) > kindRank(kind)) kind = it }
            }
            out += Difference(start, end, page.toString(), pagePy.toString(), heard.toString(), heardPy.toString(), kind, kind != "sound", reasons)
        }
        if (r.extraAtEnd.isNotEmpty()) {
            val n = chars.size
            out += Difference(n, n, "", "", r.extraAtEnd, r.extraAtEndPinyin, "extra", true, listOf("extra ${withPy(r.extraAtEnd, r.extraAtEndPinyin)}"))
        }
        return out
    }

    /** `READ_ALOUD_DIFF_KIND`: a difference's kind in words. */
    fun diffKindLabel(kind: String): String = when (kind) {
        "wrong" -> "Another word"
        "missed" -> "Missed"
        "tone" -> "Tone"
        "extra" -> "Extra words"
        else -> "Sounded right"
    }

    /** `READ_ALOUD_STOP_RECORDING`: the footer's big red button while a take records. */
    const val STOP_RECORDING = "Stop recording"

    /**
     * `readAloudLocksPage`: a take is under way (the dictation phase is `listening` or `finishing`),
     * so the page is locked — the footer becomes one big red "■ Stop recording", the audio row and
     * ▶ Play whole story are disabled, and back / ✕ stop the take instead of leaving.
     */
    fun locksPage(phase: String): Boolean = phase == "listening" || phase == "finishing"

    /**
     * `readAloudAllRight`: the WHOLE page read right — every character ok or a homophone, nothing
     * tone-off / wrong / missed, no extra words, not stopped early — and something to read. Confetti
     * once per such take.
     */
    fun allRight(r: Result): Boolean = r.total > 0 && r.right == r.total && r.toCheck == 0 && !r.stoppedEarly

    /** `READ_ALOUD_STOPPED_EARLY`: the line's note when he stopped before the end of the page. */
    const val STOPPED_EARLY = "stopped early"

    /** `readAloudLine`: "✓ 92% — 2 to check"; stopped early: "… · stopped early" ("✓ 100% — right so far · stopped early"). */
    fun line(pct: Int, toCheck: Int, stoppedEarly: Boolean = false): String {
        val early = if (stoppedEarly) " · $STOPPED_EARLY" else ""
        if (toCheck == 0) return "✓ $pct% — ${if (stoppedEarly) "right so far" else "all read right"}$early"
        val icon = if (pct >= 90) "✓" else if (pct >= 60) "≈" else "✕"
        return "$icon $pct% — $toCheck to check$early"
    }

    /** The line for a result (stopped early or not). */
    fun line(r: Result): String = line(r.pct, r.toCheck, r.stoppedEarly)

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

    /**
     * `readAloudLegend`: the marks this result shows, in a fixed order — close (tone off) · wrong ·
     * missed · extra; empty when everything was read right.
     */
    fun legend(r: Result): List<String> = buildList {
        if (r.chars.any { it.mark == Mark.CLOSE }) add("close")
        if (r.chars.any { it.mark == Mark.WRONG }) add("wrong")
        if (r.chars.any { it.mark == Mark.MISSED }) add("missed")
        if (r.extraAtEnd.isNotEmpty() || r.chars.any { it.extraBefore.isNotEmpty() }) add("extra")
    }

    /** `READ_ALOUD_LEGEND`: the legend's words. */
    fun legendLabel(key: String): String = when (key) {
        "close" -> "tone off"
        "wrong" -> "wrong"
        "missed" -> "missed"
        "extra" -> "extra words"
        else -> key
    }

    fun markName(m: Mark): String = m.name.lowercase(java.util.Locale.ROOT)
}
