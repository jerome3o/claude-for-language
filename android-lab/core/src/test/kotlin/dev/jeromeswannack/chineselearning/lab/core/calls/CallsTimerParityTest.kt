package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallTimer.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTimer.Mode
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Calls: CallTimer reproduces shared/calls/timer.ts exactly (parity/fixtures/calls-timer.ts). */
class CallsTimerParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-timer.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun lng(e: JsonElement?): Long? = if (e == null || e is JsonNull) null else e.jsonPrimitive.longOrNull

    private fun action(o: JsonObject): Action = when (str(o["kind"])) {
        "set" -> Action.Set(Mode.of(str(o["mode"]))!!, lng(o["duration_ms"]), o["start"]?.jsonPrimitive?.boolean == true)
        "start" -> Action.Start
        "pause" -> Action.Pause
        "reset" -> Action.Reset
        "clear" -> Action.Clear
        else -> fail("unknown action $o")
    }

    @Test fun constants() {
        val c = root["constants"]!!.jsonObject
        assertEquals(c["MAX_TIMER_MS"]!!.jsonPrimitive.long, CallTimer.MAX_TIMER_MS)
        assertEquals(c["MIN_TIMER_MS"]!!.jsonPrimitive.long, CallTimer.MIN_TIMER_MS)
        assertEquals(c["TIMER_FLASH_MS"]!!.jsonPrimitive.long, CallTimer.TIMER_FLASH_MS)
        assertEquals(c["TIMER_PRESET_MINUTES"]!!.jsonArray.map { it.jsonPrimitive.long.toInt() }, CallTimer.TIMER_PRESET_MINUTES)
        assertEquals(str(c["TIMER_BUTTON_LABEL"]), CallTimer.TIMER_BUTTON_LABEL)
        assertEquals(str(c["TIMER_UP_LABEL"]), CallTimer.TIMER_UP_LABEL)
        assertEquals(str(c["TIMER_COUNTDOWN_LABEL"]), CallTimer.TIMER_COUNTDOWN_LABEL)
        assertEquals(str(c["TIMER_STOPWATCH_LABEL"]), CallTimer.TIMER_STOPWATCH_LABEL)
        for (e in root["control"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(o["can"]!!.jsonPrimitive.boolean, CallTimer.canControlTimer(str(o["user"])!!, str(o["tutor"])), "$o")
        }
    }

    @Test fun runs() {
        var checked = 0
        root["runs"]!!.jsonArray.forEachIndexed { k, run ->
            var n = 0
            val newId = { "t$k-${++n}" }
            var cur: CallTimer.Timer? = null
            for (s in run.jsonObject["steps"]!!.jsonArray) {
                val o = s.jsonObject
                val now = o["now"]!!.jsonPrimitive.long
                cur = CallTimer.reduceTimer(cur, action(o["action"]!!.jsonObject), str(o["by"])!!, str(o["by_name"])!!, now, newId)
                val expected = CallTimer.parse(o["timer"])
                assertEquals(expected, cur, "step $o")
                if (cur == null) continue
                assertEquals(lng(o["ends_at"]), CallTimer.timerEndsAt(cur), "endsAt $o")
                assertEquals(str(o["key"]), CallTimer.timerFinishKey(cur))
                for (ve in o["views"]!!.jsonArray) {
                    val v = ve.jsonObject
                    val t = v["t"]!!.jsonPrimitive.long
                    assertEquals(v["elapsed"]!!.jsonPrimitive.long, CallTimer.timerElapsed(cur, t), "elapsed $v")
                    assertEquals(v["shown"]!!.jsonPrimitive.long, CallTimer.timerShown(cur, t), "shown $v")
                    assertEquals(v["done"]!!.jsonPrimitive.boolean, CallTimer.timerDone(cur, t))
                    assertEquals(str(v["label"]), CallTimer.timerLabel(cur, t), "label $v")
                    assertEquals(str(v["by_me"]), CallTimer.timerByLine(cur, "tutor", t), "by me $v")
                    assertEquals(str(v["by_other"]), CallTimer.timerByLine(cur, "student", t), "by other $v")
                    assertEquals(str(v["aria"]), CallTimer.timerAria(cur, t))
                    assertEquals(v["chime_saw"]!!.jsonPrimitive.boolean, CallTimer.shouldChimeTimer(cur, t, null, true))
                    assertEquals(v["chime_unseen"]!!.jsonPrimitive.boolean, CallTimer.shouldChimeTimer(cur, t, null, false))
                    assertEquals(v["chime_done"]!!.jsonPrimitive.boolean, CallTimer.shouldChimeTimer(cur, t, CallTimer.timerFinishKey(cur), true))
                    checked++
                }
            }
        }
        assertTrue(checked > 1000, "checked $checked views")
    }

    @Test fun stored() {
        for (e in root["stored"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(CallTimer.parse(o["timer"]), CallTimer.parse(o["raw"]), "$o")
        }
    }

    @Test fun words() {
        for (e in root["format"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(str(o["text"]), CallTimer.formatTimer(o["ms"]!!.jsonPrimitive.long, o["up"]!!.jsonPrimitive.boolean), "$o")
        }
        for (e in root["minutes"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(str(o["text"]), CallTimer.minutesLabel(o["ms"]!!.jsonPrimitive.long), "$o")
        }
        for (e in root["inputs"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(lng(o["ms"]), CallTimer.parseTimerInput(str(o["text"])!!), "$o")
        }
    }

    @Test fun actionMessages() {
        assertEquals("""{"type":"timer","action":{"kind":"set","mode":"countdown","duration_ms":300000,"start":true}}""", CallTimer.actionMessage(Action.Set(Mode.COUNTDOWN, 300_000, true)))
        assertEquals("""{"type":"timer","action":{"kind":"set","mode":"stopwatch"}}""", CallTimer.actionMessage(Action.Set(Mode.STOPWATCH)))
        assertEquals("""{"type":"timer","action":{"kind":"pause"}}""", CallTimer.actionMessage(Action.Pause))
    }
}
