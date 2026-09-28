package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package J: the video fit / PiP rules reproduce shared/calls/videoFit.ts exactly (parity/fixtures/calls-video.ts). */
class CallsVideoParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-video.json").readText()).jsonObject
    }

    private fun size(o: JsonObject) = VideoFit.Size(o["width"]!!.jsonPrimitive.double, o["height"]!!.jsonPrimitive.double)

    @Test
    fun fitRectsAndPipMatchTypeScript() {
        val cases = root["cases"]!!.jsonArray
        assertTrue(cases.size > 500)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val video = o["video"]!!.let { if (it is JsonNull) null else size(it.jsonObject) }
            val box = size(o["box"]!!.jsonObject)
            val screen = o["screen"]!!.jsonPrimitive.boolean
            val tol = o["tolerance"]!!.let { if (it is JsonNull) VideoFit.COVER_TOLERANCE else it.jsonPrimitive.double }
            val label = "case $i: $video in $box"
            assertEquals(o["fit"]!!.jsonPrimitive.content, VideoFit.choose(video, box, screen, tol).wire, "$label fit")
            val mismatch = o["mismatch"]!!
            if (mismatch !is JsonNull) assertEquals(mismatch.jsonPrimitive.double, VideoFit.aspectMismatch(video!!, box), "$label mismatch")
            for ((key, rect) in listOf("contain" to VideoFit.containRect(video, box), "cover" to VideoFit.coverRect(video, box))) {
                val e = o[key]!!.jsonObject
                assertEquals(e["x"]!!.jsonPrimitive.double, rect.x, "$label $key x")
                assertEquals(e["y"]!!.jsonPrimitive.double, rect.y, "$label $key y")
                assertEquals(e["width"]!!.jsonPrimitive.double, rect.width, "$label $key w")
                assertEquals(e["height"]!!.jsonPrimitive.double, rect.height, "$label $key h")
            }
            val pip = o["pip"]!!.jsonObject
            val p = VideoFit.pipSize(video, box)
            assertEquals(pip["width"]!!.jsonPrimitive.double, p.width, "$label pip w")
            assertEquals(pip["height"]!!.jsonPrimitive.double, p.height, "$label pip h")
        }
    }
}
