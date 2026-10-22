package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** Homework sizes (shared/homework/size.ts) — same labels and minutes. */
class HomeworkSizeParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "homework-size.json").readText()).jsonObject
    }

    @Test
    fun sizesMatchTypeScript() {
        val f = fixture()
        assertEquals(f["seconds"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }, HomeworkSize.EXERCISE_SECONDS)
        for ((i, c) in f["cases"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val types = o["types"]!!.jsonArray.map { it.jsonPrimitive.content }
            val n = o["n"]!!.jsonPrimitive.int
            assertEquals(o["minutes"]!!.jsonPrimitive.int, HomeworkSize.exerciseMinutes(types), "case[$i] minutes")
            assertEquals(o["lesson"]!!.jsonPrimitive.content, HomeworkSize.lessonSizeLabel(types), "case[$i] lesson")
            assertEquals(o["revision"]!!.jsonPrimitive.content, HomeworkSize.revisionSizeLabel(n, types), "case[$i] revision")
            assertEquals(o["deck"]!!.jsonPrimitive.content, HomeworkSize.deckSizeLabel(n), "case[$i] deck")
            assertEquals(o["reader"]!!.jsonPrimitive.content, HomeworkSize.readerSizeLabel(n), "case[$i] reader")
        }
    }
}
