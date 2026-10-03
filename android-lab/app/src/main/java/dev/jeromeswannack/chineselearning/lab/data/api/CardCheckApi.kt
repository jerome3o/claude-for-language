package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.CheckEstimate
import dev.jeromeswannack.chineselearning.lab.core.DeckCheckProposal
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.NoteDto
import kotlinx.serialization.Serializable

/*
 * Word checks (worker/src/routes/card-checks.ts, shared/cards/check.ts): Apply fix / Dismiss
 * on a note's "⚠ Possible issue", the per-deck "Check for errors" run (own deck or the
 * student's copy), the Paste-a-list pre-check and the account switch.
 */

/** `{ note }` from apply / dismiss: the note as the server now has it (check_issues = what is left). */
@Serializable
data class CheckedNoteDto(val note: NoteDto? = null)

/** Port of `DeckCheckJob` as the API returns it. */
@Serializable
data class DeckCheckJobDto(
    val id: String,
    val deck_id: String = "",
    val deck_name: String? = null,
    val relationship_id: String? = null,
    val source_deck_id: String? = null,
    val status: String = "queued",
    val total: Int = 0,
    val checked: Int = 0,
    val proposals: List<DeckCheckProposal> = emptyList(),
    val cost_usd: Double = 0.0,
    val error: String? = null,
    val created_at: String = "",
    val finished_at: String? = null,
)

/** GET …/check: the estimate, the latest run (to reopen it) and whether the tutor may fix her source deck. */
@Serializable
data class DeckCheckInfoDto(
    val estimate: CheckEstimate = CheckEstimate(),
    val job: DeckCheckJobDto? = null,
    val deck_name: String? = null,
    val can_fix_source: Boolean = false,
)

@Serializable
data class DeckCheckJobResponse(val job: DeckCheckJobDto)

@Serializable
data class ApplyDeckCheckBody(val proposal_ids: List<String>, val also_source: Boolean)

@Serializable
data class ApplyFailureDto(val id: String = "", val error: String = "")

@Serializable
data class ApplyDeckCheckResult(
    /** Proposal ids applied to the checked deck / also to the source deck. */
    val applied: List<String> = emptyList(),
    val source_applied: List<String> = emptyList(),
    val failed: List<ApplyFailureDto> = emptyList(),
    val job: DeckCheckJobDto? = null,
)

@Serializable
data class CheckWordDto(val hanzi: String, val pinyin: String, val english: String)

@Serializable
data class CheckWordsBody(val words: List<CheckWordDto>)

/** One issue of the Paste-a-list pre-check, by the row's index in the request. */
@Serializable
data class IndexedCheckIssueDto(
    val index: Int,
    val field: String,
    val kind: String,
    val current: String = "",
    val proposed: String = "",
    val reason: String = "",
)

@Serializable
data class CheckWordsResult(val issues: List<IndexedCheckIssueDto> = emptyList())

@Serializable
data class CardCheckBody(val card_check: Boolean)

@Serializable
data class CardCheckSettingDto(val card_check: Boolean = false, val card_check_setting: Boolean? = null)

/** Where a deck check runs: my own deck, or the student's copy of a deck I sent (tutor). */
sealed interface DeckCheckScope {
    val path: String
    /** Analytics `scope`: own | student. */
    val wire: String

    data class Own(val deckId: String) : DeckCheckScope {
        override val path get() = "/api/decks/${enc(deckId)}/check"
        override val wire get() = "own"
    }

    data class Student(val relationshipId: String, val sharedDeckId: String) : DeckCheckScope {
        override val path get() = "/api/relationships/${enc(relationshipId)}/shared-decks/${enc(sharedDeckId)}/check"
        override val wire get() = "student"
    }
}

suspend fun Api.applyCheckIssue(noteId: String, issueId: String): CheckedNoteDto =
    post("/api/notes/${enc(noteId)}/check-issues/${enc(issueId)}/apply")

suspend fun Api.dismissCheckIssue(noteId: String, issueId: String): CheckedNoteDto =
    post("/api/notes/${enc(noteId)}/check-issues/${enc(issueId)}/dismiss")

suspend fun Api.deckCheckInfo(scope: DeckCheckScope): DeckCheckInfoDto = get(scope.path)

suspend fun Api.startDeckCheck(scope: DeckCheckScope): DeckCheckJobResponse = post(scope.path)

suspend fun Api.deckCheckJob(jobId: String): DeckCheckJobResponse = get("/api/deck-checks/${enc(jobId)}")

suspend fun Api.applyDeckCheck(jobId: String, proposalIds: List<String>, alsoSource: Boolean): ApplyDeckCheckResult =
    post("/api/deck-checks/${enc(jobId)}/apply", ApplyDeckCheckBody(proposalIds, alsoSource))

suspend fun Api.checkWords(words: List<CheckWordDto>): CheckWordsResult = post("/api/ai/check-words", CheckWordsBody(words))

suspend fun Api.setCardCheck(on: Boolean): CardCheckSettingDto = put("/api/profile/card-check", CardCheckBody(on))
