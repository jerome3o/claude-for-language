package dev.jeromeswannack.chineselearning.lab.core

/**
 * The slim answer feedback (docs/STUDY_SESSION.md "Answer feedback: one line and a diff") — a port of
 * shared/cards/answer-diff.ts, parity-tested (parity/fixtures/answer-diff.ts → AnswerDiffParityTest):
 * his answer against the expected one character by character (lined up by the read-aloud judge, [ReadAloud.judge]),
 * ONE short sentence that says what differs ([summary]), and the line a surface shows ([line]).
 *
 * Kinds: ok · sound (a homophone, counts as right) · tone (same syllable, other tone) · wrong · extra (he added it)
 * · missing (the expected character, drawn in a muted dashed slot) · plain (punctuation).
 */
object AnswerDiff {
    data class Part(
        /** His character(s); the expected one(s) for `missing`; the punctuation for `plain`. */
        val text: String,
        val kind: String,
        /** The expected character(s) this part stands for ('' for extra / plain). */
        val expected: String,
    )

    data class Diff(
        val parts: List<Part>,
        val wrong: Int,
        val tone: Int,
        val missing: Int,
        val extra: Int,
        val sound: Int,
        val right: Boolean,
        val reordered: Boolean,
        val empty: Boolean,
    ) {
        fun count(kind: String): Int = when (kind) {
            "wrong" -> wrong
            "tone" -> tone
            "missing" -> missing
            "extra" -> extra
            "sound" -> sound
            else -> 0
        }
    }

    val KINDS = listOf("ok", "sound", "tone", "wrong", "extra", "missing", "plain")

    private fun cpLen(s: String): Int = s.codePointCount(0, s.length)

    /** `answerDiff`: his answer against the expected one. */
    fun of(said: String, expected: String): Diff = ofJudged(ReadAloud.judge(expected, said), said, expected, false)

    /** `diffOfJudged`: a judged reading; [reading] = a page read aloud (after where he stopped is skipped, not missing). */
    private fun ofJudged(r: ReadAloud.Result, said: String, expected: String, reading: Boolean): Diff {
        val parts = ArrayList<Part>()
        fun push(p: Part) {
            val last = parts.lastOrNull()
            if (p.kind == "extra" && last != null && last.kind == "extra") parts[parts.size - 1] = last.copy(text = last.text + p.text)
            else parts.add(p)
        }
        var wrong = 0
        var tone = 0
        var missing = 0
        var extra = 0
        var sound = 0
        val chars = r.chars
        for (i in chars.indices) {
            val c = chars[i]
            if (c.extraBefore.isNotEmpty()) {
                push(Part(c.extraBefore, "extra", ""))
                extra += cpLen(c.extraBefore)
            }
            if (c.unitCont) continue
            var unit = c.char
            var n = i + 1
            while (n < chars.size && chars[n].unitCont) { unit += chars[n].char; n++ }
            when (c.mark) {
                ReadAloud.Mark.PLAIN -> push(Part(c.char, "plain", ""))
                ReadAloud.Mark.OK -> push(Part(c.heard.ifEmpty { unit }, "ok", unit))
                ReadAloud.Mark.SOUND -> { push(Part(c.heard, "sound", unit)); sound++ }
                ReadAloud.Mark.CLOSE -> { push(Part(c.heard, "tone", unit)); tone++ }
                ReadAloud.Mark.WRONG -> { push(Part(c.heard, "wrong", unit)); wrong++ }
                else -> if (!(reading && c.mark == ReadAloud.Mark.UNREAD)) { push(Part(unit, "missing", unit)); missing++ }
            }
        }
        if (r.extraAtEnd.isNotEmpty()) {
            push(Part(r.extraAtEnd, "extra", ""))
            extra += cpLen(r.extraAtEnd)
        }
        if (reading) {
            val fixes = wrong + tone + missing + extra
            val empty = r.heard.all { it.mark == "plain" }
            return Diff(parts, wrong, tone, missing, extra, sound, !empty && fixes == 0, false, empty)
        }
        val saidKeys = ReadAloud.keys(said)
        val expectedKeys = ReadAloud.keys(expected)
        val empty = saidKeys.isEmpty()
        val fixes = wrong + tone + missing + extra
        val reordered = !empty && fixes > 0 && saidKeys.size == expectedKeys.size &&
            saidKeys.sorted().joinToString("") == expectedKeys.sorted().joinToString("") &&
            saidKeys.joinToString("") != expectedKeys.joinToString("")
        return Diff(parts, wrong, tone, missing, extra, sound, !empty && fixes == 0, reordered, empty)
    }

