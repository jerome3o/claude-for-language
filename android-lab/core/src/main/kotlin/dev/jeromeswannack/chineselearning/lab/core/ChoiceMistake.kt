package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Port of shared/lesson/choiceMistake.ts — "Which sentence is wrong?" multiple choice never reads the mistake aloud.
 * In such a `choice` the answer option IS the wrong sentence: ▶ / autoplay / 🎤 Say it again / the lesson audio
 * prefetch speak its CORRECTION instead (the spec's `correction`, else one the server gives an older lesson).
 * Parity-tested (android-lab/parity/fixtures/choice-mistake.ts → ChoiceMistakeParityTest).
 */
object ChoiceMistake {
    const val VERSION = 1

    private const val CLAUSE = "[^.?!。？！\\n]"
    /** ASCII word edges (not `\b`: Java's counts a Han character as a word character, JS's doesn't). */
    private const val WB = "(?<![A-Za-z0-9_])"
    private const val WE = "(?![A-Za-z0-9_])"
    private const val WRONG_EN = "(?:wrong(?:ly)?|incorrect(?:ly)?|not\\s+(?:correct|right|grammatical|natural)|(?:is|are)n['’]t\\s+(?:correct|right|grammatical|natural)|ungrammatical|unnatural|mistakes?|errors?|mistaken)"
    private const val ZH_WRONG = "(?:错|不对|不正确|有问题|有毛病|语病|病句|不通|不自然|不合适|不恰当)"
    private val I = setOf(RegexOption.IGNORE_CASE)

    private val ASKS_WRONG = listOf(
        Regex("${WB}which$WE$CLAUSE{0,60}?$WB$WRONG_EN$WE", I),
        Regex("${WB}(?:find|spot|pick|choose|select|identify|tap|mark)$WE$CLAUSE{0,40}?$WB$WRONG_EN$WE", I),
        Regex("哪一?(?:个|句|项|条|段|些)$CLAUSE{0,12}?$ZH_WRONG"),
        Regex("(?:找出|选出|指出|挑出)$CLAUSE{0,8}?$ZH_WRONG"),
    )

    private val NOT_WRONG = listOf(
        Regex("${WB}(?:no|without|free\\s+of|nothing|not)\\s+(?:an?\\s+|any\\s+)?(?:mistakes?|errors?|wrong)$WE", I),
        Regex("${WB}error-free$WE", I),
        Regex("$WB(?<!not\\s)(?:correct|right|natural|grammatical)\\s+(?:one|sentence|option|answer|version|choice)$WE", I),
        Regex("${WB}according\\s+to$WE|${WB}based\\s+on$WE|${WB}in\\s+the\\s+(?:text|dialogue|story|passage|conversation|audio|reading|article)$WE", I),
        Regex("根据|对话中|短文|课文|文章"),
        Regex("没有?(?:错|问题|毛病|语病)|无误|不错"),
        Regex("哪一?(?:个|句|项|条)(?:句子|说法|话)?(?:是)?(?:正确|对)的|(?:选出|找出)(?:正确|对)的"),
    )

    /** Does this question ask the learner to pick the WRONG sentence? (English or Chinese, conservative.) */
    fun questionAsksForWrong(question: String?): Boolean {
        val q = AnswerKey.jsTrim(question ?: "")
        if (q.isEmpty()) return false
        if (NOT_WRONG.any { it.containsMatchIn(q) }) return false
        return ASKS_WRONG.any { it.containsMatchIn(q) }
    }

    private fun hasCorrection(ex: ChoiceExercise): Boolean = AnswerKey.jsTrim(ex.correction?.hanzi ?: "").isNotEmpty()

    fun asksForWrong(ex: ChoiceExercise): Boolean = hasCorrection(ex) || questionAsksForWrong(ex.question)

    fun specCorrection(ex: ChoiceExercise): LessonSentence? {
        if (!hasCorrection(ex)) return null
        val c = ex.correction!!
        return LessonSentence(
            AnswerKey.jsTrim(c.hanzi),
            c.pinyin?.let { AnswerKey.jsTrim(it) }?.takeIf { it.isNotEmpty() },
            c.english?.let { AnswerKey.jsTrim(it) }?.takeIf { it.isNotEmpty() },
        )
    }

    /** The reveal's correction state (the web's `ChoiceCorrection`). */
    sealed interface State {
        data class Ready(val correction: LessonSentence, val source: String) : State
        data object Unchanged : State
        data object Loading : State
        data class Unavailable(val offline: Boolean) : State
        data object None : State
    }

    fun initial(ex: ChoiceExercise): State {
        specCorrection(ex)?.let { return State.Ready(it, "spec") }
        return if (asksForWrong(ex)) State.Loading else State.None
    }

    fun needsCorrection(ex: ChoiceExercise): Boolean = !hasCorrection(ex) && questionAsksForWrong(ex.question)

    fun isWrongOption(ex: ChoiceExercise, index: Int, state: State? = null): Boolean {
        if (index != ex.correct || !asksForWrong(ex)) return false
        return state != State.Unchanged
    }

    fun optionSpeakable(ex: ChoiceExercise, index: Int, state: State? = null): Boolean = !isWrongOption(ex, index, state)

    fun correctionSpokenText(state: State?): String = (state as? State.Ready)?.correction?.hanzi ?: ""

    fun pickSpeech(ex: ChoiceExercise, picked: Int, state: State? = null): String {
        val option = ex.options.getOrNull(picked)?.hanzi ?: ""
        return if (isWrongOption(ex, picked, state)) correctionSpokenText(state ?: initial(ex)) else option
    }

    fun sayAgainSentence(ex: ChoiceExercise, state: State? = null): LessonSentence? {
        if (isWrongOption(ex, ex.correct, state)) return ((state ?: initial(ex)) as? State.Ready)?.correction
        return ex.options.getOrNull(ex.correct)
    }

    fun ttsTexts(ex: ChoiceExercise): List<String> {
        val texts = ex.options.filterIndexed { i, _ -> !isWrongOption(ex, i) }.map { it.hanzi }.toMutableList()
        specCorrection(ex)?.let { texts += it.hanzi }
        return texts
    }

    // ============ The correction call (older lessons) ============

    @Serializable
    data class Input(
        val question: String,
        val sentence: String,
        val others: List<String>? = null,
        val explanation: String? = null,
    )

    private val HAN = Regex("\\p{IsHan}")

    fun input(ex: ChoiceExercise): Input? {
        val sentence = AnswerKey.jsTrim(ex.options.getOrNull(ex.correct)?.hanzi ?: "")
        if (sentence.isEmpty() || !HAN.containsMatchIn(sentence)) return null
        val others = ex.options.filterIndexed { i, _ -> i != ex.correct }.map { AnswerKey.jsTrim(it.hanzi) }.filter { it.isNotEmpty() }
        return Input(
            question = AnswerKey.jsTrim(ex.question),
            sentence = sentence,
            others = others.takeIf { it.isNotEmpty() },
            explanation = ex.explanation?.let { AnswerKey.jsTrim(it) }?.takeIf { it.isNotEmpty() },
        )
    }

    fun cacheText(question: String, sentence: String): String =
        "choice-correction|v$VERSION|${AnswerKey.jsTrim(question)}|${AnswerKey.jsTrim(sentence)}"

    data class Result(val correction: LessonSentence, val unchanged: Boolean)

    private val PUNCT = Regex("[\\s。，、！？.,!?]")

    private fun str(o: JsonObject?, key: String): String? = (o?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    private fun bool(o: JsonObject?, key: String): Boolean = (o?.get(key) as? JsonPrimitive)?.booleanOrNull == true

    /** Normalise a reply (API reply, cached result). Throws on an unusable one. */
    fun normalize(raw: JsonElement?, sentence: String): Result {
        val r = raw as? JsonObject
        val src = (r?.get("correction") as? JsonObject) ?: r
        val hanzi = AnswerKey.jsTrim(str(src, "hanzi") ?: "")
        val same = hanzi.isNotEmpty() && hanzi.replace(PUNCT, "") == sentence.replace(PUNCT, "")
        val unchanged = bool(r, "unchanged") || bool(r, "already_correct") || same
        if (!unchanged && (hanzi.isEmpty() || !HAN.containsMatchIn(hanzi))) throw IllegalArgumentException("No corrected sentence")
        val pinyin = str(src, "pinyin")?.let { AnswerKey.jsTrim(it) }?.takeIf { it.isNotEmpty() }
        val english = str(src, "english")?.let { AnswerKey.jsTrim(it) }?.takeIf { it.isNotEmpty() }
        return Result(LessonSentence(if (unchanged) AnswerKey.jsTrim(sentence) else hanzi, pinyin, english), unchanged)
    }

    fun fromResult(result: Result): State = if (result.unchanged) State.Unchanged else State.Ready(result.correction, "fetched")

    // ============ Authoring ============

    fun warnings(spec: CustomLessonSpec): List<String> {
        val out = ArrayList<String>()
        spec.sections.forEachIndexed { s, section ->
            section.exercises.forEachIndexed { e, ex ->
                if (ex is ChoiceExercise && needsCorrection(ex)) {
                    out += "sections[$s].exercises[$e]: a \"which one is wrong?\" choice should give \"correction\" (the right version of the wrong sentence) — it is what the learner hears; better, use a \"judge\" exercise"
                }
            }
        }
        return out
    }
}
