package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer

// The tutor-student / Claude chat (package E; web: pages/ChatPage.tsx, InteractiveMessage,
// MessageDiscussionModal, api/client.ts). Sending needs a connection — like the web, nothing is queued.

@Serializable
data class ChatSenderDto(val id: String = "", val name: String? = null, val picture_url: String? = null)

@Serializable
data class ChatReplyToDto(val id: String, val content: String = "", val sender: ChatSenderDto = ChatSenderDto(), val deleted_at: String? = null)

@Serializable
data class ReactionUserDto(val id: String, val name: String? = null)

@Serializable
data class ReactionDto(val emoji: String, val users: List<ReactionUserDto> = emptyList(), val count: Int = 0)

@Serializable
data class ChatMessageDto(
    val id: String,
    val conversation_id: String = "",
    val sender_id: String = "",
    val content: String = "",
    val created_at: String = "",
    val check_status: String? = null,
    val check_feedback: String? = null,
    val recording_url: String? = null,
    val reply_to_message_id: String? = null,
    val translation: String? = null,
    val segmentation: String? = null,
    val sender: ChatSenderDto = ChatSenderDto(),
    val reply_to: ChatReplyToDto? = null,
    val reactions: List<ReactionDto> = emptyList(),
    val has_discussion: Boolean = false,
    // ---- PR 2 (docs/CHAT.md): rich messages ----
    /** The sender's idempotency key: a pending bubble with this client id is replaced by this message. */
    val client_id: String? = null,
    /** Set on any change after creation (the `?since=` cursor covers it). */
    val updated_at: String? = null,
    val edited_at: String? = null,
    /** Soft delete: content '' and no attachment — rendered "Message deleted". */
    val deleted_at: String? = null,
    val attachment: ChatAttachmentDto? = null,
    /** `/api/chat-media/<messageId>` when there is an attachment (authenticated GET). */
    val media_url: String? = null,
    val pinned_at: String? = null,
    val pinned_by: String? = null,
    // ---- PR 3 (docs/CHAT.md): learning tools ----
    /** Word chips (`{ text, pinyin, gloss }`) concatenating to the text — null until split / when stale. */
    val words: List<ReaderWordDto>? = null,
    /** content | transcript (the words split `attachment.transcript`). */
    val words_source: String? = null,
    /** The tutor's correction of this (the student's text) message. */
    val correction: ChatCorrectionDto? = null,
    // ---- round 2 PR 3 ----
    /** The message this one was forwarded from — shown as "↪ Forwarded". */
    val forwarded_from: String? = null,
    // ---- listening mode (docs/CHAT.md "Listening mode") ----
    /** The pre-generated read-aloud clip (`<msg>-<hash>`), null until made / after an edit (`GET /api/messages/:id/audio`). */
    val audio_clip: String? = null,
) {
    val isDeleted: Boolean get() = !deleted_at.isNullOrEmpty()
    val isImage: Boolean get() = !isDeleted && attachment?.kind == "image"
    val isVoice: Boolean get() = !isDeleted && attachment?.kind == "voice"
    val isFile: Boolean get() = !isDeleted && attachment?.kind == "file"
    val isVideo: Boolean get() = !isDeleted && attachment?.kind == "video"
    val isForwarded: Boolean get() = !forwarded_from.isNullOrEmpty() && !isDeleted
}

/**
 * `ChatAttachment` (docs/CHAT.md PR 2): a photo or a voice message; round 2 PR 3 adds `file`
 * ([name], ≤ 20 MB) and `video` (duration / width / height as the sender's device measured them,
 * 0 = unknown).
 */
@Serializable
data class ChatAttachmentDto(
    val kind: String = "",
    val width: Int = 0,
    val height: Int = 0,
    val bytes: Long = 0,
    val mime: String = "",
    val duration_ms: Long = 0,
    /** pending | done | failed (voice). */
    val transcript_status: String? = null,
    val transcript: String? = null,
    val translation: String? = null,
    /** A file's name (kind file; round 2 PR 3). */
    val name: String? = null,
)

/** How far each side has read (`last_read_at`, ISO); `other` drives "Seen". */
@Serializable
data class ReadStateDto(val me: String? = null, val other: String? = null)

@Serializable
data class MessagesDto(val messages: List<ChatMessageDto> = emptyList(), val latest_timestamp: String? = null, val read_state: ReadStateDto? = null)

suspend fun Api.chatMessages(conversationId: String, since: String? = null): MessagesDto =
    get("/api/conversations/${enc(conversationId)}/messages" + (since?.let { "?since=${enc(it)}" } ?: ""))

@Serializable
data class SendMessageBody(val content: String, val reply_to_message_id: String? = null, val client_id: String? = null)