    const val RIGHT = "Right"
    const val WORDED = "Right — worded differently"
    const val ORDER = "Right words, different order"
    const val FAR = "Quite different from the answer"
    const val EMPTY = "Nothing to compare"
    const val YOU_SAID = "You said"
    const val YOUR_ANSWER = "Your answer"

    private class Run(var text: String, var expected: String, val first: Int, var last: Int)

    private fun runsOf(parts: List<Part>, kind: String): List<Run> {
        val out = ArrayList<Run>()
        var cur: Run? = null
        parts.forEachIndexed { i, p ->
            if (p.kind == kind) {
                val c = cur
                if (c != null) { c.text += p.text; c.expected += p.expected; c.last = i }
                else { val r = Run(p.text, p.expected, i, i); cur = r; out.add(r) }
            } else if (p.kind != "plain") {
                cur = null
            }
        }
        return out
    }

    private fun where(parts: List<Part>, run: Run): String {
        fun other(p: Part) = p.kind != "plain" && p.kind != "missing" && p.kind != "extra"
        val before = parts.subList(0, run.first).any(::other)
        val after = parts.subList(run.last + 1, parts.size).any(::other)
        if (!before && after) return " at the start"
        if (before && !after) return " at the end"
        return ""
    }

    private const val SHORT = 4
    private fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"
    private fun joinAnd(xs: List<String>): String =
        if (xs.size <= 1) xs.joinToString("") else "${xs.dropLast(1).joinToString(", ")} and ${xs.last()}"

    /** `answerDiffSummary`: ONE short sentence that says what differs. */
    fun summary(d: Diff, far: Boolean = true): String {
        if (d.empty) return EMPTY
        if (d.right) {
            if (d.sound == 0) return RIGHT
            return "Sounded right — written ${d.parts.filter { it.kind == "sound" }.joinToString("") { it.text }}"
        }
        if (d.reordered) return ORDER
        val kinds = listOf("wrong", "missing", "extra", "tone").filter { d.count(it) > 0 }
        val units = d.parts.count { it.kind != "plain" && it.kind != "extra" }
        val off = d.wrong + d.missing + minOf(d.extra, 4)
        if (far && off > SHORT && off * 2 > maxOf(units, 1)) return FAR
        if (kinds.size == 1) {
            val kind = kinds[0]
            val runs = runsOf(d.parts, kind)
            val run = if (runs.size == 1 && cpLen(if (kind == "missing") runs[0].expected else runs[0].text) <= SHORT) runs[0] else null
            when (kind) {
                "tone" -> {
                    val on = d.parts.filter { it.kind == "tone" }.map { it.expected }
                    return if (on.size <= 2) "${if (on.size == 1) "Tone" else "Tones"} off on ${joinAnd(on)}" else "${on.size} tones off"
                }
                "extra" -> return if (run != null) "Extra ${run.text}${where(d.parts, run)}" else plural(d.extra, "extra character", "extra characters")
                "missing" -> return if (run != null) "Missing ${run.expected}${where(d.parts, run)}" else "${plural(d.missing, "character", "characters")} missing"
                "wrong" -> return if (run != null) "${run.text} instead of ${run.expected}" else plural(d.wrong, "wrong character", "wrong characters")
            }
        }
        return kinds.mapIndexed { i, k ->
            val n = d.count(k)
            val noun = if (i == 0) (if (n == 1) " character" else " characters") else ""
            when (k) {
                "wrong" -> "$n wrong$noun"
                "missing" -> if (i == 0) "$n$noun missing" else "$n missing"
                "extra" -> "$n extra$noun"
                else -> "$n ${if (n == 1) "tone" else "tones"} off"
            }
        }.joinToString(", ")
    }

