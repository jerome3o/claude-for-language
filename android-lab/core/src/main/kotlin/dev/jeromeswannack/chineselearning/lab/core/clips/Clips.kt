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

data class ClipQuizState(val picked: Int?, val timedOut: Boolean, val revealMs: Double)

/** Port of `ClipPlayState`. scene = scenes.size → the end card. */
data class ClipPlayState(val scene: Int, val elapsedMs: Double, val quiz: ClipQuizState?, val done: Boolean)

data class LearnMoreOffer(val action: String, val icon: String, val label: String, val detail: String, val online: Boolean)

object Clips {
    const val QUIZ_REVEAL_MS = 2500.0
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

    /** Port of `sceneUtterances`. */
    fun sceneUtterances(scene: ClipScene, index: Int): List<ClipUtterance> {
        val voice = scene.voice
        if (voice != null && voice.text.trim().isNotEmpty()) {
            val lang = if (voice.lang == "en") "en" else "zh"
            return listOf(ClipUtterance(index, -1, ttsText(voice.text), lang, VOICE_IDS[voice.voice ?: "teacher"]))
        }
        fun zh(text: String, line: Int, voiceId: String? = null) = ClipUtterance(index, line, ttsText(text), "zh", voiceId)
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

    /** Port of `clipUtterances`. */
    fun utterances(spec: ClipSpec): List<ClipUtterance> = spec.scenes.flatMapIndexed { i, s -> sceneUtterances(s, i) }

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

    /** Port of `clipStart`. */
    fun start(spec: ClipSpec, scene: Int = 0): ClipPlayState {
        val at = max(0, min(scene, spec.scenes.size))
        return ClipPlayState(
            scene = at,
            elapsedMs = 0.0,
            quiz = if (spec.scenes.getOrNull(at)?.layout == "quiz") ClipQuizState(null, false, 0.0) else null,
            done = at >= spec.scenes.size,
        )
    }

    /** Port of `clipQuizWaiting`. */
    fun quizWaiting(state: ClipPlayState): Boolean = state.quiz != null && state.quiz.picked == null && !state.quiz.timedOut

    /** Port of `clipTick`. */
    fun tick(spec: ClipSpec, state: ClipPlayState, dtMs: Double, speaking: Boolean): ClipPlayState {
        if (state.done) return state
        val scene = spec.scenes.getOrNull(state.scene) ?: return state.copy(done = true, scene = spec.scenes.size)
        val dt = max(0.0, dtMs)
        val d = scene.duration_ms.toDouble()
        val quiz = state.quiz
        if (quiz != null) {
            if (quizWaiting(state)) {
                val elapsed = min(d, state.elapsedMs + dt)
                if (elapsed >= d) return state.copy(elapsedMs = elapsed, quiz = quiz.copy(timedOut = true))
                return state.copy(elapsedMs = elapsed)
            }
            val reveal = quiz.revealMs + dt
            if (reveal >= QUIZ_REVEAL_MS && !speaking) return start(spec, state.scene + 1)
            return state.copy(elapsedMs = d, quiz = quiz.copy(revealMs = min(reveal, QUIZ_REVEAL_MS)))
        }
        val elapsed = min(d, state.elapsedMs + dt)
        if (elapsed >= d && !speaking) return start(spec, state.scene + 1)
        return state.copy(elapsedMs = elapsed)
    }

    /** Port of `clipAnswerQuiz`. */
    fun answerQuiz(state: ClipPlayState, option: Int): ClipPlayState =
        if (!quizWaiting(state)) state else state.copy(quiz = state.quiz!!.copy(picked = option))

    /** Port of `clipQuizRight`. */
    fun quizRight(spec: ClipSpec, state: ClipPlayState): Boolean? {
        val scene = spec.scenes.getOrNull(state.scene)
        val picked = state.quiz?.picked
        if (picked == null || scene?.layout != "quiz") return null
        return picked == (scene.quiz?.answer_index ?: -1)
    }

    /** Port of `clipSceneFill`. */
    fun sceneFill(spec: ClipSpec, state: ClipPlayState): Double {
        val scene = spec.scenes.getOrNull(state.scene) ?: return 1.0
        if (state.quiz != null && !quizWaiting(state)) return 1.0
        return max(0.0, min(1.0, state.elapsedMs / scene.duration_ms))
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
