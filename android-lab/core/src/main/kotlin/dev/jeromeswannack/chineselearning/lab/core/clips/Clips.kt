package dev.jeromeswannack.chineselearning.lab.core.clips

import kotlinx.serialization.Serializable
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/*
 * Port of shared/clips (docs/CLIPS.md) — 🎬 Clips (experimental): the clip spec v1 the API serves,
 * the scene timeline, what each scene says aloud and in which voice (timeline.ts), the clip clock
 * (playback.ts) and the feed's Learn more offers (feed.ts). Parity-tested against the TypeScript
 * (parity/fixtures/clips.ts, ClipsParityTest). The validator and the feed ranking run on the
 * server only: clients play clips it already checked, in the order it sent.
 */

@Serializable
data class ClipWord(val hanzi: String, val pinyin: String = "", val english: String = "")

/** Port of `ClipVoiceLine`. lang: zh | en; voice: teacher | female | male | narrator. */
@Serializable
data class ClipVoiceLine(val text: String, val lang: String = "zh", val voice: String? = null)

@Serializable
data class ClipTitleBody(val headline_zh: String? = null, val headline_en: String? = null, val sub: String? = null)

@Serializable
data class ClipBreakdown(val char: String, val meaning: String = "")

@Serializable
data class ClipBigWordBody(val hanzi: String, val pinyin: String = "", val english: String = "", val breakdown: List<ClipBreakdown> = emptyList())

@Serializable
data class ClipSentenceBody(val hanzi: String, val pinyin: String = "", val english: String = "", val highlight: String? = null)

@Serializable
data class ClipCompareSide(val hanzi: String, val pinyin: String = "", val english: String = "", val example: String? = null)

@Serializable
data class ClipCompareBody(val left: ClipCompareSide, val right: ClipCompareSide, val rule_en: String? = null)

@Serializable
data class ClipQuizBody(
    val prompt_zh: String? = null,
    val prompt_en: String? = null,
    val options: List<String> = emptyList(),
    val answer_index: Int = 0,
    val explain: String? = null,
)

@Serializable
data class ClipStoryLine(val speaker: String? = null, val hanzi: String, val pinyin: String = "", val english: String = "")

@Serializable
data class ClipStoryBody(val lines: List<ClipStoryLine> = emptyList())

@Serializable
data class ClipListBody(val title: String? = null, val items: List<ClipWord> = emptyList())

@Serializable
data class ClipFactBody(val text_en: String = "", val hanzi: String? = null, val pinyin: String? = null)

/** Added: hear a line (hidden), pick what it means. */
@Serializable
data class ClipListenBody(
    val hanzi: String,
    val pinyin: String = "",
    val english: String = "",
    val options: List<String> = emptyList(),
    val answer_index: Int = 0,
    val prompt_en: String? = null,
    val explain: String? = null,
)

/** Added: tap the tiles into order — `tiles` IS the right order. */
@Serializable
data class ClipOrderBody(val tiles: List<String> = emptyList(), val pinyin: String = "", val english: String = "", val prompt_en: String? = null)

/** Added: a flip card, English → Chinese. */
@Serializable
data class ClipRevealBody(val prompt_en: String = "", val hanzi: String, val pinyin: String = "", val note: String? = null)

/** Added: say this line. */
@Serializable
data class ClipSpeakBody(val hanzi: String, val pinyin: String = "", val english: String = "", val prompt_en: String? = null)

/** Port of `ClipScene`: one class, the body named by `layout` filled. */
@Serializable
data class ClipScene(
    val layout: String,
    val duration_ms: Int,
    val voice: ClipVoiceLine? = null,
    val image_prompt: String? = null,
    val emoji: String? = null,
    val title: ClipTitleBody? = null,
    val big_word: ClipBigWordBody? = null,
    val sentence: ClipSentenceBody? = null,
    val compare: ClipCompareBody? = null,
    val quiz: ClipQuizBody? = null,
    val story: ClipStoryBody? = null,
    val list: ClipListBody? = null,
    val fact: ClipFactBody? = null,
    val listen: ClipListenBody? = null,
    val order: ClipOrderBody? = null,
    val reveal: ClipRevealBody? = null,
    val speak: ClipSpeakBody? = null,
)

