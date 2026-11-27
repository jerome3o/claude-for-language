package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallGoals.Action
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** Calls: CallGoals reproduces shared/calls/goals.ts exactly (parity/fixtures/calls-goals.ts). */
class CallsGoalsParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-goals.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun strs(e: JsonElement?): List<String> = (e as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()

    private fun structure(o: JsonObject) = CallGoals.Structure(
        name = str(o["name"])!!, fixed = strs(o["fixed"]), line = str(o["line"]), meaning = str(o["meaning"]), example = str(o["example"]), lastMet = str(o["last_met"]),
    )

    /** The action as the reducer got it in TypeScript (raw, not sanitized). */
    private fun action(o: JsonObject): Action = when (str(o["kind"])) {
        "add" -> Action.Add(str(o["text"])!!)
        "remove" -> Action.Remove(str(o["id"])!!)
        "move" -> Action.Move(str(o["id"])!!, o["to"]!!.jsonPrimitive.int)
        "tick" -> Action.Tick(str(o["id"])!!, str(o["text"]))
        "untick" -> Action.Untick(str(o["id"])!!)
        "heard" -> Action.HeardIt(str(o["id"])!!, str(o["text"])!!)
        "checked" -> Action.Checked(str(o["id"])!!, str(o["text"])!!, o["ok"]!!.jsonPrimitive.boolean)
        else -> fail("unknown $o")
    }

    @Test fun constants() {
        val c = root["constants"]!!.jsonObject
        assertEquals(c["GOALS_MIN"]!!.jsonPrimitive.int, CallGoals.GOALS_MIN)
        assertEquals(c["GOALS_MAX"]!!.jsonPrimitive.int, CallGoals.GOALS_MAX)
        assertEquals(c["GOALS_RECENT_DAYS"]!!.jsonPrimitive.int, CallGoals.GOALS_RECENT_DAYS)
        assertEquals(c["GOALS_LIST_MAX"]!!.jsonPrimitive.int, CallGoals.GOALS_LIST_MAX)
        assertEquals(c["GOAL_CHECK_STALE_MS"]!!.jsonPrimitive.long, CallGoals.GOAL_CHECK_STALE_MS)
        assertEquals(c["GOAL_MAX_GAP"]!!.jsonPrimitive.int, CallGoals.GOAL_MAX_GAP)
        assertEquals(c["GOAL_MAX_SPAN"]!!.jsonPrimitive.int, CallGoals.GOAL_MAX_SPAN)
        assertEquals(c["GOAL_MIN_CONTENT"]!!.jsonPrimitive.int, CallGoals.GOAL_MIN_CONTENT)
        assertEquals(c["GOAL_UTTERANCE_MAX"]!!.jsonPrimitive.int, CallGoals.GOAL_UTTERANCE_MAX)
        assertEquals(str(c["GOALS_TITLE"]), CallGoals.GOALS_TITLE)
        assertEquals(str(c["GOALS_MENU_LABEL"]), CallGoals.GOALS_MENU_LABEL)
        assertEquals(str(c["GOALS_ADD_PLACEHOLDER"]), CallGoals.GOALS_ADD_PLACEHOLDER)
        assertEquals(str(c["GOAL_CHECKING_LABEL"]), CallGoals.GOAL_CHECKING_LABEL)
        assertEquals(str(c["GOAL_TICK_LABEL"]), CallGoals.GOAL_TICK_LABEL)
        assertEquals(str(c["GOAL_UNTICK_LABEL"]), CallGoals.GOAL_UNTICK_LABEL)
    }

    @Test fun picks() {
        for (p in root["picks"]!!.jsonArray) {
            val o = p.jsonObject
            val picked = CallGoals.pickCallGoals(o["structures"]!!.jsonArray.map { structure(it.jsonObject) }, strs(o["used"]), o["now"]!!.jsonPrimitive.long)
            assertEquals(strs(o["picked"]), picked.map { it.name }, "$o")
            var n = 0
            val goals = CallGoals.goalsFromStructures(picked) { "g${++n}" }
            assertEquals(o["goals"]!!.jsonArray, JsonArray(goals.map { CallGoals.goalJson(it) }), "goals $o")
        }
    }

    @Test fun patternsAndMatches() {
        for (p in root["patterns"]!!.jsonArray) {
            val o = p.jsonObject
            val got = CallGoals.parseGoalPattern(str(o["text"])!!)
            val want = o["parsed"] as? JsonObject
            assertEquals(want?.let { str(it["name"]) to strs(it["fixed"]) }, got, "$o")
        }
        for (m in root["matches"]!!.jsonArray) {
            val o = m.jsonObject
            val s = str(o["s"])!!
            assertEquals(str(o["key"]), CallGoals.goalMatchKey(s), "key $o")
            val want = o["m"] as? JsonObject
            assertEquals(want?.let { it["start"]!!.jsonPrimitive.int to it["end"]!!.jsonPrimitive.int }, CallGoals.matchStructure(s, strs(o["fixed"])), "match $o")
        }
    }

    @Test fun runs() {
        root["runs"]!!.jsonArray.forEachIndexed { k, run ->
            val r = run.jsonObject
            val steps = r["steps"]!!.jsonArray
            var cur: CallGoals.Goals = CallGoals.parse(r["start"])!!
            assertEquals(r["start"], CallGoals.toJson(cur), "start $k")
            var n = cur.goals.size
            val newId = { "k$k-${++n}" }
            for (s in steps) {
                val o = s.jsonObject
                val a = action(o["action"]!!.jsonObject)
                val allowed = CallGoals.mayActOnGoals(a.kind, str(o["by"])!!, "tut", "stu")
                assertEquals(o["allowed"]!!.jsonPrimitive.boolean, allowed, "allowed $o")
                val next = if (allowed) CallGoals.reduceGoals(cur, a, str(o["by"])!!, str(o["by_name"])!!, o["now"]!!.jsonPrimitive.long, newId) else null
                assertEquals(o["changed"]!!.jsonPrimitive.boolean, next != null, "changed $o")
                if (next != null) cur = next
                assertEquals(o["goals"], CallGoals.toJson(cur), "goals $o")
                assertEquals(strs(o["heard"]), CallGoals.goalsHeardIn(str(o["sentence"])!!, cur.goals).map { it.id }, "heard $o")
            }
        }
    }

    @Test fun speech() {
        for (stream in root["streams"]!!.jsonArray) {
            var pending = ""
            for (st in stream.jsonArray) {
                val o = st.jsonObject
                val flush = o["flush"] as? JsonObject
                if (flush != null) {
                    assertEquals(strs(flush["utterances"]), CallGoals.flushGoalSpeech(pending))
                    continue
                }
                val (p, u) = CallGoals.foldGoalSpeech(pending, str(o["raw"])!!)
                assertEquals(strs(o["utterances"]), u, "$o")
                assertEquals(str(o["pending"]), p, "$o")
                pending = p
            }
        }
    }

    @Test fun listenStoredActionsWords() {
        for (l in root["listen"]!!.jsonArray) {
            val o = l.jsonObject
            val statuses = (o["goals"] as? JsonObject)?.get("goals")?.jsonArray?.map { CallGoals.Status.of(str(it.jsonObject["status"]))!! }
            val got = CallGoals.goalListenStatus(o["live"]!!.jsonPrimitive.boolean, o["isStudent"]!!.jsonPrimitive.boolean, statuses, o["micOn"]!!.jsonPrimitive.boolean, o["hasMic"]!!.jsonPrimitive.boolean, o["unavailable"]!!.jsonPrimitive.boolean)
            assertEquals(str(o["status"]), got, "$o")
        }
        for (s in root["stored"]!!.jsonArray) {
            val o = s.jsonObject
            val got = CallGoals.parse(o["raw"])
            assertEquals(o["goals"]!!.let { if (it is JsonNull) null else it }, got?.let { CallGoals.toJson(it) }, "$o")
        }
        for (s in root["actions"]!!.jsonArray) {
            val o = s.jsonObject
            val got = CallGoals.sanitizeAction(o["raw"])
            val want = o["action"]
            if (want == null || want is JsonNull) assertEquals(null, got, "$o") else {
                assertEquals(want, Json.parseToJsonElement(CallGoals.actionMessage(got ?: fail("null for $o"))).jsonObject["action"], "$o")
            }
        }
        for (m in root["may"]!!.jsonArray) {
            val o = m.jsonObject
            assertEquals(o["may"]!!.jsonPrimitive.boolean, CallGoals.mayActOnGoals(str(o["kind"])!!, str(o["user"])!!, str(o["tutor"]), str(o["student"])), "$o")
        }
        val w = root["words"]!!.jsonObject
        for (c in w["chip"]!!.jsonArray) {
            val o = c.jsonObject
            val g = CallGoals.parse(o["goals"])
            assertEquals(str(o["label"]), CallGoals.chipLabel(g), "$o")
            assertEquals(str(o["aria"]), CallGoals.chipAria(g), "$o")
        }
        for (c in w["intro"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(str(o["text"]), CallGoals.intro(o["student"]!!.jsonPrimitive.boolean, str(o["name"])!!))
        }
        for (c in w["empty"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(str(o["text"]), CallGoals.emptyText(o["student"]!!.jsonPrimitive.boolean, str(o["name"])!!, o["available"]!!.jsonPrimitive.long))
        }
        for (c in w["listen"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(str(o["text"]), CallGoals.listenNote(str(o["status"])!!, o["student"]!!.jsonPrimitive.boolean))
        }
        for (c in w["source"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(str(o["text"]), CallGoals.sourceLine(str(o["source"])!!, str(o["last_met"])), "$o")
        }
        for (c in w["hit"]!!.jsonArray) {
            val o = c.jsonObject
            val h = o["hit"]!!.jsonObject
            assertEquals(str(o["text"]), CallGoals.hitCaption(CallGoals.Hit(str(h["text"])!!, h["at"]!!.jsonPrimitive.long, str(h["by"])!!, str(h["name"]))))
        }
        val sum = root["summary"]!!.jsonObject
        val goals = CallGoals.parse(buildGoals(sum["goals"]!!))!!.goals
        val s = CallGoals.summary(goals)
        val want = sum["summary"]!!.jsonObject
        assertEquals(want["used"]!!.jsonArray.map { val u = it.jsonObject; Triple(str(u["name"])!!, str(u["text"])!!, str(u["by"])!!) }, s.used)
        assertEquals(want["near"]!!.jsonArray.map { val u = it.jsonObject; str(u["name"])!! to str(u["text"])!! }, s.near)
        assertEquals(strs(want["not_tried"]), s.notTried)
        assertEquals(str(sum["notes"]), CallGoals.notes(s))
        val second = goals.map { it.copy(status = CallGoals.Status.OPEN, used = null) }
        assertEquals(sum["merged"], JsonArray(CallGoals.mergeLessonGoals(listOf(goals, second)).map { CallGoals.goalJson(it) }))
    }

    private fun buildGoals(list: JsonElement): JsonObject = JsonObject(mapOf("goals" to list, "student_id" to JsonPrimitive("s"), "student_name" to JsonPrimitive("J")))
}