/** [clientId] makes the send idempotent (docs/CHAT.md §2): a retry returns the same message. */
suspend fun Api.sendChatMessage(conversationId: String, content: String, replyTo: String?, clientId: String? = null): ChatMessageDto =
    post("/api/conversations/${enc(conversationId)}/messages", SendMessageBody(content, replyTo, clientId))

@Serializable
data class AIRespondDto(val message: ChatMessageDto, val audio_base64: String? = null, val audio_content_type: String? = null)

suspend fun Api.aiRespond(conversationId: String): AIRespondDto = exchange("POST", "/api/conversations/${enc(conversationId)}/ai-respond", "{}", AIRespondDto.serializer())

@Serializable
data class ConversationTtsBody(val text: String, val voice_id: String? = null, val voice_speed: Double? = null, val message_id: String? = null)

@Serializable
data class ConversationTtsDto(val audio_base64: String, val content_type: String = "audio/mpeg")

/**
 * The fallback read-aloud: with [messageId] the server resolves the voice itself (shared/chats/voice.ts);
 * chat read-aloud normally goes through `/api/practice/tts` with the voice resolved on the phone.
 */
suspend fun Api.conversationTts(conversationId: String, text: String, voiceId: String?, speed: Double?, messageId: String? = null): ConversationTtsDto =
    post("/api/conversations/${enc(conversationId)}/tts", ConversationTtsBody(text, voiceId, speed, messageId))

/** A card Claude suggests (GeneratedNoteWithContext). */
@Serializable
data class SuggestedCard(
    val hanzi: String,
    val pinyin: String = "",
    val english: String = "",
    val fun_facts: String? = null,
    val context: String? = null,
)

@Serializable
data class CheckResultDto(val status: String, val feedback: String = "", val corrections: List<SuggestedCard>? = null)

suspend fun Api.checkChatMessage(messageId: String): CheckResultDto = exchange("POST", "/api/messages/${enc(messageId)}/check", "{}", CheckResultDto.serializer())

@Serializable
data class TranslateCardDto(val translation: String = "", val flashcard: SuggestedCard)

suspend fun Api.translateMessageCard(messageId: String): TranslateCardDto = post("/api/messages/${enc(messageId)}/translate-flashcard")

@Serializable
data class SegmentChunk(val hanzi: String, val pinyin: String = "", val english: String = "")

@Serializable
data class ChatBreakdownDto(val hanzi: String = "", val pinyin: String = "", val english: String = "", val chunks: List<SegmentChunk> = emptyList())

@Serializable
data class SegmentedDto(val translation: String = "", val segmentation: ChatBreakdownDto)

suspend fun Api.translateSegmented(messageId: String): SegmentedDto = post("/api/messages/${enc(messageId)}/translate-segmented")

@Serializable
data class ResponseOptionsBody(val intendedMeaning: String, val guess: String? = null)

@Serializable
data class ResponseOptionsDto(val explanation: String? = null, val options: List<SuggestedCard> = emptyList())

suspend fun Api.responseOptions(conversationId: String, intended: String, guess: String?): ResponseOptionsDto =
    post("/api/conversations/${enc(conversationId)}/generate-response-options", ResponseOptionsBody(intended, guess))

@Serializable
data class ReactionBody(val emoji: String)

@Serializable
data class ReactionAnswer(val added: Boolean = false)

suspend fun Api.toggleReaction(messageId: String, emoji: String): ReactionAnswer = post("/api/messages/${enc(messageId)}/reactions", ReactionBody(emoji))

@Serializable
data class TitleBody(val title: String)

suspend fun Api.renameConversation(conversationId: String, title: String): ChatConversationDto = patch("/api/conversations/${enc(conversationId)}", TitleBody(title))

@Serializable
data class VoiceSettingsBody(val voice_id: String? = null, val voice_speed: Double? = null)

suspend fun Api.setVoiceSettings(conversationId: String, voiceId: String?, speed: Double?): ChatConversationDto =
    patch("/api/conversations/${enc(conversationId)}/voice-settings", VoiceSettingsBody(voiceId, speed))

// ---------------- Discuss with Claude ----------------

@Serializable
data class DiscussionTurn(val role: String, val content: String)

@Serializable
data class DiscussionDto(val id: String? = null, val messages: List<DiscussionTurn> = emptyList())

suspend fun Api.messageDiscussion(messageId: String): DiscussionDto = get("/api/messages/${enc(messageId)}/discussion")

@Serializable
data class SaveDiscussionBody(val messages: List<DiscussionTurn>)

suspend fun Api.saveMessageDiscussion(messageId: String, turns: List<DiscussionTurn>): Unit =
    exchange("PUT", "/api/messages/${enc(messageId)}/discussion", encode(SaveDiscussionBody(turns)), Unit.serializer())

