package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** One entry of the phone's event log (`{ type, at, … }`, a record write has `record`, `id`, `data`). */
typealias PhoneEvent = JsonObject

/** Port of `PhoneRecord`: the latest version of `(record, id)`. */
data class PhoneRecord(val record: String, val id: String, val data: JsonObject, val at: Long)

/**
 * Port of shared/phone/engine.ts: pure functions over a scenario spec and the phone's event log.
 * Records are the LATEST version of each (record, id) — a ticket booked and then refunded is a
 * refunded ticket. Goals and mistakes are declarative conditions over records and events.
 */
object PhoneEngine {
    // ── events ──

    fun type(e: PhoneEvent): String = JsJson.str(e["type"]) ?: ""

    fun at(e: PhoneEvent): Long = JsJson.num(e["at"])?.toLong() ?: 0L

    /** A simple event `{ type, at, …extra }` (web `emit`). */
    fun event(type: String, at: Long, vararg extra: Pair<String, JsonElement?>): PhoneEvent =
        PhoneJs.obj("type" to PhoneJs.str(type), "at" to JsonPrimitive(at), *extra)

    /** A record write (web `write`). */
    fun recordEvent(record: String, id: String, data: JsonObject, at: Long): PhoneEvent =
        PhoneJs.obj("type" to PhoneJs.str("record"), "record" to PhoneJs.str(record), "id" to PhoneJs.str(id), "data" to data, "at" to JsonPrimitive(at))

    fun isRecordEvent(e: PhoneEvent): Boolean = type(e) == "record" && PhoneJs.isString(e["record"]) && PhoneJs.isString(e["id"])

    /** The latest version of every record, in first-written order. */
    fun recordsFrom(events: List<PhoneEvent>): List<PhoneRecord> {
        val byKey = LinkedHashMap<String, PhoneRecord>()
        for (e in events) {
            if (!isRecordEvent(e)) continue
            val record = JsJson.str(e["record"])!!
            val id = JsJson.str(e["id"])!!
            val key = "$record\u0000$id"
            val prev = byKey[key]
            val data = e["data"] as? JsonObject ?: JsonObject(emptyMap())
            byKey[key] = PhoneRecord(record, id, PhoneJs.merge(prev?.data, data), prev?.at ?: at(e))
        }
        return byKey.values.toList()
    }

    fun recordsOf(events: List<PhoneEvent>, record: String): List<PhoneRecord> = recordsFrom(events).filter { it.record == record }

    // ── matchers ──

    private val INDEX = Regex("^[0-9]+$")

    /** A dotted path into a value ("seats.0", "params.where"); null = undefined. */
    fun getPath(obj: JsonElement?, path: String): JsonElement? {
        var cur: JsonElement? = obj
        for (part in path.split(".")) {
            if (cur == null || cur is JsonNull) return null
            cur = when {
                cur is JsonArray && INDEX.matches(part) -> part.toIntOrNull()?.let { cur.getOrNull(it) }
                cur is JsonArray -> if (part == "length") JsonPrimitive(cur.size) else null
                cur is JsonObject -> cur[part]
                else -> return null
            }
        }
        return cur
    }

    private fun isScalar(m: JsonElement?): Boolean = m is JsonNull || m is JsonPrimitive

    private fun eqScalar(a: JsonElement?, b: JsonElement?): Boolean {
        if (JsJson.strictEquals(a, b)) return true
        val an = JsJson.num(a)
        val bn = JsJson.num(b)
        val astr = JsJson.str(a)
        val bstr = JsJson.str(b)
        // Numbers written as strings in a world ("18.50") still compare.
        if (an != null && bstr != null && JsJson.trim(bstr) != "" && PhoneJs.toNumber(bstr) == an) return true
        if (astr != null && bn != null && JsJson.trim(astr) != "" && PhoneJs.toNumber(astr) == bn) return true
        return false
    }

    private fun compare(a: JsonElement?, b: JsonElement): Double? {
        val an = JsJson.num(a)
        val bn = JsJson.num(b)
        val astr = JsJson.str(a)
        val bstr = JsJson.str(b)
        if (an != null && bn != null) return an - bn
        if (astr != null && bstr != null) return if (astr < bstr) -1.0 else if (astr > bstr) 1.0 else 0.0
        if (an != null && bstr != null && PhoneJs.toNumber(bstr).isFinite()) return an - PhoneJs.toNumber(bstr)
        if (astr != null && bn != null && PhoneJs.toNumber(astr).isFinite()) return PhoneJs.toNumber(astr) - bn
        return null
    }

