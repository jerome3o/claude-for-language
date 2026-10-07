package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
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
 * Graded readers are read once — DailyReader.kt must pick, generate and play exactly like
 * shared/study/daily-reader.ts (parity/fixtures/daily-reader.ts → daily-reader.json).
 */
class DailyReaderParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "daily-reader.json").readText()).jsonObject
    }

    private fun list(key: String) = fixture[key]!!.jsonArray.map { it.jsonObject }
    private fun str(e: kotlinx.serialization.json.JsonElement?) = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    @Test fun constants() {
        assertEquals(fixture["readers_per_day"]!!.jsonPrimitive.int, DailyReader.READERS_PER_DAY)
        assertEquals(fixture["story_page_gap_ms"]!!.jsonPrimitive.long, DailyReader.STORY_PAGE_GAP_MS)
    }

    @Test fun picksTheSameReader() {
        val cases = list("picks")
        assertTrue(cases.size >= 400)
        for ((i, c) in cases.withIndex()) {
            val readers = c["readers"]!!.jsonArray.map { it.jsonObject }.map {
                ReaderOffer(it["id"]!!.jsonPrimitive.content, it["created_at"]!!.jsonPrimitive.content, it["studyable"]!!.jsonPrimitive.boolean, it["read"]!!.jsonPrimitive.boolean)
            }
            val readToday = c["read_today"]!!.jsonPrimitive.boolean
            assertEquals(str(c["picked"]), DailyReader.pickTodays(readers, readToday) { it }?.id, "pick #$i $c")
            assertEquals(str(c["next"]), DailyReader.nextUnread(readers) { it }?.id, "next #$i $c")
        }
    }

    @Test fun generatesOnlyWhenNothingIsWaiting() {
        for (c in list("generate")) {
            val got = DailyReader.shouldGenerate(
                c["readToday"]!!.jsonPrimitive.boolean,
                c["hasUnread"]!!.jsonPrimitive.boolean,
                str(c["lastAttemptDate"]),
                c["today"]!!.jsonPrimitive.content,
            )
            assertEquals(c["want"]!!.jsonPrimitive.boolean, got, "generate $c")
        }
    }

    @Test fun playWholeStory() {
        for (c in list("pages")) {
            val want = c["next"].let { if (it == null || it is JsonNull) null else it.jsonPrimitive.int }
            assertEquals(want, DailyReader.storyNextPage(c["index"]!!.jsonPrimitive.int, c["count"]!!.jsonPrimitive.int), "page $c")
        }
        for (c in list("gaps")) {
            assertEquals(c["gap"]!!.jsonPrimitive.long, DailyReader.storyPageGapMs(c["speed"]!!.jsonPrimitive.double), "gap $c")
        }
    }
}
