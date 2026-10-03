package dev.jeromeswannack.chineselearning.lab.core.analytics

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The usage-event catalogue and privacy filter match shared/analytics exactly
 * (parity/fixtures/analytics.ts runs the TypeScript).
 */
class AnalyticsParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "analytics.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun strings(key: String) = data[key]!!.jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun catalogueEqualsTheTypeScriptOne() {
        val ts = data["catalogue"]!!.jsonArray.map { it.jsonObject }
        assertTrue(ts.size > 100)
        assertEquals(ts.map { it["name"].str }, AnalyticsEvents.ALL.map { it.name }, "same events, same order")
        for (o in ts) {
            val name = o["name"].str!!
            val kt = AnalyticsEvents.BY_NAME[name] ?: fail("missing $name")
            assertEquals(o["area"].str, kt.area, name)
            assertEquals(o["props"]!!.jsonArray.map { it.jsonPrimitive.content }, kt.props, "$name props")
            assertEquals(o["server"]!!.jsonPrimitive.boolean, kt.server, "$name server")
            assertEquals(o["replacedBy"].str, kt.replacedBy, "$name replacedBy")
            assertEquals(!kt.server, AnalyticsEvents.isClientEvent(name))
        }
        assertEquals(strings("verbose_only"), AnalyticsEvents.VERBOSE_ONLY_EVENTS)
        assertEquals(strings("levels_list"), AnalyticsEvents.LEVELS)
        assertEquals(strings("platforms"), AnalyticsEvents.PLATFORMS)
        assertEquals(data["screen_replaced_by"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, AnalyticsEvents.SCREEN_REPLACED_BY)
        assertEquals(data["retention_days"]!!.jsonPrimitive.int, AnalyticsEvents.USAGE_RETENTION_DAYS)
        assertEquals(strings("forbidden"), AnalyticsPrivacy.FORBIDDEN_PROP_KEYS)
        assertEquals(data["max_props"]!!.jsonPrimitive.int, AnalyticsPrivacy.MAX_PROPS)
        assertEquals(data["max_prop_string"]!!.jsonPrimitive.int, AnalyticsPrivacy.MAX_PROP_STRING)
        // No catalogue prop is a forbidden key (events.test.ts checks the same on the TS side).
        for (e in AnalyticsEvents.ALL) for (p in e.props) assertFalse(p in AnalyticsPrivacy.FORBIDDEN_PROP_KEYS, "${e.name}.$p")
        assertFalse(AnalyticsEvents.isEvent("not.an.event"))
    }

    private fun decode(e: JsonElement): Any? = when {
        e is JsonNull -> null
        e is JsonPrimitive && e.isString -> when (e.content) {
            "__NaN__" -> Double.NaN
            "__Inf__" -> Double.POSITIVE_INFINITY
            "__-Inf__" -> Double.NEGATIVE_INFINITY
            "__obj__" -> emptyMap<String, Any?>()
            "__arr__" -> emptyList<Any?>()
            else -> e.content
        }
        e is JsonPrimitive -> e.booleanOrNull ?: e.double
        else -> fail("unexpected $e")
    }

    @Test
    fun sanitizePropsMatches() {
        val cases = data["sanitize"]!!.jsonArray
        assertTrue(cases.size > 100)
        for (c in cases) {
            val o = c.jsonObject
            val event = o["event"].str!!
            val input = o["props"]!!.jsonObject.mapValues { decode(it.value) }
            val got = AnalyticsPrivacy.sanitizeProps(event, input)
            val want = o["out"]!!.jsonObject
            assertEquals(want.keys.toList(), got.keys.toList(), "$event $input keys")
            for ((k, w) in want) {
                val g = got[k]
                when {
                    w is JsonNull -> assertEquals(null, g, "$event.$k")
                    w is JsonPrimitive && w.isString -> assertEquals(w.content, g, "$event.$k")
                    w is JsonPrimitive && w.booleanOrNull != null -> assertEquals(w.boolean, g, "$event.$k")
                    else -> assertTrue((g as Double) == w.jsonPrimitive.double, "$event.$k: $g vs $w")
                }
            }
        }
    }

    @Test
    fun aMessageBodyUnderAnAllowedKeyNeverPasses() {
        val out = AnalyticsPrivacy.sanitizeProps("chat.send", mapOf("kind" to "你好，我明天不能来上课了", "reply" to true, "text" to "hello"))
        assertEquals(mapOf<String, Any?>("reply" to true), out)
        assertEquals(emptyMap<String, Any?>(), AnalyticsPrivacy.sanitizeProps("chat.menu_action", mapOf("action" to "jerome@example.com")))
    }

    @Test
    fun tokensSegmentsAndScreens() {
        for (c in data["tokens"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["safe"]!!.jsonPrimitive.boolean, AnalyticsPrivacy.isSafeToken(o["value"].str!!), "token ${o["value"]}")
        }
        for (c in data["segments"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["id"]!!.jsonPrimitive.boolean, AnalyticsPrivacy.isIdSegment(o["seg"].str!!), "segment ${o["seg"]}")
        }
        for (c in data["paths"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["screen"].str, AnalyticsPrivacy.screenName(o["path"].str), "path ${o["path"]}")
        }
    }

    @Test
    fun levels() {
        for (c in data["levels"]!!.jsonArray) {
            val o = c.jsonObject
            val raw: Any? = when (val r = o["raw"]!!) {
                is JsonNull -> null
                is JsonPrimitive -> if (r.isString) r.content else r.double
                is JsonArray, is JsonObject -> r.toString()
            }
            assertEquals(o["level"].str, AnalyticsEvents.parseLevel(raw), "level $raw")
        }
        for (c in data["allowed"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["allowed"]!!.jsonPrimitive.boolean, AnalyticsEvents.allowedAtLevel(o["name"].str!!, o["level"].str!!), "$o")
        }
    }
}
