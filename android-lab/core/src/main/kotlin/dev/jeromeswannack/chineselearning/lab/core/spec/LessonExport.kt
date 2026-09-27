package dev.jeromeswannack.chineselearning.lab.core.spec

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.num
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.str
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.truthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * Port of shared/lesson/export.ts: Markdown (teaching notes + numbered exercises + answer key),
 * re-importable JSON (server-filled image keys stripped) and Quizlet-style CSV, built on the
 * phone so exports work offline. Byte-identical to the web's files (LessonSpecParityTest).
 */
object LessonExport {
    // Field access with the TS's `?? ''` / truthiness semantics on typed-valid specs.
    private fun s(o: JsonObject?, k: String): String = o?.let { str(it[k]) } ?: ""
    private fun t(o: JsonObject?, k: String): Boolean = o != null && truthy(o[k])
    private fun o(o: JsonObject?, k: String): JsonObject? = o?.get(k) as? JsonObject
    private fun a(o: JsonObject?, k: String): List<JsonElement> = (o?.get(k) as? JsonArray).orEmpty()
    private fun objs(o: JsonObject?, k: String): List<JsonObject> = a(o, k).map { it as? JsonObject ?: JsonObject(emptyMap()) }
    private fun letter(i: Int): Char = (65 + i).toChar()

    private fun sentenceLine(s: JsonObject): String {
        val parts = mutableListOf(s(s, "hanzi"))
        if (t(s, "pinyin")) parts += "*${s(s, "pinyin")}*"
        if (t(s, "english")) parts += "— ${s(s, "english")}"
        return parts.joinToString(" ")
    }

    private class Numbered(val n: Int, val section: String?, val exercise: JsonObject)

    private fun numberExercises(spec: JsonObject): List<Numbered> {
        val out = mutableListOf<Numbered>()
        var n = 0
        for (section in objs(spec, "sections")) {
            val title = section["title"]?.takeIf { it !is JsonNull }?.let { str(it) }
            for (ex in objs(section, "exercises")) {
                if (str(ex["type"]) == "note") out += Numbered(0, title, ex)
                else { n++; out += Numbered(n, title, ex) }
            }
        }
        return out
    }

    private fun pinyinSuffix(o: JsonObject): String = if (t(o, "pinyin")) " (*${s(o, "pinyin")}*)" else ""