@Serializable
data class DiscussBody(val question: String, val conversationHistory: List<DiscussionTurn>? = null)

@Serializable
data class DiscussAnswer(val response: String = "", val flashcards: List<SuggestedCard>? = null)

suspend fun Api.discussMessage(messageId: String, question: String, history: List<DiscussionTurn>?): DiscussAnswer =
    post("/api/messages/${enc(messageId)}/discuss", DiscussBody(question, history))

// ---------------- saving cards ----------------

/** POST /api/decks/:id/notes with the chat's `context` (the content service makes the cards + audio). */
@Serializable
data class ChatNoteBody(val hanzi: String, val pinyin: String, val english: String, val fun_facts: String? = null, val context: String? = null)

@Serializable
data class CreatedNoteDto(val id: String = "")

suspend fun Api.addChatNote(deckId: String, card: ChatNoteBody): CreatedNoteDto = post("/api/decks/${enc(deckId)}/notes", card)

// ---------------- PR 2: edit / delete / pin / media ----------------

@Serializable
data class EditMessageBody(val content: String)

/** `PATCH /api/messages/:id` — sender only; returns the updated message. */
suspend fun Api.editChatMessage(messageId: String, content: String): ChatMessageDto = patch("/api/messages/${enc(messageId)}", EditMessageBody(content))

/** `DELETE /api/messages/:id` — sender only; soft delete (idempotent); returns the deleted message. */
suspend fun Api.deleteChatMessage(messageId: String): ChatMessageDto = exchange("DELETE", "/api/messages/${enc(messageId)}", null, ChatMessageDto.serializer())

@Serializable
data class PinBody(val pinned: Boolean)

/** `POST /api/messages/:id/pin` — either participant; returns the updated message. */
suspend fun Api.pinChatMessage(messageId: String, pinned: Boolean): ChatMessageDto = post("/api/messages/${enc(messageId)}/pin", PinBody(pinned))

/**
 * `POST /api/conversations/:id/media?kind=image|voice&client_id=&caption=&reply_to_message_id=&duration_ms=` —
 * the raw body is the photo / recording. Queued through the outbox (enqueueRaw), so the path carries everything.
 */
fun chatMediaUploadPath(
    conversationId: String,
    kind: String,
    clientId: String,
    caption: String? = null,
    replyTo: String? = null,
    durationMs: Long? = null,
    /** A file's name (kind file). */
    name: String? = null,
    /** A video's shape (kind video; 0 / null = unknown). */
    width: Int? = null,
    height: Int? = null,
): String =
    buildString {
        append("/api/conversations/${enc(conversationId)}/media?kind=${enc(kind)}&client_id=${enc(clientId)}")
        if (!caption.isNullOrBlank()) append("&caption=${enc(caption)}")
        if (replyTo != null) append("&reply_to_message_id=${enc(replyTo)}")
        if (durationMs != null) append("&duration_ms=$durationMs")
        if (!name.isNullOrEmpty()) append("&name=${enc(name)}")
        if (width != null && width > 0) append("&width=$width")
        if (height != null && height > 0) append("&height=$height")
    }

/** `POST /api/messages/:id/forward` (round 2 PR 3): idempotent by [client_id]. */
@Serializable
data class ForwardBody(val conversation_id: String, val client_id: String)

fun chatForwardPath(messageId: String): String = "/api/messages/${enc(messageId)}/forward"

/** Downloads `GET /api/chat-media/:id` (or the message's [mediaUrl]) into [dest] with the session's auth. */
suspend fun Api.downloadChatMedia(mediaUrl: String, dest: java.io.File): Unit = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    http.newCall(request(mediaUrl).get().build()).execute().use { res ->
        if (res.code == 401) throw dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException()
        if (!res.isSuccessful) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(res.code, "media ${res.code}", null)
        dest.parentFile?.mkdirs()
        val tmp = java.io.File(dest.parentFile, dest.name + ".part")
        res.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
        if (!tmp.renameTo(dest)) { tmp.copyTo(dest, overwrite = true); tmp.delete() }
    }
}

// A new deck from the picker: Api.createDeck (DecksApi.kt, package C).

