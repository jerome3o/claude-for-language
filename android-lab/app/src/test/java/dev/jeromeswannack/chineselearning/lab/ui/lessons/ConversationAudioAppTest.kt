package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudio
import dev.jeromeswannack.chineselearning.lab.core.ConversationClip
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.core.ConversationLine
import dev.jeromeswannack.chineselearning.lab.core.ConversationSpeaker
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.MeDto
import dev.jeromeswannack.chineselearning.lab.data.api.conversationAudio
import dev.jeromeswannack.chineselearning.lab.data.api.updateConversationAudio
import dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationAudioCache
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonMedia
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Conversation audio in the app: the device clip key is the web's `conversationClipKey`, a line is
 * fetched with kind=conversation / voice / provider rate / delivery and cached, Regenerate refetches
 * online and plays the cached copy offline, the API shapes, `/api/auth/me` → the cache, and a choice
 * applied locally changes the resolution (and so the clips) at once.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class ConversationAudioAppTest {
    private val ex = ConversationExercise(
        situation = "在咖啡店点咖啡",
        speakers = listOf(ConversationSpeaker("店员", "female"), ConversationSpeaker("顾客", "male")),
        lines = listOf(ConversationLine(0, "你好！"), ConversationLine(1, "我要一杯拿铁。")),
    )

    @Test fun clipKeysMatchTheWeb() {
        val media = LessonMedia(Files.createTempDirectory("m").toFile(), Api("http://localhost") { "t" })
        // Values from the web's conversationClipKey (frontend/src/services/ttsCache.ts).
        assertEquals("tts/c-tj4875-x0.75", media.conversationKey(ConversationClip("你好！", "zh-CN-XiaoxiaoNeural", 0.75, "chat")))
        assertEquals("tts/c-82evec-x1", media.conversationKey(ConversationClip("请问，火车站怎么走？", "Chinese (Mandarin)_News_Anchor", 1.0, "natural")))
        assertEquals("tts/c-z05ni8-x0.85", media.conversationKey(ConversationClip("谢谢", "cmn-CN-Wavenet-B", 0.85, "calm")))
        // Never the key of a card / lesson clip.
        assertNotEquals(media.ttsKey("谢谢", 0.85, "cmn-CN-Wavenet-B"), media.conversationKey(ConversationClip("谢谢", "cmn-CN-Wavenet-B", 0.85, "calm")))
    }

    @Test fun linesAreFetchedCachedAndRegenerated() = runBlocking {
        val server = MockWebServer().apply { start() }
        val media = LessonMedia(Files.createTempDirectory("m").toFile(), Api(server.url("").toString().removeSuffix("/")) { "t" })
        val clip = ConversationClip("你好！", "zh-CN-XiaoxiaoNeural", 0.75, "chat")
        server.enqueue(MockResponse().setBody("""{"audio_base64":"SUQz","content_type":"audio/mpeg"}"""))
        val first = media.conversationLine(clip, online = true)
        assertNotNull(first)
        val req = server.takeRequest()
        assertEquals("POST /api/practice/tts", "${req.method} ${req.path}")
        val body = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("conversation", body["kind"]!!.jsonPrimitive.content)
        assertEquals("zh-CN-XiaoxiaoNeural", body["voice_id"]!!.jsonPrimitive.content)
        assertEquals(0.75, body["speed"]!!.jsonPrimitive.content.toDouble())
        assertEquals("chat", body["delivery"]!!.jsonPrimitive.content)
        assertNull(body["regenerate"])

        // Cached: no request.
        assertEquals(first, media.conversationLine(clip, online = true))
        assertEquals(1, server.requestCount)
        // Offline + regenerate: the cached copy plays as it is.
        assertEquals(first, media.conversationLine(clip, online = false, regenerate = true))
        assertEquals(1, server.requestCount)
        // Online + regenerate: made again, the phone's copy overwritten.
        server.enqueue(MockResponse().setBody("""{"audio_base64":"SUQ0","content_type":"audio/mpeg"}"""))
        val again = media.conversationLine(clip, online = true, regenerate = true)
        assertEquals(true, Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject["regenerate"]!!.jsonPrimitive.content.toBoolean())
        assertEquals("ID4", again!!.readText())
        // Failure → the cached copy; offline with nothing cached → null.
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(again, media.conversationLine(clip, online = true, regenerate = true))
        assertNull(media.conversationLine(clip.copy(text = "别的"), online = false))
        server.shutdown()
    }

    @Test fun apiShapes() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        val view = """{"prefs":{"speed":0.7,"delivery":"calm","voices":{},"exercise_voices":{}},"provider":"azure","provider_name":"Azure Speech","default_speed":0.75,"enabled":null,
            "speed_steps":[0.6,0.7,0.75,0.8,0.85,0.9,1],"speed_range":{"min":0.6,"max":1.2},
            "voices":[{"id":"zh-CN-XiaoxiaoNeural","name":"Xiaoxiao 晓晓","gender":"female","note":"Clear","deliveries":["natural","chat","calm","cheerful"]}],
            "deliveries":[{"id":"natural","label":"Natural"}]}"""
        server.enqueue(MockResponse().setBody(view))
        val v = api.conversationAudio()
        assertEquals("azure", v.provider)
        assertEquals(listOf(0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0), v.speed_steps)
        assertEquals(0.7, ConversationAudio.fromJson(v.prefs).speed)
        assertEquals("Azure Speech", v.toOffer().providerName)
        assertEquals("GET /api/conversation-audio", server.takeRequest().let { "${it.method} ${it.path}" })

        server.enqueue(MockResponse().setBody(view))
        api.updateConversationAudio(JsonObject(mapOf("speed" to JsonNull, "delivery" to JsonPrimitive("chat"))))
        val put = server.takeRequest()
        assertEquals("PUT /api/conversation-audio", "${put.method} ${put.path}")
        assertEquals("""{"speed":null,"delivery":"chat"}""", put.body.readUtf8())
        server.shutdown()
    }

    @Test fun meCarriesTheStateAndALocalChoiceAppliesAtOnce() = runBlocking {
        val app: LabApp = ApplicationProvider.getApplicationContext()
        val me = Api("http://localhost") { "t" }.json.decodeFromString(
            MeDto.serializer(),
            """{"id":"u1","conversation_audio":{"prefs":{"speed":null,"delivery":"natural","voices":{"azure":{"male":"zh-CN-YunjianNeural"}},"exercise_voices":{}},"provider":"azure","provider_name":"Azure Speech","default_speed":0.75}}""",
        )
        ConversationAudioCache.put(app.cache, me.conversation_audio!!)
        val state = ConversationAudioCache.get(app.cache)
        assertEquals("azure", state.provider)
        assertEquals(0.75, state.defaultSpeed)

        val controls = LabConversationAudioControls(app)
        val before = controls.resolve(ex)
        assertEquals("azure", before.audio.provider)
        assertEquals("zh-CN-YunjianNeural", before.audio.voices[1])
        assertEquals(listOf(false, true), before.audio.chosen)
        assertEquals(0.75, before.audio.speed)

        val version = ConversationAudioCache.changes.value
        // Offline (no network in tests): applied on this phone, the save reports nothing to show.
        val update = ConversationAudio.speakerVoiceUpdate(before.audio, ex.speakers, 0, "zh-CN-XiaoyiNeural", before.prefs)
        ConversationAudioCache.applyUpdate(app.cache, update)
        ConversationAudioCache.applyUpdate(app.cache, JsonObject(mapOf("speed" to JsonPrimitive(0.9), "delivery" to JsonPrimitive("cheerful"))))
        assertTrue(ConversationAudioCache.changes.value > version)
        val after = controls.resolve(ex).audio
        assertEquals(listOf("zh-CN-XiaoyiNeural", "zh-CN-YunjianNeural"), after.voices)
        assertEquals(0.9, after.speed)
        assertEquals("cheerful", after.delivery)
        assertEquals("some voices only", conversationDeliveryNote(after.copy(voices = listOf("zh-CN-XiaoyiNeural", "zh-CN-YunyangNeural")), "cheerful"))
        assertEquals("these voices speak it naturally", conversationDeliveryNote(after.copy(voices = listOf("zh-CN-XiaochenNeural", "zh-CN-YunyangNeural")), "cheerful"))
        assertNull(conversationDeliveryNote(after, "cheerful"))
        Unit
    }
}
