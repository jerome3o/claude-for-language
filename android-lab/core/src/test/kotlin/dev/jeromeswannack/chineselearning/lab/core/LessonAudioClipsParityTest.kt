package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** LessonAudioClips reproduces shared/lesson/audioClips.ts exactly (parity/fixtures/lesson-audio.ts). */
class LessonAudioClipsParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "lesson-audio.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content

    private fun clip(e: JsonElement): LessonAudioClip {
        val o = e.jsonObject
        return LessonAudioClip(
            kind = o["kind"].str!!,
            text = o["text"].str!!,
            voice = o["voice"].str,
            speed = o["speed"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.double,
            delivery = o["delivery"].str,
            exercise = o["exercise"]!!.jsonPrimitive.int,
        )
    }

    private fun clips(e: JsonElement) = e.jsonArray.map(::clip)

    private fun ctx(e: JsonElement?): ConversationAudioContext? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return ConversationAudioContext(
            provider = o["provider"].str!!,
            defaultSpeed = o["default_speed"]!!.jsonPrimitive.double,
            enabled = o["enabled"]?.takeIf { it !is JsonNull }?.jsonArray?.map { it.str!! },
            prefs = ConversationAudio.fromJson(o["prefs"]),
        )
    }

    @Test
    fun lessonClipsMatch() {
        val lessons = data["lessons"]!!.jsonArray
        assertTrue(lessons.size > 10)
        for ((i, l) in lessons.withIndex()) {
            val o = l.jsonObject
            val spec = Lessons.decodeSpec(o["spec"]) ?: fail("spec $i did not decode")
            val c = ctx(o["ctx"])
            val resolve: ((ConversationExercise) -> ResolvedConversationAudio)? = c?.let { cc -> { ex -> ConversationAudio.resolve(ex, cc) } }
            val got = LessonAudioClips.lessonClips(spec, resolve)
            assertEquals(clips(o["clips"]!!), got, "clips of lesson $i")
            assertEquals(o["ids"]!!.jsonArray.map { it.str!! }, got.map(LessonAudioClips::clipId), "ids of lesson $i")
            assertEquals(clips(o["distinct"]!!), LessonAudioClips.distinctClips(spec, resolve), "distinct of lesson $i")
            for (ord in o["orders"]!!.jsonArray) {
                val current = ord.jsonObject["current"]!!.jsonPrimitive.int
                assertEquals(clips(ord.jsonObject["clips"]!!), LessonAudioClips.orderForPrefetch(got, current), "order of lesson $i from $current")
            }
        }
    }

    @Test
    fun lessonsToPrefetchMatch() {
        for ((i, p) in data["prefetch"]!!.jsonArray.withIndex()) {
            val o = p.jsonObject
            val rows = o["rows"]!!.jsonArray.map {
                val r = it.jsonObject
                LessonAudioClips.PrefetchRow(r["id"].str!!, r["created_at"].str!!, r["finishes"]!!.jsonPrimitive.int, r["retired"]!!.jsonPrimitive.boolean, r["lock"].str!!)
            }
            val homework = o["homework"]!!.jsonArray.map {
                val h = it.jsonObject
                LessonAudioClips.HomeworkRef(h["kind"].str!!, h["target_id"].str!!, h["status"].str!!)
            }
            val todays = o["todays"]!!.jsonArray.map { it.str!! }
            val upcoming = o["upcoming"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.int
            val got = if (upcoming == null) LessonAudioClips.lessonsToPrefetch(todays, homework, rows) else LessonAudioClips.lessonsToPrefetch(todays, homework, rows, upcoming)
            assertEquals(o["result"]!!.jsonArray.map { it.str!! }, got, "prefetch pick $i")
        }
    }
}
