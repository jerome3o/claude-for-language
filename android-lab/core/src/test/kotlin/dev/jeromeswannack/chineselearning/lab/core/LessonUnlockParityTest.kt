package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Unlockable mini lessons must behave exactly like the web: shared/lesson/unlock.ts via
 * parity/fixtures/lesson-unlock.ts → lesson-unlock.json.
 */
class LessonUnlockParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "lesson-unlock.json").readText()).jsonObject
    }

    private fun list(key: String) = fixture[key]!!.jsonArray.map { it.jsonObject }
    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.contentOrNull

    private fun unlock(e: JsonElement?): LessonUnlock? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return LessonUnlock(o["kind"]!!.jsonPrimitive.content, str(o["audio_lesson_id"]), str(o["prompt"]))
    }

    @Test fun lockStatus() {
        val cases = list("statuses")
        assertTrue(cases.size >= 60)
        for (c in cases) assertEquals(c["status"]!!.jsonPrimitive.content, LessonUnlocks.status(unlock(c["unlock"]), str(c["unlocked_at"])), "$c")
    }

    @Test fun earliestUnlockWins() {
        for (c in list("earlier")) assertEquals(str(c["out"]), LessonUnlocks.earlier(str(c["a"]), str(c["b"])), "$c")
    }

    @Test fun listenedToTheEnd() {
        val cases = list("listened")
        assertTrue(cases.size >= 400)
        for (c in cases) {
            val starts = c["starts"]!!.jsonArray.map { it.jsonPrimitive.double }
            assertEquals(c["out"]!!.jsonPrimitive.boolean, LessonUnlocks.listened(c["position"]!!.jsonPrimitive.double, c["duration"]!!.jsonPrimitive.double, starts), "$c")
        }
    }

    @Test fun listensAndLockSets() {
        for (c in list("listens")) {
            val lessons = c["lessons"]!!.jsonArray.map { it.jsonObject }.map { LessonUnlocks.Item(it["id"]!!.jsonPrimitive.content, unlock(it["unlock"]), str(it["unlocked_at"])) }
            fun ids(key: String) = c[key]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(ids("unlocked_by_listen"), LessonUnlocks.unlockedByListen(lessons, c["audio"]!!.jsonPrimitive.content), "$c")
            val (locked, unlocked) = LessonUnlocks.lockSets(lessons)
            assertEquals(ids("locked"), locked.toList(), "locked $c")
            assertEquals(ids("unlocked"), unlocked.toList(), "unlocked $c")
        }
    }

    @Test fun words() {
        val w = fixture["words"]!!.jsonObject
        for (c in w["titles"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["out"]!!.jsonPrimitive.content, LessonUnlocks.companionTitle(c["in"]!!.jsonPrimitive.content))
        for (c in w["buttons"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["out"]!!.jsonPrimitive.content, LessonUnlocks.buttonLabel(unlock(c["unlock"])!!))
        for (c in w["lines"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["out"]!!.jsonPrimitive.content, LessonUnlocks.lockedLine(unlock(c["unlock"])!!, str(c["audio_title"])))
        for (c in w["badges"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["out"]!!.jsonPrimitive.content, LessonUnlocks.companionBadge(c["status"]!!.jsonPrimitive.content))
        for (c in w["ready"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["out"]!!.jsonPrimitive.content, LessonUnlocks.readyLine(c["title"]!!.jsonPrimitive.content))
    }
}
