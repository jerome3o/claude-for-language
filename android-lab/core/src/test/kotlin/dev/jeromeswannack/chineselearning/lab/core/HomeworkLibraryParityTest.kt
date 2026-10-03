package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** The homework library + link homework (shared/homework/library.ts, link.ts) — the same answers as the TypeScript. */
class HomeworkLibraryParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "homework-library.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private val JsonElement?.bool: Boolean get() = if (this == null || this is JsonNull) false else jsonPrimitive.boolean

    @Test
    fun statusToneAndDueTextMatchTypeScript() {
        val cases = fixture()["statusCases"]!!.jsonArray
        assertEquals(400, cases.size)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val today = o["today"].str!!
            val due = o["due"].str
            assertEquals(o["status"].str, HomeworkLibrary.libraryStatus(o["complete"].bool, o["started"].bool, due, today), "case[$i] status")
            assertEquals(o["tone"].str, HomeworkLibrary.statusTone(o["toneStatus"].str!!, due, today), "case[$i] tone")
            assertEquals(o["dueText"].str, HomeworkLibrary.libraryDueText(due, today), "case[$i] dueText")
        }
    }

    @Test
    fun sortFilterCountsAndMostRecentMatchTypeScript() {
        val cases = fixture()["listCases"]!!.jsonArray
        assertEquals(120, cases.size)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val items = o["items"]!!.jsonArray.map { it.jsonObject }.map { j ->
                LibraryItem(
                    key = j["key"].str!!, kind = j["kind"].str!!, title = j["title"].str!!,
                    student_name = j["student_name"].str!!, sent_at = j["sent_at"].str!!, status = j["status"].str!!,
                )
            }
            val keys = { l: List<LibraryItem> -> l.map { it.key } }
            fun expected(name: String) = o[name]!!.jsonArray.map { it.str!! }
            assertEquals(expected("sorted"), keys(HomeworkLibrary.sortLibrary(items)), "case[$i] sorted")
            assertEquals(
                expected("filtered"),
                keys(HomeworkLibrary.filterLibrary(items, o["status"].str, o["kind"].str, o["query"].str)),
                "case[$i] filtered",
            )
            val counts = o["counts"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
            assertEquals(counts, HomeworkLibrary.libraryCounts(items), "case[$i] counts")
            assertEquals(expected("recent"), keys(HomeworkLibrary.mostRecentHomework(items, o["limit"]!!.jsonPrimitive.int)), "case[$i] recent")
        }
    }

    @Test
    fun dueDateChoicesMatchTypeScript() {
        for (c in fixture()["choices"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["choices"]!!.jsonArray.map { it.str }, HomeworkLibrary.dueDateChoices(o["today"].str!!))
        }
    }

    @Test
    fun linksMatchTypeScript() {
        for ((i, l) in fixture()["links"]!!.jsonArray.withIndex()) {
            val o = l.jsonObject
            val raw = o["raw"].str
            val url = HomeworkLinks.normalizeLinkUrl(raw)
            assertEquals(o["url"].str, url, "link[$i] url for ${raw?.take(60)}")
            val probe = url ?: raw.orEmpty()
            assertEquals(o["host"].str, HomeworkLinks.linkHost(probe), "link[$i] host")
            assertEquals(o["videoId"].str, HomeworkLinks.youtubeVideoId(probe), "link[$i] videoId")
            assertEquals(o["thumbnail"].str, HomeworkLinks.linkThumbnail(probe), "link[$i] thumbnail")
            assertEquals(o["site"].str, HomeworkLinks.linkSiteName(probe), "link[$i] site")
        }
    }

    @Test
    fun notesMatchTypeScript() {
        for ((i, n) in fixture()["notes"]!!.jsonArray.withIndex()) {
            val o = n.jsonObject
            assertEquals(o["note"].str, HomeworkLinks.cleanLinkNote(o["raw"].str), "note[$i]")
        }
    }

    /** The cases of library.test.ts / the doc, spelled out so a failure reads plainly. */
    @Test
    fun plainCases() {
        assertEquals("overdue", HomeworkLibrary.libraryStatus(false, true, "2026-10-02", "2026-10-03"))
        assertEquals("completed", HomeworkLibrary.libraryStatus(true, false, "2026-10-01", "2026-10-03"))
        assertEquals("amber", HomeworkLibrary.statusTone("in_progress", "2026-10-04", "2026-10-03"))
        assertEquals("blue", HomeworkLibrary.statusTone("in_progress", "2026-10-09", "2026-10-03"))
        assertEquals("grey", HomeworkLibrary.statusTone("not_started", null, "2026-10-03"))
        assertEquals("Was due 3 days ago", HomeworkLibrary.libraryDueText("2026-09-30", "2026-10-03"))
        val a = LibraryItem(key = "a", title = "A", sent_at = "2026-10-03T10:00:00Z")
        val b = LibraryItem(key = "b", title = "B", sent_at = "2026-10-03T09:40:00Z")
        val c = LibraryItem(key = "c", title = "C", sent_at = "2026-10-03T09:20:00Z")
        assertEquals(listOf("a", "b"), HomeworkLibrary.mostRecentHomework(listOf(c, b, a)).map { it.key })
        assertEquals("https://youtu.be/dQw4w9WgXcQ", HomeworkLinks.normalizeLinkUrl("youtu.be/dQw4w9WgXcQ"))
        assertNull(HomeworkLinks.normalizeLinkUrl("javascript:alert(1)"))
        assertEquals("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", HomeworkLinks.linkThumbnail("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        assertTrue(HomeworkLinks.cleanLinkNote("  ") == null)
    }
}
