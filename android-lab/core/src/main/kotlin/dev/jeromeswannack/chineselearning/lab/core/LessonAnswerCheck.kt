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
 * (the quote one tappable word) and the 💬 quick questions. Parity-tested by
 * LessonAnswerCheckParityTest (parity/fixtures/lesson-answer-check.ts).
 *
 * Free speaking (oral_expression / speak; docs/STUDY_SESSION.md "Claude checks your speaking"): the
 * transcript's check adds `cleaned`, `parts` and a tip's `fix`; [LessonAnswerCheck.taskParts] reads
 * the task's ① ② ③, [SpeakingTake] the long-take numbers. Parity-tested by
 * LessonSpeakingCheckParityTest (parity/fixtures/lesson-speaking-check.ts).
 */

@Serializable
data class AnswerCheckTip(
    val text: String,
    val quote: String? = null,
    /** Speaking: the better Chinese for the quoted words. */
    val fix: String? = null,
    @SerialName("fix_pinyin") val fixPinyin: String? = null,
)

/** Speaking: one part of the task — used | used_with_issue | missing. */
@Serializable
data class AnswerCheckPart(val label: String, val status: String, val note: String? = null)

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
    /** Speaking: what they meant (the transcript without disfluencies). */
    val cleaned: String? = null,
    @SerialName("cleaned_pinyin") val cleanedPinyin: String? = null,
    /** Speaking: the task's parts, in order. */
    val parts: List<AnswerCheckPart>? = null,
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
    /** Speaking: the task's useful words and the question played in Chinese. */
    val hints: List<String>? = null,
    @SerialName("question_audio") val questionAudio: String? = null,
)

/** One answer given to an exercise (the attempt keeps every try). */
@Serializable
data class AnswerTry(val text: String, val input: String? = null, val check: AnswerCheck? = null)

object LessonAnswerCheck {
    const val VERSION = 1
    val VERDICTS = listOf("correct", "acceptable", "almost", "wrong")
    val TYPES = listOf("translate", "listen_translate")
    val SPEAKING_TYPES = listOf("oral_expression", "speak")
    const val SPEAKING_VERSION = 1
    val PART_STATUSES = listOf("used", "used_with_issue", "missing")

    fun isSpeaking(exerciseType: String?): Boolean = exerciseType in SPEAKING_TYPES

    private const val PROMPT = 400
    private const val MODEL = 300
    private const val ANSWER = 300
    private const val TIP = 220
    private const val QUOTE = 60
    private const val HEADLINE = 160
    private const val ALTERNATIVE = 200
    private const val SPEECH = 1500
    private const val PART = 80
    private const val PART_NOTE = 160
    private const val PARTS = 8
    private const val SPEAKING_TIPS = 4

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
        if (exerciseType !in TYPES && !isSpeaking(exerciseType)) return false
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
        if (isSpeaking(input.exerciseType)) {
            return listOf(
                "s$SPEAKING_VERSION",
                input.exerciseType,
                collapse(nfkc(input.promptEn)).lowercase(),
                LessonAnswers.normalizeHanzi(input.modelAnswer),
                LessonAnswers.normalizeHanzi(input.answer),
                collapse(nfkc(input.focus ?: "")).lowercase(),
                (input.hints ?: emptyList()).map { LessonAnswers.normalizeHanzi(it) }.filter { it.isNotEmpty() }.joinToString(","),
                LessonAnswers.normalizeHanzi(input.questionAudio ?: ""),
            ).joinToString("|")
        }
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

    fun suggestedFor(verdict: String): String = if (verdict == "correct" || verdict == "acceptable") "got_it" else "missed_it"

    /** good | warn | bad */
    data class Chip(val label: String, val tone: String)

