package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * "Notes from your tutor" + the practice rule (shared/tutor-notes): the new / earlier merge, the
 * Home line, and — the FSRS guard — a practice rating counts as a review only when the card is due.
 */
class TutorNotesParityTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "tutor-notes.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun rows(e: JsonElement) = json.decodeFromJsonElement(ListSerializer(TutorNoteRow.serializer()), e)

    @Test
    fun mergeAndHomeLineMatchTypeScript() {
        val f = fixture()
        for ((i, c) in f["merges"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val unseen = o["unseen"]!!.jsonArray.map {
                val u = it.jsonObject
                UnseenTutorNote(u["id"]!!.str!!, u["kind"]!!.str!!, u["card_id"]!!.str, u["note_id"]!!.str!!, u["hanzi"]!!.str!!, u["comment"]!!.str!!, u["tutor_name"]!!.str, u["updated_at"]!!.str!!)
            }
            val list = TutorNotesRules.merge(rows(o["all"]!!), unseen)
            assertEquals(rows(o["fresh"]!!), list.fresh, "merge[$i] fresh")
            assertEquals(rows(o["earlier"]!!), list.earlier, "merge[$i] earlier")
            assertEquals(o["line"]!!.str, TutorNotesRules.homeLine(list.fresh.map { it.tutor_name }), "merge[$i] line")
        }
        for (l in f["labels"]!!.jsonArray) assertEquals(l.jsonObject["label"]!!.str, TutorNotesRules.label(l.jsonObject["kind"]!!.str!!))
    }

    @Test
    fun practiceRulesMatchTypeScript() {
        val f = fixture()
        for ((i, c) in f["counts"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val due = o["due_ms"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long }
            val counts = TutorNotesRules.practiceRatingCounts(o["queue"]!!.jsonPrimitive.int, due, o["cutoff"]!!.jsonPrimitive.long)
            assertEquals(o["counts"]!!.jsonPrimitive.boolean, counts, "counts[$i]")
            assertEquals(o["hint"]!!.str, TutorNotesRules.practiceHint(counts), "hint[$i]")
        }
        for ((i, c) in f["after"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonArray.map { it.str!! }, TutorNotesRules.practiceAfterRating(o["queue"]!!.jsonArray.map { it.str!! }, o["cardId"]!!.str!!, o["rating"]!!.jsonPrimitive.int), "after[$i]")
        }
        for ((i, c) in f["cardPicks"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val notes = o["notes"]!!.jsonArray.map { val n = it.jsonObject; n["card_id"]!!.str to n["note_id"]!!.str!! }
            val byNote = LinkedHashMap<String, List<Pair<String, String>>>()
            for (p in o["cardsByNote"]!!.jsonArray) {
                val pair = p.jsonArray
                byNote[pair[0].str!!] = pair[1].jsonArray.map { val cc = it.jsonObject; cc["id"]!!.str!! to cc["card_type"]!!.str!! }
            }
            assertEquals(o["result"]!!.jsonArray.map { it.str!! }, TutorNotesRules.practiceCardIds(notes, byNote), "cardPicks[$i]")
        }
    }

    @Test
    fun practiceNeverCountsANewOrNotDueCard() {
        val cutoff = 1_000_000L
        assertFalse(TutorNotesRules.practiceRatingCounts(0, null, cutoff))
        assertFalse(TutorNotesRules.practiceRatingCounts(2, cutoff + 1, cutoff))
        assertTrue(TutorNotesRules.practiceRatingCounts(2, cutoff, cutoff))
        assertTrue(TutorNotesRules.practiceRatingCounts(1, null, cutoff))
    }
}
