package dev.jeromeswannack.chineselearning.lab.ui.editor

import dev.jeromeswannack.chineselearning.lab.core.Pinyin
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * Immutable edits on a spec held as a JSON tree — the web editor's `{ ...exercise, field: value }`.
 * Blank optional text becomes "absent" (the web's `clean()` → undefined), so saved specs match.
 */

val EMPTY_OBJECT = JsonObject(emptyMap())

fun JsonObject.text(key: String): String = str(key) ?: ""

/** `clean(v)`: blank → removed (undefined), else the text. */
fun JsonObject.withClean(key: String, value: String): JsonObject = with(key, value.takeIf { JsJson.trim(it).isNotEmpty() })

fun JsonObject.objs(key: String): List<JsonObject> = (this[key] as? JsonArray).orEmpty().map { it as? JsonObject ?: EMPTY_OBJECT }

fun JsonObject.strings(key: String): List<String> = (this[key] as? JsonArray).orEmpty().map { JsJson.str(it) ?: "" }

fun JsonObject.withObjs(key: String, list: List<JsonObject>): JsonObject = with(key, JsonArray(list))

fun JsonObject.withStrings(key: String, list: List<String>?): JsonObject = with(key, list?.let { l -> JsonArray(l.map { JsonPrimitive(it) }) })

fun JsonObject.int(key: String): Int? = JsJson.num(this[key])?.toInt()

fun JsonObject.withInt(key: String, value: Int?): JsonObject = with(key, value?.let { JsonPrimitive(it) })

fun <T> List<T>.moveItem(from: Int, to: Int): List<T> {
    if (to < 0 || to >= size || from == to) return this
    val next = toMutableList()
    val item = next.removeAt(from)
    next.add(to, item)
    return next
}

fun <T> List<T>.replaceAt(i: Int, value: T): List<T> = mapIndexed { j, x -> if (j == i) value else x }

fun <T> List<T>.removeAtIndex(i: Int): List<T> = filterIndexed { j, _ -> j != i }

fun <T> List<T>.insertAt(i: Int, value: T): List<T> = toMutableList().also { it.add(i.coerceIn(0, size), value) }

/** Tone-marked pinyin for hanzi (pinyin-pro on the web, its Kotlin port here — works offline). */
fun toPinyin(hanzi: String): String = Pinyin.toPinyin(hanzi)

/** Whole-page pinyin for a reader page: no stray spaces around Chinese punctuation (ReaderForm `toPagePinyin`). */
fun toPagePinyin(chinese: String): String {
    var s = toPinyin(chinese)
    s = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+([，。！？、；：）」』】”’])").replace(s, "$1")
    s = Regex("([（「『【“‘])[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+").replace(s, "$1")
    s = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]{2,}").replace(s, " ")
    return JsJson.trim(s)
}

private fun fillSentence(s: JsonObject): JsonObject {
    val hanzi = s.text("hanzi")
    return if (JsJson.truthy(s["pinyin"]) || JsJson.trim(hanzi).isEmpty()) s else s.with("pinyin", toPinyin(hanzi))
}

private fun JsonObject.mapObj(key: String, f: (JsonObject) -> JsonObject): JsonObject =
    (this[key] as? JsonObject)?.let { with(key, f(it)) } ?: this

private fun JsonObject.mapList(key: String, f: (JsonObject) -> JsonObject): JsonObject =
    (this[key] as? JsonArray)?.let { a -> with(key, JsonArray(a.map { (it as? JsonObject)?.let(f) ?: it })) } ?: this

private fun JsonObject.fillField(hanziKey: String, pinyinKey: String): JsonObject {
    val hanzi = text(hanziKey)
    return if (JsJson.truthy(this[pinyinKey]) || JsJson.trim(hanzi).isEmpty()) this else with(pinyinKey, toPinyin(hanzi))
}

/** "Auto-fill missing pinyin": pinyin for every hanzi field of an exercise that has none (ExerciseForm `fillMissingPinyin`). */
fun fillMissingPinyin(ex: JsonObject): JsonObject = when (ex.str("type")) {
    "note" -> ex.mapList("sentences", ::fillSentence)
    "choice" -> ex.mapList("options", ::fillSentence)
    "translate", "describe_image" -> ex.fillField("reference_hanzi", "reference_pinyin")
    "match" -> ex.mapList("pairs", ::fillSentence)
    "speak" -> ex.mapObj("example", ::fillSentence)
    "listen_choice" -> ex.mapObj("audio", ::fillSentence).mapList("options", ::fillSentence)
    "listen_translate", "dictation" -> ex.mapObj("audio", ::fillSentence)
    "sentence_making" -> ex.mapList("words", ::fillSentence).mapObj("example", ::fillSentence)
    "write_typed", "write_handwriting" -> ex.mapObj("answer", ::fillSentence)
    "oral_expression" -> ex.mapList("hints", ::fillSentence).mapObj("question_audio", ::fillSentence).mapObj("example", ::fillSentence)
    "conversation" -> ex.mapList("lines", ::fillSentence)
    else -> ex
}

/**
 * The validator's problems for one section (ei == null: the section's own) or one exercise,
 * with the `sections[i].exercises[j]` prefix removed (LessonForm `errorsFor`).
 */
fun errorsFor(errors: List<String>, si: Int, ei: Int? = null): List<String> {
    val prefix = if (ei == null) "sections[$si]" else "sections[$si].exercises[$ei]"
    return errors
        .filter { it.startsWith(prefix) && (ei != null || !it.startsWith("$prefix.exercises[")) }
        .map { it.substring(prefix.length).replace(Regex("^[.:]\\s*"), "") }
}

/** Reader page problems for page n (1-based) with the prefix removed (ReaderForm `pageErrors`). */
fun pageErrors(errors: List<String>, n: Int): List<String> {
    val prefix = "Page $n:"
    return errors.filter { it.startsWith(prefix) }.map { JsJson.trim(it.substring(prefix.length)) }
}

fun JsonElement?.asObject(): JsonObject = this as? JsonObject ?: EMPTY_OBJECT
