package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * "Revisit later" (mini lessons) + "New lessons a day" must schedule exactly like the web:
 * shared/study/revisit.ts via parity/fixtures/revisit.ts → revisit.json. Doubles compared exactly.
 */
class RevisitParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "revisit.json").readText()).jsonObject
    }

    private fun list(key: String) = fixture[key]!!.jsonArray.map { it.jsonObject }
    private fun JsonElement?.isNull() = this == null || this is JsonNull
    private fun intOrNull(e: JsonElement?) = if (e.isNull()) null else e!!.jsonPrimitive.int
    private fun longOrNull(e: JsonElement?) = if (e.isNull()) null else e!!.jsonPrimitive.long

    private fun settings(e: JsonElement?): RevisitSettings {
        val o = e!!.jsonObject
        return RevisitSettings(
            o["hard_days"]!!.jsonPrimitive.double, o["good_days"]!!.jsonPrimitive.double, o["easy_days"]!!.jsonPrimitive.double,
            o["growth"]!!.jsonPrimitive.double, o["cap_days"]!!.jsonPrimitive.double,
            o["new_lessons_per_day"]?.jsonPrimitive?.double ?: Revisit.DEFAULT.newLessonsPerDay,
        )
    }

    private fun state(e: JsonElement?): RevisitState {
        val o = e!!.jsonObject
        return RevisitState(
            o["status"]!!.jsonPrimitive.content, longOrNull(o["due_ms"]), o["gap_days"]!!.jsonPrimitive.double,
            longOrNull(o["last_ms"]), o["finishes"]!!.jsonPrimitive.int,
        )
    }

    private fun event(e: JsonElement): RevisitEvent {
        val o = e.jsonObject
        return RevisitEvent(o["id"]!!.jsonPrimitive.content, o["at"]!!.jsonPrimitive.content, o["kind"]!!.jsonPrimitive.content, intOrNull(o["rating"]))
    }

    @Test fun nextGapDays() {
        val cases = list("gaps")
        assertTrue(cases.size > 400)
        for (c in cases) {
            val got = Revisit.nextGapDays(c["prev"]!!.jsonPrimitive.double, intOrNull(c["r"]), settings(c["s"]))
            assertEquals(c["gap"]!!.jsonPrimitive.double, got, "nextGapDays $c")
        }
    }

    @Test fun historiesReplayExactly() {
        val cases = list("histories")
        assertTrue(cases.size > 500)
        for ((i, c) in cases.withIndex()) {
            val s = settings(c["s"])
            val st = Revisit.computeState(c["events"]!!.jsonArray.map(::event), s)
            assertEquals(state(c["state"]), st, "history #$i $c")
            for (d in c["due"]!!.jsonArray.map { it.jsonObject }) {
                assertEquals(d["due"]!!.jsonPrimitive.boolean, Revisit.isDue(st, d["cutoff"]!!.jsonPrimitive.long), "isDue #$i $d")
            }
            assertEquals(c["previews"]!!.jsonArray.map { it.jsonPrimitive.double }, Revisit.previews(st, s), "previews #$i")
        }
    }

    @Test fun gapLabels() {
        for (c in list("labels")) assertEquals(c["label"]!!.jsonPrimitive.content, Revisit.gapLabel(c["d"]!!.jsonPrimitive.double), "label $c")
    }

    @Test fun settingsValidation() {
        val cases = list("updates")
        assertTrue(cases.size > 400)
        for (c in cases) {
            val input = c["input"].let { if (it.isNull()) null else it!!.jsonObject }
            val current = settings(c["current"])
            val got = Revisit.pickUpdate(input, current)
            val want = c["update"]!!.jsonObject.mapValues { (_, v) -> if (v.isNull()) null else v.jsonPrimitive.double }
            assertEquals(want, got.update, "update $c")
            assertEquals(want.keys.toList(), got.update.keys.filter { it in want }.toList(), "update order $c")
            assertEquals(c["problems"]!!.jsonArray.map { it.jsonPrimitive.content }, got.problems, "problems $c")
            assertEquals(settings(c["applied"]), Revisit.applyUpdate(current, got.update), "applied $c")
        }
        for (c in list("parses")) assertEquals(settings(c["settings"]), Revisit.parse(c["raw"]), "parse $c")
        for (c in list("defaults")) assertEquals(c["isDefault"]!!.jsonPrimitive.boolean, Revisit.isDefault(settings(c["s"])), "isDefault $c")
    }

    @Test fun pickRevisitsForToday() {
        for (c in list("picks")) {
            val items = c["items"]!!.jsonArray.map { it.jsonObject }.map { it["item"]!!.jsonPrimitive.content to state(it["state"]) }
            val perDay = intOrNull(c["perDay"]) ?: Revisit.MAX_LESSON_REVISITS_PER_DAY
            val got = Revisit.pickForToday(items, c["cutoff"]!!.jsonPrimitive.long, c["doneToday"]!!.jsonPrimitive.int, perDay)
            assertEquals(c["picked"]!!.jsonArray.map { it.jsonPrimitive.content }, got, "pick $c")
        }
    }

    @Test fun newLessonsPerDay() {
        val cases = list("newLessons")
        assertTrue(cases.size >= 200)
        for ((i, c) in cases.withIndex()) {
            val events = c["events"]!!.jsonArray.map { it.jsonObject }.map { it["lesson_id"]!!.jsonPrimitive.content to it["completed_at"]!!.jsonPrimitive.content }
            val exclude = c["exclude"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()
            val introduced = Revisit.newLessonsIntroducedToday(events, c["day_start"]!!.jsonPrimitive.long, exclude)
            assertEquals(c["introduced"]!!.jsonPrimitive.int, introduced, "introduced #$i $c")
            val fresh = c["fresh"]!!.jsonArray.map { it.jsonObject }.map { it["id"]!!.jsonPrimitive.content to it["created_at"]!!.jsonPrimitive.content }
            val perDay = intOrNull(c["per_day"]) ?: Revisit.DEFAULT.newLessonsPerDayInt
            val started = c["started"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()
            val got = Revisit.pickNewForToday(fresh, { it.first }, { it.second }, introduced, perDay, started).map { it.first }
            assertEquals(c["picked"]!!.jsonArray.map { it.jsonPrimitive.content }, got, "picked #$i $c")
        }
        assertEquals(1, Revisit.DEFAULT.newLessonsPerDayInt)
    }

    /** `pickTodaysLessons` — the one rule for the session, Home's Today and today's lesson list. */
    @Test fun todaysLessons() {
        val cases = list("todays")
        assertTrue(cases.size >= 250)
        for ((i, c) in cases.withIndex()) {
            val lessons = c["lessons"]!!.jsonArray.map { it.jsonObject }.map {
                ScheduledItem(it["id"]!!.jsonPrimitive.content, it["created_at"]!!.jsonPrimitive.content, state(it["state"]))
            }
            val events = c["events"]!!.jsonArray.map { it.jsonObject }.mapIndexed { k, e -> ItemEvent("e$k", e["lesson_id"]!!.jsonPrimitive.content, null, e["completed_at"]!!.jsonPrimitive.content) }
            fun set(key: String) = c[key]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()
            val cutoff = StudyCutoff(c["cutoff"]!!.jsonPrimitive.long)
            val got = LessonSchedule.todaysLessons(
                lessons, events, c["day_start"]!!.jsonPrimitive.long, cutoff, set("one_off_only"), set("homework_pass"), set("started"),
                c["revisited_today"]!!.jsonPrimitive.int, intOrNull(c["per_day"]) ?: Revisit.DEFAULT.newLessonsPerDayInt,
                set("locked"), set("unlocked"),
            ).map { it.id }
            assertEquals(c["picked"]!!.jsonArray.map { it.jsonPrimitive.content }, got, "todays #$i $c")
            val practice = c["practice"]!!.jsonArray.map { it.jsonPrimitive.boolean }
            assertEquals(practice, lessons.map { Revisit.replayIsPractice(it.state, cutoff.ts) }, "practice #$i")
        }
    }

    @Test fun namedSchedule() {
        // The spec's numbers: Again 1 day, Hard 2, Good 14, Easy 42; Good each time doubles to the 180-day cap.
        assertEquals(listOf(1.0, 2.0, 14.0, 42.0), Revisit.previews(RevisitState.INITIAL))
        assertEquals("2 wk → 4 wk → 8 wk → 4 mo → 6 mo", Revisit.goodChain(Revisit.DEFAULT))
        assertEquals(listOf("1 day", "2 days", "2 wk", "6 wk"), Revisit.buttonPreviews(RevisitState.INITIAL).map { it.intervalText })
    }
}
