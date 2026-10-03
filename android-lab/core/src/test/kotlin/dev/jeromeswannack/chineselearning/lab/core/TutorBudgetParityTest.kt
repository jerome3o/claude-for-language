package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** The tutor-set budget's words reproduce shared/decks/tutor-budget.ts exactly (parity/fixtures/tutor-budget.ts). */
class TutorBudgetParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "tutor-budget.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private val JsonElement?.intOrNull: Int? get() = if (this == null || this is JsonNull) null else jsonPrimitive.int

    private fun budget(e: JsonElement) = e.jsonObject.let { StudyBudget(it["new_cards_per_day"]!!.jsonPrimitive.int, it["secondary_cards_per_day"]!!.jsonPrimitive.int) }

    private val offsets: List<Int> by lazy { data["offsets"]!!.jsonArray.map { it.jsonPrimitive.int } }

    @Test
    fun summaryAndChatMessage() {
        val cases = data["summaries"]!!.jsonArray
        assertTrue(cases.size > 50)
        for (c in cases) {
            val o = c.jsonObject
            val b = budget(o["budget"]!!)
            assertEquals(o["summary"].str, TutorBudget.budgetSummary(b), "$b")
            assertEquals(o["message"].str, TutorBudget.budgetChangeMessage(b, false), "$b")
            assertEquals(o["message_default"].str, TutorBudget.budgetChangeMessage(b, true), "$b default")
        }
    }

    @Test
    fun shortDayAndFirstName() {
        for (c in data["days"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["day"].str, TutorBudget.shortDay(o["iso"].str!!, o["tz"]!!.jsonPrimitive.int), "$o")
        }
        for (c in data["firsts"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["first"].str, TutorBudget.firstName(o["name"].str), "$o")
        }
    }

    @Test
    fun infoFromRowAndSetByLabel() {
        for (c in data["infos"]!!.jsonArray) {
            val o = c.jsonObject
            val row = o["row"]?.takeIf { it !is JsonNull }?.jsonObject?.let {
                StudyBudgetRow(
                    newCardsPerDay = it["new_cards_per_day"].intOrNull,
                    secondaryCardsPerDay = it["secondary_cards_per_day"].intOrNull,
                    studyBudgetSetBy = it["study_budget_set_by"].str,
                    studyBudgetSetAt = it["study_budget_set_at"].str,
                    studyBudgetSetByName = it["study_budget_set_by_name"].str,
                )
            }
            val want = o["info"]!!.jsonObject
            val got = TutorBudget.studyBudgetInfo(row, "me")
            assertEquals(
                StudyBudgetInfo(
                    newCardsPerDay = want["new_cards_per_day"]!!.jsonPrimitive.int,
                    secondaryCardsPerDay = want["secondary_cards_per_day"]!!.jsonPrimitive.int,
                    isDefault = want["is_default"]!!.jsonPrimitive.boolean,
                    setById = want["set_by_id"].str,
                    setByName = want["set_by_name"].str,
                    setByTutor = want["set_by_tutor"]!!.jsonPrimitive.boolean,
                    setAt = want["set_at"].str,
                ),
                got,
                "$row",
            )
            assertEquals(o["labels"]!!.jsonArray.map { it.str }, offsets.map { TutorBudget.budgetSetByLabel(got, it) }, "$row")
        }
        for (c in data["extra_infos"]!!.jsonArray) {
            val o = c.jsonObject
            val i = o["info"]!!.jsonObject
            val info = StudyBudgetInfo(3, 6, isDefault = false, setByName = i["set_by_name"].str, setByTutor = i["set_by_tutor"]!!.jsonPrimitive.boolean, setAt = i["set_at"].str)
            assertEquals(o["labels"]!!.jsonArray.map { it.str }, offsets.map { TutorBudget.budgetSetByLabel(info, it) }, "$i")
        }
        assertEquals(null, TutorBudget.budgetSetByLabel(null, 0))
    }

    @Test
    fun finishHint() {
        val cases = data["hints"]!!.jsonArray
        assertTrue(cases.size > 100)
        for (c in cases) {
            val o = c.jsonObject
            assertEquals(o["hint"].str, TutorBudget.budgetFinishHint(o["n"]!!.jsonPrimitive.int, o["deck"].str, o["words"].intOrNull), "$o")
        }
    }
}
