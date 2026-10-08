package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// Chat delivery (docs/CHAT.md §2): read markers, the inbox for background checks / socket
// catch-up, FCM device tokens and the live socket's ticket. Used by data/chat/.

@Serializable
data class ChatReadBody(val up_to: String? = null)

@Serializable
data class ChatReadDto(val conversation_id: String = "", val last_read_at: String? = null, val unread: Int = 0)

/** `POST /api/conversations/:id/read` — moves my read marker forward (never back). */
suspend fun Api.markChatRead(conversationId: String, upTo: String? = null): ChatReadDto =
    post("/api/conversations/${enc(conversationId)}/read", ChatReadBody(upTo))

fun chatReadPath(conversationId: String) = "/api/conversations/${enc(conversationId)}/read"
fun chatMessagesPath(conversationId: String) = "/api/conversations/${enc(conversationId)}/messages"

@Serializable
data class InboxMessageDto(
    val id: String,
    val conversation_id: String = "",
    val relationship_id: String = "",
    val content: String = "",
    val created_at: String = "",
    val sender: ChatSenderDto = ChatSenderDto(),
    /** PR 2: image | voice | null, and the notification text ("📷 Photo: caption", "🎤 Voice message"). */
    val attachment_kind: String? = null,
    val preview: String? = null,
    /** A photo album's first photo stands for it ("📷 3 photos", docs/CHAT.md "Photo albums"). */
    val album_id: String? = null,
    val album_count: Int? = null,
)

@Serializable
data class InboxConversationDto(
    val conversation_id: String,
    val relationship_id: String = "",
    val title: String? = null,
    val other_user: ChatSenderDto = ChatSenderDto(),
    val unread: Int = 0,
    val last_read_at: String? = null,
    val last_message_at: String? = null,
)

@Serializable
data class ChatInboxDto(
    val server_time: String? = null,
    val messages: List<InboxMessageDto> = emptyList(),
    val conversations: List<InboxConversationDto> = emptyList(),
)

/** `GET /api/me/chat-inbox?since=` — unread messages to me, oldest first (≤ 50), + conversations with unread. */
suspend fun Api.chatInbox(since: String?): ChatInboxDto =
    get("/api/me/chat-inbox" + (since?.let { "?since=${enc(it)}" } ?: ""))

@Serializable
data class PushDeviceBody(val token: String, val platform: String = "android", val app: String = "lab", val device_label: String? = null)

@Serializable
data class PushDeviceTokenBody(val token: String)

const val PUSH_DEVICES_PATH = "/api/push/devices"

@Serializable
data class LiveTicketDto(val ticket: String, val ws_path: String = "/api/live/ws")

/** `POST /api/live/ticket` — a one-minute ticket for the ChatHub socket. */
suspend fun Api.liveTicket(): LiveTicketDto = post("/api/live/ticket")
