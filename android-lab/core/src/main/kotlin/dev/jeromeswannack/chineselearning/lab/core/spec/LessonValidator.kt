package dev.jeromeswannack.chineselearning.lab.core.spec

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.isInteger
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.num
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Port of shared/lesson/validate.ts: structural validation for a lesson spec. Returns the
 * problems as the same sentences, in the same order (empty = valid); the editor shows them
 * inline by their `sections[i].exercises[j]` prefix. Parity-tested (LessonSpecParityTest).
 */
object LessonValidator {
    private const val MAX_SECTIONS = 20
    private const val MAX_EXERCISES = 50
    private const val MAX_TILES = 14
    private const val MAX_MATCH_PAIRS = 8
    private const val MAX_TARGET_WORDS = 4
    private const val MAX_HINTS = 8
    private const val MAX_HANDWRITING_CHARS = 12
    private const val MAX_HANDWRITTEN_DICTATION_CHARS = 16
    private const val MAX_CONVERSATION_LINES = 24
    private const val MAX_CONVERSATION_QUESTIONS = 6

    /** Every exercise type the validator accepts, in catalogue order (EXERCISE_TYPE_IDS). */
    val EXERCISE_TYPE_IDS = listOf(
        "note", "scramble", "choice", "translate", "match", "describe_image", "speak",
        "listen_choice", "listen_translate", "sentence_making", "write_typed", "write_handwriting",
        "dictation", "oral_expression", "conversation",
    )

    private fun nonEmpty(v: JsonElement?): Boolean = str(v)?.let { JsJson.trim(it).isNotEmpty() } == true

    private fun checkSentence(v: JsonElement?, where: String, errors: MutableList<String>) {
        if (v !is JsonObject || !nonEmpty(v["hanzi"])) errors += "$where: expected a sentence object with non-empty \"hanzi\""
    }

    private fun checkWord(v: JsonElement?, where: String, errors: MutableList<String>) {
        if (v !is JsonObject || !nonEmpty(v["hanzi"])) errors += "$where: expected a word object with non-empty \"hanzi\""
    }

    private fun allNonEmpty(a: JsonArray): Boolean = a.all(::nonEmpty)

    private fun sameMultiset(a: List<String>, b: List<String>): Boolean {
        if (a.size != b.size) return false
        val counts = HashMap<String, Int>()
        for (t in a) counts[t] = (counts[t] ?: 0) + 1
        for (t in b) {
            val n = counts[t]
            if (n == null || n == 0) return false
            counts[t] = n - 1
        }
        return true
    }

    private fun strings(a: JsonArray): List<String> = a.map { str(it)!! }

    private fun isIndex(v: JsonElement?, size: Int): Boolean {
        val d = num(v) ?: return false
        return isInteger(d) && d >= 0 && d < size
    }

