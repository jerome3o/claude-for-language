package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Prepared in-call activities: PreparedActivities reproduces shared/call-activities/prepared.ts (parity/fixtures/prepared-activities.ts). */
class PreparedActivitiesParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "prepared-activities.json").readText()).jsonObject
    }
    private val j = CallActivities.json
    private fun str(e: kotlinx.serialization.json.JsonElement?) = e?.takeIf { it !is JsonNull }?.jsonPrimitive?.content

    @Test fun ids() {
        for (c in root["ids"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(str(o["row"]), PreparedActivities.rowId(str(o["id"])!!), "id ${o["id"]}")
        }
        assertEquals(str(root["activity_id"]), PreparedActivities.activityId("job-1-2"))
    }

    @Test fun copy() {
        for (c in root["headlines"]!!.jsonArray) assertEquals(str(c.jsonObject["text"]), PreparedActivities.headline(c.jsonObject["n"]!!.jsonPrimitive.int))
        for (c in root["names"]!!.jsonArray) {
            val o = c.jsonObject
            val name = str(o["name"])
            assertEquals(str(o["first"]), PreparedActivities.firstName(name), "first of $name")
            assertEquals(str(o["section"]), PreparedActivities.sectionTitle(name))
        }
        for (c in root["coverages"]!!.jsonArray) {
            val o = c.jsonObject
            val cov = j.decodeFromJsonElement(StudentCoverage.serializer(), o["coverage"]!!)
            assertEquals(str(o["headline"]), PreparedActivities.coverageHeadline(cov))
        }
    }

    @Test fun previews() {
        val all = root["previews"]!!.jsonArray
        assertTrue(all.size > 40)
        for (c in all) {
            val o = c.jsonObject
            val spec = j.decodeFromJsonElement(ActivitySpec.serializer(), o["spec"]!!)
            val want = o["lines"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(want, PreparedActivities.preview(spec, o["max"]!!.jsonPrimitive.int), "preview of ${spec.id} max ${o["max"]}")
        }
    }

    @Test fun order() {
        for (c in root["orders"]!!.jsonArray) {
            val o = c.jsonObject
            val list = o["list"]!!.jsonArray.map { j.decodeFromJsonElement(PreparedActivity.serializer(), it) }
            assertEquals(o["ids"]!!.jsonArray.map { it.jsonPrimitive.content }, PreparedActivities.order(list).map { it.id })
        }
    }
}
