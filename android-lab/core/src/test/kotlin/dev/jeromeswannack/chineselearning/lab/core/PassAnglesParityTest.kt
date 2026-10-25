package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Hard mode in the homework pass (docs/HOMEWORK.md §3e) reproduces shared/homework/pass-angles.ts exactly. */
class PassAnglesParityTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "pass-angles.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.int(k: String) = this[k]!!.jsonPrimitive.int
    private fun JsonObject.bool(k: String) = this[k]!!.jsonPrimitive.boolean

    private fun word(o: JsonObject) = PassAngles.Word(o["id"]!!.str!!, o["cardTypes"]!!.jsonArray.map { it.str!! }, o.bool("hasAudio"))

    private fun showing(o: JsonObject) = PassAngles.Showing(o["noteId"]!!.str!!, o["cardType"]!!.str!!, o.int("angle"), o.bool("retry"))

    @Test
    fun plansMatchTypeScript() {
        val plans = fixture()["plans"]!!.jsonArray
        var withSteps = 0
        var withDueAngle = 0
        for ((i, c) in plans.withIndex()) {
            val o = c.jsonObject
            val words = o["words"]!!.jsonArray.map { word(it.jsonObject) }
            val events = json.decodeFromJsonElement(ListSerializer(HomeworkEvent.serializer()), JsonArray(o["events"]!!.jsonArray.map { e ->
                JsonObject(e.jsonObject + ("assignment_id" to JsonPrimitive("a")))
            }))
            val mode = o["mode"]!!.str!!
            val plan = PassAngles.plan(words, events, mode)
            val e = o["plan"]!!.jsonObject
            val where = "plan[$i]"
            assertEquals(e["remaining"]!!.jsonArray.map { showing(it.jsonObject) }, plan.remaining, "$where remaining")
            assertEquals(e["next"]!!.let { if (it is JsonNull) null else showing(it.jsonObject) }, plan.next, "$where next")
            assertEquals(e.int("done"), plan.done, "$where done")
            assertEquals(e.int("total"), plan.total, "$where total")
            assertEquals(e.bool("complete"), plan.complete, "$where complete")
            assertEquals(e.int("retrying"), plan.retrying, "$where retrying")
            assertEquals(e.int("anglesOwed"), plan.anglesOwed, "$where anglesOwed")
            val bar = e["bar"]!!.jsonObject
            assertEquals(bar.int("answered"), plan.bar.answered, "$where bar answered")
            assertEquals(bar.int("fresh"), plan.bar.fresh, "$where bar fresh")
            assertEquals(bar.int("retries"), plan.bar.retries, "$where bar retries")
            assertEquals(bar.int("itemsDone"), plan.bar.itemsDone, "$where bar itemsDone")
            assertEquals(bar.int("items"), plan.bar.items, "$where bar items")
            assertEquals(bar["doneFraction"]!!.jsonPrimitive.double, plan.bar.doneFraction, "$where bar doneFraction")
            assertEquals(bar.bool("onRetries"), plan.bar.onRetries, "$where bar onRetries")
            assertEquals(bar.bool("complete"), plan.bar.complete, "$where bar complete")
            val missed = o["missed"]!!.jsonArray.map { it.jsonPrimitive.boolean }
            assertEquals(missed, words.map { PassAngles.wordMissed(it.id, events) }, "$where missed")
            if (events.any { it.item_id.contains('#') }) withSteps++
            if (plan.remaining.any { it.angle == 2 }) withDueAngle++
        }
        assertTrue(plans.size >= 400)
        assertTrue(withSteps > 50, "vectors with step events")
        assertTrue(withDueAngle > 20, "vectors with a second angle to come")
    }

    @Test
    fun rulesMatchTypeScript() {
        val rules = fixture()["rules"]!!.jsonArray
        for ((i, c) in rules.withIndex()) {
            val o = c.jsonObject
            val w = word(o["word"]!!.jsonObject)
            val cardType = o["cardType"]!!.str!!
            val done = o["done"]!!.jsonArray.map { it.str!! }
            val where = "rule[$i]"
            assertEquals(o["first"]!!.str, PassAngles.firstAngleType(w.cardTypes), "$where first")
            assertEquals(o["second"]!!.str, PassAngles.secondAngleType(w, cardType, done), "$where second")
            assertEquals(o["second_none_done"]!!.str, PassAngles.secondAngleType(w, cardType), "$where second (none done)")
            assertEquals(o.bool("applies"), PassAngles.hardApplies(o["mode"]!!.str!!, cardType, o.bool("missed")), "$where applies")
            val showing = PassAngles.Showing("w", cardType, o.int("angle"), false)
            assertEquals(o["item_id"]!!.str, PassAngles.answerItemId(showing, w, o.bool("right"), o.bool("hard")), "$where item id")
            assertEquals(o["angle_line"]!!.str, PassAngles.angleLine(o.int("angle"), cardType), "$where angle line")
        }
    }

    @Test
    fun wordsMatchTypeScript() {
        val w = fixture()["words"]!!.jsonObject
        for (p in w["parse"]!!.jsonArray) {
            val o = p.jsonObject
            assertEquals(o["mode"]!!.str, PassAngles.parseMode(o["raw"]!!.str), "parse ${o["raw"]}")
        }
        for (p in w["step_ids"]!!.jsonArray) {
            val o = p.jsonObject
            val parsed = o["parsed"]!!.let { if (it is JsonNull) null else it.jsonObject["noteId"]!!.str!! to it.jsonObject["cardType"]!!.str!! }
            assertEquals(parsed, PassAngles.parseStepId(o["id"]!!.str!!), "step id ${o["id"]}")
        }
        assertEquals(w["step_id"]!!.str, PassAngles.stepId("note-1", "meaning_to_hanzi"))
        for (l in w["labels"]!!.jsonArray) {
            val o = l.jsonObject
            val mode = o["mode"]!!.str!!
            assertEquals(o["angles"]!!.str, PassAngles.anglesLabel(mode), "angles $mode")
            assertEquals(o["chip"]!!.str, PassAngles.chipLabel(mode), "chip $mode")
            assertEquals(o["option"]!!.str, PassAngles.OPTION[mode], "option $mode")
            assertEquals(o["hint"]!!.str, PassAngles.OPTION_HINT[mode], "hint $mode")
        }
        assertEquals(w["description"]!!.str, PassAngles.DESCRIPTION)
        assertEquals(w["gave_up_line"]!!.str, PassAngles.GAVE_UP_LINE)
        assertEquals(w["round_skip_note"]!!.str, PassAngles.ROUND_SKIP_NOTE)
        for (c in w["round_done_cheers"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["cheer"]!!.str, PassAngles.roundDoneCheer(o.int("got"), o.int("needed")))
        }
        assertEquals(w["gave_up_blocked"]!!.str, PassAngles.GAVE_UP_BLOCKED)
    }
}
