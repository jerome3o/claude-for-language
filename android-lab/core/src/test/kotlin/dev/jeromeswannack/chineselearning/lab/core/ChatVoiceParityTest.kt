package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Chat read-aloud voice reproduces shared/chats/voice.ts exactly (parity/fixtures/chat-voice.ts). */
class ChatVoiceParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "chat-voice.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun copyAndConstantsMatch() {
        assertEquals(data["title"]!!.str, ChatVoice.TITLE)
        assertEquals(data["hint"]!!.str, ChatVoice.HINT)
        assertEquals(data["speed"]!!.jsonPrimitive.double, ChatVoice.SPEED)
        assertEquals(data["device_speech_rate"]!!.jsonPrimitive.double, ChatVoice.DEVICE_SPEECH_RATE)
        assertEquals(data["default_voice"]!!.str, ChatVoice.DEFAULT_VOICE)
        val options = data["options"]!!.jsonArray.map { ChatVoice.Option(it.jsonObject["value"]?.str, it.jsonObject["label"]!!.str!!) }
        assertEquals(options, ChatVoice.OPTIONS)
    }

    @Test
    fun voicesMatch() {
        val cases = data["voices"]!!.jsonArray
        assertTrue(cases.size > 100)
        for (c in cases) {
            val o = c.jsonObject
            val enabled = o["enabled"]!!.let { if (it is JsonNull) null else it.jsonArray.map { e -> e.str!! } }
            val got = ChatVoice.voice(
                senderGender = o["sender_gender"]!!.str,
                enabled = enabled,
                fromAi = o["from_ai"]!!.jsonPrimitive.boolean,
                personaVoice = o["persona_voice"]!!.str,
            )
            assertEquals(o["voice"]!!.str, got, "case $o")
            if (!o["from_ai"]!!.jsonPrimitive.boolean && enabled?.contains("female-yujie") != true) assertNotEquals("female-yujie", got, "a human chat never reads in the legacy default: $o")
        }
    }

    @Test
    fun speedsMatch() {
        for (c in data["speeds"]!!.jsonArray) {
            val o = c.jsonObject
            val s = o["persona_speed"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }
            assertEquals(o["speed"]!!.jsonPrimitive.double, ChatVoice.speed(o["from_ai"]!!.jsonPrimitive.boolean, s), "case $o")
        }
    }

    @Test
    fun parseAndPickMatch() {
        for (c in data["parsed"]!!.jsonArray) {
            val o = c.jsonObject
            val v = o["value"]!!.str
            assertEquals(o["parsed"]!!.str, ChatVoice.parse(v), "parse $v")
            val p = ChatVoice.pick(v)
            assertEquals(o["pick_set"]!!.jsonPrimitive.boolean, p.set, "pick set $v")
            assertEquals(o["pick_value"]!!.str, p.value, "pick value $v")
            assertEquals(o["pick_problem"]!!.str, p.problem, "pick problem $v")
        }
        assertEquals(ChatVoice.Pick(false, null, null), ChatVoice.pick(null, present = false))
    }

    @Test
    fun deviceGenderFollowsTheVoice() {
        assertEquals("male", ChatVoice.deviceGender("presenter_male"))
        assertEquals("female", ChatVoice.deviceGender("Chinese (Mandarin)_News_Anchor"))
        assertEquals(null, ChatVoice.deviceGender(ChatVoice.DEFAULT_VOICE))
        assertEquals(null, ChatVoice.deviceGender("junk"))
    }
}

/** The offline device-voice fallback (Lab only: the web has no device voice choice). */
class ChatDeviceVoiceTest {
    private fun v(name: String, lang: String = "zh", country: String = "CN", quality: Int = 300, net: Boolean = false) = ChatVoice.DeviceVoice(name, lang, country, quality, net)

    @Test
    fun picksMandarinOnly() {
        val voices = listOf(v("en-us-x-female", "en", "US"), v("yue-hk-x-1", "yue", "HK"), v("zh-tw-x-1", "zh", "TW"))
        assertEquals(null, ChatVoice.pickDeviceVoice(voices, "male"))
        val cn = v("cmn-cn-x-ccc-local")
        assertEquals(cn, ChatVoice.pickDeviceVoice(voices + cn, "male"))
    }

    @Test
    fun prefersOfflineThenGenderThenQuality() {
        val female = v("cmn-cn-female-local", quality = 300)
        val male = v("cmn-cn-male-local", quality = 200)
        val maleNet = v("cmn-cn-male-network", quality = 500, net = true)
        assertEquals(male, ChatVoice.pickDeviceVoice(listOf(female, male, maleNet), "male"))
        assertEquals(female, ChatVoice.pickDeviceVoice(listOf(female, male, maleNet), "female"))
        assertEquals(female, ChatVoice.pickDeviceVoice(listOf(female, male, maleNet), null))
        assertEquals("female", ChatVoice.deviceVoiceGender("zh-CN-language#female_1-local"))
        assertEquals("male", ChatVoice.deviceVoiceGender("zh-CN-language#male_2-local"))
        assertEquals(null, ChatVoice.deviceVoiceGender("cmn-cn-x-ccc-local"))
    }
}
