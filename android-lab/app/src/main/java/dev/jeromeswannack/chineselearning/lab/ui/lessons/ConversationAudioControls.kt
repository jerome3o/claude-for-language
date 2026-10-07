package dev.jeromeswannack.chineselearning.lab.ui.lessons

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationAudioViewDto
import dev.jeromeswannack.chineselearning.lab.data.api.conversationAudio
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.updateConversationAudio
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationAudioCache
import dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationVoiceCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

/** The server's view → what the menu offers. */
fun ConversationAudioViewDto.toOffer(): ConversationAudioOffer {
    val bundled = ConversationAudioOffer.bundled(provider, provider_name ?: ConversationAudioOffer.bundled(provider).providerName)
    return ConversationAudioOffer(
        providerName = bundled.providerName,
        speedSteps = speed_steps.ifEmpty { bundled.speedSteps },
        voices = voices.map { ConversationAudioVoiceOption(it.id, it.name, it.gender, it.note) }.ifEmpty { bundled.voices },
    )
}

/**
 * [ConversationAudioControls] for a real run (the web's services/conversationAudio.ts + the
 * sheet's save): cached prefs from [ConversationAudioCache], `GET|PUT /api/conversation-audio`,
 * analytics through [Analytics].
 */
class LabConversationAudioControls(private val app: LabApp) : ConversationAudioControls {
    override val online: StateFlow<Boolean> get() = app.online
    override val changes: StateFlow<Int> get() = ConversationAudioCache.changes

    override suspend fun resolve(ex: ConversationExercise): ConversationAudioNow {
        val state = ConversationAudioCache.get(app.cache)
        val audio = ConversationAudioCache.resolve(state, ConversationVoiceCache.get(app.cache), ex)
        return ConversationAudioNow(audio, state.prefs, state.providerName)
    }

    override suspend fun refresh(): ConversationAudioOffer? = try {
        val view = withContext(Dispatchers.IO) { app.repo.api.conversationAudio() }
        ConversationAudioCache.put(app.cache, view)
        view.toOffer()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    override suspend fun save(update: JsonObject): Pair<String?, ConversationAudioOffer?> {
        ConversationAudioCache.applyUpdate(app.cache, update)
        if (!app.online.value) return null to null
        return try {
            val view = withContext(Dispatchers.IO) { app.repo.api.updateConversationAudio(update) }
            ConversationAudioCache.put(app.cache, view)
            null to view.toOffer()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            ((e as? HttpException)?.problems()?.firstOrNull() ?: "Could not save — it applies on this phone only for now (${e.userMessage()})") to null
        }
    }

    override fun track(event: String, props: Map<String, Any?>) = Analytics.track(event, props)
}