    /** Number of Han characters (`/\p{Script=Han}/gu`). */
    fun hanCount(s: String): Int {
        var n = 0
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            if (Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN) n++
            i += Character.charCount(cp)
        }
        return n
    }

    private fun checkInput(v: JsonElement?, where: String, errors: MutableList<String>) {
        if (v != null && str(v) != "type" && str(v) != "handwrite") errors += "$where: \"input\" must be \"type\" or \"handwrite\""
    }

    private val CUES = listOf("english", "pinyin", "audio")

    private fun checkCues(v: JsonElement?, where: String, errors: MutableList<String>): List<String> {
        if (v == null) return listOf("english", "pinyin")
        if (v !is JsonArray || v.isEmpty() || !v.all { str(it) in CUES }) {
            errors += "$where: \"cues\" must be a non-empty list of ${CUES.joinToString(" / ") { "\"$it\"" }}"
            return emptyList()
        }
        return strings(v)
    }

    private fun checkAlternatives(v: JsonElement?, where: String, errors: MutableList<String>) {
        if (v != null && (v !is JsonArray || !allNonEmpty(v))) errors += "$where: \"alternatives\" must be a list of non-empty strings"
    }

    private fun checkOptions(ex: JsonObject, where: String, errors: MutableList<String>) {
        val options = ex["options"]
        if (options !is JsonArray || options.size < 2 || options.size > 5) {
            errors += "$where: \"options\" must be 2-5 sentences"
        } else {
            options.forEachIndexed { i, o -> checkSentence(o, "$where.options[$i]", errors) }
            if (!isIndex(ex["correct"], options.size)) errors += "$where: \"correct\" must be an option index (0-${options.size - 1})"
        }
    }

    private fun checkExercise(ex: JsonElement?, where: String, errors: MutableList<String>) {
        if (ex !is JsonObject) {
            errors += "$where: expected an exercise object"
            return
        }
        when (str(ex["type"])) {
            "note" -> {
                val sentences = ex["sentences"]
                val hasBody = nonEmpty(ex["body"])
                val hasSentences = sentences is JsonArray && sentences.isNotEmpty()
                if (!hasBody && !hasSentences) errors += "$where: note needs \"body\" text and/or \"sentences\""
                if (sentences is JsonArray) sentences.forEachIndexed { i, s -> checkSentence(s, "$where.sentences[$i]", errors) }
            }
            "scramble" -> {
                if (!nonEmpty(ex["english"])) errors += "$where: scramble needs \"english\""
                val tiles = ex["tiles"]
                val order = ex["correct_order"]
                if (tiles !is JsonArray || tiles.size < 2 || tiles.size > MAX_TILES || !allNonEmpty(tiles)) {
                    errors += "$where: \"tiles\" must be 2-$MAX_TILES non-empty strings"
                } else if (order !is JsonArray || !allNonEmpty(order) || !sameMultiset(strings(tiles), strings(order))) {
                    errors += "$where: \"correct_order\" must use exactly the tiles in \"tiles\" (same multiset)"
                } else {
                    val alts = ex["alt_orders"]
                    if (alts is JsonArray) alts.forEachIndexed { i, alt ->
                        if (alt !is JsonArray || !allNonEmpty(alt) || !sameMultiset(strings(tiles), strings(alt))) {
                            errors += "$where: alt_orders[$i] must use exactly the tiles in \"tiles\""
                        }
                    }
                }
            }
            "choice" -> {
                if (!nonEmpty(ex["question"])) errors += "$where: choice needs \"question\""
                checkOptions(ex, where, errors)
            }
            "translate" -> {
                if (!nonEmpty(ex["english"])) errors += "$where: translate needs \"english\""
                if (!nonEmpty(ex["reference_hanzi"])) errors += "$where: translate needs \"reference_hanzi\""
            }
            "match" -> {
                val pairs = ex["pairs"]
                if (pairs !is JsonArray || pairs.size < 2 || pairs.size > MAX_MATCH_PAIRS) {
                    errors += "$where: \"pairs\" must be 2-$MAX_MATCH_PAIRS items"
                    return
                }
                val hanzi = HashSet<String>()
                val english = HashSet<String>()
                pairs.forEachIndexed { i, p ->
                    if (p !is JsonObject || !nonEmpty(p["hanzi"]) || !nonEmpty(p["english"])) {
                        errors += "$where.pairs[$i]: needs non-empty \"hanzi\" and \"english\""
                        return@forEachIndexed
                    }
                    val h = str(p["hanzi"])!!
                    val e = str(p["english"])!!
                    if (h in hanzi || e in english) errors += "$where.pairs[$i]: duplicate hanzi/english make matching ambiguous"
                    hanzi += h
                    english += e
                }
            }
            "describe_image" -> {
                if (!nonEmpty(ex["image_prompt"])) errors += "$where: describe_image needs \"image_prompt\""
                if (!nonEmpty(ex["reference_hanzi"])) errors += "$where: describe_image needs \"reference_hanzi\""
            }
            "speak" -> {
                if (!nonEmpty(ex["prompt"])) errors += "$where: speak needs \"prompt\""
                if (ex["example"] != null) checkSentence(ex["example"], "$where.example", errors)
            }
            "listen_choice" -> {
                checkSentence(ex["audio"], "$where.audio", errors)
                checkOptions(ex, where, errors)
            }
            "listen_translate" -> {
                checkSentence(ex["audio"], "$where.audio", errors)
                val audio = ex["audio"]
                if (audio is JsonObject && !nonEmpty(audio["english"])) {
                    errors += "$where: listen_translate \"audio\" needs \"english\" (the translation to check against)"
                }
            }
            "sentence_making" -> {
                val words = ex["words"]
                if (words !is JsonArray || words.size < 1 || words.size > MAX_TARGET_WORDS) {
                    errors += "$where: sentence_making needs \"words\": 1-$MAX_TARGET_WORDS target words ({hanzi, pinyin?, english?})"
                } else {
                    words.forEachIndexed { i, w -> checkWord(w, "$where.words[$i]", errors) }
                }
                checkInput(ex["input"], where, errors)
                if (ex["task"] != null && str(ex["task"]) == null) errors += "$where: \"task\" must be a string"
                if (ex["example"] != null) checkSentence(ex["example"], "$where.example", errors)
            }
            "write_typed", "write_handwriting" -> {
                val type = str(ex["type"])
                checkSentence(ex["answer"], "$where.answer", errors)
                val cues = checkCues(ex["cues"], where, errors)
                val answer = ex["answer"]
                if (answer is JsonObject && nonEmpty(answer["hanzi"])) {
                    val shown = cues.filter { it == "audio" || nonEmpty(answer[it]) }
                    if (shown.isEmpty()) {
                        errors += "$where: nothing to go on — give \"answer.english\" and/or \"answer.pinyin\", or add \"audio\" to \"cues\" (shown: ${cues.joinToString(", ")})"
                    }
                    if (type == "write_handwriting" && hanCount(str(answer["hanzi"])!!) > MAX_HANDWRITING_CHARS) {
                        errors += "$where: handwriting answers are character recall — keep \"answer.hanzi\" to $MAX_HANDWRITING_CHARS characters or fewer (use write_typed or sentence_making for longer text)"
                    }
                }
                if (type == "write_typed") checkAlternatives(ex["alternatives"], where, errors)
            }
            "dictation" -> {
                checkSentence(ex["audio"], "$where.audio", errors)
                checkInput(ex["input"], where, errors)
                checkAlternatives(ex["alternatives"], where, errors)
                val audio = ex["audio"]
                if (str(ex["input"]) == "handwrite" && audio is JsonObject && nonEmpty(audio["hanzi"]) && hanCount(str(audio["hanzi"])!!) > MAX_HANDWRITTEN_DICTATION_CHARS) {
                    errors += "$where: handwritten dictation should be short — $MAX_HANDWRITTEN_DICTATION_CHARS characters or fewer"
                }
            }
            "oral_expression" -> {
                if (!nonEmpty(ex["prompt"])) errors += "$where: oral_expression needs \"prompt\" (what to talk about)"
                if (ex["question_audio"] != null) checkSentence(ex["question_audio"], "$where.question_audio", errors)
                if (ex["example"] != null) checkSentence(ex["example"], "$where.example", errors)
                val hints = ex["hints"]
                if (hints != null) {
                    if (hints !is JsonArray || hints.size > MAX_HINTS) {
                        errors += "$where: \"hints\" must be a list of up to $MAX_HINTS words"
                    } else {
                        hints.forEachIndexed { i, w -> checkWord(w, "$where.hints[$i]", errors) }
                    }
                }
                val ts = ex["target_seconds"]
                if (ts != null) {
                    val s = num(ts)
                    if (s == null || !s.isFinite() || s < 5 || s > 180) errors += "$where: \"target_seconds\" must be 5-180"
                }
            }
            "conversation" -> checkConversation(ex, where, errors)
            else -> errors += "$where: unknown exercise type \"${JsJson.jsString(ex["type"])}\" (valid: ${EXERCISE_TYPE_IDS.joinToString(", ")})"
        }
    }

    private fun checkConversation(ex: JsonObject, where: String, errors: MutableList<String>) {
        if (!nonEmpty(ex["situation"])) errors += "$where: conversation needs \"situation\" (e.g. \"Checking in at a hotel\")"

        val speakers = ex["speakers"]
        var speakerCount = 0
        if (speakers !is JsonArray || speakers.size < 2 || speakers.size > 3) {
            errors += "$where: \"speakers\" must be 2-3 speakers ({name, voice?: \"female\"|\"male\"})"
        } else {
            speakerCount = speakers.size
            speakers.forEachIndexed { i, s ->
                if (s !is JsonObject || !nonEmpty(s["name"])) {
                    errors += "$where.speakers[$i]: needs a non-empty \"name\""
                } else if (s["voice"] != null && str(s["voice"]) != "female" && str(s["voice"]) != "male") {
                    errors += "$where.speakers[$i]: \"voice\" must be \"female\" or \"male\""
                }
            }
        }

        val lines = ex["lines"]
        if (lines !is JsonArray || lines.size < 2 || lines.size > MAX_CONVERSATION_LINES) {
            errors += "$where: \"lines\" must be 2-$MAX_CONVERSATION_LINES lines ({speaker, hanzi, pinyin?, english?})"
        } else {
            val spoke = HashSet<Double>()
            lines.forEachIndexed { i, line ->
                if (line !is JsonObject || !nonEmpty(line["hanzi"])) {
                    errors += "$where.lines[$i]: needs non-empty \"hanzi\""
                    return@forEachIndexed
                }
                val sp = num(line["speaker"])
                if (sp == null || !isInteger(sp) || sp < 0 || (speakerCount > 0 && sp >= speakerCount)) {
                    errors += "$where.lines[$i]: \"speaker\" must be a speaker index (0-${maxOf(speakerCount - 1, 0)})"
                } else {
                    spoke += sp + 0.0 // JS Sets treat -0 as 0
                }
            }
            if (speakerCount > 0 && spoke.isNotEmpty() && spoke.size < speakerCount) errors += "$where: every speaker needs at least one line"
        }

        val questions = ex["questions"]
        if (questions !is JsonArray || questions.size < 1 || questions.size > MAX_CONVERSATION_QUESTIONS) {
            errors += "$where: \"questions\" must be 1-$MAX_CONVERSATION_QUESTIONS comprehension questions"
            return
        }
        questions.forEachIndexed { i, q ->
            val qWhere = "$where.questions[$i]"
            if (q !is JsonObject || !nonEmpty(q["question"])) {
                errors += "$qWhere: needs non-empty \"question\""
                return@forEachIndexed
            }
            val options = q["options"]
            if (options != null) {
                if (options !is JsonArray || options.size < 2 || options.size > 5 || !allNonEmpty(options)) {
                    errors += "$qWhere: \"options\" must be 2-5 non-empty strings"
                    return@forEachIndexed
                }
                if (!isIndex(q["correct"], options.size)) errors += "$qWhere: \"correct\" must be an option index (0-${options.size - 1})"
            } else if (!nonEmpty(q["answer"])) {
                errors += "$qWhere: give \"options\" + \"correct\" (multiple choice) or \"answer\" (free answer, self-assessed)"
            }
        }
    }

    /** validateLessonSpec: [] when valid; otherwise the problems. */
    fun validate(spec: JsonElement?): List<String> {
        val errors = mutableListOf<String>()
        if (spec !is JsonObject) return listOf("spec must be an object")

        if (!nonEmpty(spec["title"])) errors += "lesson needs a non-empty \"title\""
        else if (str(spec["title"])!!.length > 200) errors += "\"title\" too long (max 200 chars)"
        val icon = spec["icon"]
        if (icon != null && (str(icon) == null || str(icon)!!.length > 8)) errors += "\"icon\" must be a short emoji string (max 8 chars)"

        val sections = spec["sections"]
        if (sections !is JsonArray || sections.isEmpty()) {
            errors += "lesson needs at least one section"
            return errors
        }
        if (sections.size > MAX_SECTIONS) errors += "too many sections (max $MAX_SECTIONS)"

        var exerciseCount = 0
        sections.forEachIndexed { si, section ->
            val exercises = (section as? JsonObject)?.get("exercises")
            if (exercises !is JsonArray || exercises.isEmpty()) {
                errors += "sections[$si]: needs a non-empty \"exercises\" array"
                return@forEachIndexed
            }
            exercises.forEachIndexed { ei, ex ->
                exerciseCount++
                checkExercise(ex, "sections[$si].exercises[$ei]", errors)
            }
        }
        if (exerciseCount > MAX_EXERCISES) errors += "too many exercises (max $MAX_EXERCISES)"
        return errors
    }
}
