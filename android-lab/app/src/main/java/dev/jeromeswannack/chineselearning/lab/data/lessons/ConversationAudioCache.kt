package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.ConversationAudio
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudioContext
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudioPrefs
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.core.ResolvedConversationAudio
import dev.jeromeswannack.chineselearning.lab.core.TtsConversation
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationAudioStateDto
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationAudioViewDto
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Conversation audio on this phone (the web's `services/conversationAudio.ts`): the account's
 * preferences + which provider speaks clips now, mirrored from `/api/auth/me`
 * `conversation_audio` by the sync's profile refresh and from the ⚙︎ Audio menu / Settings, so a
 * conversation resolves the same voices / speed / delivery — and so the same cached clips —
 * offline. The Audio menu writes here at once ([applyUpdate]) and PUTs the change.
 */
object ConversationAudioCache {
    const val KEY = "settings/conversation-audio"
    private const val KIND = "settings"

    @Serializable
    private data class Stored(val prefs: JsonElement? = null, val provider: String = "minimax", val provider_name: String? = null, val default_speed: Double? = null)

    /** What a conversation needs: the prefs, the provider and its default speed. */
    data class State(
        val prefs: ConversationAudioPrefs = ConversationAudio.DEFAULT_PREFS,
        val provider: String = "minimax",
        val providerName: String = TtsConversation.PROVIDER_NAMES.getValue("minimax"),
        val defaultSpeed: Double = TtsConversation.DEFAULT_CONVERSATION_RATES.getValue("minimax"),
    )

    private val _changes = MutableStateFlow(0)
    /** Bumped on every write, so an open conversation re-resolves its voices / speed. */
    val changes: StateFlow<Int> = _changes

    suspend fun get(cache: JsonCache): State {
        val s = runCatching { cache.get(KEY, Stored.serializer()) }.getOrNull() ?: return State()
        val provider = s.provider.takeIf { it in TtsConversation.PROVIDERS } ?: "minimax"
        return State(
            prefs = ConversationAudio.fromJson(s.prefs),
            provider = provider,
            providerName = s.provider_name ?: TtsConversation.PROVIDER_NAMES.getValue(provider),
            defaultSpeed = s.default_speed ?: TtsConversation.DEFAULT_CONVERSATION_RATES.getValue(provider),
        )
    }

    private suspend fun write(cache: JsonCache, state: State) {
        cache.put(KEY, KIND, Stored(ConversationAudio.toJson(state.prefs), state.provider, state.providerName, state.defaultSpeed), Stored.serializer())
        _changes.value++
    }

    /** From `/api/auth/me` (sync). */
    suspend fun put(cache: JsonCache, dto: ConversationAudioStateDto) {
        if (dto.prefs == null) return
        val provider = dto.provider.takeIf { it in TtsConversation.PROVIDERS } ?: return
        write(cache, State(ConversationAudio.fromJson(dto.prefs), provider, dto.provider_name ?: TtsConversation.PROVIDER_NAMES.getValue(provider), dto.default_speed ?: TtsConversation.DEFAULT_CONVERSATION_RATES.getValue(provider)))
    }

    /** From `GET|PUT /api/conversation-audio`. */
    suspend fun put(cache: JsonCache, view: ConversationAudioViewDto) =
        put(cache, ConversationAudioStateDto(view.prefs, view.provider, view.provider_name, view.default_speed))

    /** `applyConversationAudioUpdate`: a partial update merged locally (the server's rules). */
    suspend fun applyUpdate(cache: JsonCache, update: JsonObject): State {
        val current = get(cache)
        val next = current.copy(prefs = ConversationAudio.merge(current.prefs, update).prefs)
        write(cache, next)
        return next
    }

    /** `audioForConversation`: the voices, speed and delivery one conversation plays in on this phone. */
    suspend fun resolve(cache: JsonCache, ex: ConversationExercise): ResolvedConversationAudio = resolve(get(cache), ConversationVoiceCache.get(cache), ex)

    fun resolve(state: State, enabled: List<String>?, ex: ConversationExercise): ResolvedConversationAudio =
        ConversationAudio.resolve(ex, ConversationAudioContext(state.provider, state.defaultSpeed, enabled, state.prefs))
}
