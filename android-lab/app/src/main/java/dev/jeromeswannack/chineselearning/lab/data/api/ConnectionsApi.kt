package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.QuestionRowLike
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer

// The student's Tutor tab (package E; web: ConnectionsPage, ConnectionDetailPage, api/client.ts,
// api/cardFlags.ts). Chat calls live in ChatApi.kt.

/** The fixed id of the Claude practice partner (web: isClaudeUser). */
const val CLAUDE_USER_ID = "claude-ai"

/** The other person in a relationship, seen by [myId] (web: getOtherUserInRelationship). */
fun RelationshipDto.other(myId: String?): UserSummaryDto? = when {
    myId != null && requester_id == myId -> recipient
    myId != null && recipient_id == myId -> requester
    else -> null
}

/** The tutor of a relationship (the side whose role is tutor). */
fun RelationshipDto.tutor(): UserSummaryDto? = if (requester_role == "tutor") requester else recipient

/** The student of a relationship. */
fun RelationshipDto.student(): UserSummaryDto? = if (requester_role == "tutor") recipient else requester

fun UserSummaryDto?.displayName(fallback: String = "Unknown"): String = this?.name?.takeIf { it.isNotBlank() } ?: this?.email?.takeIf { it.isNotBlank() } ?: fallback

suspend fun Api.relationship(id: String): RelationshipDto = get("/api/relationships/${enc(id)}")

suspend fun Api.acceptRelationship(id: String): RelationshipDto = post("/api/relationships/${enc(id)}/accept")

suspend fun Api.removeRelationship(id: String): Unit = exchange("DELETE", "/api/relationships/${enc(id)}", null, Unit.serializer())

suspend fun Api.cancelInvitation(id: String): Unit = exchange("DELETE", "/api/invitations/${enc(id)}", null, Unit.serializer())

@Serializable
data class CreateRelationshipBody(val recipient_email: String, val role: String)

/** `{ type: 'relationship' | 'invitation', data }` — only the type and the invitation email matter here. */
@Serializable
data class CreateRelationshipResult(val type: String = "", val data: CreateRelationshipData? = null)

@Serializable
data class CreateRelationshipData(val id: String = "", val recipient_email: String? = null)

suspend fun Api.createRelationship(email: String, role: String): CreateRelationshipResult = post("/api/relationships", CreateRelationshipBody(email, role))

// ---------------- conversations ----------------

@Serializable
data class MessageDto(
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
)

@Serializable
data class ConversationDto(
    val id: String,
    val relationship_id: String = "",
    val title: String? = null,
    val created_at: String = "",
    val last_message_at: String? = null,
    val scenario: String? = null,
    val user_role: String? = null,
    val ai_role: String? = null,
    val is_ai_conversation: Boolean = false,
    val voice_id: String? = null,
    val voice_speed: Double? = null,
    val last_message: MessageDto? = null,
    val other_user: UserSummaryDto? = null,
)

suspend fun Api.conversations(relId: String): List<ConversationDto> = get("/api/relationships/${enc(relId)}/conversations")

@Serializable
data class OpenConversationDto(val conversation_id: String, val created: Boolean = false)

/** Most recent conversation, created when there is none (either side). */
suspend fun Api.openConversation(relId: String): OpenConversationDto = post("/api/relationships/${enc(relId)}/conversations/open")

@Serializable
data class NewConversationBody(val title: String? = null, val scenario: String? = null, val user_role: String? = null, val ai_role: String? = null)

suspend fun Api.createConversation(relId: String, body: NewConversationBody): ConversationDto = post("/api/relationships/${enc(relId)}/conversations", body)

@Serializable
data class StudentSharedDeckDto(val id: String, val deck_name: String = "", val note_count: Int = 0, val shared_at: String = "")

suspend fun Api.studentSharedDecks(relId: String): List<StudentSharedDeckDto> = get("/api/relationships/${enc(relId)}/student-shared-decks")

// ---------------- card flags ----------------

@Serializable
data class CardFlagDto(
    val id: String,
    val relationship_id: String = "",
    val note_id: String = "",
    val card_id: String? = null,
    val message: String = "",
    /** 'open' | 'resolved'. */
    val status: String = "open",
    val tutor_reply: String? = null,
    val replied_at: String? = null,
    val created_at: String = "",
    val resolved_at: String? = null,
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_name: String = "",
    val student_name: String? = null,
    val tutor_name: String? = null,
)

@Serializable
data class CardFlagsDto(val flags: List<CardFlagDto> = emptyList(), val open: Int = 0)

@Serializable
data class CardFlagOne(val flag: CardFlagDto? = null)

suspend fun Api.cardFlags(relId: String, status: String = "all"): CardFlagsDto = get("/api/relationships/${enc(relId)}/card-flags?status=${enc(status)}")

suspend fun Api.resolveCardFlag(id: String): CardFlagOne = post("/api/card-flags/${enc(id)}/resolve")

suspend fun Api.reopenCardFlag(id: String): CardFlagOne = post("/api/card-flags/${enc(id)}/reopen")

suspend fun Api.deleteCardFlag(id: String): Unit = exchange("DELETE", "/api/card-flags/${enc(id)}", null, Unit.serializer())

// ---------------- Ask-Claude conversations ----------------

@Serializable
data class ClaudeChatQuestionDto(
    override val id: String,
    override val note_id: String = "",
    val question: String = "",
    val answer: String = "",
    override val asked_at: String = "",
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_id: String = "",
    val deck_name: String = "",
) : QuestionRowLike

@Serializable
data class ClaudeChatsDto(val questions: List<ClaudeChatQuestionDto> = emptyList(), val next_cursor: String? = null, val total: Int = 0)

suspend fun Api.myClaudeChats(limit: Int = 100, before: String? = null): ClaudeChatsDto =
    get("/api/me/claude-chats?limit=$limit" + (before?.let { "&before=${enc(it)}" } ?: ""))
