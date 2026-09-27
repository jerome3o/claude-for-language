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
data class ChatConversationDto(
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

suspend fun Api.chatConversations(relId: String): List<ChatConversationDto> = get("/api/relationships/${enc(relId)}/conversations")

@Serializable
data class PracticeConversationBody(val title: String? = null, val scenario: String? = null, val user_role: String? = null, val ai_role: String? = null)

suspend fun Api.startConversation(relId: String, body: PracticeConversationBody): ChatConversationDto = post("/api/relationships/${enc(relId)}/conversations", body)

// ---------------- card flags ----------------

@Serializable
data class FlagDto(
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
data class FlagsDto(val flags: List<FlagDto> = emptyList(), val open: Int = 0)

suspend fun Api.myCardFlags(relId: String, status: String = "all"): FlagsDto = get("/api/relationships/${enc(relId)}/card-flags?status=${enc(status)}")

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
data class MyClaudeChatsDto(val questions: List<ClaudeChatQuestionDto> = emptyList(), val next_cursor: String? = null, val total: Int = 0)

suspend fun Api.myClaudeChats(limit: Int = 100, before: String? = null): MyClaudeChatsDto =
    get("/api/me/claude-chats?limit=$limit" + (before?.let { "&before=${enc(it)}" } ?: ""))

// ---------------- the student's own lesson notes (/lesson-notes) ----------------

@Serializable
data class LessonNoteFileDto(val id: String, val filename: String = "")

@Serializable
data class LessonNoteDto(val id: String, val raw_text: String = "", val given_at: String? = null, val created_at: String = "", val files: List<LessonNoteFileDto> = emptyList())

@Serializable
data class LessonNotesDto(val notes: List<LessonNoteDto> = emptyList())

@Serializable
data class NewLessonNoteBody(val raw_text: String, val given_at: String? = null)

@Serializable
data class NewLessonNoteDto(val id: String)

suspend fun Api.lessonNotes(): List<LessonNoteDto> = get<LessonNotesDto>("/api/lesson-notes").notes

suspend fun Api.createLessonNote(text: String, givenAt: String?): NewLessonNoteDto = post("/api/lesson-notes", NewLessonNoteBody(text, givenAt))

suspend fun Api.deleteLessonNote(id: String): Unit = exchange("DELETE", "/api/lesson-notes/${enc(id)}", null, Unit.serializer())

// Shared with package F (TeachingApi.kt): openConversation, removeRelationship, studentSharedDecks,
// resolveCardFlag / reopenCardFlag — the same endpoints either side of the relationship.
