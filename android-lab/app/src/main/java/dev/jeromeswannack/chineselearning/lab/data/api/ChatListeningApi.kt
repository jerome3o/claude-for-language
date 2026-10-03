package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

// Chat listening mode (docs/CHAT.md "Listening mode"; worker routes/chat-listening.ts).

/** One conversation's stored setting. */
@Serializable
data class ListeningRowDto(val conversation_id: String, val on: Boolean = false, val since: String? = null, val updated_at: String = "")

/** `GET /api/me/chat-listening` — also what the phone keeps (JsonCache `chat/listening/state`). */
@Serializable
data class ListeningStateDto(val default_on: Boolean = false, val conversations: List<ListeningRowDto> = emptyList())

/** `PUT /api/conversations/:id/listening` (idempotent: the whole setting). */
@Serializable
data class ListeningBody(val on: Boolean, val since: String? = null)

@Serializable
data class ListeningDefaultBody(val on: Boolean)

@Serializable
data class ListeningDefaultDto(val default_on: Boolean = false)

@Serializable
data class ChatClipDto(val message_id: String, val conversation_id: String = "", val clip: String? = null)

@Serializable
data class ChatClipsDto(val clips: List<ChatClipDto> = emptyList())

suspend fun Api.chatListening(): ListeningStateDto = get("/api/me/chat-listening")

fun chatListeningPath(conversationId: String): String = "/api/conversations/${enc(conversationId)}/listening"

suspend fun Api.setChatListening(conversationId: String, on: Boolean, since: String?): ListeningRowDto = put(chatListeningPath(conversationId), ListeningBody(on, since))

const val CHAT_LISTENING_DEFAULT_PATH = "/api/profile/chat-listening"

suspend fun Api.setChatListeningDefault(on: Boolean): ListeningDefaultDto = put(CHAT_LISTENING_DEFAULT_PATH, ListeningDefaultBody(on))

/** `GET /api/me/chat-clips` — the newest ready clips of the other person's messages, per chat. */
suspend fun Api.chatClips(perConversation: Int? = null): ChatClipsDto =
    get("/api/me/chat-clips" + (perConversation?.let { "?per_conversation=$it" } ?: ""))

/** A message read aloud: the mp3 and its clip id (`X-Clip-Id`, "" when the server didn't say). */
class MessageAudio(val bytes: ByteArray, val clipId: String?)

/** `GET /api/messages/:id/audio` — made on demand when missing; 410 for a deleted message. */
suspend fun Api.messageAudio(messageId: String): MessageAudio = withContext(Dispatchers.IO) {
    http.newCall(request("/api/messages/${enc(messageId)}/audio").get().build()).execute().use { res ->
        if (res.code == 401) throw UnauthorizedException()
        if (!res.isSuccessful) {
            val body = res.body?.string().orEmpty()
            throw HttpException(res.code, body.take(200), body)
        }
        MessageAudio(res.body!!.bytes(), res.header("X-Clip-Id")?.takeIf { it.isNotBlank() })
    }
}
