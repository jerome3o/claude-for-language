package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer

// The tutor-student / Claude chat (package E; web: pages/ChatPage.tsx, InteractiveMessage,
// MessageDiscussionModal, api/client.ts). Sending needs a connection — like the web, nothing is queued.

@Serializable
data class ChatSenderDto(val id: String = "", val name: String? = null, val picture_url: String? = null)

@Serializable
data class ChatReplyToDto(val id: String, val content: String = "", val sender: ChatSenderDto = ChatSenderDto())

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
)

@Serializable
data class MessagesDto(val messages: List<ChatMessageDto> = emptyList(), val latest_timestamp: String? = null)

suspend fun Api.chatMessages(conversationId: String, since: String? = null): MessagesDto =
    get("/api/conversations/${enc(conversationId)}/messages" + (since?.let { "?since=${enc(it)}" } ?: ""))

@Serializable
data class SendMessageBody(val content: String, val reply_to_message_id: String? = null)

suspend fun Api.sendChatMessage(conversationId: String, content: String, replyTo: String?): ChatMessageDto =
    post("/api/conversations/${enc(conversationId)}/messages", SendMessageBody(content, replyTo))

@Serializable
data class AIRespondDto(val message: ChatMessageDto, val audio_base64: String? = null, val audio_content_type: String? = null)

suspend fun Api.aiRespond(conversationId: String): AIRespondDto = exchange("POST", "/api/conversations/${enc(conversationId)}/ai-respond", "{}", AIRespondDto.serializer())

@Serializable
data class ConversationTtsBody(val text: String, val voice_id: String? = null, val voice_speed: Double? = null)

@Serializable
data class ConversationTtsDto(val audio_base64: String, val content_type: String = "audio/mpeg")

suspend fun Api.conversationTts(conversationId: String, text: String, voiceId: String?, speed: Double?): ConversationTtsDto =
    post("/api/conversations/${enc(conversationId)}/tts", ConversationTtsBody(text, voiceId, speed))

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
data class SentenceBreakdownDto(val hanzi: String = "", val pinyin: String = "", val english: String = "", val chunks: List<SegmentChunk> = emptyList())

@Serializable
data class SegmentedDto(val translation: String = "", val segmentation: SentenceBreakdownDto)

suspend fun Api.translateSegmented(messageId: String): SegmentedDto = post("/api/messages/${enc(messageId)}/translate-segmented")

@Serializable
data class FlashcardFromChatBody(val message_ids: List<String>? = null)

@Serializable
data class FlashcardFromChatDto(val flashcard: SuggestedCard)

suspend fun Api.flashcardFromChat(conversationId: String): FlashcardFromChatDto =
    post("/api/conversations/${enc(conversationId)}/generate-flashcard", FlashcardFromChatBody())

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

suspend fun Api.renameConversation(conversationId: String, title: String): ConversationDto = patch("/api/conversations/${enc(conversationId)}", TitleBody(title))

@Serializable
data class VoiceSettingsBody(val voice_id: String? = null, val voice_speed: Double? = null)

suspend fun Api.setVoiceSettings(conversationId: String, voiceId: String?, speed: Double?): ConversationDto =
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