@Serializable
data class ClipStyle(val theme: String = "neon", val accent: String? = null)

@Serializable
data class ClipEnding(val question_en: String? = null, val cta: String? = null)

/** Port of `ClipSpec`. */
@Serializable
data class ClipSpec(
    val v: Int = 1,
    val title: String,
    val hook: String = "",
    val style: ClipStyle = ClipStyle(),
    val words: List<ClipWord> = emptyList(),
    val tags: List<String> = emptyList(),
    val scenes: List<ClipScene> = emptyList(),
    val ending: ClipEnding? = null,
    val topic: String? = null,
)

@Serializable
data class ClipUserState(
    val viewed: Boolean = false,
    val completed: Boolean = false,
    val liked: Boolean = false,
    val saved: Boolean = false,
    val skips: Int = 0,
)

/** Port of `ClipLessonState`. status: generating | ready | failed. */
@Serializable
data class ClipLessonState(val status: String, val lesson_id: String? = null, val error: String? = null)

/** Port of `ClipRecord` (what GET /api/clips serves). */
@Serializable
data class ClipRecord(
    val id: String,
    val status: String,
    val source: String = "manual",
    val title: String? = null,
    val topic: String? = null,
    val theme: String? = null,
    val spec: ClipSpec? = null,
    val images: Map<String, String> = emptyMap(),
    val progress: String? = null,
    val error: String? = null,
    val created_at: String = "",
    val state: ClipUserState = ClipUserState(),
    val lesson: ClipLessonState? = null,
)

data class ClipSegment(val index: Int, val layout: String, val startMs: Int, val endMs: Int)

data class ClipUtterance(val scene: Int, val line: Int, val text: String, val lang: String, val voiceId: String?)

data class ClipAudio(val text: String, val voiceId: String?)

data class StoryCast(val sides: List<String>, val voices: List<String?>)

/** Port of `ClipInteractState`. result: null (waiting) | right | wrong | close | done | skipped. */
data class ClipInteractState(val picked: Int?, val result: String?, val waitedMs: Double, val revealMs: Double)

/** Port of `ClipPlayState`. scene = scenes.size → the end card. */
data class ClipPlayState(val scene: Int, val elapsedMs: Double, val interact: ClipInteractState?, val done: Boolean)

data class LearnMoreOffer(val action: String, val icon: String, val label: String, val detail: String, val online: Boolean)

object Clips {
    const val QUIZ_REVEAL_MS = 2500.0
    /** Port of `CLIP_SKIP_AFTER_MS`: an interactive scene offers "Skip ›" after waiting this long. */
    const val SKIP_AFTER_MS = 6000.0
    /** Port of `CLIP_INTERACTIVE_LAYOUTS`. */
    val INTERACTIVE_LAYOUTS = listOf("quiz", "listen", "order", "reveal", "speak")
    /** Port of `CLIP_INTERACT_VALUES`. */
    val INTERACT_VALUES = mapOf("wrong" to 0, "right" to 1, "close" to 2, "done" to 3, "skipped" to -1)
    const val LINE_GAP_MS = 250L
    const val TTS_SPEED = 0.6
    const val DOUBLE_TAP_MS = 300L
    const val DOUBLE_TAP_PX = 60f
    const val LONG_PRESS_MS = 550L

    val THEMES = listOf("neon", "paper", "chalk", "comic", "sunset", "mono", "ink", "retro")

    /** Port of `CLIP_VOICE_IDS` (the first default lesson voices; teacher = the app voice). */
    val VOICE_IDS: Map<String, String?> = mapOf(
        "teacher" to null,
        "female" to "Chinese (Mandarin)_News_Anchor",
        "male" to "Chinese (Mandarin)_Male_Announcer",
        "narrator" to "audiobook_male_1",
    )

    /** Story speakers in turn: female, male, then the next voices of each pool. */
    private val SPEAKER_VOICES: List<String?> = listOf(
        "Chinese (Mandarin)_News_Anchor",
        "Chinese (Mandarin)_Male_Announcer",
        "presenter_female",
        "presenter_male",
        "audiobook_female_1",
        "Chinese (Mandarin)_Gentleman",
    )

