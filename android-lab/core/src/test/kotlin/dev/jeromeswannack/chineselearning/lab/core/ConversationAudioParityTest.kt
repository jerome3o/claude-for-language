package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Conversation audio reproduces shared/tts/conversation.ts + shared/lesson/conversationAudio.ts
 * exactly (parity/fixtures/conversation-audio.ts).
 */
class ConversationAudioParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "conversation-audio.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonElement.strings(): List<String> = jsonArray.map { it.str!! }
    private fun JsonElement.doubles(): List<Double> = jsonArray.map { it.jsonPrimitive.double }

    /** Fixture prefs → Kotlin prefs, field by field (no validation: the fixture holds the TS result). */
    private fun prefs(e: JsonElement?): ConversationAudioPrefs? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return ConversationAudioPrefs(
            speed = o["speed"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double },
            delivery = o["delivery"]!!.str!!,
            voices = o["voices"]!!.jsonObject.mapValues { (_, g) -> g.jsonObject.mapValues { it.value.str!! } },
            exerciseVoices = o["exercise_voices"]!!.jsonObject.mapValues { (_, l) -> l.jsonArray.map { it.str } },
        )
    }

    private fun assertPrefs(expected: JsonElement, got: ConversationAudioPrefs, msg: String) {
        assertEquals(prefs(expected), got, msg)
        assertEquals(expected.jsonObject["exercise_voices"]!!.jsonObject.keys.toList(), got.exerciseVoices.keys.toList(), "order: $msg")
    }

    private fun speakers(e: JsonElement) = e.jsonArray.map { ConversationSpeaker(it.jsonObject["name"]!!.str!!, it.jsonObject["voice"]?.str) }
    private fun lines(e: JsonElement) = e.jsonArray.map { ConversationLine(it.jsonObject["speaker"]!!.jsonPrimitive.int, it.jsonObject["hanzi"]!!.str!!) }

    private fun ctx(o: JsonObject) = ConversationAudioContext(
        provider = o["provider"]!!.str!!,
        defaultSpeed = o["default_speed"]!!.jsonPrimitive.double,
        enabled = o["enabled"]!!.let { if (it is JsonNull) null else it.strings() },
        prefs = prefs(o["prefs"]),
    )

    /** A JsonElement compared by value (numbers as doubles), so 1 == 1.0. */
    private fun norm(e: JsonElement?): Any? = when (e) {
        null, JsonNull -> null
        is JsonObject -> e.mapValues { norm(it.value) }
        is JsonArray -> e.map { norm(it) }
        is JsonPrimitive -> if (e.isString) e.content else e.content.toDoubleOrNull() ?: e.content
    }

    @Test
    fun constantsMatch() {
        assertEquals(data["providers"]!!.strings(), TtsConversation.PROVIDERS)
        assertEquals(data["provider_names"]!!.jsonObject.mapValues { it.value.str }, TtsConversation.PROVIDER_NAMES)
        for ((p, r) in data["rate_range"]!!.jsonObject) {
            val o = r.jsonObject
            assertEquals(
                TtsConversation.RateRange(o["min"]!!.jsonPrimitive.double, o["max"]!!.jsonPrimitive.double, o["good_min"]!!.jsonPrimitive.double, o["good_max"]!!.jsonPrimitive.double),
                TtsConversation.RATE_RANGE[p],
            )
        }
        assertEquals(data["conversation_rate"]!!.jsonObject.mapValues { it.value.jsonPrimitive.double }, TtsConversation.DEFAULT_CONVERSATION_RATES)
        assertEquals(data["speed_steps_all"]!!.doubles(), TtsConversation.SPEED_STEPS)
        assertEquals(data["default_rate"]!!.jsonPrimitive.double, TtsConversation.DEFAULT_RATE)
        for ((p, steps) in data["steps"]!!.jsonObject) assertEquals(steps.doubles(), TtsConversation.speedSteps(p), p)
        assertEquals(data["deliveries_all"]!!.strings(), TtsConversation.DELIVERIES)
        assertEquals(data["delivery_labels"]!!.jsonObject.mapValues { it.value.str }, TtsConversation.DELIVERY_LABELS)
        assertEquals(data["azure_styles"]!!.jsonObject.mapValues { it.value.strings() }, TtsConversation.AZURE_VOICE_STYLES)
        assertEquals(data["max_entries"]!!.jsonPrimitive.int, ConversationAudio.MAX_EXERCISE_VOICE_ENTRIES)
        assertEquals(prefs(data["default_prefs"]), ConversationAudio.DEFAULT_PREFS)
        for (c in data["is_delivery"]!!.jsonArray) assertEquals(c.jsonObject["ok"]!!.jsonPrimitive.boolean, TtsConversation.isDelivery(c.jsonObject["v"]!!.str))
    }

    @Test
    fun clampMatches() {
        val cases = data["clamp"]!!.jsonArray
        assertTrue(cases.size > 50)
        for (c in cases) {
            val o = c.jsonObject
            assertEquals(o["rate"]!!.jsonPrimitive.double, TtsConversation.clampRate(o["provider"]!!.str!!, o["speed"]!!.jsonPrimitive.double), "case $o")
        }
    }

    @Test
    fun voicesOwnersAndPoolsMatch() {
        for ((p, list) in data["voices"]!!.jsonObject) {
            val expected = list.jsonArray.map { val o = it.jsonObject; TtsConversation.ProviderVoice(o["id"]!!.str!!, o["name"]!!.str!!, o["gender"]!!.str!!, o["note"]!!.str!!) }
            assertEquals(expected, TtsConversation.providerVoices(p), p)
        }
        for ((p, pools) in data["pools"]!!.jsonObject) {
            assertEquals(pools.jsonObject.mapValues { it.value.strings() }, TtsConversation.providerPools(p), p)
        }
        for (c in data["owners"]!!.jsonArray) {
            val o = c.jsonObject
            val id = o["id"]!!.str!!
            assertEquals(o["provider"]!!.str, TtsConversation.voiceProvider(id), id)
            assertEquals(o["gender"]!!.str, TtsConversation.voiceGender(id), id)
        }
    }

    @Test
    fun deliveriesMatch() {
        for (c in data["delivery_params"]!!.jsonArray) {
            val o = c.jsonObject
            val p = o["params"]!!.let { if (it is JsonNull) null else TtsConversation.DeliveryParams(it.jsonObject["azure_style"]?.str, it.jsonObject["minimax_emotion"]?.str) }
            assertEquals(p, TtsConversation.deliveryParams(o["provider"]!!.str!!, o["voice"]!!.str!!, o["delivery"]!!.str!!), "case $o")
        }
        for (c in data["supported"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["deliveries"]!!.strings(), TtsConversation.supportedDeliveries(o["provider"]!!.str!!, o["voice"]!!.str!!), "case $o")
        }
    }

    @Test
    fun mergeMatches() {
        val cases = data["merges"]!!.jsonArray
        assertTrue(cases.size > 300)
        var withProblems = 0
        for (c in cases) {
            val o = c.jsonObject
            val r = ConversationAudio.merge(prefs(o["base"])!!, o["input"])
            assertPrefs(o["prefs"]!!, r.prefs, "case $o")
            val problems = o["problems"]!!.strings()
            assertEquals(problems, r.problems, "case $o")
            if (problems.isNotEmpty()) withProblems++
        }
        assertTrue(withProblems in 20 until cases.size - 20, "both valid and invalid updates are covered")
    }

    @Test
    fun parseMatches() {
        for (c in data["parses"]!!.jsonArray) {
            val o = c.jsonObject
            assertPrefs(o["prefs"]!!, ConversationAudio.parse(o["raw"]!!.str), "case $o")
        }
    }

    @Test
    fun jsonRoundTripKeepsPrefs() {
        for (c in data["merges"]!!.jsonArray) {
            val p = prefs(c.jsonObject["prefs"])!!
            assertEquals(p, ConversationAudio.fromJson(ConversationAudio.toJson(p)))
            assertEquals(p, ConversationAudio.parse(ConversationAudio.toJson(p).toString()))
        }
    }

    @Test
    fun resolveAndVoiceUpdateMatch() {
        val cases = data["resolves"]!!.jsonArray
        assertTrue(cases.size >= 500)
        for (c in cases) {
            val o = c.jsonObject
            val ex = o["ex"]!!.jsonObject
            val sp = speakers(ex["speakers"]!!)
            val ctx = ctx(o["ctx"]!!.jsonObject)
            val got = ConversationAudio.resolve(sp, ex["situation"]!!.str!!, lines(ex["lines"]!!), ctx)
            val r = o["result"]!!.jsonObject
            val expected = ResolvedConversationAudio(
                key = r["key"]!!.str!!,
                provider = r["provider"]!!.str!!,
                voices = r["voices"]!!.strings(),
                autoVoices = r["auto_voices"]!!.strings(),
                chosen = r["chosen"]!!.jsonArray.map { it.jsonPrimitive.boolean },
                speed = r["speed"]!!.jsonPrimitive.double,
                delivery = r["delivery"]!!.str!!,
            )
            assertEquals(expected, got, "case $o")
            val update = ConversationAudio.speakerVoiceUpdate(
                got, sp, o["pick_index"]!!.jsonPrimitive.int, o["pick_voice"]!!.str, ctx.prefs ?: ConversationAudio.DEFAULT_PREFS,
            )
            assertEquals(norm(o["update"]), norm(update), "update $o")
        }
    }

    @Test
    fun poolRotationMatches() {
        for (c in data["pool_resolves"]!!.jsonArray) {
            val o = c.jsonObject
            val pools = o["pools"]!!.jsonObject.mapValues { it.value.strings() }
            val got = ConversationVoices.resolve(
                speakers(o["speakers"]!!),
                o["enabled"]!!.let { if (it is JsonNull) null else it.strings() },
                o["seed"]!!.jsonPrimitive.double.toLong(),
                pools,
            )
            assertEquals(o["voices"]!!.strings(), got, "case $o")
        }
    }

    @Test
    fun lessonClipsMatch() {
        val spec = Lessons.decodeSpec(data["lesson_spec"]) ?: fail("spec did not decode")
        for (c in data["clips"]!!.jsonArray) {
            val o = c.jsonObject
            val ctx = ctx(o["ctx"]!!.jsonObject)
            val got = ConversationAudio.lessonClips(spec) { ConversationAudio.resolve(it, ctx) }
            val expected = o["clips"]!!.jsonArray.map {
                val x = it.jsonObject
                ConversationClip(x["text"]!!.str!!, x["voice"]!!.str, x["speed"]!!.jsonPrimitive.double, x["delivery"]!!.str!!)
            }
            assertEquals(expected, got)
        }
    }
}