    /** `readAloudResultLine`: a page read aloud as its ONE line — the score, then what differs in the part he read. */
    fun readingLine(r: ReadAloud.Result): String {
        val early = if (r.stoppedEarly) " · stopped early" else ""
        if (r.toCheck == 0) return "✓ ${r.pct}% — ${if (r.stoppedEarly) "right so far" else "all read right"}$early"
        val icon = if (r.pct >= 90) "✓" else if (r.pct >= 60) "≈" else "✕"
        return "$icon ${r.pct}% — ${summary(ofJudged(r, "", "", true), far = false)}$early"
    }

    private val WS = Regex("[${AnswerKey.JS_WS}]+")
    private val TRAILING_WS = Regex("[${AnswerKey.JS_WS}]+$")
    private val FIRST_SENTENCE = Regex("^.+?[.!?。！？](?=[${AnswerKey.JS_WS}]|$)")

    /** `firstSentence`: the first sentence of a line, at most [max] code points. */
    fun firstSentence(text: String?, max: Int = 90): String {
        val t = AnswerKey.jsTrim(WS.replace(text ?: "", " "))
        if (t.isEmpty()) return ""
        val s = AnswerKey.jsTrim(FIRST_SENTENCE.find(t)?.value ?: t)
        if (cpLen(s) <= max) return s
        val cps = s.codePoints().toArray()
        val head = cps.take(max - 1).joinToString("") { String(Character.toChars(it)) }
        return "${TRAILING_WS.replace(head, "")}…"
    }

    /** `answerDiffLine`: the line a surface shows above the diff. */
    fun line(diff: Diff, accepted: Boolean = false, headline: String? = null): String {
        if (accepted) {
            if (diff.right) return summary(diff)
            return if (diff.reordered) ORDER else WORDED
        }
        val s = summary(diff)
        val h = firstSentence(headline)
        return if (s == FAR && h.isNotEmpty()) h else s
    }

    /** `answerDiffTone`: right ✓ (accepted / nothing to fix) · close ≈ (tones only, or reordered) · wrong ✕. */
    fun tone(diff: Diff, accepted: Boolean = false): String = when {
        accepted || diff.right -> "right"
        diff.empty -> "wrong"
        diff.reordered || diff.wrong + diff.missing + diff.extra == 0 -> "close"
        else -> "wrong"
    }

    /** `ANSWER_DIFF_ICON`. */
    fun icon(tone: String): String = when (tone) { "right" -> "✓"; "close" -> "≈"; else -> "✕" }

    /** `ANSWER_DIFF_VERDICT`: Claude's check / Hard mode's result as the line's chip → (tone, label). */
    fun verdict(key: String): Pair<String, String>? = when (key) {
        "correct" -> "right" to "Correct"
        "acceptable" -> "right" to "Also right"
        "almost" -> "close" to "Almost"
        "wrong" -> "wrong" to "Not quite"
        "right" -> "right" to "Right"
        "close" -> "close" to "Nearly"
        else -> null
    }

    /** `answerDiffPartLabel`: one part for a screen reader. */
    fun partLabel(p: Part): String = when (p.kind) {
        "sound" -> "${p.text} — sounded right, written ${p.expected} in the answer"
        "tone" -> "${p.text} — tone off (${p.expected})"
        "wrong" -> "${p.text} — wrong, the answer has ${p.expected}"
        "extra" -> "${p.text} — extra"
        "missing" -> "missing ${p.expected}"
        else -> p.text
    }

    /** `answerDiffLabel`: the whole diff as one sentence for a screen reader. */
    fun label(d: Diff, line: String, label: String = YOUR_ANSWER): String {
        val said = d.parts.filter { it.kind != "missing" }.joinToString("") { it.text }
        val marked = d.parts.filter { it.kind != "ok" && it.kind != "plain" }.map(::partLabel)
        val tail = if (marked.isNotEmpty()) " ${marked.joinToString("; ")}." else ""
        return "$label: ${said.ifEmpty { "…" }}. $line.$tail".replace("..", ".")
    }
}