    fun chip(verdict: String, speaking: Boolean = false): Chip = when (verdict) {
        "correct" -> Chip(if (speaking) "✓ Well said" else "✓ Correct", "good")
        "acceptable" -> Chip(if (speaking) "✓ Good" else "✓ Also right", "good")
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
        // A speaking check is the one with `cleaned`: its cleaner version may fix an acceptable answer too.
        val cleanedRaw = str(r["cleaned"], SPEECH)
        val speaking = cleanedRaw.isNotEmpty() && hasHan(cleanedRaw)
        val meant = if (speaking) LessonAnswers.normalizeHanzi(cleanedRaw) else mine
        val noFix = verdict == "correct" || (verdict == "acceptable" && !speaking)
        var corrected = if (noFix) "" else str(r["corrected"], if (speaking) SPEECH else ANSWER * 2)
        if (corrected.isNotEmpty() && (!hasHan(corrected) || LessonAnswers.normalizeHanzi(corrected).let { it == mine || it == meant })) corrected = ""
        val correctedPinyin = if (corrected.isNotEmpty()) str(r["corrected_pinyin"], (if (speaking) SPEECH else ANSWER) * 6) else ""
        val tips = mutableListOf<AnswerCheckTip>()
        for (t in (r["tips"] as? JsonArray).orEmpty()) {
            val o = t as? JsonObject
            val text = if (o != null) str(o["text"], TIP) else str(t, TIP)
            if (text.isEmpty()) continue
            val quote = if (o != null) str(o["quote"], QUOTE) else ""
            var tip = if (quote.isNotEmpty() && hasHan(quote)) AnswerCheckTip(text, quote) else AnswerCheckTip(text)
            val fix = if (o != null) str(o["fix"], ALTERNATIVE) else ""
            if (fix.isNotEmpty() && hasHan(fix) && LessonAnswers.normalizeHanzi(fix) != LessonAnswers.normalizeHanzi(quote)) {
                tip = tip.copy(fix = fix, fixPinyin = str(o!!["fix_pinyin"], ALTERNATIVE * 6).ifEmpty { null })
            }
            tips += tip
            if (tips.size == (if (speaking) SPEAKING_TIPS else 3)) break
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
        val base = AnswerCheck(verdict, headline, corrected, correctedPinyin, tips, alternative, suggestedFor(verdict))
        if (!speaking) return base
        val parts = mutableListOf<AnswerCheckPart>()
        for (p in (r["parts"] as? JsonArray).orEmpty()) {
            val o = p as? JsonObject ?: JsonObject(emptyMap())
            val label = str(o["label"], PART)
            val status = (o["status"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it in PART_STATUSES }
            if (label.isEmpty() || status == null) continue
            parts += AnswerCheckPart(label, status, str(o["note"], PART_NOTE).ifEmpty { null })
            if (parts.size == PARTS) break
        }
        return base.copy(cleaned = cleanedRaw, cleanedPinyin = str(r["cleaned_pinyin"], SPEECH * 6).ifEmpty { null }, parts = parts)
    }

    /** Port of cleanerVersion(): the correction, else what they meant. */
    data class CleanerVersion(val hanzi: String, val pinyin: String, val diffFrom: String?)

    fun cleanerVersion(check: AnswerCheck): CleanerVersion = when {
        check.corrected.isNotEmpty() -> CleanerVersion(check.corrected, check.correctedPinyin, check.cleaned?.ifEmpty { null })
        !check.cleaned.isNullOrEmpty() -> CleanerVersion(check.cleaned, check.cleanedPinyin ?: "", null)
        else -> CleanerVersion("", "", null)
    }

    /** Port of speakingPartMark(). */
    data class PartMark(val icon: String, val tone: String)

    fun partMark(status: String): PartMark = when (status) {
        "used" -> PartMark("✓", "good")
        "used_with_issue" -> PartMark("~", "warn")
        else -> PartMark("✗", "bad")
    }

    /** Port of SpeakingTaskPart. */
    data class TaskPart(val marker: String, val structure: String, val description: String)

    private fun isCircled(c: Char) = c.code in 0x2460..0x2473 || c.code in 0x3251..0x325F || c.code in 0x32B1..0x32BF
    private val CLAUSE_SPLIT = Regex("[.。:：;；!?！？]")
    private val LEAD_JOIN = Regex("^(and|then|also)( +|$)", RegexOption.IGNORE_CASE)
    private val TRAIL_JOIN = Regex("[$WS]+(and|then)[$WS]*$", RegexOption.IGNORE_CASE)
    private val PART_EDGE_START = Regex("^[,，;；:：、.。 ]+")
    private val PART_EDGE_END = Regex("[,，;；:：、.。 ]+$")
    private fun trimPart(s: String) = PART_EDGE_END.replace(PART_EDGE_START.replace(collapse(s), ""), "")
    private fun lastOfAny(s: String, chars: String) = chars.maxOf { s.lastIndexOf(it) }
    private fun firstOfAny(s: String, chars: String) = chars.map { s.indexOf(it) }.filter { it >= 0 }.minOrNull() ?: -1

    /** Port of speakingTaskParts(): the task's ① ② ③ with their structure (and the ask before a bracket). */
    fun taskParts(prompt: String?): List<TaskPart> {
        val text = Normalizer.normalize(prompt ?: "", Normalizer.Form.NFC)
        val marks = text.indices.filter { isCircled(text[it]) }
        val out = mutableListOf<TaskPart>()
        var prevEnd = 0
        marks.forEachIndexed { k, at ->
            val next = if (k + 1 < marks.size) marks[k + 1] else text.length
            val marker = text[at].toString()
            val before = text.substring(0, at)
            val openAt = lastOfAny(before, "(（")
            val inParen = openAt >= 0 && openAt > lastOfAny(before, ")）") && jsTrim(text.substring(openAt + 1, at)).isEmpty()
            val seg = text.substring(at + 1, next)
            var structure: String
            var description = ""
            if (inParen) {
                val close = firstOfAny(seg, ")）")
                structure = if (close >= 0) seg.substring(0, close) else seg
                val clause = text.substring(minOf(prevEnd, openAt), openAt)
                val pieces = clause.split(CLAUSE_SPLIT)
                description = LEAD_JOIN.replace(trimPart(pieces.last()), "")
                prevEnd = if (close >= 0) at + 1 + close + 1 else next
            } else {
                structure = TRAIL_JOIN.replace(seg, "")
                prevEnd = next
            }
            structure = trimPart(structure).take(60)
            if (structure.isNotEmpty() && out.none { it.marker == marker }) out += TaskPart(marker, structure, description.take(120))
        }
        return out
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
    fun askQuickQuestions(verdict: String?, exerciseType: String? = null): List<String> =
        if (isSpeaking(exerciseType)) listOf("How could I say it more naturally?", "Explain the grammar", "What did I leave out?")
        else if (verdict == "correct" || verdict == "acceptable") listOf("Why does mine work?", "How is it different from the model?", "Other ways to say it?")
        else listOf("Why is mine wrong?", "Explain the grammar", "Other ways to say it?")
}

/** Port of shared/lesson/speakingTake.ts: a free-speaking take may run minutes. */
object SpeakingTake {
    const val MAX_SECONDS = 300
    /** A cached live key is reused for a speaking take only with this long left. */
    const val LIVE_KEY_MARGIN_MS = (MAX_SECONDS + 60) * 1000L
    const val FINISH_TIMEOUT_MS = 8000L

    /** recording | transcribing | offline | failed */
    fun line(phase: String): String = when (phase) {
        "recording" -> "Listening…"
        "transcribing" -> "Writing down what you said…"
        "offline" -> "Recording saved — Claude will check it when you’re online."
        else -> "Couldn’t transcribe — tap to retry"
    }

    fun clock(seconds: Double): String {
        val s = kotlin.math.max(0.0, kotlin.math.floor(seconds)).toLong()
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }
}