    /** The learner-facing part of an exercise (no answers). */
    private fun exerciseBody(ex: JsonObject): List<String> = when (str(ex["type"])) {
        "note" -> buildList {
            if (t(ex, "title")) addAll(listOf("**${s(ex, "title")}**", ""))
            if (t(ex, "body")) addAll(listOf(s(ex, "body"), ""))
            for (x in objs(ex, "sentences")) add("- ${sentenceLine(x)}")
        }
        "scramble" -> listOf(
            "**Word order.** Arrange the tiles into a sentence meaning: *${s(ex, "english")}*",
            "",
            "Tiles: ${a(ex, "tiles").joinToString(" ") { "`${JsJson.jsString(it)}`" }}",
        )
        "choice" -> listOf("**Multiple choice.** ${s(ex, "question")}", "") +
            objs(ex, "options").mapIndexed { i, op -> "${letter(i)}. ${s(op, "hanzi")}${pinyinSuffix(op)}" }
        "translate" -> listOf("**Translate into Chinese.** ${s(ex, "english")}") + (if (t(ex, "note")) listOf("", "_${s(ex, "note")}_") else emptyList())
        "match" -> {
            val pairs = objs(ex, "pairs")
            val shuffled = pairs.map { s(it, "english") }.sorted()
            listOf("**Match each word with its meaning.**", "", "| Chinese | Meaning |", "|---|---|") +
                pairs.mapIndexed { i, p -> "| ${s(p, "hanzi")} | ${shuffled[i]} |" }
        }
        "describe_image" -> listOf(
            "**Describe the picture.** ${if (t(ex, "task")) s(ex, "task") else "Describe what you see, in Chinese."}",
            "",
            "_Scene: ${s(ex, "image_prompt")}_",
        )
        "speak" -> listOf("**Say it out loud.** ${s(ex, "prompt")}")
        "listen_choice" -> listOf(
            "**Listening.** ${if (t(ex, "question")) s(ex, "question") else "Which one did you hear?"} (the teacher reads the sentence aloud)",
            "",
        ) + objs(ex, "options").mapIndexed { i, op -> "${letter(i)}. ${s(op, "hanzi")}" }
        "listen_translate" -> listOf("**Listening.** Translate what you hear into English. (the teacher reads the sentence aloud)")
        "sentence_making" -> listOf(
            "**Make a sentence${if (str(ex["input"]) == "handwrite") " (write it by hand)" else ""}.** ${if (t(ex, "task")) s(ex, "task") else "Write your own sentence using these words."}",
            "",
            "Words: ${objs(ex, "words").joinToString(" · ") { w -> "${s(w, "hanzi")}${pinyinSuffix(w)}${if (t(w, "english")) " ${s(w, "english")}" else ""}" }}",
        )
        "write_typed", "write_handwriting" -> {
            val cues = (ex["cues"] as? JsonArray)?.mapNotNull { str(it) } ?: listOf("english", "pinyin")
            val answer = o(ex, "answer")
            val shown = mutableListOf<String>()
            if ("english" in cues && t(answer, "english")) shown += s(answer, "english")
            if ("pinyin" in cues && t(answer, "pinyin")) shown += "*${s(answer, "pinyin")}*"
            if ("audio" in cues) shown += "(the teacher reads it aloud)"
            val prompt = ex["prompt"]?.takeIf { it !is JsonNull }?.let { JsJson.jsString(it) } ?: ""
            listOf(
                JsJson.trim("**Write it in characters${if (str(ex["type"]) == "write_handwriting") " by hand" else ""}.** $prompt"),
                "",
                shown.joinToString(" — "),
            )
        }
        "dictation" -> listOf("**Dictation.** Write down what you hear${if (str(ex["input"]) == "handwrite") ", by hand" else ""}. (the teacher reads the sentence aloud)")
        "oral_expression" -> {
            val qa = o(ex, "question_audio")
            val hints = objs(ex, "hints")
            listOf("**Speak.** ${s(ex, "prompt")}${if (qa != null) " — ${s(qa, "hanzi")}" else ""}") +
                (if (hints.isNotEmpty()) listOf("", "Useful words: ${hints.joinToString(" · ") { w -> "${s(w, "hanzi")}${pinyinSuffix(w)}" }}") else emptyList())
        }
        "conversation" -> listOf(
            "**Conversation — ${s(ex, "situation")}.** Listen to the conversation (the teacher reads it aloud), then answer:",
            "",
        ) + objs(ex, "questions").flatMapIndexed { i, q ->
            listOf("${i + 1}) ${s(q, "question")}") + a(q, "options").mapIndexed { j, op -> "   ${letter(j)}. ${JsJson.jsString(op)}" }
        }
        else -> emptyList()
    }

    private fun optionAt(ex: JsonObject, index: Int?): JsonObject? = index?.let { objs(ex, "options").getOrNull(it) }

    private fun intAt(o: JsonObject, k: String): Int? = num(o[k])?.toInt()

