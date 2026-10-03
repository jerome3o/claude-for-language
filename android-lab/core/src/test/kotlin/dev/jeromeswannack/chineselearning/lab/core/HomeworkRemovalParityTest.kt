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
import kotlin.test.fail

/** Taking homework back (shared/homework/removal.ts) — the same words, character for character. */
class HomeworkRemovalParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "homework-removal.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private val JsonElement?.intOrNull: Int? get() = if (this == null || this is JsonNull) null else jsonPrimitive.int
    private val JsonElement?.bool: Boolean get() = if (this == null || this is JsonNull) false else jsonPrimitive.boolean

    @Test
    fun confirmSheetWordsMatchTypeScript() {
        val cases = fixture()["cases"]!!.jsonArray
        assertEquals(209, cases.size)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val f = o["facts"]!!.jsonObject
            val facts = RemovalFacts(
                kind = f["kind"].str!!,
                title = f["title"].str!!,
                wordsMet = f["words_met"].intOrNull,
                wordsTotal = f["words_total"].intOrNull,
                times = f["times"].intOrNull,
                copyGone = f["copy_gone"].bool,
                canDeleteSource = f["can_delete_source"].bool,
            )
            val copy = HomeworkRemoval.removalCopy(facts, o["name"].str)
            val e = o["copy"]!!.jsonObject
            assertEquals(e["menuLabel"].str, copy.menuLabel, "case[$i] menuLabel")
            assertEquals(e["title"].str, copy.title, "case[$i] title")
            assertEquals(e["body"].str, copy.body, "case[$i] body")
            assertEquals(e["detail"].str, copy.detail, "case[$i] detail")
            assertEquals(e["sourceOption"].str, copy.sourceOption, "case[$i] sourceOption")
            assertEquals(e["confirmLabel"].str, copy.confirmLabel, "case[$i] confirmLabel")
        }
    }

    @Test
    fun namesAndLabelsMatchTypeScript() {
        for ((i, n) in fixture()["names"]!!.jsonArray.withIndex()) {
            val o = n.jsonObject
            val name = o["name"].str
            assertEquals(o["first"].str, HomeworkRemoval.studentFirstName(name), "name[$i] first")
            assertEquals(o["undo"].str, HomeworkRemoval.removalUndoLabel(name), "name[$i] undo")
            val menu = o["menu"]!!.jsonArray.map { it.str }
            assertEquals(menu, listOf("deck", "lesson", "reader").map { HomeworkRemoval.removalMenuLabel(it, name) }, "name[$i] menu")
        }
    }

    @Test
    fun toastsMatchTypeScript() {
        for ((i, t) in fixture()["toasts"]!!.jsonArray.withIndex()) {
            val o = t.jsonObject
            assertEquals(
                o["text"].str,
                HomeworkRemoval.removalToast(o["kind"].str!!, o["title"].str!!, o["name"].str, o["sourceDeleted"].bool),
                "toast[$i]",
            )
        }
    }

    /** The cases of removal.test.ts, spelled out so a failure reads plainly. */
    @Test
    fun webUnitCases() {
        assertEquals("Jerome", HomeworkRemoval.studentFirstName("Jerome Swannack"))
        assertEquals("your student", HomeworkRemoval.studentFirstName("  "))
        assertEquals("Remove from Jerome's decks", HomeworkRemoval.removalMenuLabel("deck", "Jerome Swannack"))
        assertEquals("Remove from Jerome's lessons", HomeworkRemoval.removalMenuLabel("lesson", "Jerome"))
        assertEquals("Undo — remove from Jerome", HomeworkRemoval.removalUndoLabel("Jerome"))
        val c = HomeworkRemoval.removalCopy(RemovalFacts("deck", "HSK 1", wordsMet = 0, wordsTotal = 319, canDeleteSource = true), "Jerome")
        assertEquals("Remove “HSK 1” from Jerome's decks?", c.title)
        assertEquals("Jerome hasn't started this — nothing is lost.", c.body)
        assertEquals("Also delete my copy", c.sourceOption)
        val s = HomeworkRemoval.removalCopy(RemovalFacts("deck", "Lesson 8", wordsMet = 12, wordsTotal = 40), "Jerome")
        assertEquals("Jerome has met 12 of 40 words; their progress on these words will be deleted.", s.body)
        assertNull(s.sourceOption)
        assertEquals("Jerome has done this lesson twice; that history will be deleted.", HomeworkRemoval.removalCopy(RemovalFacts("lesson", "Tones", times = 2), "Jerome").body)
        assertEquals("Removed “HSK 1” from Jerome's decks and deleted your copy", HomeworkRemoval.removalToast("deck", "HSK 1", "Jerome", true))
    }
}
