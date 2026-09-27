package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// GET /api/relationships (frontend/src/api/client.ts getMyRelationships). Used by the
// shell for the tab set (nav/NavRole.kt) and cached as NavKeys.RELATIONSHIPS; the tutor
// and students packages extend these DTOs (fields are additive, unknown keys ignored).

@Serializable
data class UserSummaryDto(
    val id: String,
    val email: String? = null,
    val name: String? = null,
    val picture_url: String? = null,
)

@Serializable
data class RelationshipDto(
    val id: String,
    val requester_id: String = "",
    val recipient_id: String = "",
    /** 'tutor' | 'student' — the requester's role. */
    val requester_role: String = "",
    /** 'pending' | 'active' | 'removed' … */
    val status: String = "",
    val created_at: String? = null,
    val accepted_at: String? = null,
    val requester: UserSummaryDto? = null,
    val recipient: UserSummaryDto? = null,
)

@Serializable
data class MyRelationshipsDto(
    /** Relationships where the OTHER person is my tutor. */
    val tutors: List<RelationshipDto> = emptyList(),
    /** Relationships where the other person is my student. */
    val students: List<RelationshipDto> = emptyList(),
    val pending_incoming: List<RelationshipDto> = emptyList(),
    val pending_outgoing: List<RelationshipDto> = emptyList(),
)

suspend fun Api.myRelationships(): MyRelationshipsDto = get("/api/relationships")
