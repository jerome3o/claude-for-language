package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// A student sharing one of their decks with a tutor so the tutor can follow their progress
// (DeckDetailPage.tsx "Share with tutor" / "Shared with Tutors"; client.ts getDeckTutorShares,
// studentShareDeck, unshareStudentDeck).

@Serializable
data class DeckTutorShareDto(
    val relationship_id: String,
    val shared_deck_id: String = "",
    val shared_at: String = "",
    val tutor: UserSummaryDto,
)

@Serializable
private data class StudentShareBody(val deck_id: String)

@Serializable
data class StudentShareResultDto(val id: String? = null)

@Serializable
data class UnshareResultDto(val success: Boolean = true)

/** JsonCache key of a deck's tutor shares (re-opened offline). */
fun deckTutorSharesKey(deckId: String) = "decks/tutor-shares/$deckId"

suspend fun Api.deckTutorShares(deckId: String): List<DeckTutorShareDto> = get("/api/decks/${enc(deckId)}/tutor-shares")

suspend fun Api.studentShareDeck(relationshipId: String, deckId: String): StudentShareResultDto =
    post<StudentShareBody, StudentShareResultDto>("/api/relationships/${enc(relationshipId)}/student-share-deck", StudentShareBody(deckId))

suspend fun Api.unshareStudentDeck(relationshipId: String, deckId: String): UnshareResultDto =
    delete("/api/relationships/${enc(relationshipId)}/student-shared-decks/${enc(deckId)}")
