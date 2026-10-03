package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyBudgetInfo
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * The daily new-card budget with who set it (shared/decks/tutor-budget.ts `StudyBudgetInfo`):
 * on /api/auth/me and /api/sync/changes (`study_budget`), the learner's own
 * PUT /api/profile/study-budget, and the tutor's GET|PUT …/student-study-budget.
 */

@Serializable
data class StudyBudgetInfoDto(
    val new_cards_per_day: Int = StudyBudget.DEFAULT.newCardsPerDay,
    val secondary_cards_per_day: Int = StudyBudget.DEFAULT.secondaryCardsPerDay,
    val is_default: Boolean = false,
    val set_by_id: String? = null,
    val set_by_name: String? = null,
    val set_by_tutor: Boolean = false,
    val set_at: String? = null,
) {
    fun toInfo() = StudyBudgetInfo(
        newCardsPerDay = new_cards_per_day.coerceIn(0, StudyBudget.MAX),
        secondaryCardsPerDay = secondary_cards_per_day.coerceIn(0, StudyBudget.MAX),
        isDefault = is_default,
        setById = set_by_id,
        setByName = set_by_name,
        setByTutor = set_by_tutor,
        setAt = set_at,
    )
}

@Serializable
data class BudgetDefaultDto(
    val new_cards_per_day: Int = StudyBudget.DEFAULT.newCardsPerDay,
    val secondary_cards_per_day: Int = StudyBudget.DEFAULT.secondaryCardsPerDay,
) {
    fun toBudget() = StudyBudget(new_cards_per_day, secondary_cards_per_day)
}

/** The first deck in the student's queue that still has words to introduce (the sheet's live hint). */
@Serializable
data class BudgetTopDeckDto(val id: String, val name: String = "", val words_to_go: Int = 0)

@Serializable
data class StudentStudyBudgetDto(
    val budget: StudyBudgetInfoDto = StudyBudgetInfoDto(),
    val default: BudgetDefaultDto = BudgetDefaultDto(),
    val top_deck: BudgetTopDeckDto? = null,
)

@Serializable
data class SavedStudentBudgetDto(val budget: StudyBudgetInfoDto, val changed: Boolean = false, val message_sent: Boolean = false)

private fun budgetBody(newPerDay: Int?, secondaryPerDay: Int?): JsonObject = buildJsonObject {
    // Built by hand: the API's Json drops nulls, and null here means "back to the default".
    put("new_cards_per_day", newPerDay?.let(::JsonPrimitive) ?: JsonNull)
    put("secondary_cards_per_day", secondaryPerDay?.let(::JsonPrimitive) ?: JsonNull)
}

/** PUT /api/profile/study-budget — the learner's own; null = back to the default. 400 carries `problems`. */
suspend fun Api.saveOwnStudyBudget(newPerDay: Int?, secondaryPerDay: Int?): StudyBudgetInfoDto =
    put<JsonObject, StudyBudgetInfoDto>("/api/profile/study-budget", budgetBody(newPerDay, secondaryPerDay))

/** GET /api/relationships/:relId/student-study-budget — tutor of an active relationship only. */
suspend fun Api.studentStudyBudget(relId: String): StudentStudyBudgetDto =
    get("/api/relationships/${enc(relId)}/student-study-budget")

/** PUT …/student-study-budget — both null = reset to the default; the server posts the chat message. */
suspend fun Api.saveStudentStudyBudget(relId: String, newPerDay: Int?, secondaryPerDay: Int?): SavedStudentBudgetDto =
    put<JsonObject, SavedStudentBudgetDto>("/api/relationships/${enc(relId)}/student-study-budget", budgetBody(newPerDay, secondaryPerDay))