    /** The answer key entry for an exercise, or null when it has none. */
    private fun exerciseAnswer(ex: JsonObject): String? = when (str(ex["type"])) {
        "scramble" -> {
            val alts = a(ex, "alt_orders")
            val alt = if (alts.isNotEmpty()) " (also: ${alts.joinToString(" / ") { (it as? JsonArray).orEmpty().joinToString("") { p -> JsJson.jsString(p) } }})" else ""
            "${a(ex, "correct_order").joinToString("") { JsJson.jsString(it) }}$alt"
        }
        "choice" -> {
            val c = intAt(ex, "correct") ?: 0
            val op = optionAt(ex, c)
            "${letter(c)}. ${s(op, "hanzi")}${if (t(op, "english")) " — ${s(op, "english")}" else ""}${if (t(ex, "explanation")) " (${s(ex, "explanation")})" else ""}"
        }
        "translate" -> "${s(ex, "reference_hanzi")}${if (t(ex, "reference_pinyin")) " (${s(ex, "reference_pinyin")})" else ""}"
        "match" -> objs(ex, "pairs").joinToString("; ") { "${s(it, "hanzi")} = ${s(it, "english")}" }
        "describe_image" -> "${s(ex, "reference_hanzi")}${if (t(ex, "reference_pinyin")) " (${s(ex, "reference_pinyin")})" else ""}${if (t(ex, "reference_english")) " — ${s(ex, "reference_english")}" else ""}"
        "speak", "oral_expression" -> o(ex, "example")?.let { "e.g. ${sentenceLine(it).replace("*", "")}" }
        "listen_choice" -> {
            val c = intAt(ex, "correct") ?: 0
            val audio = o(ex, "audio")
            "Read aloud: ${s(audio, "hanzi")}${if (t(audio, "pinyin")) " (${s(audio, "pinyin")})" else ""}. Answer: ${letter(c)}. ${s(optionAt(ex, c), "hanzi")}${if (t(ex, "explanation")) " (${s(ex, "explanation")})" else ""}"
        }
        "listen_translate" -> {
            val audio = o(ex, "audio")
            "Read aloud: ${s(audio, "hanzi")}${if (t(audio, "pinyin")) " (${s(audio, "pinyin")})" else ""}. Answer: ${s(audio, "english")}"
        }
        "sentence_making" -> o(ex, "example")?.let { "e.g. ${sentenceLine(it).replace("*", "")}" } ?: "Any correct sentence using the words."
        "write_typed", "write_handwriting" -> {
            val answer = o(ex, "answer")
            "${s(answer, "hanzi")}${if (t(answer, "pinyin")) " (${s(answer, "pinyin")})" else ""}"
        }
        "dictation" -> {
            val audio = o(ex, "audio")
            "Read aloud: ${s(audio, "hanzi")}${if (t(audio, "pinyin")) " (${s(audio, "pinyin")})" else ""}${if (t(audio, "english")) " — ${s(audio, "english")}" else ""}"
        }
        "conversation" -> {
            val speakers = objs(ex, "speakers")
            val script = objs(ex, "lines").joinToString(" / ") { l ->
                val sp = intAt(l, "speaker")
                val name = sp?.let { speakers.getOrNull(it) }?.get("name")?.takeIf { it !is JsonNull }?.let { JsJson.jsString(it) } ?: "?"
                "$name: ${s(l, "hanzi")}"
            }
            val answers = objs(ex, "questions").mapIndexed { i, q ->
                val options = q["options"] as? JsonArray
                val correct = num(q["correct"])
                val text = if (options != null && correct != null) {
                    val c = correct.toInt()
                    "${letter(c)}. ${options.getOrNull(c)?.let { JsJson.jsString(it) } ?: ""}"
                } else {
                    q["answer"]?.takeIf { it !is JsonNull }?.let { JsJson.jsString(it) } ?: ""
                }
                "${i + 1}) $text"
            }.joinToString("; ")
            "Read aloud: $script. Answers: $answers"
        }
        else -> null
    }

    fun toMarkdown(spec: JsonObject): String {
        val lines = mutableListOf<String>()
        lines += "# ${if (t(spec, "icon")) "${s(spec, "icon")} " else ""}${s(spec, "title")}"
        if (t(spec, "description")) lines += listOf("", s(spec, "description"))

        val numbered = numberExercises(spec)
        var current: String? = null
        var started = false
        for (item in numbered) {
            if (!started || item.section != current) {
                started = true
                current = item.section
                if (!item.section.isNullOrEmpty()) lines += listOf("", "## ${item.section}")
            }
            lines += ""
            if (item.n > 0) lines += listOf("### ${item.n}.", "")
            lines += exerciseBody(item.exercise)
        }

        val answers = numbered.filter { it.n > 0 }.mapNotNull { i -> exerciseAnswer(i.exercise)?.takeIf { it.isNotEmpty() }?.let { i.n to it } }
        if (answers.isNotEmpty()) {
            lines += listOf("", "---", "", "## Answer key", "")
            for ((n, answer) in answers) lines += "$n. $answer"
        }
        return lines.joinToString("\n").replace(Regex("\n{3,}"), "\n\n") + "\n"
    }