    /** JavaScript's whitespace (String.prototype.trim, \s). */
    private val JS_SPACE: Set<Char> = (listOf(' ', '\t', '\n', '\r', '\u000B', '\u000C', '\u00A0', '\u1680', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF') + ('\u2000'..'\u200A')).toSet()

    private val NARRATOR_LABELS = setOf("旁白", "narrator", "解说", "画外音")

    /** Port of `clipTimeline`. */
    fun timeline(spec: ClipSpec): List<ClipSegment> {
        var at = 0
        return spec.scenes.mapIndexed { i, s ->
            val seg = ClipSegment(i, s.layout, at, at + s.duration_ms)
            at += s.duration_ms
            seg
        }
    }

    /** Port of `clipDurationMs`. */
    fun durationMs(spec: ClipSpec): Int = spec.scenes.sumOf { it.duration_ms }

    /** Port of `formatClipDuration`: "0:41". */
    fun formatDuration(ms: Number): String {
        val s = floor(ms.toDouble() / 1000 + 0.5).toLong()
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }

    /** Port of `clipProgressSegments`. */
    fun progressSegments(spec: ClipSpec, sceneIndex: Int, elapsedMs: Double): List<Double> =
        spec.scenes.mapIndexed { i, s ->
            when {
                i < sceneIndex -> 1.0
                i > sceneIndex -> 0.0
                else -> max(0.0, min(1.0, elapsedMs / s.duration_ms))
            }
        }

    /** Port of `isNarratorSpeaker`. */
    fun isNarratorSpeaker(speaker: String?): Boolean = !speaker.isNullOrEmpty() && speaker.trim().lowercase() in NARRATOR_LABELS

    /** Port of `clipTtsText`: " / " → a pause, spaces tidied. */
    fun ttsText(text: String): String =
        text.replace(Regex("[ \\t\\n\\r\\u000B\\f\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]*[/／][ \\t\\n\\r\\u000B\\f\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]*"), "，")
            .replace(Regex("[ \\t\\n\\r\\u000B\\f\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+"), " ")
            .trim { it in JS_SPACE }

    /** Port of `storyCast`. */
    fun storyCast(speakers: List<String?>): StoryCast {
        val order = mutableListOf<String>()
        val sides = mutableListOf<String>()
        val voices = mutableListOf<String?>()
        for (raw in speakers) {
            val label = (raw ?: "").trim()
            if (isNarratorSpeaker(label)) {
                sides += "center"
                voices += VOICE_IDS["narrator"]
                continue
            }
            var i = order.indexOf(label)
            if (i < 0) {
                order += label
                i = order.size - 1
            }
            sides += if (i % 2 == 0) "left" else "right"
            voices += SPEAKER_VOICES[i % SPEAKER_VOICES.size]
        }
        return StoryCast(sides, voices)
    }

    /** Port of `sceneUtterances`: a voice line says only that — except listen / speak, which then say their hanzi. */
    fun sceneUtterances(scene: ClipScene, index: Int): List<ClipUtterance> {
        val voice = scene.voice
        val voiced = if (voice != null && voice.text.trim().isNotEmpty()) {
            listOf(ClipUtterance(index, -1, ttsText(voice.text), if (voice.lang == "en") "en" else "zh", VOICE_IDS[voice.voice ?: "teacher"]))
        } else emptyList()
        fun zh(text: String, line: Int, voiceId: String? = null) = ClipUtterance(index, line, ttsText(text), "zh", voiceId)
        if (scene.layout == "listen" || scene.layout == "speak") {
            val hanzi = (if (scene.layout == "listen") scene.listen?.hanzi else scene.speak?.hanzi).orEmpty()
            return voiced + (if (hanzi.trim().isNotEmpty()) listOf(zh(hanzi, 0)) else emptyList())
        }
        if (voiced.isNotEmpty()) return voiced
        return when (scene.layout) {
            "story" -> {
                val lines = scene.story?.lines.orEmpty()
                val cast = storyCast(lines.map { it.speaker })
                lines.mapIndexed { i, l -> zh(l.hanzi, i, cast.voices[i]) }.filter { it.text.isNotEmpty() }
            }
            "list" -> scene.list?.items.orEmpty().mapIndexed { i, it -> zh(it.hanzi, i) }.filter { it.text.isNotEmpty() }
            "sentence" -> scene.sentence?.hanzi?.takeIf { it.isNotEmpty() }?.let { listOf(zh(it, 0)) } ?: emptyList()
            "big_word" -> scene.big_word?.hanzi?.takeIf { it.isNotEmpty() }?.let { listOf(zh(it, 0)) } ?: emptyList()
            else -> emptyList()
        }
    }

    /** Port of `clipOrderSentence`. */
    fun orderSentence(tiles: List<String>): String = tiles.joinToString("")

    /** Port of `sceneRevealUtterances`: what an order / reveal scene says once answered. */
    fun sceneRevealUtterances(scene: ClipScene, index: Int): List<ClipUtterance> {
        val text = when (scene.layout) {
            "order" -> orderSentence(scene.order?.tiles.orEmpty())
            "reveal" -> scene.reveal?.hanzi.orEmpty()
            else -> ""
        }
        val tts = ttsText(text)
        return if (tts.isNotEmpty()) listOf(ClipUtterance(index, 0, tts, "zh", null)) else emptyList()
    }

    /** Port of `clipUtterances` (the answers' lines included). */
    fun utterances(spec: ClipSpec): List<ClipUtterance> = spec.scenes.flatMapIndexed { i, s -> sceneUtterances(s, i) + sceneRevealUtterances(s, i) }

    /** Port of `clipAudioClips`: the distinct practice-TTS requests (text + voice). */
    fun audioClips(spec: ClipSpec): List<ClipAudio> {
        val seen = HashSet<String>()
        return utterances(spec).mapNotNull { u -> if (seen.add("${u.text}|${u.voiceId ?: ""}")) ClipAudio(u.text, u.voiceId) else null }
    }

    /** Port of `clipImagePrompts`. */
    fun imagePrompts(spec: ClipSpec): List<String> {
        val out = mutableListOf<String>()
        for (s in spec.scenes) {
            val p = s.image_prompt?.trim()
            if (!p.isNullOrEmpty() && p !in out) out += p
        }
        return out
    }

    /** Port of `clipTopic`. */
    fun topic(spec: ClipSpec): String = (spec.topic ?: "").trim().ifEmpty { spec.title.trim() }

    // ---------- The clip clock (playback.ts) ----------

    /** Port of `isInteractiveLayout`. */
    fun isInteractive(layout: String?): Boolean = layout in INTERACTIVE_LAYOUTS

    /** Port of `clipStart`. */
    fun start(spec: ClipSpec, scene: Int = 0): ClipPlayState {
        val at = max(0, min(scene, spec.scenes.size))
        return ClipPlayState(
            scene = at,
            elapsedMs = 0.0,
            interact = if (isInteractive(spec.scenes.getOrNull(at)?.layout)) ClipInteractState(null, null, 0.0, 0.0) else null,
            done = at >= spec.scenes.size,
        )
    }

    /** Port of `clipWaiting`. */
    fun waiting(state: ClipPlayState): Boolean = state.interact != null && state.interact.result == null

    /** Port of `clipSkipShown`. */
    fun skipShown(state: ClipPlayState): Boolean = waiting(state) && state.interact!!.waitedMs >= SKIP_AFTER_MS

    /** Port of `clipRevealMs`. */
    fun revealMs(layout: String, result: String): Double = when {
        result == "skipped" -> QUIZ_REVEAL_MS
        layout == "order" || layout == "reveal" -> 3000.0
        layout == "speak" -> 3500.0
        else -> QUIZ_REVEAL_MS
    }

    /** Port of `clipTick`. */
    fun tick(spec: ClipSpec, state: ClipPlayState, dtMs: Double, speaking: Boolean): ClipPlayState {
        if (state.done) return state
        val scene = spec.scenes.getOrNull(state.scene) ?: return state.copy(done = true, scene = spec.scenes.size)
        val dt = max(0.0, dtMs)
        val d = scene.duration_ms.toDouble()
        val interact = state.interact
        if (interact != null) {
            val result = interact.result
            if (result == null) {
                val elapsed = min(d, state.elapsedMs + dt)
                val waited = min(SKIP_AFTER_MS, interact.waitedMs + dt)
                if (elapsed == state.elapsedMs && waited == interact.waitedMs) return state
                return state.copy(elapsedMs = elapsed, interact = interact.copy(waitedMs = waited))
            }
            val need = revealMs(scene.layout, result)
            val reveal = interact.revealMs + dt
            if (reveal >= need && !speaking) return start(spec, state.scene + 1)
            return state.copy(elapsedMs = d, interact = interact.copy(revealMs = min(reveal, need)))
        }
        val elapsed = min(d, state.elapsedMs + dt)
        if (elapsed >= d && !speaking) return start(spec, state.scene + 1)
        return state.copy(elapsedMs = elapsed)
    }

    private fun settle(state: ClipPlayState, result: String, picked: Int? = null): ClipPlayState =
        if (!waiting(state)) state else state.copy(interact = state.interact!!.copy(result = result, picked = picked, revealMs = 0.0))

    /** Port of `clipAnswerOption` (quiz / listen). */
    fun answerOption(spec: ClipSpec, state: ClipPlayState, option: Int): ClipPlayState {
        val scene = spec.scenes.getOrNull(state.scene)
        val answer = when (scene?.layout) {
            "quiz" -> scene.quiz?.answer_index
            "listen" -> scene.listen?.answer_index
            else -> null
        } ?: return state
        return settle(state, if (option == answer) "right" else "wrong", option)
    }

    /** Port of `clipOrderRight`. */
    fun orderRight(tiles: List<String>, order: List<Int>): Boolean =
        order.size == tiles.size && order.withIndex().all { (i, idx) -> tiles.getOrNull(idx) == tiles[i] }

    /** Port of `clipAnswerOrder`. */
    fun answerOrder(spec: ClipSpec, state: ClipPlayState, order: List<Int>): ClipPlayState {
        val scene = spec.scenes.getOrNull(state.scene)
        if (scene?.layout != "order") return state
        return settle(state, if (orderRight(scene.order?.tiles.orEmpty(), order)) "right" else "wrong")
    }

    /** Port of `clipFlip`. */
    fun flip(state: ClipPlayState): ClipPlayState = settle(state, "done")

    /** Port of `clipSpeakResult` (the verdict as the web names it: exact, sound, close, wrong…). */
    fun speakResult(state: ClipPlayState, verdict: String): ClipPlayState =
        settle(state, if (verdict != "wrong" && verdict != "close") "right" else if (verdict == "close") "close" else "wrong")

    /** Port of `clipSkip`. */
    fun skip(state: ClipPlayState): ClipPlayState = settle(state, "skipped")

    /** Port of `clipContinue`. */
    fun continueOn(spec: ClipSpec, state: ClipPlayState): ClipPlayState =
        if (state.interact == null || state.interact.result == null || state.done) state else start(spec, state.scene + 1)

    /** Port of `clipQuizRight` (quiz / listen). */
    fun quizRight(spec: ClipSpec, state: ClipPlayState): Boolean? {
        val scene = spec.scenes.getOrNull(state.scene)
        val picked = state.interact?.picked ?: return null
        return when (scene?.layout) {
            "quiz" -> picked == (scene.quiz?.answer_index ?: -1)
            "listen" -> picked == (scene.listen?.answer_index ?: -1)
            else -> null
        }
    }

    /** Port of `clipInteractValue`. */
    fun interactValue(result: String): Int = INTERACT_VALUES[result] ?: 0

    /** Port of `clipSceneFill`. */
    fun sceneFill(spec: ClipSpec, state: ClipPlayState): Double {
        val scene = spec.scenes.getOrNull(state.scene) ?: return 1.0
        if (state.interact != null && !waiting(state)) return 1.0
        return max(0.0, min(1.0, state.elapsedMs / scene.duration_ms))
    }

    /** Port of `clipHash`: FNV-1a (32-bit) over UTF-16 code units. */
    fun hash(text: String): Long {
        var h = 0x811c9dc5L
        for (ch in text) {
            h = h xor ch.code.toLong()
            h = (h * 0x01000193L) and 0xFFFFFFFFL
        }
        return h
    }

    /** Port of `clipOrderShuffle`: xorshift32 + Fisher–Yates, never reading as the answer. */
    fun orderShuffle(tiles: List<String>, seed: String): List<Int> {
        val idx = tiles.indices.toMutableList()
        if (idx.size < 2) return idx
        var s = hash(seed).let { if (it == 0L) 1L else it }
        fun next(): Long {
            s = (s xor (s shl 13)) and 0xFFFFFFFFL
            s = (s xor (s ushr 17)) and 0xFFFFFFFFL
            s = (s xor (s shl 5)) and 0xFFFFFFFFL
            return s
        }
        for (i in idx.size - 1 downTo 1) {
            val j = (next() % (i + 1)).toInt()
            val t = idx[i]; idx[i] = idx[j]; idx[j] = t
        }
        if (orderRight(tiles, idx)) {
            idx.add(idx.removeAt(0))
            if (orderRight(tiles, idx)) idx.reverse()
        }
        return idx
    }

    /** Port of `storyLinesShown`. */
    fun storyLinesShown(lineCount: Int, durationMs: Double, elapsedMs: Double, spokenLine: Int = -1): Int {
        if (lineCount <= 0) return 0
        val span = durationMs * 0.7
        val byTime = if (lineCount == 1) 1 else 1 + floor((min(elapsedMs, span) / span) * (lineCount - 1) + 1e-9).toInt()
        return min(lineCount, max(byTime, spokenLine + 1))
    }

    // ---------- Learn more (feed.ts) ----------

    /** Port of `learnMoreOffers`. */
    fun learnMoreOffers(spec: ClipSpec, lesson: ClipLessonState?): List<LearnMoreOffer> {
        val n = spec.words.size
        val words = if (n == 1) "this word" else "these $n words"
        val lessonOffer = when {
            lesson?.status == "ready" && !lesson.lesson_id.isNullOrEmpty() -> LearnMoreOffer("lesson", "✨", "Open the mini lesson", "Made from this clip — ready to play", false)
            lesson?.status == "generating" -> LearnMoreOffer("lesson", "✨", "Mini lesson — writing…", "It opens here when it is ready", true)
            else -> LearnMoreOffer("lesson", "✨", "Mini lesson", "~8 min drilling $words and the idea", true)
        }
        return listOf(
            lessonOffer,
            LearnMoreOffer("reader", "📖", "Graded reader", "A short story that uses them", true),
            LearnMoreOffer("podcast", "🎧", "Podcast", "A dialogue audio lesson on this topic", true),
            LearnMoreOffer("study_words", "⚡", "Study $words today", "Cards you have go to the front of today", false),
            LearnMoreOffer("add_card", "＋", if (n == 1) "Add as card" else "Add as cards", "New words into a deck", false),
            LearnMoreOffer("more", "🎬", "More clips like this", "Two more on this topic", true),
        )
    }

    /** Port of `learnMoreTitle`. */
    fun learnMoreTitle(topic: String): String {
        val t = topic.trim()
        return if (t.isNotEmpty()) "Keep going with $t" else "Keep going"
    }

    /** Port of `withPendingEvents` (web services/clips.ts): the device's events over the server's state. */
    fun withPendingEvents(state: ClipUserState, kinds: List<String>): ClipUserState {
        var s = state
        for (k in kinds) {
            s = when (k) {
                "view" -> s.copy(viewed = true)
                "complete" -> s.copy(viewed = true, completed = true)
                "like" -> s.copy(liked = true)
                "unlike" -> s.copy(liked = false)
                "save" -> s.copy(saved = true)
                "unsave" -> s.copy(saved = false)
                "skip" -> s.copy(skips = s.skips + 1)
                else -> s
            }
        }
        return s
    }
}
