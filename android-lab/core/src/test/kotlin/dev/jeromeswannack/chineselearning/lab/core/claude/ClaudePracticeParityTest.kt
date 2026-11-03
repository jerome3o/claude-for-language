package dev.jeromeswannack.chineselearning.lab.core.claude

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
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** Practice with Claude reproduces shared/claude/practice.ts (parity/fixtures/claude-practice.ts). */
class ClaudePracticeParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "claude-practice.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content

    private fun ctx(e: JsonElement?): ClaudePractice.Context? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return ClaudePractice.Context(
            scenario = o["scenario"].str,
            aiRole = o["ai_role"].str,
            userRole = o["user_role"].str,
            level = o["level"].str,
            noteId = o["note_id"].str,
            voiceId = o["voice_id"].str,
            label = o["label"].str,
        )
    }

    @Test
    fun constants() {
        assertEquals(f["defaultLevel"].str, ClaudePractice.DEFAULT_LEVEL)
        assertEquals(f["textMax"]!!.jsonPrimitive.int, ClaudePractice.TEXT_MAX)
        assertEquals(f["voiceSpeed"]!!.jsonPrimitive.double, ClaudePractice.VOICE_SPEED)
        assertEquals(
            f["levels"]!!.jsonArray.map { it.jsonObject.let { l -> ClaudePractice.Level(l["id"].str!!, l["label"].str!!, l["hint"].str!!) } },
            ClaudePractice.LEVELS,
        )
        assertEquals(
            f["scenarios"]!!.jsonArray.map {
                it.jsonObject.let { s -> ClaudePractice.Scenario(s["id"].str!!, s["icon"].str!!, s["label"].str!!, s["scenario"].str!!, s["ai_role"].str!!, s["user_role"].str!!) }
            },
            ClaudePractice.SCENARIOS,
        )
        for (c in f["parseLevel"]!!.jsonArray) assertEquals(c.jsonObject["out"].str, ClaudePractice.parseLevel(c.jsonObject["in"].str), c.toString())
    }

    @Test
    fun contextsAndCards() {
        for (c in f["contexts"]!!.jsonArray) {
            val i = c.jsonObject["in"]!!.jsonObject
            assertEquals(ctx(c.jsonObject["out"]), ClaudePractice.practiceContext(i["scenario"].str, i["ai_role"].str, i["user_role"].str, i["level"].str), c.toString())
        }
        for (c in f["fromCard"]!!.jsonArray) {
            val i = c.jsonObject["in"]!!.jsonObject
            assertEquals(ctx(c.jsonObject["out"]), ClaudePractice.fromCard(i["id"].str!!, i["hanzi"].str!!, c.jsonObject["level"].str), c.toString())
        }
    }

    @Test
    fun voices() {
        for (c in f["voices"]!!.jsonArray) {
            val i = c.jsonObject["in"]!!.jsonObject
            assertEquals(c.jsonObject["out"].str, ClaudePractice.voiceFor(i["voice_id"].str, i["scenario"].str, i["ai_role"].str), c.toString())
        }
    }

    @Test
    fun helpRequests() {
        for (c in f["help"]!!.jsonArray) {
            val o = c.jsonObject
            val text = o["text"].str!!
            assertEquals(o["help"]!!.jsonPrimitive.boolean, ClaudePractice.isHelpRequest(text), text)
            assertEquals(o["reply"].str, ClaudePractice.replyLanguage(text, o["language"].str!!), text)
        }
    }
}
