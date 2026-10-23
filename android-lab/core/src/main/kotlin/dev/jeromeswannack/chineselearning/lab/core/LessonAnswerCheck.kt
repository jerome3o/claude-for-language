package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.text.Normalizer

/*
 * Port of shared/lesson/answerCheck.ts: Claude's check of a self-assessed lesson answer ("Say it
 * in Chinese", "Listen and translate" answered in Chinese) — which answers get it, the cache text,
 * the shape rules a reply must follow, the verdict chip, the suggested button, the tip segments
 * (the quote one tappable word), the 💬 quick questions and the local check of an exact answer. Parity-tested by
 * LessonAnswerCheckParityTest (parity/fixtures/lesson-answer-check.ts).
 */

@Serializable
data class AnswerCheckTip(val text: String, val quote: String? = null)

@Serializable
data class AnswerCheckAlternative(val hanzi: String, val pinyin: String? = null, val english: String? = null)

@Serializable
data class AnswerCheck(
    /** correct | acceptable | almost | wrong */
    val verdict: String,
    val headline: String,
    val corrected: String = "",
    @SerialName("corrected_pinyin") val correctedPinyin: String = "",
    val tips: List<AnswerCheckTip> = emptyList(),
    val alternative: AnswerCheckAlternative? = null,
    /** got_it | missed_it */
    val suggested: String = "missed_it",
)

@Serializable
data class AnswerCheckInput(
    @SerialName("prompt_en") val promptEn: String,
    @SerialName("model_answer") val modelAnswer: String,
    @SerialName("model_pinyin") val modelPinyin: String? = null,
    val answer: String,
    @SerialName("exercise_type") val exerciseType: String,
    /** spoken | edited | typed */
    val input: String? = null,
    val focus: String? = null,
)

/** One answer given to an exercise (the attempt keeps every try). */
@Serializable
data class AnswerTry(val text: String, val input: String? = null, val check: AnswerCheck? = null)

object LessonAnswerCheck {
    const val VERSION = 1
    val VERDICTS = listOf("correct", "acceptable", "almost", "wrong")
    val TYPES = listOf("translate", "listen_translate")

    private const val PROMPT = 400
    private const val MODEL = 300
    private const val ANSWER = 300
    private const val TIP = 220
    private const val QUOTE = 60
    private const val HEADLINE = 160
    private const val ALTERNATIVE = 200

    private fun isHanCp(cp: Int) = Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN

    fun hasHan(text: String): Boolean {
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            if (isHanCp(cp)) return true
            i += Character.charCount(cp)
        }
        return false
    }

    /** Port of answerCheckApplies(). */
    fun applies(exerciseType: String, answer: String?): Boolean {
        if (exerciseType !in TYPES) return false
        val a = jsTrim(answer ?: "")
        return a.isNotEmpty() && hasHan(a) && LessonAnswers.normalizeHanzi(a).isNotEmpty()
    }

    // JS `\s` / String.prototype.trim: ASCII whitespace plus the Unicode space separators.
    private const val WS = "\\t\\n\\u000B\\u000C\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private val WS_RUN = Regex("[$WS]+")
    private val WS_EDGES = Regex("^[$WS]+|[$WS]+$")
    private fun jsTrim(s: String) = WS_EDGES.replace(s, "")
    private fun collapse(s: String) = jsTrim(WS_RUN.replace(s, " "))
    private fun nfkc(s: String) = Normalizer.normalize(s, Normalizer.Form.NFKC)

    /** Port of answerCheckCacheText(). */
    fun cacheText(input: AnswerCheckInput): String {
        val mode = if (input.input == "spoken") "spoken" else "typed"
        return listOf(
            "v$VERSION",
            input.exerciseType,
            mode,
            collapse(nfkc(input.promptEn)).lowercase(),
            LessonAnswers.normalizeHanzi(input.modelAnswer),
            LessonAnswers.normalizeHanzi(input.answer),
            collapse(nfkc(input.focus ?: "")).lowercase(),
        ).joinToString("|")
    }

    /** Port of EXACT_ANSWER_HEADLINE. */
    const val EXACT_HEADLINE = "Exactly right — nice!"

    /**
     * Port of exactAnswerCheck(): an answer that IS the model answer (the "✓ Exact match" chip's
     * rule, LessonAnswers.isExactHanziMatch) is checked locally — correct, Got it, no model call.
     */
    fun exact(exerciseType: String, answer: String, modelAnswer: String): AnswerCheck? {
        if (!applies(exerciseType, answer)) return null
        if (!LessonAnswers.isExactHanziMatch(answer, modelAnswer)) return null
        return AnswerCheck(verdict = "correct", headline = EXACT_HEADLINE, corrected = "", correctedPinyin = "", tips = emptyList(), suggested = "got_it")
    }

    fun exact(input: AnswerCheckInput): AnswerCheck? = exact(input.exerciseType, input.answer, input.modelAnswer)

    fun suggestedFor(verdict: String): String = if (verdict == "correct" || verdict == "acceptable") "got_it" else "missed_it"

    /** good | warn | bad */
    data class Chip(val label: String, val tone: String)

    fun chip(verdict: String): Chip = when (verdict) {
        "correct" -> Chip("✓ Correct", "good")
        "acceptable" -> Chip("✓ Also right", "good")
        "almost" -> Chip("~ Almost", "warn")
        else -> Chip("✗ Not quite", "bad")
    }

    private fun str(v: JsonElement?, max: Int): String {
        val p = v as? JsonPrimitive ?: return ""
        if (!p.isString) return ""
        return collapse(p.content).take(max)
    }

    /** Port of normalizeAnswerCheck(): throws when the essentials are missing. */
    fun normalize(raw: JsonElement?, answer: String): AnswerCheck {
        val r = raw as? JsonObject ?: JsonObject(emptyMap())
        val verdictRaw = (r["verdict"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val verdict = verdictRaw?.takeIf { it in VERDICTS }
        val headline = str(r["headline"], HEADLINE)
        if (verdict == null || headline.isEmpty()) throw IllegalArgumentException("Invalid answer check")
        val mine = LessonAnswers.normalizeHanzi(answer)
        var corrected = if (verdict == "correct" || verdict == "acceptable") "" else str(r["corrected"], ANSWER * 2)
        if (corrected.isNotEmpty() && (!hasHan(corrected) || LessonAnswers.normalizeHanzi(corrected) == mine)) corrected = ""
        val correctedPinyin = if (corrected.isNotEmpty()) str(r["corrected_pinyin"], ANSWER * 6) else ""
        val tips = mutableListOf<AnswerCheckTip>()
        for (t in (r["tips"] as? JsonArray).orEmpty()) {
            val o = t as? JsonObject
            val text = if (o != null) str(o["text"], TIP) else str(t, TIP)
            if (text.isEmpty()) continue
            val quote = if (o != null) str(o["quote"], QUOTE) else ""
            tips += if (quote.isNotEmpty() && hasHan(quote)) AnswerCheckTip(text, quote) else AnswerCheckTip(text)
            if (tips.size == 3) break
        }
        var alternative: AnswerCheckAlternative? = null
        val a = r["alternative"] as? JsonObject
        val altHanzi = if (a != null) str(a["hanzi"], ALTERNATIVE) else ""
        if (altHanzi.isNotEmpty() && hasHan(altHanzi)) {
            val n = LessonAnswers.normalizeHanzi(altHanzi)
            if (n != mine && n != LessonAnswers.normalizeHanzi(corrected)) {
                alternative = AnswerCheckAlternative(
                    altHanzi,
                    str(a!!["pinyin"], ALTERNATIVE * 6).ifEmpty { null },
                    str(a["english"], ALTERNATIVE).ifEmpty { null },
                )
            }
        }
        return AnswerCheck(verdict, headline, corrected, correctedPinyin, tips, alternative, suggestedFor(verdict))
    }

    fun parse(raw: JsonElement?, answer: String): AnswerCheck? = try { normalize(raw, answer) } catch (_: IllegalArgumentException) { null }

    data class TipSegment(val text: String, val han: Boolean, val quote: Boolean)
    data class TipSegments(val segments: List<TipSegment>, val quoteInText: Boolean)

    /** Port of tipSegments(): the quote ONE segment, other Chinese by character, the rest plain. */
    fun tipSegments(tip: AnswerCheckTip): TipSegments {
        val segs = mutableListOf<TipSegment>()
        val quote = tip.quote ?: ""
        fun pushPlainOrHan(part: String) {
            var i = 0
            while (i < part.length) {
                val cp = part.codePointAt(i)
                val ch = String(Character.toChars(cp))
                val han = isHanCp(cp)
                val last = segs.lastOrNull()
                if (!han && last != null && !last.han && !last.quote) segs[segs.size - 1] = last.copy(text = last.text + ch)
                else segs += TipSegment(ch, han, false)
                i += Character.charCount(cp)
            }
        }
        var rest = tip.text
        var inText = false
        while (quote.isNotEmpty() && rest.contains(quote)) {
            val at = rest.indexOf(quote)
            pushPlainOrHan(rest.substring(0, at))
            segs += TipSegment(quote, han = true, quote = true)
            inText = true
            rest = rest.substring(at + quote.length)
        }
        pushPlainOrHan(rest)
        return TipSegments(segs, inText)
    }

    /** Port of askQuickQuestions(). */
    fun askQuickQuestions(verdict: String?): List<String> =
        if (verdict == "correct" || verdict == "acceptable") listOf("Why does mine work?", "How is it different from the model?", "Other ways to say it?")
        else listOf("Why is mine wrong?", "Explain the grammar", "Other ways to say it?")
}
