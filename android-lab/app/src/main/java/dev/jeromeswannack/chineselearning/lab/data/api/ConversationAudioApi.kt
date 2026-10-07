package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/*
 * Conversation audio — the ⚙︎ Audio menu on a conversation exercise and Settings → Conversation
 * voices (web: api/client.ts getConversationAudio / updateConversationAudio /
 * generateConversationLineTTS; worker routes/conversation-voices.ts, docs/AUDIO.md
 * "Conversation audio"). The pure rules are core ConversationAudio / TtsConversation.
 */

/** `/api/auth/me` → `conversation_audio`: the account's preferences + where clips come from now. */
@Serializable
data class ConversationAudioStateDto(
    /** ConversationAudioPrefs JSON (core ConversationAudio.fromJson). */
    val prefs: JsonElement? = null,
    val provider: String = "minimax",
    val provider_name: String? = null,
    val default_speed: Double? = null,
)

@Serializable
data class ConversationAudioVoiceDto(
    val id: String,
    val name: String,
    val gender: String,
    val note: String = "",
    val deliveries: List<String> = emptyList(),
)

/** GET|PUT /api/conversation-audio. */
@Serializable
data class ConversationAudioViewDto(
    val prefs: JsonElement? = null,
    val provider: String = "minimax",
    val provider_name: String? = null,
    val default_speed: Double? = null,
    val enabled: List<String>? = null,
    val speed_steps: List<Double> = emptyList(),
    val voices: List<ConversationAudioVoiceDto> = emptyList(),
)

suspend fun Api.conversationAudio(): ConversationAudioViewDto = get("/api/conversation-audio")

/** A partial update (core ConversationAudio.merge rules; a 400 carries `problems`) → the same view. */
suspend fun Api.updateConversationAudio(update: JsonObject): ConversationAudioViewDto =
    put<JsonObject, ConversationAudioViewDto>("/api/conversation-audio", update)

@Serializable
data class ConversationLineTtsBody(
    val text: String,
    val voice_id: String,
    /** The provider's own rate (core TtsConversation.clampRate). */
    val speed: Double,
    /** Always "conversation" (no default: the API's Json doesn't encode defaults). */
    val kind: String,
    val delivery: String,
    /** Make it again server-side (the Audio menu's "Regenerate"); omitted otherwise. */
    val regenerate: Boolean? = null,
)

/** POST /api/practice/tts kind=conversation — one conversation line in its voice / rate / delivery. */
suspend fun Api.conversationLineTts(text: String, voice: String, speed: Double, delivery: String, regenerate: Boolean): PracticeTtsDto =
    post("/api/practice/tts", ConversationLineTtsBody(text, voice, speed, kind = "conversation", delivery = delivery, regenerate = if (regenerate) true else null))
