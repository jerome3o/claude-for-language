package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.clips.ClipLessonState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPlayState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSpec
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipUserState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipMusic
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.core.clips.Karaoke
import kotlinx.serialization.json.long
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 🎬 Clips: the Kotlin port (core/…/clips/Clips.kt) reproduces shared/clips exactly — the spec
 * decodes, timelines, lengths, utterances (text + voice), audio clips, pictures, story casts, the
 * TTS text rule, progress, the clip clock over scripted runs, story lines shown and the Learn more
 * offers (parity/fixtures/clips.ts).
 */
class ClipsParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "clips.json").readText()).jsonObject
    }

    private fun JsonElement.str(): String? = (this as? JsonNull)?.let { null } ?: jsonPrimitive.contentOrNull

    @Test
    fun voiceIds() {
        val ids = fixture["voice_ids"]!!.jsonObject
        for ((k, v) in ids) assertEquals(v.str(), Clips.VOICE_IDS[k], "voice $k")
        assertEquals(ids.keys, Clips.VOICE_IDS.keys)
    }

    @Test
    fun specsDecodeAndPlayTheSame() {
        val specs = fixture["specs"]!!.jsonArray.map { it.jsonObject }
        assertTrue(specs.size >= 4)
        for (c in specs) {
            val spec = json.decodeFromJsonElement(ClipSpec.serializer(), c["spec"]!!)
            val tl = c["timeline"]!!.jsonArray.map { it.jsonObject }
            assertEquals(tl.map { listOf(it["index"]!!.jsonPrimitive.int, it["start_ms"]!!.jsonPrimitive.int, it["end_ms"]!!.jsonPrimitive.int) }, Clips.timeline(spec).map { listOf(it.index, it.startMs, it.endMs) })
            assertEquals(tl.map { it["layout"]!!.jsonPrimitive.content }, Clips.timeline(spec).map { it.layout })
            assertEquals(c["duration"]!!.jsonPrimitive.int, Clips.durationMs(spec))
            assertEquals(c["duration_label"]!!.jsonPrimitive.content, Clips.formatDuration(Clips.durationMs(spec)))
            val utt = c["utterances"]!!.jsonArray.map { it.jsonObject }
            assertEquals(
                utt.map { listOf(it["scene"]!!.jsonPrimitive.int, it["line"]!!.jsonPrimitive.int, it["text"]!!.jsonPrimitive.content, it["lang"]!!.jsonPrimitive.content, it["voice_id"]!!.str()) },
                Clips.utterances(spec).map { listOf(it.scene, it.line, it.text, it.lang, it.voiceId) },
                "utterances of ${spec.title}",
            )
            assertEquals(
                c["audio"]!!.jsonArray.map { it.jsonObject.let { o -> o["text"]!!.jsonPrimitive.content to o["voice_id"]!!.str() } },
                Clips.audioClips(spec).map { it.text to it.voiceId },
            )
            assertEquals(c["images"]!!.jsonArray.map { it.jsonPrimitive.content }, Clips.imagePrompts(spec))
            assertEquals(
                c["reveal_utterances"]!!.jsonArray.map { sc -> sc.jsonArray.map { it.jsonObject.let { u -> listOf(u["scene"]!!.jsonPrimitive.int, u["line"]!!.jsonPrimitive.int, u["text"]!!.jsonPrimitive.content, u["voice_id"]!!.str()) } } },
                spec.scenes.mapIndexed { i, sc -> Clips.sceneRevealUtterances(sc, i).map { listOf(it.scene, it.line, it.text, it.voiceId) } },
                "reveal utterances of ${spec.title}",
            )
            assertEquals(c["topic"]!!.jsonPrimitive.content, Clips.topic(spec))
            assertEquals(c["title"]!!.jsonPrimitive.content, Clips.learnMoreTitle(Clips.topic(spec)))
        }
    }

    @Test
    fun storyCasts() {
        for (c in fixture["casts"]!!.jsonArray.map { it.jsonObject }) {
            val labels = c["labels"]!!.jsonArray.map { it.jsonPrimitive.content.ifEmpty { null } }
            val cast = Clips.storyCast(labels)
            val want = c["cast"]!!.jsonObject
            assertEquals(want["sides"]!!.jsonArray.map { it.jsonPrimitive.content }, cast.sides, "sides $labels")
            assertEquals(want["voices"]!!.jsonArray.map { it.str() }, cast.voices, "voices $labels")
            assertEquals(c["narrator"]!!.jsonArray.map { it.jsonPrimitive.boolean }, c["labels"]!!.jsonArray.map { Clips.isNarratorSpeaker(it.jsonPrimitive.content) })
        }
    }

    @Test
    fun ttsTextProgressAndTitles() {
        for (c in fixture["tts"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["out"]!!.jsonPrimitive.content, Clips.ttsText(c["text"]!!.jsonPrimitive.content))
        val spec = json.decodeFromJsonElement(ClipSpec.serializer(), fixture["specs"]!!.jsonArray[0].jsonObject["spec"]!!)
        for (c in fixture["progress"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["out"]!!.jsonArray.map { it.jsonPrimitive.double }, Clips.progressSegments(spec, c["scene"]!!.jsonPrimitive.int, c["elapsed"]!!.jsonPrimitive.double))
        }
        for (c in fixture["titles"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["title"]!!.jsonPrimitive.content, Clips.learnMoreTitle(c["topic"]!!.jsonPrimitive.content))
    }

    private fun assertState(want: JsonObject, got: ClipPlayState, where: String) {
        assertEquals(want["scene"]!!.jsonPrimitive.int, got.scene, "scene $where")
        assertEquals(want["elapsed_ms"]!!.jsonPrimitive.double, got.elapsedMs, "elapsed $where")
        assertEquals(want["done"]!!.jsonPrimitive.boolean, got.done, "done $where")
        val q = want["interact"]
        if (q == null || q is JsonNull) assertEquals(null, got.interact, "interact $where")
        else {
            val o = q.jsonObject
            assertEquals(o["picked"]!!.jsonPrimitive.intOrNull, got.interact?.picked, "picked $where")
            assertEquals(o["result"]!!.str(), got.interact?.result, "result $where")
            assertEquals(o["waited_ms"]!!.jsonPrimitive.double, got.interact?.waitedMs, "waited $where")
            assertEquals(o["reveal_ms"]!!.jsonPrimitive.double, got.interact?.revealMs, "reveal $where")
        }
    }

    @Test
    fun theClipClock() {
        val specs = fixture["specs"]!!.jsonArray.map { json.decodeFromJsonElement(ClipSpec.serializer(), it.jsonObject["spec"]!!) }
        for ((r, run) in fixture["clock"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val spec = specs[run["spec"]!!.jsonPrimitive.int]
            val states = run["states"]!!.jsonArray.map { it.jsonObject }
            var state = Clips.start(spec, run["start"]!!.jsonPrimitive.int)
            val ops = run["ops"]!!.jsonArray.map { it.jsonArray }
            for (i in states.indices) {
                if (i > 0) {
                    val op = ops[i - 1]
                    state = when (op[0].jsonPrimitive.content) {
                        "t" -> Clips.tick(spec, state, op[1].jsonPrimitive.double, op[2].jsonPrimitive.boolean)
                        "a" -> Clips.answerOption(spec, state, op[1].jsonPrimitive.int)
                        "o" -> Clips.answerOrder(spec, state, op[1].jsonArray.map { it.jsonPrimitive.int })
                        "f" -> Clips.flip(state)
                        "s" -> Clips.skip(state)
                        "v" -> Clips.speakResult(state, op[1].jsonPrimitive.content)
                        "c" -> Clips.continueOn(spec, state)
                        else -> fail("op $op")
                    }
                }
                val want = states[i]
                assertState(want["state"]!!.jsonObject, state, "run $r step $i")
                assertEquals(want["waiting"]!!.jsonPrimitive.boolean, Clips.waiting(state), "waiting run $r step $i")
                assertEquals(want["skip"]!!.jsonPrimitive.boolean, Clips.skipShown(state), "skip run $r step $i")
                assertEquals(want["right"]!!.jsonPrimitive.booleanOrNull, Clips.quizRight(spec, state), "right run $r step $i")
                assertEquals(want["fill"]!!.jsonPrimitive.double, Clips.sceneFill(spec, state), "fill run $r step $i")
            }
        }
        for (c in fixture["starts"]!!.jsonArray.map { it.jsonObject }) assertState(c["state"]!!.jsonObject, Clips.start(specs[0], c["scene"]!!.jsonPrimitive.int), "start ${c["scene"]}")
    }

    @Test
    fun storyLinesShown() {
        val cases = fixture["story_shown"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 500)
        for (c in cases) {
            assertEquals(
                c["out"]!!.jsonPrimitive.int,
                Clips.storyLinesShown(c["lines"]!!.jsonPrimitive.int, c["duration"]!!.jsonPrimitive.double, c["elapsed"]!!.jsonPrimitive.double, c["spoken"]!!.jsonPrimitive.int),
                "story $c",
            )
        }
    }

    @Test
    fun learnMoreOffers() {
        val spec = json.decodeFromJsonElement(ClipSpec.serializer(), fixture["specs"]!!.jsonArray[0].jsonObject["spec"]!!)
        for (c in fixture["offers"]!!.jsonArray.map { it.jsonObject }) {
            val s = if (c["words"]!!.jsonPrimitive.int == 1) spec.copy(words = spec.words.take(1)) else spec
            val lesson = c["lesson"]!!.let { if (it is JsonNull) null else json.decodeFromJsonElement(ClipLessonState.serializer(), it) }
            val want = c["offers"]!!.jsonArray.map { it.jsonObject }
            val got = Clips.learnMoreOffers(s, lesson)
            assertEquals(want.map { it["action"]!!.jsonPrimitive.content }, got.map { it.action })
            assertEquals(want.map { it["icon"]!!.jsonPrimitive.content }, got.map { it.icon })
            assertEquals(want.map { it["label"]!!.jsonPrimitive.content }, got.map { it.label })
            assertEquals(want.map { it["detail"]!!.jsonPrimitive.content }, got.map { it.detail })
            assertEquals(want.map { it["online"]!!.jsonPrimitive.boolean }, got.map { it.online })
        }
    }

    @Test
    fun pendingEventsOverlay() {
        val s = Clips.withPendingEvents(ClipUserState(), listOf("view", "like", "save", "unsave", "skip", "skip", "dance"))
        assertEquals(ClipUserState(viewed = true, completed = false, liked = true, saved = false, skips = 2), s)
        assertEquals(ClipUserState(viewed = true, completed = true), Clips.withPendingEvents(ClipUserState(), listOf("complete")))
    }

    @Test
    fun revealTimesHashesAndShuffles() {
        for (c in fixture["reveal_ms"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["out"]!!.jsonPrimitive.double, Clips.revealMs(c["layout"]!!.jsonPrimitive.content, c["result"]!!.jsonPrimitive.content), "reveal $c")
        }
        for (c in fixture["hashes"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["out"]!!.jsonPrimitive.long, Clips.hash(c["text"]!!.jsonPrimitive.content), "hash $c")
        val shuffles = fixture["shuffles"]!!.jsonArray.map { it.jsonObject }
        assertTrue(shuffles.size >= 25)
        for (c in shuffles) {
            val tiles = c["tiles"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c["out"]!!.jsonArray.map { it.jsonPrimitive.int }, Clips.orderShuffle(tiles, c["seed"]!!.jsonPrimitive.content), "shuffle $c")
        }
        for (c in fixture["order_right"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["out"]!!.jsonPrimitive.boolean, Clips.orderRight(c["tiles"]!!.jsonArray.map { it.jsonPrimitive.content }, c["order"]!!.jsonArray.map { it.jsonPrimitive.int }), "order $c")
        }
        assertEquals(mapOf("wrong" to 0, "right" to 1, "close" to 2, "done" to 3, "skipped" to -1), Clips.INTERACT_VALUES)
    }

    @Test
    fun karaokeTimelines() {
        val cases = fixture["karaoke"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 50)
        for (c in cases) {
            val text = c["text"]!!.jsonPrimitive.content
            val lang = c["lang"]!!.jsonPrimitive.content
            val words = c["words"]!!.let { if (it is JsonNull) null else it.jsonArray.map { w -> w.jsonPrimitive.content } }
            val tl = Karaoke.timeline(text, lang, c["duration"]!!.jsonPrimitive.double, words)
            val want = c["timeline"]!!.jsonArray.map { it.jsonObject }
            assertEquals(
                want.map { listOf(it["text"]!!.jsonPrimitive.content, it["kind"]!!.jsonPrimitive.content, it["weight"]!!.jsonPrimitive.double, it["start_ms"]!!.jsonPrimitive.long, it["end_ms"]!!.jsonPrimitive.long) },
                tl.map { listOf(it.text, it.kind, it.weight, it.startMs, it.endMs) },
                "karaoke \"$text\" ${c["duration"]}",
            )
            for (a in c["at"]!!.jsonArray.map { it.jsonObject }) {
                val active = Karaoke.active(tl, a["t"]!!.jsonPrimitive.double)
                assertEquals(a["active"]!!.jsonPrimitive.int, active, "active \"$text\" at ${a["t"]}")
                assertEquals(a["states"]!!.jsonArray.map { it.jsonPrimitive.content }, Karaoke.states(tl, active))
            }
        }
    }

    @Test
    fun music() {
        val m = fixture["music"]!!.jsonObject
        assertEquals(
            m["tracks"]!!.jsonArray.map { it.jsonObject.let { t -> listOf(t["id"]!!.jsonPrimitive.content, t["path"]!!.jsonPrimitive.content, t["raw"]!!.jsonPrimitive.content, t["bpm"]!!.jsonPrimitive.int, t["name"]!!.jsonPrimitive.content) } },
            ClipMusic.TRACKS.map { listOf(it.id, it.path, it.raw, it.bpm, it.name) },
        )
        for (c in m["by_theme"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["id"]!!.jsonPrimitive.content, ClipMusic.forTheme(c["theme"]!!.jsonPrimitive.content).id)
        for (c in m["target"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["out"]!!.jsonPrimitive.double, ClipMusic.target(c["speaking"]!!.jsonPrimitive.boolean))
        for (c in m["steps"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["out"]!!.jsonPrimitive.double, ClipMusic.step(c["current"]!!.jsonPrimitive.double, c["target"]!!.jsonPrimitive.double, c["dt"]!!.jsonPrimitive.double), "step $c")
        }
        for (c in m["play"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["out"]!!.jsonPrimitive.boolean, ClipMusic.shouldPlay(c["playing"]!!.jsonPrimitive.boolean, c["muted"]!!.jsonPrimitive.boolean, c["music"]!!.jsonPrimitive.boolean))
        }
    }
}