    /** lessonToExportSpec: the spec with describe_image `image_url` removed. */
    fun toExportSpec(spec: JsonObject): JsonObject {
        val sections = spec["sections"] as? JsonArray ?: return spec
        return spec.with("sections", JsonArray(sections.map { section ->
            val sec = section as? JsonObject ?: return@map section
            val exercises = sec["exercises"] as? JsonArray ?: return@map sec
            sec.with("exercises", JsonArray(exercises.map { ex ->
                if (ex is JsonObject && str(ex["type"]) == "describe_image") ex.without("image_url") else ex
            }))
        }))
    }

    fun toJson(spec: JsonObject): String = JsJson.stringifyPretty(toExportSpec(spec)) + "\n"

    data class VocabRow(val term: String, val definition: String, val example: String)

    /** lessonVocabRows: vocabulary harvested from a lesson, deduplicated by term. */
    fun vocabRows(spec: JsonObject): List<VocabRow> {
        val rows = mutableListOf<VocabRow>()
        val seen = HashSet<String>()
        fun add(term: JsonElement?, definition: JsonElement?, example: JsonElement? = null) {
            val tm = JsJson.trim(str(term) ?: "")
            if (tm.isEmpty() || tm in seen) return
            seen += tm
            rows += VocabRow(tm, JsJson.trim(str(definition) ?: ""), JsJson.trim(str(example) ?: ""))
        }
        fun addSentence(x: JsonObject?) { if (x != null) add(x["hanzi"], x["english"], x["pinyin"]) }
        for (section in objs(spec, "sections")) for (ex in objs(section, "exercises")) when (str(ex["type"])) {
            "match" -> objs(ex, "pairs").forEach { add(it["hanzi"], it["english"], it["pinyin"]) }
            "note" -> objs(ex, "sentences").forEach(::addSentence)
            "translate" -> add(ex["reference_hanzi"], ex["english"], ex["reference_pinyin"])
            "choice" -> addSentence(optionAt(ex, intAt(ex, "correct")))
            "scramble" -> add(JsJson.s(a(ex, "correct_order").joinToString("") { JsJson.jsString(it) }), ex["english"])
            "describe_image" -> add(ex["reference_hanzi"], ex["reference_english"], ex["reference_pinyin"])
            "speak" -> addSentence(o(ex, "example"))
            "listen_choice", "listen_translate", "dictation" -> addSentence(o(ex, "audio"))
            "sentence_making" -> { objs(ex, "words").forEach { add(it["hanzi"], it["english"], it["pinyin"]) }; addSentence(o(ex, "example")) }
            "write_typed", "write_handwriting" -> addSentence(o(ex, "answer"))
            "oral_expression" -> { objs(ex, "hints").forEach { add(it["hanzi"], it["english"], it["pinyin"]) }; addSentence(o(ex, "example")) }
            "conversation" -> objs(ex, "lines").forEach { add(it["hanzi"], it["english"], it["pinyin"]) }
        }
        return rows
    }

    fun csvEscape(value: String): String =
        if (value.any { it == '"' || it == ',' || it == '\n' || it == '\r' }) "\"${value.replace("\"", "\"\"")}\"" else value

    fun toCsv(spec: JsonObject): String {
        val lines = mutableListOf("term,definition,example")
        for (row in vocabRows(spec)) lines += listOf(row.term, row.definition, row.example).joinToString(",") { csvEscape(it) }
        return lines.joinToString("\n") + "\n"
    }

    /** lessonExportFilename. */
    fun filename(spec: JsonObject, ext: String): String = exportBase(s(spec, "title"), "lesson") + ".$ext"

    internal fun exportBase(title: String, fallback: String): String {
        val cleaned = JsJson.replaceSpaceRuns(JsJson.trim(title).replace(Regex("[\\\\/:*?\"<>|]+"), " "), "-")
            .replace(Regex("^-+|-+$"), "")
        return cleaned.take(60).ifEmpty { fallback }
    }
}
