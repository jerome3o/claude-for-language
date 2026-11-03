package dev.jeromeswannack.chineselearning.lab.core.claude

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** What a tutor can read of her student's Claude chats reproduces shared/claude/visibility.ts (parity/fixtures/claude-tutor-visibility.ts). */
class TutorVisibilityParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "claude-tutor-visibility.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private val JsonElement?.bool: Boolean? get() = if (this == null || this is JsonNull) null else jsonPrimitive.booleanOrNull

    @Test
    fun constants() {
        assertEquals(f["values"]!!.jsonArray.map { it.str }, TutorVisibility.VALUES)
        assertEquals(f["defaultValue"].str, TutorVisibility.DEFAULT)
        assertEquals(f["explainer"].str, TutorVisibility.EXPLAINER)
        assertEquals(
            f["options"]!!.jsonArray.map { it.jsonObject.let { o -> TutorVisibility.Option(o["id"].str!!, o["label"].str!!, o["hint"].str!!) } },
            TutorVisibility.OPTIONS,
        )
        for (c in f["parse"]!!.jsonArray) assertEquals(c.jsonObject["out"].str, TutorVisibility.parse(c.jsonObject["in"].str), c.toString())
        for (c in f["today"]!!.jsonArray) assertEquals(c.jsonObject["out"].str, TutorVisibility.askedClaudeTodayLabel(c.jsonObject["in"]!!.jsonPrimitive.int), c.toString())
        for (c in f["empty"]!!.jsonArray) assertEquals(c.jsonObject["out"].str, TutorVisibility.tutorEmptyText(c.jsonObject["name"].str, c.jsonObject["visibility"].str), c.toString())
        for (c in f["readOnly"]!!.jsonArray) assertEquals(c.jsonObject["out"].str, TutorVisibility.tutorReadOnlyLine(c.jsonObject["in"].str), c.toString())
    }

    @Test
    fun theRule() {
        val cases = f["cases"]!!.jsonArray
        check(cases.size > 50)
        for (c in cases) {
            val o = c.jsonObject
            val setting = o["setting"].str!!
            val kind = o["kind"].str
            val tv = o["tutor_visible"].bool
            assertEquals(o["byDefault"]!!.jsonPrimitive.boolean, TutorVisibility.visibleByDefault(kind, setting), c.toString())
            assertEquals(o["canSee"]!!.jsonPrimitive.boolean, TutorVisibility.tutorCanSee(kind, tv, setting), c.toString())
            assertEquals(o["next"].bool, TutorVisibility.nextTutorVisible(kind, tv, setting), c.toString())
            assertEquals(o["menu"].str, TutorVisibility.shareMenuLabel(kind, tv, setting), c.toString())
            assertEquals(o["line"].str, TutorVisibility.sharedLine(kind, tv, setting, "Minghui"), c.toString())
            assertEquals(o["lineNoName"].str, TutorVisibility.sharedLine(kind, tv, setting, "  "), c.toString())
        }
    }
}
