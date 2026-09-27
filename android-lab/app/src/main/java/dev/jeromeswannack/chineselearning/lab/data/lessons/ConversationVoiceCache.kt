package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer

/**
 * The account's conversation voices on this phone (the web's `services/conversationVoices.ts`):
 * mirrored from `/api/auth/me` `conversation_voices` by the sync's profile refresh and from
 * Settings → Conversation voices, so a conversation resolves the same voices offline and the
 * prefetched clips are the ones it plays. Null = nothing cached (the shipped defaults apply).
 */
object ConversationVoiceCache {
    const val KEY = "settings/conversation-voices"
    private const val KIND = "settings"
    private val serializer = ListSerializer(String.serializer())

    suspend fun get(cache: JsonCache): List<String>? = runCatching { cache.get(KEY, serializer) }.getOrNull()

    suspend fun put(cache: JsonCache, enabled: List<String>) = cache.put(KEY, KIND, enabled, serializer)
}
