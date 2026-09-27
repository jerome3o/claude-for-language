package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/* Settings → Conversation voices (web: pages/ConversationVoicesPage.tsx, worker routes/conversation-voices.ts). */

@Serializable
data class ConversationVoiceSettingsDto(
    val enabled: List<String> = emptyList(),
    val customised: Boolean = false,
    val default_enabled: List<String> = emptyList(),
    /** "admin" | "app" */
    val default_source: String = "app",
    val is_admin: Boolean = false,
    val speed: Double = 0.9,
)

@Serializable data class VoiceSampleDto(val audio_base64: String, val content_type: String = "audio/mpeg")

/** GET /api/conversation-voices — the catalogue (the Lab uses its own parity-tested copy) + this account's selection. */
suspend fun Api.conversationVoiceSettings(): ConversationVoiceSettingsDto = get("/api/conversation-voices")

/** PUT /api/conversation-voices — `{ enabled }` (≥ 1 female + ≥ 1 male; a 400 carries `problems`), or null = `{ reset: true }`. */
suspend fun Api.saveConversationVoices(enabled: List<String>?): ConversationVoiceSettingsDto =
    put<JsonObject, ConversationVoiceSettingsDto>(
        "/api/conversation-voices",
        if (enabled == null) buildJsonObject { put("reset", JsonPrimitive(true)) }
        else buildJsonObject { putJsonArray("enabled") { enabled.forEach { add(JsonPrimitive(it)) } } },
    )

/** GET /api/conversation-voices/sample?voice= — the sample line in one voice (made once server-side, kept in R2). */
suspend fun Api.conversationVoiceSample(voiceId: String): VoiceSampleDto = get("/api/conversation-voices/sample?voice=${enc(voiceId)}")
