package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** The take lock (shared/voice/takeLock.ts): phases, combinations, footer / proceed / leave rules, copy. */
class TakeLockParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "take-lock.json").readText()).jsonObject
    }

    @Test
    fun copyAndPhasesMatchTypeScript() {
        val f = fixture()
        val copy = f["copy"]!!.jsonObject
        assertEquals(copy["stop"]!!.jsonPrimitive.content, TakeLock.STOP)
        assertEquals(copy["checking"]!!.jsonPrimitive.content, TakeLock.CHECKING_LINE)
        assertEquals(f["phases"]!!.jsonArray.map { it.jsonPrimitive.content }, TakeLock.PHASES)
        // The study sentence rows' stop bar says the same.
        assertEquals(TakeLock.STOP, SentencePractise.STOP_RECORDING)
    }

    @Test
    fun rulesMatchTypeScript() {
        val f = fixture()
        for (c in f["flags"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["phase"]!!.jsonPrimitive.content, TakeLock.phase(o["recording"]!!.jsonPrimitive.boolean, o["checking"]!!.jsonPrimitive.boolean))
        }
        for (c in f["combined"]!!.jsonArray) {
            val o = c.jsonObject
            val phases = o["phases"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(o["phase"]!!.jsonPrimitive.content, TakeLock.combine(phases), phases.toString())
        }
        for (c in f["rules"]!!.jsonArray) {
            val o = c.jsonObject
            val phase = o["phase"]!!.jsonPrimitive.content
            assertEquals(o["footer"]!!.jsonPrimitive.content, TakeLock.footer(phase), phase)
            assertEquals(o["mayProceed"]!!.jsonPrimitive.boolean, TakeLock.mayProceed(phase), phase)
            assertEquals(o["leave"]!!.jsonPrimitive.content, TakeLock.leave(phase), phase)
            assertEquals(o["row"]!!.jsonPrimitive.content, TakeLock.row(phase, false), phase)
            assertEquals(o["rowPinned"]!!.jsonPrimitive.content, TakeLock.row(phase, true), phase)
        }
    }
}
