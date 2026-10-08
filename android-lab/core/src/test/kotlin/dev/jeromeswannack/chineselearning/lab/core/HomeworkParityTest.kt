package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package E: the Kotlin homework rules reproduce shared/homework exactly (parity/fixtures/homework.ts). */
class HomeworkParityTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonElement.strings(): List<String> = jsonArray.map { it.str!! }

    private fun assertDue(expected: JsonObject, actual: DueLabel, where: String) {
        assertEquals(expected["text"]!!.str, actual.text, "$where text")
        assertEquals(expected["tone"]!!.str, actual.tone, "$where tone")
        assertEquals(expected["days"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.int }, actual.days, "$where days")
    }

    private fun assertProgress(expected: JsonObject, actual: PassProgress, where: String) {
        assertEquals(expected["total"]!!.jsonPrimitive.int, actual.total, "$where total")
        assertEquals(expected["done"]!!.jsonPrimitive.int, actual.done, "$where done")
        assertEquals(expected["remaining"]!!.strings(), actual.remaining, "$where remaining")
        assertEquals(expected["retrying"]!!.jsonPrimitive.int, actual.retrying, "$where retrying")
        assertEquals(expected["complete"]!!.jsonPrimitive.boolean, actual.complete, "$where complete")
    }

    @Test
    fun datesAndDueLabelsMatchTypeScript() {
        val f = fixture("homework.json")
        val today = f["today"]!!.str!!
        for ((i, c) in f["due"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val date = o["date"]!!.str
            assertEquals(o["valid"]!!.jsonPrimitive.boolean, Homework.isDateString(date), "due[$i] valid $date")
            assertDue(o["label"]!!.jsonObject, Homework.dueLabel(date, today), "due[$i] $date")
            if (date != null) assertEquals(o["short"]!!.str, Homework.shortDay(date), "due[$i] short")
        }
        for ((i, c) in f["arithmetic"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(o["add"]!!.str, Homework.addDays(o["from"]!!.str!!, o["days"]!!.jsonPrimitive.int), "arith[$i] add")
            assertEquals(o["between"]!!.jsonPrimitive.int, Homework.daysBetween(o["from"]!!.str!!, o["to"]!!.str!!), "arith[$i] between")
        }
    }

    @Test
    fun passProgressMatchesTypeScript() {
        val passes = fixture("homework.json")["passes"]!!.jsonArray
        for ((i, c) in passes.withIndex()) {
            val o = c.jsonObject
            val events = o["events"]!!.jsonArray.mapIndexed { k, e ->
                val eo = e.jsonObject
                HomeworkEvent("e$k", "a", eo["item_id"]!!.str!!, eo["result"]!!.str!!, eo["created_at"]!!.str!!)
            }
            val p = Homework.passProgress(o["item_ids"]!!.strings(), events)
            assertProgress(o["progress"]!!.jsonObject, p, "pass[$i]")
            assertEquals(o["summary_deck"]!!.str, Homework.passSummary(p, "deck"), "pass[$i] summary deck")
            assertEquals(o["summary_lesson"]!!.str, Homework.passSummary(p, "lesson"), "pass[$i] summary lesson")
            assertEquals(o["progress"]!!.jsonObject["remaining"]!!.jsonArray.firstOrNull()?.str, Homework.nextPassItem(p), "pass[$i] next")
        }
        assertTrue(passes.size >= 300)
    }

    @Test
    fun homeworkScreensMatchTypeScript() {
        val f = fixture("homework.json")
        val today = f["today"]!!.str!!
        for ((i, c) in f["screens"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val assignments = json.decodeFromJsonElement(ListSerializer(HomeworkAssignment.serializer()), o["assignments"]!!)
            val events = json.decodeFromJsonElement(ListSerializer(HomeworkEvent.serializer()), o["events"]!!)
            val items = Homework.toHomeworkItems(assignments, events, today)
            val expected = o["items"]!!.jsonArray
            assertEquals(expected.size, items.size, "screen[$i] items")
            for ((k, e) in expected.withIndex()) {
                val eo = e.jsonObject
                val item = items[k]
                val where = "screen[$i] item ${item.assignment.id}"
                assertEquals(eo["id"]!!.str, item.assignment.id, where)
                assertEquals(eo["done"]!!.jsonPrimitive.boolean, item.done, "$where done")
                assertProgress(eo["progress"]!!.jsonObject, item.progress, where)
                assertDue(eo["due"]!!.jsonObject, item.due, where)
                val t = Homework.titleParts(item.assignment)
                assertEquals(eo["title"]!!.jsonObject["base"]!!.str, t.base, "$where base")
                assertEquals(eo["title"]!!.jsonObject["part"]!!.str, t.part, "$where part")
                assertEquals(eo["detail"]!!.str, Homework.rowDetail(item, false), "$where detail")
                assertEquals(eo["detail_tutor"]!!.str, Homework.rowDetail(item, true), "$where detail tutor")
                assertEquals(eo["status"]!!.str, HomeworkLibrary.itemStatus(item, today), "$where status")
                eo["icon"]?.str?.let { assertEquals(it, Homework.kindIcon(item.assignment.kind), "$where icon") }
            }
            val sorted = Homework.sortHomeworkItems(items)
            assertEquals(o["todo"]!!.strings(), sorted.todo.map { it.assignment.id }, "screen[$i] todo order")
            assertEquals(o["done"]!!.strings(), sorted.done.map { it.assignment.id }, "screen[$i] done order")
            assertEquals(o["one_off_only"]!!.strings(), Homework.oneOffOnlyTargets(assignments).toList(), "screen[$i] one-off only")
            assertEquals(o["homework_pass"]!!.strings(), Homework.homeworkPassTargets(assignments).toList(), "screen[$i] homework pass")
        }
    }

    @Test
    fun fromTutorCardMatchesTypeScript() {
        val f = fixture("homework-tutor-card.json")
        for ((i, c) in f["picks"]!!.jsonArray.withIndex()) {
            val input = c.jsonObject["input"]!!.jsonObject
            val tutors = input["tutors"]!!.jsonArray.map { val o = it.jsonObject; HwTutor(o["relationshipId"]!!.str!!, o["tutorId"]!!.str!!, o["tutorName"]!!.str!!) }
            val decks = input["sharedDecks"]!!.jsonArray.map { val o = it.jsonObject; HwDeckSource(o["relationshipId"]!!.str!!, o["targetDeckId"]!!.str!!, o["sharedAt"]!!.str!!) }
            val lessons = input["lessons"]!!.jsonArray.map { val o = it.jsonObject; HwLessonSource(o["id"]!!.str!!, o["title"]!!.str!!, o["assignedBy"]!!.str, o["assignedRelationshipId"]!!.str, o["createdAt"]!!.str!!, o["status"]!!.str!!) }
            val msgs = input["unreadMessages"]!!.jsonArray.map { val o = it.jsonObject; HwMessage(o["conversationId"]!!.str!!, o["relationshipId"]!!.str, o["text"]!!.str, o["createdAt"]!!.str!!) }
            val local = LinkedHashMap<String, String>().apply { input["localDecks"]!!.jsonArray.forEach { val p = it.jsonArray; put(p[0].str!!, p[1].str!!) } }
            val actual = TutorHomework.pick(tutors, decks, lessons, msgs, local)
            val expected = c.jsonObject["pick"]!!
            if (expected is JsonNull) { assertEquals(null, actual, "pick[$i]"); continue }
            val e = expected.jsonObject
            actual ?: fail("pick[$i] expected a pick")
            assertEquals(e["tutorName"]!!.str, actual.tutorName, "pick[$i] tutor")
            assertEquals(e["relationshipId"]!!.str, actual.relationshipId, "pick[$i] rel")
            val item = e["item"]!!
            when (val a = actual.item) {
                null -> assertTrue(item is JsonNull, "pick[$i] item")
                is HwItem.Deck -> { val io = item.jsonObject; assertEquals("deck", io["kind"]!!.str); assertEquals(io["deckId"]!!.str, a.deckId); assertEquals(io["name"]!!.str, a.name, "pick[$i] name"); assertEquals(io["sentAt"]!!.str, a.sentAt) }
                is HwItem.Lesson -> { val io = item.jsonObject; assertEquals("lesson", io["kind"]!!.str); assertEquals(io["lessonId"]!!.str, a.lessonId); assertEquals(io["title"]!!.str, a.title) }
            }
            val m = e["unreadMessage"]!!
            if (m is JsonNull) assertEquals(null, actual.unreadMessage, "pick[$i] msg")
            else assertEquals(m.jsonObject["conversationId"]!!.str, actual.unreadMessage?.conversationId, "pick[$i] msg")
        }
        for ((i, c) in f["summaries"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val cards = o["cards"]!!.jsonArray.map { val x = it.jsonObject; TutorHomework.CardRow(x["id"]!!.str!!, x["note_id"]!!.str!!, x["queue"]!!.jsonPrimitive.int) }
            val notes = o["notes"]!!.jsonArray.map { val x = it.jsonObject; TutorHomework.NoteRow(x["id"]!!.str!!, x["hanzi"]!!.str!!) }
            val events = o["events"]!!.jsonArray.map { val x = it.jsonObject; TutorHomework.EventRow(x["card_id"]!!.str!!, x["rating"]!!.jsonPrimitive.int) }
            val s = TutorHomework.summarizeDeck(cards, notes, events)
            val es = o["summary"]!!.jsonObject
            assertEquals(es["total"]!!.jsonPrimitive.int, s.total, "summary[$i] total")
            assertEquals(es["started"]!!.jsonPrimitive.int, s.started, "summary[$i] started")
            assertEquals(es["needWork"]!!.strings(), s.needWork, "summary[$i] needWork")
            assertEquals(o["text"]!!.str, TutorHomework.describe(s), "summary[$i] text")
        }
        for (c in f["strip"]!!.jsonArray) assertEquals(c.jsonObject["out"]!!.str, TutorHomework.stripFromTutorSuffix(c.jsonObject["in"]!!.str!!))
    }

    @Test
    fun oneOffOnlyDecksNeverTakeTheDailyBudget() {
        for ((i, c) in fixture("homework-budget.json")["cases"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val pools = o["pools"]!!.jsonArray.map {
                val p = it.jsonObject
                fun n(k: String) = p[k]!!.jsonPrimitive.int
                DeckNewPool(p["deckId"]!!.str!!, n("priority"), p["createdAt"]!!.str!!, n("totalNew"), n("totalSecondaryNew"), n("capPrimary"), n("capSecondary"), n("studiedPrimary"), n("studiedSecondary"))
            }
            val b = o["budget"]!!.jsonObject
            val alloc = Budget.allocateNewCards(pools, StudyBudget(b["new_cards_per_day"]!!.jsonPrimitive.int, b["secondary_cards_per_day"]!!.jsonPrimitive.int), o["bonus"]!!.jsonPrimitive.int)
            val expected = o["alloc"]!!.jsonObject
            assertEquals(expected.keys.toList(), alloc.keys.toList(), "budget[$i] order")
            for ((deck, e) in expected) {
                val a = alloc.getValue(deck)
                assertEquals(e.jsonObject["primary"]!!.jsonPrimitive.int, a.primary, "budget[$i] $deck primary")
                assertEquals(e.jsonObject["secondary"]!!.jsonPrimitive.int, a.secondary, "budget[$i] $deck secondary")
                if (deck.startsWith("oneoff")) assertEquals(DeckAllocation(0, 0), a, "budget[$i] one-off deck $deck took budget")
            }
        }
    }
}
