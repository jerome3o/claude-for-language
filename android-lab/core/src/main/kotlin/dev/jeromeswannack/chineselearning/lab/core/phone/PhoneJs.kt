package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * JavaScript semantics for the phone's JSON values (records, events, conditions): Kotlin `null`
 * is `undefined` (a missing key), [JsonNull] is `null`. Numbers are written the way JSON.stringify
 * writes them (73, not 73.0) so a record saved on the phone reads like the web's.
 */
object PhoneJs {
    /** A JSON number for [d] (integers without ".0"). */
    fun num(d: Double): JsonPrimitive =
        if (d.isFinite() && d == Math.floor(d) && Math.abs(d) < 9.007199254740992E15) JsonPrimitive(d.toLong()) else JsonPrimitive(d)

    fun num(i: Int): JsonPrimitive = JsonPrimitive(i)

    fun str(s: String): JsonPrimitive = JsonPrimitive(s)

    fun strs(list: List<String>): JsonArray = JsonArray(list.map(::JsonPrimitive))

    fun bool(b: Boolean): JsonPrimitive = JsonPrimitive(b)

    /** An object keeping insertion order; `null` values (undefined) are left out. */
    fun obj(vararg pairs: Pair<String, JsonElement?>): JsonObject =
        JsonObject(LinkedHashMap<String, JsonElement>().also { m -> for ((k, v) in pairs) if (v != null) m[k] = v })

    fun isString(e: JsonElement?): Boolean = e is JsonPrimitive && e.isString

    fun isBool(e: JsonElement?): Boolean = e is JsonPrimitive && !e.isString && (e.content == "true" || e.content == "false")

    /** `typeof e === 'number'`. */
    fun isNumber(e: JsonElement?): Boolean = JsJson.num(e) != null

    fun number(e: JsonElement?): Double? = JsJson.num(e)

    /** JS `Number(s)` for a string. */
    fun toNumber(s: String): Double {
        val t = JsJson.trim(s)
        if (t.isEmpty()) return 0.0
        when (t) {
            "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
            "-Infinity" -> return Double.NEGATIVE_INFINITY
        }
        val lower = t.lowercase()
        val radix = when {
            lower.startsWith("0x") -> 16
            lower.startsWith("0o") -> 8
            lower.startsWith("0b") -> 2
            else -> 0
        }
        if (radix != 0) {
            val digits = t.substring(2)
            if (digits.isEmpty() || digits.any { Character.digit(it, radix) < 0 }) return Double.NaN
            return java.math.BigInteger(digits, radix).toDouble()
        }
        if (!DECIMAL.matches(t)) return Double.NaN
        return t.toDouble()
    }

    private val DECIMAL = Regex("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$")

    /** `String(v)` for a JSON value. */
    fun jsString(e: JsonElement?): String = JsJson.jsString(e)

    /** `${n}` for a number. */
    fun numStr(d: Double): String = Js.numberToString(d)

    /** A JSON value as a plain string: `String(o.x)`. */
    fun s(o: JsonObject?, key: String): String = jsString(o?.get(key))

    /** The field as a string, or null when absent / not a string. */
    fun sOrNull(o: JsonObject?, key: String): String? = (o?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** `Number(o.x)` (NaN when it isn't a number-ish value). */
    fun n(o: JsonObject?, key: String): Double = when (val e = o?.get(key)) {
        null -> Double.NaN
        JsonNull -> 0.0
        is JsonPrimitive -> when {
            e.isString -> toNumber(e.content)
            e.content == "true" -> 1.0
            e.content == "false" -> 0.0
            else -> e.content.toDoubleOrNull() ?: Double.NaN
        }
        else -> Double.NaN
    }

    /** The field as a list of strings (a JSON array of strings), empty otherwise. */
    fun list(o: JsonObject?, key: String): List<String> =
        (o?.get(key) as? JsonArray)?.map { jsString(it) } ?: emptyList()

    fun has(o: JsonObject?, key: String): Boolean = o?.containsKey(key) == true

    /** `{ ...a, ...b }`. */
    fun merge(a: JsonObject?, b: JsonObject): JsonObject {
        val m = LinkedHashMap<String, JsonElement>()
        a?.let { m.putAll(it) }
        m.putAll(b)
        return JsonObject(m)
    }

    /** Structural equality with numbers compared by value (73 == 73.0). */
    fun same(a: JsonElement?, b: JsonElement?): Boolean {
        if (a == null || b == null) return a == null && b == null
        if (a is JsonNull || b is JsonNull) return a is JsonNull && b is JsonNull
        if (a is JsonPrimitive && b is JsonPrimitive) {
            if (a.isString || b.isString) return a.isString && b.isString && a.content == b.content
            val x = a.content.toDoubleOrNull()
            val y = b.content.toDoubleOrNull()
            return if (x != null && y != null) x == y else a.content == b.content
        }
        if (a is JsonArray && b is JsonArray) return a.size == b.size && a.indices.all { same(a[it], b[it]) }
        if (a is JsonObject && b is JsonObject) return a.keys == b.keys && a.keys.all { same(a[it], b[it]) }
        return false
    }

    /** JS `\d` (ASCII only — Android's ICU regex would take any Unicode digit). */
    fun isDigit(c: Char): Boolean = c in '0'..'9'

    fun allDigits(s: String, len: Int? = null): Boolean = (len == null || s.length == len) && s.isNotEmpty() && s.all(::isDigit)

    /** `/^1[3-9]\d{9}$/` */
    fun isMobile(s: String): Boolean = s.length == 11 && s[0] == '1' && s[1] in '3'..'9' && s.all(::isDigit)

    /** `[㐀-鿿]` (a UTF-16 unit in that range). */
    fun hasHan(s: String): Boolean = s.any { it in '㐀'..'鿿' }
}