    private fun sizeOf(v: JsonElement?): Int? = when {
        v is JsonArray -> v.size
        JsJson.str(v) != null -> JsJson.str(v)!!.codePointCount(0, JsJson.str(v)!!.length)
        else -> null
    }

    /** Port of `matches`: does [value] satisfy [m]? */
    fun matches(value: JsonElement?, m: JsonElement): Boolean {
        if (isScalar(m)) {
            if (value is JsonArray) return value.any { eqScalar(it, m) }
            return eqScalar(value, m)
        }
        val o = m as? JsonObject ?: return true
        o["exists"]?.let { ex ->
            val present = value != null && value !is JsonNull
            // `present !== m.exists`: only a boolean can ever equal it.
            val want = if (PhoneJs.isBool(ex)) (ex as JsonPrimitive).content == "true" else null
            if (want == null || want != present) return false
        }
        o["eq"]?.let { if (!eqScalar(value, it)) return false }
        o["ne"]?.let { if (eqScalar(value, it)) return false }
        (o["in"] as? JsonArray)?.let { list -> if (list.none { eqScalar(value, it) }) return false }
        if (o["in"] != null && o["in"] !is JsonArray && JsJson.truthy(o["in"])) return false
        (o["nin"] as? JsonArray)?.let { list -> if (list.any { eqScalar(value, it) }) return false }
        for ((op, test) in listOf<Pair<String, (Double) -> Boolean>>("gt" to { d -> d > 0 }, "gte" to { d -> d >= 0 }, "lt" to { d -> d < 0 }, "lte" to { d -> d <= 0 })) {
            val bound = o[op] ?: continue
            val d = compare(value, bound)
            if (d == null || d.isNaN() || !test(d)) return false
        }
        o["contains"]?.let { c ->
            val cs = JsJson.str(c)
            when {
                value is JsonArray -> if (value.none { v -> eqScalar(v, c) || (cs != null && JsJson.str(v)?.contains(cs) == true) }) return false
                JsJson.str(value) != null -> if (!JsJson.str(value)!!.contains(PhoneJs.jsString(c))) return false
                else -> return false
            }
        }
        o["size"]?.let { size ->
            val n = sizeOf(value) ?: return false
            val exact = JsJson.num(size)
            if (exact != null) {
                if (n.toDouble() != exact) return false
            } else if (size is JsonObject) {
                val gte = JsJson.num(size["gte"])
                val lte = JsJson.num(size["lte"])
                if ((gte != null && n < gte) || (lte != null && n > lte)) return false
            }
        }
        o["match"]?.let { w -> if (value !is JsonObject || !matchesWhere(value, w as? JsonObject)) return false }
        o["has_all"]?.let { all ->
            if (value !is JsonArray || (all as? JsonArray)?.all { x -> value.any { v -> eqScalar(v, x) } } != true) return false
        }
        o["every"]?.let { ev -> if (value !is JsonArray || value.isEmpty() || !value.all { matches(it, ev) }) return false }
        o["some"]?.let { sm -> if (value !is JsonArray || value.none { matches(it, sm) }) return false }
        return true
    }

    fun matchesWhere(obj: JsonElement?, where: JsonObject?): Boolean {
        if (where == null) return true
        return where.entries.all { (path, m) -> matches(getPath(obj, path), m) }
    }

    private fun countOk(n: Int, count: JsonElement?): Boolean {
        if (count == null) return n >= 1
        JsJson.num(count)?.let { return n >= it }
        val o = count as? JsonObject ?: return n >= 1
        val gte = JsJson.num(o["gte"])
        val lte = JsJson.num(o["lte"])
        return (gte == null || n >= gte) && (lte == null || n <= lte)
    }

    // ── conditions ──

    class Snapshot(val events: List<PhoneEvent>, val records: List<PhoneRecord>)

    fun snapshot(events: List<PhoneEvent>): Snapshot = Snapshot(events, recordsFrom(events))

