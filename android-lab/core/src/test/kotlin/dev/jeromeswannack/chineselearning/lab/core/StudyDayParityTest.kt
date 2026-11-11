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
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * "When does a new day start" — StudyDay.kt must give exactly the study days of
 * shared/study/studyDay.ts (parity/fixtures/study-day.ts → study-day.json), DST nights included,
 * and introduced-today / the daily reader must follow the study day's start like the web.
 */
class StudyDayParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "study-day.json").readText()).jsonObject
    }

    private fun list(key: String) = fixture[key]!!.jsonArray.map { it.jsonObject }
    private fun str(e: kotlinx.serialization.json.JsonElement?) = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    @Test fun constants() {
        assertEquals(fixture["default_hour"]!!.jsonPrimitive.int, StudyDay.DEFAULT_ROLLOVER_HOUR)
        assertEquals(fixture["choices"]!!.jsonArray.map { it.jsonPrimitive.int }, StudyDay.CHOICES)
        assertEquals(fixture["labels"]!!.jsonArray.map { it.jsonPrimitive.content }, StudyDay.CHOICES.map(StudyDay::label))
        for (n in list("normalised")) {
            val v = n["v"]!!
            if (v !is JsonNull && v.jsonPrimitive.double % 1.0 != 0.0) continue // not an Int in Kotlin
            val asInt = if (v is JsonNull) null else v.jsonPrimitive.double.toInt()
            assertEquals(n["hour"]!!.jsonPrimitive.int, StudyDay.rolloverHour(asInt), "normalise $v")
        }
    }

    @Test fun studyDays() {
        val cases = list("days")
        assertTrue(cases.size > 3000)
        for (c in cases) {
            val ms = c["ms"]!!.jsonPrimitive.long
            val zone = ZoneId.of(c["zone"]!!.jsonPrimitive.content)
            val r = c["rollover"]!!.jsonPrimitive.int
            val day = StudyDay.at(ms, r, zone)
            val where = "$ms ${c["zone"]} r=$r"
            assertEquals(StudyDayInfo(c["key"]!!.jsonPrimitive.content, c["start"]!!.jsonPrimitive.long, c["end"]!!.jsonPrimitive.long), day, where)
            assertEquals(day.key, StudyDay.key(ms, r, zone), where)
            assertEquals(c["cutoff"]!!.jsonPrimitive.long, StudyDay.cutoffMs(ms, day), "$where cutoff")
        }
    }

    @Test fun fixedOffsets() {
        for (c in list("offsets")) {
            val ms = c["ms"]!!.jsonPrimitive.long
            val off = c["offset"]!!.jsonPrimitive.int
            val r = c["rollover"]!!.jsonPrimitive.int
            assertEquals(StudyDayInfo(c["key"]!!.jsonPrimitive.content, c["start"]!!.jsonPrimitive.long, c["end"]!!.jsonPrimitive.long), StudyDay.atOffset(ms, r, off), "$ms $off $r")
            assertEquals(c["shift"]!!.jsonPrimitive.int, StudyDay.shiftMinutes(off, r))
            assertEquals(c["shifted_key"]!!.jsonPrimitive.content, c["key"]!!.jsonPrimitive.content)
        }
    }

    @Test fun introducedTodayFromTheStudyDay() {
        val state = ComputedCardState(1, 0.0, 0.0, 0, 0, 0, null, null, null, 2.5, 0, 0, 0)
        for ((i, c) in list("introduced").withIndex()) {
            val dayStart = StudyDay.at(c["now"]!!.jsonPrimitive.long, c["rollover"]!!.jsonPrimitive.int, ZoneId.of(c["zone"]!!.jsonPrimitive.content)).startMs
            assertEquals(c["day_start"]!!.jsonPrimitive.long, dayStart, "case $i day start")
            val cards = c["cards"]!!.jsonArray.map { it.jsonObject }.map {
                QueueCard(it["id"]!!.jsonPrimitive.content, it["note_id"]!!.jsonPrimitive.content, it["deck_id"]!!.jsonPrimitive.content, "hanzi_to_meaning", state)
            }
            val first = c["first"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }
            val expected = c["introduced"]!!.jsonObject.mapValues { (_, v) -> Introduced(v.jsonObject["primary"]!!.jsonPrimitive.int, v.jsonObject["secondary"]!!.jsonPrimitive.int) }
            assertEquals(expected, StudyQueue.introducedToday(cards, first, dayStart).toSortedMap(), "case $i")
        }
    }

    @Test fun dailyReaderFromTheStudyDay() {
        for ((i, c) in list("readers").withIndex()) {
            val now = c["now"]!!.jsonPrimitive.long
            val day = StudyDay.at(now, c["rollover"]!!.jsonPrimitive.int, ZoneId.of(c["zone"]!!.jsonPrimitive.content))
            assertEquals(c["today"]!!.jsonPrimitive.content, day.key, "case $i today")
            val readAt = c["read_at"]!!.jsonPrimitive.long
            val readToday = readAt >= day.startMs && readAt < day.endMs
            assertEquals(c["read_today"]!!.jsonPrimitive.boolean, readToday, "case $i read today")
            val hasUnread = c["has_unread"]!!.jsonPrimitive.boolean
            val offers = if (hasUnread) listOf(ReaderOffer("next", Js.toIsoString(readAt), studyable = true, read = false)) else emptyList()
            assertEquals(str(c["offered"]), DailyReader.pickTodays(offers, readToday) { it }?.id, "case $i offered")
            assertEquals(c["generate"]!!.jsonPrimitive.boolean, DailyReader.shouldGenerate(readToday, hasUnread, str(c["last_attempt"]), day.key), "case $i generate")
        }
    }
}
