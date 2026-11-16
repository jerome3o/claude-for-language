package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** The take lock (docs/STUDY_SESSION.md "While a take is recording") reproduces shared/voice/takeLock.ts exactly. */
class TakeLockParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "take-lock.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun singlePhases() {
        val cases = fixture()["single"]!!.jsonArray
        assertTrue(cases.size > 10)
        for (c in cases) {
            val o = c.jsonObject
            val phase = o["phase"]!!.str
            assertEquals(o["lock"]!!.str, TakeLock.phase(phase), "phase '$phase'")
            assertEquals(o["locked"]!!.jsonPrimitive.boolean, TakeLock.locked(phase), "locked '$phase'")
            assertEquals(o["footer"]!!.str, TakeLock.footer(phase), "footer '$phase'")
            assertEquals(o["guard"]!!.str, TakeLock.guard(phase), "guard '$phase'")
        }
    }

    @Test
    fun merges() {
        val cases = fixture()["merges"]!!.jsonArray
        assertTrue(cases.size > 20)
        for (c in cases) {
            val o = c.jsonObject
            val phases = o["phases"]!!.jsonArray.map { it.str }
            assertEquals(o["merged"]!!.str, TakeLock.merge(phases), "merge $phases")
        }
    }

    @Test
    fun copy() {
        val copy = fixture()["copy"]!!.jsonObject
        assertEquals(copy["stop"]!!.str, TakeLock.STOP_RECORDING)
        assertEquals(copy["checking"]!!.str, TakeLock.CHECKING_LABEL)
        assertEquals(copy["hint"]!!.str, TakeLock.LOCKED_HINT)
        // The sentence rows' bar and the reader's footer say the same words.
        assertEquals(TakeLock.STOP_RECORDING, SentencePractise.STOP_RECORDING)
        assertEquals(TakeLock.STOP_RECORDING, ReadAloud.STOP_RECORDING)
    }
}