    fun checkCondition(c: JsonElement?, s: Snapshot): Boolean {
        val o = c as? JsonObject ?: return false
        return when (JsJson.str(o["kind"])) {
            "record" -> {
                val record = o["record"]
                val where = o["where"] as? JsonObject
                countOk(s.records.count { JsJson.strictEquals(PhoneJs.str(it.record), record) && matchesWhere(it.data, where) }, o["count"])
            }
            "event" -> {
                val event = o["event"]
                val where = o["where"] as? JsonObject
                countOk(s.events.count { JsJson.strictEquals(it["type"], event) && matchesWhere(it, where) }, o["count"])
            }
            "all_of" -> (o["conditions"] as? JsonArray)?.all { checkCondition(it, s) } ?: false
            "any_of" -> (o["conditions"] as? JsonArray)?.any { checkCondition(it, s) } ?: false
            "not" -> !checkCondition(o["condition"], s)
            else -> false
        }
    }

    // ── progress, hints, finish ──

    data class GoalState(val goal: ScenarioGoal, val done: Boolean)

    fun goalStates(spec: ScenarioSpec, events: List<PhoneEvent>): List<GoalState> {
        val s = snapshot(events)
        return spec.goals.map { GoalState(it, checkCondition(it.condition, s)) }
    }

    /** Every required goal holds. */
    fun isComplete(spec: ScenarioSpec, events: List<PhoneEvent>): Boolean = goalStates(spec, events).all { it.done || it.goal.optional }

    /** Port of `nextHintIndex`: the hint to show next after [shown] revealed ones (null = none left). */
    fun nextHintIndex(spec: ScenarioSpec, events: List<PhoneEvent>, shown: Int): Int? {
        if (spec.hints.isEmpty()) return null
        val s = snapshot(events)
        var from = 0
        spec.hints.forEachIndexed { i, h -> if (h.done != null && checkCondition(h.done, s)) from = i + 1 }
        val idx = maxOf(from, minOf(shown, spec.hints.size))
        return if (idx < spec.hints.size) idx else null
    }

    data class MistakeHit(val id: String, val label: Bilingual)

    fun mistakesMade(spec: ScenarioSpec, events: List<PhoneEvent>): List<MistakeHit> {
        val s = snapshot(events)
        return (spec.mistakes ?: emptyList()).filter { checkCondition(it.whenCondition, s) }.map { MistakeHit(it.id, it.label) }
    }

    /** Slips the apps report themselves (a wrong pay password, a form sent with gaps). */
    fun slipCount(events: List<PhoneEvent>): Int = events.count { type(it) == "error" }

    val DURATION_BUCKETS = listOf("lt2m", "2-5m", "5-10m", "10-20m", "gt20m")

    fun durationBucket(ms: Long): String {
        val min = ms / 60_000.0
        return when {
            min < 2 -> "lt2m"
            min < 5 -> "2-5m"
            min < 10 -> "5-10m"
            min < 20 -> "10-20m"
            else -> "gt20m"
        }
    }

    @kotlinx.serialization.Serializable
    data class ScenarioResult(
        val scenario_id: String,
        val success: Boolean,
        val duration_ms: Long,
        val hints_used: Int,
        val goals_done: List<String>,
        val bonus_done: List<String>,
        val bonus_total: Int,
        val mistakes: List<MistakeIdLabel>,
        val slips: Int,
        val persona_messages: Int,
    )

    @kotlinx.serialization.Serializable
    data class MistakeIdLabel(val id: String, val label: Bilingual)

    fun scenarioResult(spec: ScenarioSpec, events: List<PhoneEvent>, startedAt: Long, endedAt: Long): ScenarioResult {
        val states = goalStates(spec, events)
        return ScenarioResult(
            scenario_id = spec.id,
            success = states.all { it.done || it.goal.optional },
            duration_ms = maxOf(0L, endedAt - startedAt),
            hints_used = events.count { type(it) == "hint" },
            goals_done = states.filter { it.done && !it.goal.optional }.map { it.goal.id },
            bonus_done = states.filter { it.done && it.goal.optional }.map { it.goal.id },
            bonus_total = states.count { it.goal.optional },
            mistakes = mistakesMade(spec, events).map { MistakeIdLabel(it.id, it.label) },
            slips = slipCount(events),
            persona_messages = events.count { type(it) == "persona.message" && JsJson.str(it["from"]) == "me" },
        )
    }

    /** "3 min 12 s" / "45 s". */
    fun formatDuration(ms: Long): String {
        val s = dev.jeromeswannack.chineselearning.lab.core.Js.round(ms / 1000.0).toLong()
        val m = s / 60
        return if (m > 0) "$m min ${s % 60} s" else "$s s"
    }
}