/** The MiniMax voices a Claude conversation can speak with (web: MINIMAX_VOICES). */
val MINIMAX_VOICES: List<Pair<String, String>> = listOf(
    "Chinese (Mandarin)_Gentleman" to "Gentleman (Male, Formal)",
    "Chinese (Mandarin)_Male_Announcer" to "Male Announcer",
    "Chinese (Mandarin)_Southern_Young_Man" to "Southern Young Man",
    "Chinese (Mandarin)_Gentle_Youth" to "Gentle Youth (Male)",
    "Chinese (Mandarin)_Straightforward_Boy" to "Straightforward Boy",
    "Chinese (Mandarin)_Pure-hearted_Boy" to "Pure-hearted Boy",
    "Chinese (Mandarin)_Unrestrained_Young_Man" to "Unrestrained Young Man",
    "Chinese (Mandarin)_Sincere_Adult" to "Sincere Adult (Male)",
    "Chinese (Mandarin)_Humorous_Elder" to "Humorous Elder (Male)",
    "Chinese (Mandarin)_Kind-hearted_Elder" to "Kind-hearted Elder (Male)",
    "Chinese (Mandarin)_Gentle_Senior" to "Gentle Senior (Male)",
    "Chinese (Mandarin)_Sweet_Lady" to "Sweet Lady",
    "Chinese (Mandarin)_Wise_Women" to "Wise Woman",
    "Chinese (Mandarin)_Warm_Bestie" to "Warm Bestie (Female)",
    "Chinese (Mandarin)_Warm_Girl" to "Warm Girl",
    "Chinese (Mandarin)_Crisp_Girl" to "Crisp Girl",
    "Chinese (Mandarin)_Soft_Girl" to "Soft Girl",
    "Chinese (Mandarin)_IntellectualGirl" to "Intellectual Girl",
    "Chinese (Mandarin)_Cute_Spirit" to "Cute Spirit (Female)",
    "Chinese (Mandarin)_Lyrical_Voice" to "Lyrical Voice (Female)",
    "Chinese (Mandarin)_Kind-hearted_Antie" to "Kind-hearted Auntie",
    "Chinese (Mandarin)_News_Anchor" to "News Anchor",
    "Chinese (Mandarin)_Radio_Host" to "Radio Host",
)

// ---------------- PR 3: learning tools in the chat (docs/CHAT.md) ----------------

/** `{ text, note, by, at }` — the tutor's corrected version of a message. */
@Serializable
data class ChatCorrectionDto(val text: String = "", val note: String? = null, val by: String = "", val at: String = "")

@Serializable
data class MessageWordsDto(val words: List<ReaderWordDto>? = null, val source: String? = null, val cached: Boolean = false)

/** `POST /api/messages/:id/words` — the message's word chips, made now when missing (null = no Chinese / not transcribed). */
suspend fun Api.messageWords(messageId: String): MessageWordsDto = post("/api/messages/${enc(messageId)}/words")

@Serializable
data class ProposeFlashcardsBody(val message_ids: List<String>? = null, val since: String? = null, val focus: String? = null)

@Serializable
data class ProposedCardDto(
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val fun_facts: String = "",
    val sentence_clue: String? = null,
    val sentence_clue_pinyin: String? = null,
    val sentence_clue_translation: String? = null,
    val already_have: Boolean = false,
    val source_message_id: String? = null,
)

@Serializable
data class ProposedCardsDto(val cards: List<ProposedCardDto> = emptyList())

/** `POST /api/conversations/:id/flashcards/propose` — Claude's cards from these messages (nothing saved). */
suspend fun Api.proposeChatFlashcards(conversationId: String, body: ProposeFlashcardsBody): ProposedCardsDto =
    post("/api/conversations/${enc(conversationId)}/flashcards/propose", body)

@Serializable
data class CorrectionBody(val text: String, val note: String? = null)

/** `PUT /api/messages/:id/correction` — the tutor's correction (returns the message). */
suspend fun Api.setMessageCorrection(messageId: String, text: String, note: String?): ChatMessageDto =
    exchange("PUT", "/api/messages/${enc(messageId)}/correction", encode(CorrectionBody(text, note)), ChatMessageDto.serializer())

suspend fun Api.clearMessageCorrection(messageId: String): ChatMessageDto =
    exchange("DELETE", "/api/messages/${enc(messageId)}/correction", null, ChatMessageDto.serializer())

@Serializable
data class BatchNotesBody(val notes: List<NewNoteBody>)

@Serializable
data class BatchFailureDto(val index: Int = 0, val hanzi: String = "", val error: String = "")

@Serializable
data class BatchCreatedDto(val id: String = "")

@Serializable
data class BatchNotesDto(val created: List<BatchCreatedDto> = emptyList(), val failed: List<BatchFailureDto> = emptyList())

/** `POST /api/decks/:id/notes/batch` — every row stands alone; failures come back by index. */
suspend fun Api.addNotesBatch(deckId: String, notes: List<NewNoteBody>): BatchNotesDto = post("/api/decks/${enc(deckId)}/notes/batch", BatchNotesBody(notes))

@Serializable
data class CoachSentenceBody(val sentence: String)

/** `POST /api/sentence/coach` — the composer's ✓ "Check my Chinese" (correction + short critique). */
suspend fun Api.coachDraft(sentence: String): CoachResultDto = post("/api/sentence/coach", CoachSentenceBody(sentence))
