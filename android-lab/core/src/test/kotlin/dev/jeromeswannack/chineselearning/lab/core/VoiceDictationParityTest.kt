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

/** The voice-first text box reproduces shared/voice/dictation.ts exactly (parity/fixtures/voice-dictation.ts). */
class VoiceDictationParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "voice-dictation.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun rows(key: String) = data[key]!!.jsonArray.map { it.jsonObject }
    private fun state(o: JsonObject) = VoiceDictation.State(o["mode"].str!!, o["phase"].str!!, o["failure"].str, o["blocked"].str)

    @Test
    fun modesAndRows() {
        for (r in rows("initial")) assertEquals(r["mode"].str, VoiceDictation.initialMode(r["default_mode"].str, r["blocked"].str), r.toString())
        for (r in rows("mic_shown")) assertEquals(r["shown"]!!.jsonPrimitive.boolean, VoiceDictation.voiceButtonShown(r["blocked"].str))
        val controls = rows("controls")
        assertTrue(controls.size >= 200)
        for (r in controls) {
            val want = r["controls"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(want, VoiceDictation.controls(state(r["state"]!!.jsonObject)), r.toString())
        }
    }

    @Test
    fun answersAndSources() {
        val answers = rows("answers")
        assertTrue(answers.size > 1000)
        for (r in answers) {
            val got = VoiceDictation.answer(state(r["state"]!!.jsonObject), r["transcript"].str!!, r["typed"].str!!, r["filled"].str)
            val want = r["answer"]!!.let { if (it is JsonNull) null else VoiceDictation.Answer(it.jsonObject["text"].str!!, it.jsonObject["source"].str!!) }
            assertEquals(want, got, r.toString())
        }
        for (r in rows("sources")) assertEquals(r["source"].str, VoiceDictation.source(r["text"].str!!, r["filled"].str), r.toString())
        for (r in rows("joins")) assertEquals(r["joined"].str, VoiceDictation.join(r["a"].str!!, r["b"].str!!), r.toString())
    }

    @Test
    fun errorsOutcomesAndCopy() {
        for (r in rows("mic_errors")) assertEquals(r["block"].str, VoiceDictation.micErrorBlock(r["name"].str), r.toString())
        for (r in rows("reasons")) assertEquals(r["reason"].str, VoiceDictation.blockReason(r["blocked"].str!!))
        for (r in rows("outcomes")) assertEquals(r["outcome"].str, VoiceDictation.outcome(r["result"].str!!), r.toString())
        for (r in rows("typed_outcomes")) assertEquals(r["outcome"].str, VoiceDictation.typedOutcome(r["source"].str!!))
        for (r in rows("hints")) assertEquals(r["hints"]!!.jsonArray.map { it.jsonPrimitive.content }, VoiceDictation.languageHints(r["lang"].str))
        val copy = data["copy"]!!.jsonObject.mapValues { it.value.str }
        assertEquals(copy, VoiceDictation.Copy.ALL)
    }
}
