package dev.jeromeswannack.chineselearning.lab.ui.settings

import dev.jeromeswannack.chineselearning.lab.core.ConversationVoices
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.conversationVoiceSample
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.saveConversationVoices
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ConversationVoicesTest {
    private val f = "Chinese (Mandarin)_News_Anchor"
    private val m = "Chinese (Mandarin)_Male_Announcer"
    private val m2 = "presenter_male"

    @Test fun theLastVoiceOfAGenderStaysOn() {
        val (next, problem) = VoiceSettingsLogic.toggle(listOf(f, m, m2), f)
        assertNull(next)
        assertEquals("Keep at least one female voice on", problem)
        val (ok, none) = VoiceSettingsLogic.toggle(listOf(f, m, m2), m2)
        assertEquals(listOf(f, m), ok)
        assertNull(none)
        // Turning one on keeps the catalogue order.
        assertEquals(listOf(f, "presenter_female", m), VoiceSettingsLogic.toggle(listOf(m, f), "presenter_female").first)
    }

    @Test fun filtersByGenderStyleAccentAndOnOnly() {
        val base = ConversationVoicesUi(enabled = listOf(f, m))
        assertEquals(ConversationVoices.ALL.size, VoiceSettingsLogic.filter(base).size)
        assertTrue(VoiceSettingsLogic.filter(base.copy(gender = "male")).all { it.gender == "male" })
        assertEquals(listOf(f, m), VoiceSettingsLogic.filter(base.copy(onlyOn = true)).map { it.id })
        assertTrue(VoiceSettingsLogic.filter(base.copy(style = "soft")).none { it.defaultOn })
        assertEquals(listOf("Chinese (Mandarin)_HK_Flight_Attendant"), VoiceSettingsLogic.filter(base.copy(accent = "hong_kong")).map { it.id })
    }

    @Test fun scopeLineSaysWhoseChoiceItIs() {
        assertTrue(VoiceSettingsLogic.scopeLine(ConversationVoicesUi(isAdmin = true)).startsWith("You’re the admin"))
        assertTrue(VoiceSettingsLogic.scopeLine(ConversationVoicesUi(defaultSource = "admin")).startsWith("Using the default chosen by the admin."))
        assertTrue(VoiceSettingsLogic.scopeLine(ConversationVoicesUi()).contains("0.9× speed"))
    }

    @Test fun apiSendsTheSelectionOrAReset() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        server.enqueue(MockResponse().setBody("""{"enabled":["$f","$m"],"customised":true,"default_enabled":[],"default_source":"admin","is_admin":false,"speed":0.9,"voices":[]}"""))
        val saved = api.saveConversationVoices(listOf(f, m))
        assertEquals(listOf(f, m), saved.enabled)
        assertEquals("admin", saved.default_source)
        val put = server.takeRequest()
        assertEquals("PUT /api/conversation-voices", "${put.method} ${put.path}")
        assertEquals("""{"enabled":["$f","$m"]}""", put.body.readUtf8())

        server.enqueue(MockResponse().setBody("""{"enabled":[],"customised":false}"""))
        api.saveConversationVoices(null)
        assertEquals("""{"reset":true}""", server.takeRequest().body.readUtf8())

        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"x","problems":["Keep at least one male voice on"]}"""))
        try {
            api.saveConversationVoices(listOf(f))
            fail("expected a 400")
        } catch (e: HttpException) {
            assertEquals(listOf("Keep at least one male voice on"), e.problems())
        }
        server.takeRequest()

        server.enqueue(MockResponse().setBody("""{"audio_base64":"SUQz","content_type":"audio/mpeg"}"""))
        assertEquals("SUQz", api.conversationVoiceSample(f).audio_base64)
        assertEquals("/api/conversation-voices/sample?voice=Chinese%20%28Mandarin%29_News_Anchor", server.takeRequest().path)
        server.shutdown()
    }
}
