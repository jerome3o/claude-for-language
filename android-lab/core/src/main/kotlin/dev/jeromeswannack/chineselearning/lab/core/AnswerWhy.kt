package dev.jeromeswannack.chineselearning.lab.core

import java.util.Locale

/**
 * Port of shared/cards/answer-why.ts — the ONE "why" sentence under an answer's verdict + diff, and what
 * "Explain more ›" opens in place (docs/STUDY_SESSION.md "Answer feedback: one line and a diff"). Parity-tested by
 * `AnswerWhyParityTest` over android-lab/parity/fixtures/answer-diff.ts.
 */
object AnswerWhy {
    const val MAX = 110
    const val MORE = "Explain more ›"
    const val LESS = "Show less"
    const val CORRECTED = "Corrected:"
    const val ALTERNATIVE = "Also natural:"

    /** What a check gives the why (`AnswerWhyCheck`). */
    data class Check(
        val headline: String? = null,
        val tips: List<String> = emptyList(),
        val corrected: String? = null,
        val alternative: String? = null,
    )

    /** A lesson / sentence answer check as the why's input. */
    fun of(c: AnswerCheck?): Check? = c?.let { Check(it.headline, it.tips.map { t -> t.text }, it.corrected, it.alternative?.hanzi) }

    /** `AnswerMore`. */
    data class More(val tips: List<String>, val corrected: String?, val alternative: String?)

    /** `ANSWER_WHY_STOCK`. */
    val STOCK = listOf(
        "Exactly right — nice!",
        "Natural and right — nicely said.",
        "Different wording, same meaning — that works.",
        "Nearly — compare with the corrected version.",
        "Not quite — compare with the corrected version.",
        "Nearly — one thing to fix.",
        "Not quite — have another go.",
    )

    private val WS = Regex("[${AnswerKey.JS_WS}]+")
    private val END = Regex("[.!?。！？…]+$")
    private val BARE_END = Regex("[。．.！!？?，,、…${AnswerKey.JS_WS}]+$")

    private fun squash(s: String) = AnswerKey.jsTrim(WS.replace(s, " "))
    private fun norm(s: String) = END.replace(squash(s), "").lowercase(Locale.ROOT)

    private fun saysNothing(s: String, line: String?): Boolean {
        if (s.isEmpty()) return true
        if (STOCK.any { norm(it) == norm(s) }) return true
        return !line.isNullOrEmpty() && norm(line) == norm(s)
    }

    /** `deviceWhy`: a homophone counted right. */
    fun device(diff: AnswerDiff.Diff): String? {
        val pairs = diff.parts.filter { it.kind == "sound" && it.expected.isNotEmpty() }.map { "${it.text} vs ${it.expected}" }
        if (pairs.isEmpty()) return null
        val shown = pairs.take(3).joinToString(", ")
        return AnswerDiff.firstSentence("Same sounds — written differently: $shown${if (pairs.size > 3) ", …" else ""}", MAX)
    }

    /** `answerWhy`. */
    fun why(diff: AnswerDiff.Diff? = null, check: Check? = null, line: String? = null): String? {
        if (check != null) {
            val head = AnswerDiff.firstSentence(check.headline, MAX)
            if (!saysNothing(head, line)) return head
            for (t in check.tips) {
                val tip = AnswerDiff.firstSentence(t, MAX)
                if (!saysNothing(tip, line)) return tip
            }
        }
        val d = diff?.let { device(it) }
        return if (d != null && !saysNothing(d, line)) d else null
    }

    /** `answerMore`. */
    fun more(check: Check?, why: String?, said: String = "", expected: String = ""): More? {
        if (check == null) return null
        val whyKey = why?.let { norm(it) } ?: ""
        val tips = check.tips.map { squash(it) }
            .filter { it.isNotEmpty() && norm(it) != whyKey && norm(AnswerDiff.firstSentence(it, MAX)) != whyKey }
            .take(4)
        val corrected = AnswerKey.jsTrim(check.corrected ?: "")
        val alternative = AnswerKey.jsTrim(check.alternative ?: "")
        // A line equal to one already there (sentence punctuation aside) isn't shown again.
        fun bare(t: String) = BARE_END.replace(AnswerKey.jsTrim(t), "")
        fun shown(t: String, vararg others: String) = others.any { bare(it).isNotEmpty() && bare(it) == bare(t) }
        val fixed = if (corrected.isNotEmpty() && !shown(corrected, said, expected)) corrected else null
        val alt = if (alternative.isNotEmpty() && !shown(alternative, said, corrected, expected)) alternative else null
        val head = squash(check.headline ?: "")
        var rest = ""
        if (why != null && why.isNotEmpty() && head.isNotEmpty() && head != why) {
            if (why.endsWith("…")) rest = head
            else if (head.startsWith(why)) rest = AnswerKey.jsTrim(head.substring(why.length))
        }
        val all = if (rest.isNotEmpty() && tips.none { norm(it) == norm(rest) }) (listOf(rest) + tips).take(4) else tips
        if (all.isEmpty() && fixed == null && alt == null) return null
        return More(all, fixed, alt)
    }

    /** `ANSWER_ASK_CLAUDE`: the small link under a judged answer when nothing explains it. */
    const val ASK_CLAUDE = "💬 Ask Claude"

    /**
     * `answerAskOffered`: the fallback "💬 Ask Claude" link — only for an answer judged not right ([tone] close / wrong)
     * with no why sentence and nothing "Explain more ›" could open, where the surface can open a Claude thread now.
     */
    fun askOffered(tone: String, why: String?, more: More?, canAsk: Boolean): Boolean =
        canAsk && tone != "right" && why.isNullOrEmpty() && more == null

    /** `answerAskQuestion`: what the link asks in the card's Claude thread. */
    fun askQuestion(said: String, expected: String, prompt: String? = null, spoken: Boolean = true): String {
        fun quoted(t: String) = "“${squash(t)}”"
        val p = AnswerKey.jsTrim(prompt ?: "")
        val verb = if (spoken) "said" else "wrote"
        val end = if (Regex("[.!?。！？…]$").containsMatchIn(p)) "" else "."
        val asked = if (p.isNotEmpty()) "I was asked to say ${quoted(p)}$end " else ""
        return "${asked}I $verb ${quoted(said)} but the answer is ${quoted(expected)}. What did I get wrong?"
    }
}
