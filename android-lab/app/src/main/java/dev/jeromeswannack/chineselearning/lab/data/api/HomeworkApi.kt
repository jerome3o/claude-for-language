package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer

// Student homework (docs/HOMEWORK.md §5; web: frontend/src/services/homework.ts) and the
// sources of Home's "From <tutor>" card (web: components/home/useHomework.ts).

@Serializable
data class MyHomeworkDto(val assignments: List<HomeworkAssignment> = emptyList(), val events: List<HomeworkEvent> = emptyList())

@Serializable
data class HomeworkEventsBody(val events: List<HomeworkEvent>)

suspend fun Api.myHomework(): MyHomeworkDto = get("/api/me/homework")

/** PUT /api/decks/:id/settings — "Add to my daily review" (caps back to DEFAULT_DECK_SETTINGS, 3 + 6). */
@Serializable
data class DeckCapsBody(val new_cards_per_day: Int, val secondary_cards_per_day: Int)

suspend fun Api.setDeckCaps(deckId: String, caps: DeckCapsBody): Unit = put("/api/decks/${enc(deckId)}/settings", caps)

@Serializable
data class SharedDeckDto(
    val id: String,
    val relationship_id: String = "",
    val source_deck_id: String = "",
    val target_deck_id: String = "",
    val shared_at: String = "",
    val source_deck_name: String = "",
    val target_deck_name: String = "",
)

suspend fun Api.sharedDecks(relId: String): List<SharedDeckDto> = get("/api/relationships/${enc(relId)}/shared-decks")

@Serializable
data class LessonSummaryDto(
    val id: String,
    val title: String = "",
    val status: String = "active",
    val created_at: String = "",
    val assigned_by: String? = null,
    val assigned_relationship_id: String? = null,
)

@Serializable
data class LessonListDto(val lessons: List<LessonSummaryDto> = emptyList())

suspend fun Api.activeLessonSummaries(): List<LessonSummaryDto> = get<LessonListDto>("/api/custom-lessons?status=active").lessons

@Serializable
data class NotificationDto(
    val id: String,
    val type: String = "",
    val title: String = "",
    val message: String? = null,
    val conversation_id: String? = null,
    val relationship_id: String? = null,
    val is_read: Boolean = false,
    val created_at: String = "",
)

suspend fun Api.notifications(): List<NotificationDto> = get("/api/notifications")

suspend fun Api.markNotificationsReadByConversation(conversationId: String): Unit =
    exchange("PATCH", "/api/notifications/read-by-conversation/${enc(conversationId)}", null, Unit.serializer())

@Serializable
data class OnboardingDto(
    val invited: Boolean = false,
    val redeemed_at: String? = null,
    val inviter: UserSummaryDto? = null,
    val inviter_role: String? = null,
    val relationship_id: String? = null,
    val welcome_message: String? = null,
    val welcome_conversation_id: String? = null,
    val decks: List<OnboardingDeckDto> = emptyList(),
    val has_reviewed: Boolean = false,
    val review_count: Int = 0,
)

@Serializable
data class OnboardingDeckDto(val id: String, val name: String = "", val note_count: Int = 0)

suspend fun Api.onboarding(): OnboardingDto = get("/api/me/onboarding")
