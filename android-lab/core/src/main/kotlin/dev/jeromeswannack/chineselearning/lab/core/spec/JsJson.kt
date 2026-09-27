package dev.jeromeswannack.chineselearning.lab.core.spec

import dev.jeromeswannack.chineselearning.lab.core.Js
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * JavaScript semantics for lesson / reader specs held as JSON trees (the editors keep a spec
 * as a [JsonObject], exactly the value the web app holds, so unknown fields survive and key
 * order matches). Kotlin `null` stands for `undefined` (a missing key), [JsonNull] for `null`.
 *
 * Everything here mirrors what the TypeScript does with `JSON.stringify`, `String.prototype.trim`,
 * `\s` and truthiness, so the ports in this package produce byte-identical output.
 */
object JsJson {
    /** JS `\s` / `trim()` whitespace (WhiteSpace + LineTerminator), not Java's or Kotlin's. */
    fun isJsSpace(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
        else -> c in ' '..' '
    }

    /** `String.prototype.trim`. */
    fun trim(s: String): String {
        var start = 0
        var end = s.length
        while (start < end && isJsSpace(s[start])) start++
        while (end > start && isJsSpace(s[end - 1])) end--
        return s.substring(start, end)
    }

    /** `s.replace(/\s+/g, replacement)`. */
    fun replaceSpaceRuns(s: String, replacement: String): String {
        val out = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            if (isJsSpace(s[i])) {
                while (i < s.length && isJsSpace(s[i])) i++
                out.append(replacement)
            } else {
                out.append(s[i]); i++
            }
        }
        return out.toString()
    }

    /** The string content when [e] is a JSON string, else null (`typeof v === 'string'`). */
    fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** `typeof v === 'number'` (JSON numbers only; booleans and strings are not). */
    fun num(e: JsonElement?): Double? {
        val p = e as? JsonPrimitive ?: return null
        if (p.isString || p is JsonNull) return null
        val c = p.content
        if (c == "true" || c == "false") return null
        return c.toDoubleOrNull()
    }

    fun isRecord(e: JsonElement?): Boolean = e is JsonObject

    /** JS truthiness of a JSON value (undefined = null → false). */
    fun truthy(e: JsonElement?): Boolean = when (e) {
        null, JsonNull -> false
        is JsonObject, is JsonArray -> true
        is JsonPrimitive -> when {
            e.isString -> e.content.isNotEmpty()
            e.content == "true" -> true
            e.content == "false" -> false
            else -> e.content.toDoubleOrNull().let { it != null && it != 0.0 && !it.isNaN() }
        }
    }

    /** `Number.isInteger(v)` for `typeof v === 'number'`. */
    fun isInteger(d: Double): Boolean = d.isFinite() && d == Math.floor(d)

    /** JS `String(v)` for a primitive (used by template literals). */
    fun jsString(e: JsonElement?): String = when (e) {
        null -> "undefined"
        JsonNull -> "null"
        is JsonPrimitive -> if (e.isString) e.content else num(e)?.let { Js.numberToString(it) } ?: e.content
        is JsonArray -> e.joinToString(",") { el -> if (el is JsonNull) "" else jsString(el) }
        is JsonObject -> "[object Object]"
    }

    /** `JSON.stringify(value)` (compact); null for `undefined`. */
    fun stringify(e: JsonElement?): String? = e?.let { StringBuilder().also { sb -> write(sb, it, null, "") }.toString() }

    /** `JSON.stringify(value, null, 2)`. */
    fun stringifyPretty(e: JsonElement): String = StringBuilder().also { write(it, e, "  ", "") }.toString()

    /** Deterministic JSON: object keys sorted (UTF-16 order), as `canonicalJson` in shared/lesson/diff.ts. Null for undefined. */
    fun canonical(e: JsonElement?): String? = e?.let { stringify(sortKeys(it)) }

    fun sortKeys(e: JsonElement): JsonElement = when (e) {
        is JsonArray -> JsonArray(e.map(::sortKeys))
        is JsonObject -> JsonObject(LinkedHashMap<String, JsonElement>().also { m -> for (k in e.keys.sorted()) m[k] = sortKeys(e.getValue(k)) })
        else -> e
    }

    private fun write(sb: StringBuilder, e: JsonElement, indent: String?, current: String) {
        when (e) {
            JsonNull -> sb.append("null")
            is JsonPrimitive -> when {
                e.isString -> quote(sb, e.content)
                e.content == "true" || e.content == "false" -> sb.append(e.content)
                else -> {
                    val d = e.content.toDoubleOrNull()
                    sb.append(if (d == null || !d.isFinite()) "null" else Js.numberToString(d))
                }
            }
            is JsonArray -> {
                if (e.isEmpty()) { sb.append("[]"); return }
                val inner = if (indent != null) current + indent else current
                sb.append('[')
                e.forEachIndexed { i, el ->
                    if (i > 0) sb.append(',')
                    if (indent != null) sb.append('\n').append(inner)
                    write(sb, el, indent, inner)
                }
                if (indent != null) sb.append('\n').append(current)
                sb.append(']')
            }
            is JsonObject -> {
                if (e.isEmpty()) { sb.append("{}"); return }
                val inner = if (indent != null) current + indent else current
                sb.append('{')
                var first = true
                for ((k, v) in e) {
                    if (!first) sb.append(',')
                    first = false
                    if (indent != null) sb.append('\n').append(inner)
                    quote(sb, k)
                    sb.append(':')
                    if (indent != null) sb.append(' ')
                    write(sb, v, indent, inner)
                }
                if (indent != null) sb.append('\n').append(current)
                sb.append('}')
            }
        }
    }

    /** JSON.stringify's string quoting (well-formed: lone surrogates escaped). */
    private fun quote(sb: StringBuilder, s: String) {
        sb.append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\b' -> sb.append("\\b")
                c == '\u000C' -> sb.append("\\f")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c < ' ' -> sb.append("\\u").append(String.format("%04x", c.code))
                Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> { sb.append(c).append(s[i + 1]); i++ }
                Character.isSurrogate(c) -> sb.append("\\u").append(String.format("%04x", c.code))
                else -> sb.append(c)
            }
            i++
        }
        sb.append('"')
    }

    /** `===` between two JSON values as JS would see them after parsing (objects compare by identity → false unless same). */
    fun strictEquals(a: JsonElement?, b: JsonElement?): Boolean {
        if (a == null || b == null) return a == null && b == null
        if (a is JsonNull || b is JsonNull) return a is JsonNull && b is JsonNull
        if (a is JsonPrimitive && b is JsonPrimitive) {
            if (a.isString != b.isString) return false
            if (a.isString) return a.content == b.content
            val ab = a.content == "true" || a.content == "false"
            val bb = b.content == "true" || b.content == "false"
            if (ab || bb) return a.content == b.content
            val x = a.content.toDoubleOrNull()
            val y = b.content.toDoubleOrNull()
            return x != null && y != null && x == y
        }
        return a === b
    }

    /** `text.length > max ? text.slice(0, max - 1) + '…' : text` over a value like `short()` in the diffs. */
    fun short(value: JsonElement?, max: Int): String {
        val text = str(value) ?: if (value == null || value is JsonNull) "" else (stringify(value) ?: "")
        return if (text.length > max) text.substring(0, max - 1) + "…" else text
    }

    // ---------------- building / editing trees ----------------

    fun obj(vararg pairs: Pair<String, JsonElement?>): JsonObject =
        JsonObject(LinkedHashMap<String, JsonElement>().also { m -> for ((k, v) in pairs) if (v != null) m[k] = v })

    fun s(v: String): JsonPrimitive = JsonPrimitive(v)
}

/** `{ ...this, key: value }` — keeps the key's position when it exists; `value == null` removes it (undefined). */
fun JsonObject.with(key: String, value: JsonElement?): JsonObject {
    val m = LinkedHashMap<String, JsonElement>(this)
    if (value == null) m.remove(key) else m[key] = value
    return JsonObject(m)
}

fun JsonObject.with(key: String, value: String?): JsonObject = with(key, value?.let { JsonPrimitive(it) })

fun JsonObject.without(vararg keys: String): JsonObject = JsonObject(LinkedHashMap<String, JsonElement>(this).also { m -> keys.forEach { m.remove(it) } })

/** The string at [key] (null when missing or not a string). */
fun JsonObject.str(key: String): String? = JsJson.str(this[key])

fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray

fun JsonObject.objAt(key: String): JsonObject? = this[key] as? JsonObject

fun JsonObject.num(key: String): Double? = JsJson.num(this[key])

fun JsonArray.objects(): List<JsonObject> = mapNotNull { it as? JsonObject }
