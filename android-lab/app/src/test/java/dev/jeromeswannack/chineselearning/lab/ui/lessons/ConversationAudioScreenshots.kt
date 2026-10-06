package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudio
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudioContext
import dev.jeromeswannack.chineselearning.lab.core.ConversationVoices
import dev.jeromeswannack.chineselearning.lab.core.TtsConversation
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.settings.ConversationAudioDefaultsUi
import dev.jeromeswannack.chineselearning.lab.ui.settings.ConversationVoicesActions
import dev.jeromeswannack.chineselearning.lab.ui.settings.ConversationVoicesScreen
import dev.jeromeswannack.chineselearning.lab.ui.settings.ConversationVoicesUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test

/** The ⚙︎ Audio sheet on a conversation (MiniMax, a voice list open, Azure, offline) and Settings → Conversation voices' speed + delivery. */
class ConversationAudioScreenshots : LabScreenshotTest() {
    private val ex = LessonSamples.conversation

    private fun now(provider: String, update: JsonObject? = null): ConversationAudioNow {
        val prefs = update?.let { ConversationAudio.merge(ConversationAudio.DEFAULT_PREFS, it).prefs } ?: ConversationAudio.DEFAULT_PREFS
        val audio = ConversationAudio.resolve(ex, ConversationAudioContext(provider, TtsConversation.DEFAULT_CONVERSATION_RATES.getValue(provider), null, prefs))
        return ConversationAudioNow(audio, prefs)
    }

    /** MiniMax as the server offers it: the account's enabled voices only. */
    private val minimaxOffer = ConversationAudioOffer.bundled("minimax").let { o -> o.copy(voices = o.voices.filter { it.id in ConversationVoices.DEFAULT_IDS }) }

    @Composable
    private fun SheetFrame(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.BottomCenter) {
            Box(Modifier.fillMaxWidth().heightIn(max = 760.dp).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)) { content() }
        }
    }

    @Test fun minimax() = shoot("convo-audio-01-minimax") {
        SheetFrame { ConversationAudioSheetContent(ConversationAudioSheetUi(ex.speakers, now("minimax"), minimaxOffer, online = true), ConversationAudioSheetActions()) }
    }

    @Test fun voiceOpen() = shoot("convo-audio-02-voice-list") {
        val update = JsonObject(
            mapOf(
                "speed" to JsonPrimitive(0.7),
                "delivery" to JsonPrimitive("calm"),
                "voices" to JsonObject(mapOf("minimax" to JsonObject(mapOf("male" to JsonPrimitive("Chinese (Mandarin)_Gentle_Youth"))))),
            ),
        )
        SheetFrame { ConversationAudioSheetContent(ConversationAudioSheetUi(ex.speakers, now("minimax", update), minimaxOffer, online = true, openSpeaker = 1), ConversationAudioSheetActions()) }
    }

    @Test fun azure() = shoot("convo-audio-03-azure") {
        val update = JsonObject(
            mapOf(
                "delivery" to JsonPrimitive("chat"),
                "voices" to JsonObject(mapOf("azure" to JsonObject(mapOf("female" to JsonPrimitive("zh-CN-XiaochenNeural"))))),
            ),
        )
        SheetFrame { ConversationAudioSheetContent(ConversationAudioSheetUi(ex.speakers, now("azure", update), ConversationAudioOffer.bundled("azure"), online = true), ConversationAudioSheetActions()) }
    }

    @Test fun offline() = shoot("convo-audio-04-offline") {
        SheetFrame { ConversationAudioSheetContent(ConversationAudioSheetUi(ex.speakers, now("minimax"), ConversationAudioOffer.bundled("minimax"), online = false), ConversationAudioSheetActions()) }
    }

    @Test fun dark() = shoot("convo-audio-05-dark", dark = true) {
        SheetFrame { ConversationAudioSheetContent(ConversationAudioSheetUi(ex.speakers, now("google"), ConversationAudioOffer.bundled("google"), online = true, regenerating = true, error = "Could not save — it applies on this phone only for now"), ConversationAudioSheetActions()) }
    }

    @Test fun settings() = shoot("convo-audio-06-settings") {
        ConversationVoicesScreen(
            ConversationVoicesUi(
                enabled = ConversationVoices.DEFAULT_IDS,
                loaded = true,
                audio = ConversationAudioDefaultsUi(provider = "azure", providerName = "Azure Speech", speed = 0.7, isDefault = false, steps = TtsConversation.speedSteps("azure"), delivery = "calm", loaded = true),
            ),
            ConversationVoicesActions(onBack = {}),
        )
    }
}
