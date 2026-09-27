package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * Port of shared/lesson/types.ts — the custom mini lesson spec agents author and the
 * study session plays. Every field has a default so a spec that is slightly off (or
 * written by a newer server) still decodes; an exercise of a type this build doesn't
 * know decodes as [UnknownExercise] and is skipped by the player.
 */

@Serializable
data class LessonSentence(val hanzi: String = "", val pinyin: String? = null, val english: String? = null)

@Serializable
data class LessonWord(val hanzi: String = "", val pinyin: String? = null, val english: String? = null) {
    fun asSentence() = LessonSentence(hanzi, pinyin, english)
}

@Serializable(with = LessonExerciseSerializer::class)
sealed interface LessonExercise {
    val type: String
}

@Serializable
data class NoteExercise(val title: String? = null, val body: String? = null, val sentences: List<LessonSentence>? = null) : LessonExercise {
    override val type get() = "note"
}

@Serializable
data class ScrambleExercise(
    val english: String = "",
    val tiles: List<String> = emptyList(),
    @SerialName("correct_order") val correctOrder: List<String> = emptyList(),
    @SerialName("alt_orders") val altOrders: List<List<String>>? = null,
) : LessonExercise {
    override val type get() = "scramble"
}

@Serializable
data class ChoiceExercise(
    val question: String = "",
    val options: List<LessonSentence> = emptyList(),
    val correct: Int = 0,
    val explanation: String? = null,
) : LessonExercise {
    override val type get() = "choice"
}

@Serializable
data class TranslateExercise(
    val english: String = "",
    @SerialName("reference_hanzi") val referenceHanzi: String = "",
    @SerialName("reference_pinyin") val referencePinyin: String? = null,
    val note: String? = null,
) : LessonExercise {
    override val type get() = "translate"
}

@Serializable
data class MatchPair(val hanzi: String = "", val pinyin: String? = null, val english: String = "")

@Serializable
data class MatchExercise(val pairs: List<MatchPair> = emptyList()) : LessonExercise {
    override val type get() = "match"
}

@Serializable
data class DescribeImageExercise(
    @SerialName("image_prompt") val imagePrompt: String = "",
    @SerialName("image_url") val imageUrl: String? = null,
    val task: String? = null,
    @SerialName("reference_hanzi") val referenceHanzi: String = "",
    @SerialName("reference_pinyin") val referencePinyin: String? = null,
    @SerialName("reference_english") val referenceEnglish: String? = null,
) : LessonExercise {
    override val type get() = "describe_image"
}

@Serializable
data class SpeakExercise(val prompt: String = "", val example: LessonSentence? = null) : LessonExercise {
    override val type get() = "speak"
}

@Serializable
data class ListenChoiceExercise(
    val audio: LessonSentence = LessonSentence(),
    val question: String? = null,
    val options: List<LessonSentence> = emptyList(),
    val correct: Int = 0,
    val explanation: String? = null,
) : LessonExercise {
    override val type get() = "listen_choice"
}

@Serializable
data class ListenTranslateExercise(val audio: LessonSentence = LessonSentence(), val note: String? = null) : LessonExercise {
    override val type get() = "listen_translate"
}

/** 'type' (default) or 'handwrite'. */
object WritingInput {
    const val TYPE = "type"
    const val HANDWRITE = "handwrite"
}

@Serializable
data class SentenceMakingExercise(
    val words: List<LessonWord> = emptyList(),
    val task: String? = null,
    val input: String? = null,
    val example: LessonSentence? = null,
) : LessonExercise {
    override val type get() = "sentence_making"
    val typed: Boolean get() = input != WritingInput.HANDWRITE
}

/** The cues a writing exercise shows (default english + pinyin). */
object WritingCue {
    const val ENGLISH = "english"
    const val PINYIN = "pinyin"
    const val AUDIO = "audio"
    val DEFAULT = listOf(ENGLISH, PINYIN)
}

@Serializable
data class WriteTypedExercise(
    val answer: LessonSentence = LessonSentence(),
    val prompt: String? = null,
    val cues: List<String>? = null,
    val alternatives: List<String>? = null,
) : LessonExercise {
    override val type get() = "write_typed"
}

@Serializable
data class WriteHandwritingExercise(
    val answer: LessonSentence = LessonSentence(),
    val prompt: String? = null,
    val cues: List<String>? = null,
) : LessonExercise {
    override val type get() = "write_handwriting"
}

@Serializable
data class DictationExercise(
    val audio: LessonSentence = LessonSentence(),
    val input: String? = null,
    val alternatives: List<String>? = null,
    val note: String? = null,
) : LessonExercise {
    override val type get() = "dictation"
    val typed: Boolean get() = input != WritingInput.HANDWRITE
}

@Serializable
data class OralExpressionExercise(
    val prompt: String = "",
    @SerialName("question_audio") val questionAudio: LessonSentence? = null,
    val hints: List<LessonWord>? = null,
    val example: LessonSentence? = null,
    @SerialName("target_seconds") val targetSeconds: Int? = null,
) : LessonExercise {
    override val type get() = "oral_expression"
}

@Serializable
data class ConversationSpeaker(val name: String = "", val voice: String? = null)

@Serializable
data class ConversationLine(val speaker: Int = 0, val hanzi: String = "", val pinyin: String? = null, val english: String? = null)

@Serializable
data class ConversationQuestion(
    val question: String = "",
    val options: List<String>? = null,
    val correct: Int? = null,
    val answer: String? = null,
    val explanation: String? = null,
)

@Serializable
data class ConversationExercise(
    val situation: String = "",
    val speakers: List<ConversationSpeaker> = emptyList(),
    val lines: List<ConversationLine> = emptyList(),
    val questions: List<ConversationQuestion> = emptyList(),
) : LessonExercise {
    override val type get() = "conversation"
}

/** A type this build doesn't know (a newer server): kept verbatim, never played. */
data class UnknownExercise(override val type: String, val raw: JsonObject) : LessonExercise

@Serializable
data class LessonSection(val title: String? = null, val exercises: List<LessonExercise> = emptyList())

@Serializable
data class CustomLessonSpec(
    val title: String = "",
    val icon: String? = null,
    val description: String? = null,
    val sections: List<LessonSection> = emptyList(),
)

/** Reads the `type` field and picks the exercise's serializer; unknown types survive a round trip. */
object LessonExerciseSerializer : KSerializer<LessonExercise> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("LessonExercise")

    override fun deserialize(decoder: Decoder): LessonExercise {
        val input = decoder as? JsonDecoder ?: throw SerializationException("Lesson specs are JSON")
        val obj = input.decodeJsonElement().jsonObject
        val json = input.json
        return when (val type = obj["type"]?.jsonPrimitive?.contentOrNull ?: "") {
            "note" -> json.decodeFromJsonElement(NoteExercise.serializer(), obj)
            "scramble" -> json.decodeFromJsonElement(ScrambleExercise.serializer(), obj)
            "choice" -> json.decodeFromJsonElement(ChoiceExercise.serializer(), obj)
            "translate" -> json.decodeFromJsonElement(TranslateExercise.serializer(), obj)
            "match" -> json.decodeFromJsonElement(MatchExercise.serializer(), obj)
            "describe_image" -> json.decodeFromJsonElement(DescribeImageExercise.serializer(), obj)
            "speak" -> json.decodeFromJsonElement(SpeakExercise.serializer(), obj)
            "listen_choice" -> json.decodeFromJsonElement(ListenChoiceExercise.serializer(), obj)
            "listen_translate" -> json.decodeFromJsonElement(ListenTranslateExercise.serializer(), obj)
            "sentence_making" -> json.decodeFromJsonElement(SentenceMakingExercise.serializer(), obj)
            "write_typed" -> json.decodeFromJsonElement(WriteTypedExercise.serializer(), obj)
            "write_handwriting" -> json.decodeFromJsonElement(WriteHandwritingExercise.serializer(), obj)
            "dictation" -> json.decodeFromJsonElement(DictationExercise.serializer(), obj)
            "oral_expression" -> json.decodeFromJsonElement(OralExpressionExercise.serializer(), obj)
            "conversation" -> json.decodeFromJsonElement(ConversationExercise.serializer(), obj)
            else -> UnknownExercise(type, obj)
        }
    }

    override fun serialize(encoder: Encoder, value: LessonExercise) {
        val output = encoder as? JsonEncoder ?: throw SerializationException("Lesson specs are JSON")
        val json = output.json
        val body = when (value) {
            is NoteExercise -> json.encodeToJsonElement(NoteExercise.serializer(), value)
            is ScrambleExercise -> json.encodeToJsonElement(ScrambleExercise.serializer(), value)
            is ChoiceExercise -> json.encodeToJsonElement(ChoiceExercise.serializer(), value)
            is TranslateExercise -> json.encodeToJsonElement(TranslateExercise.serializer(), value)
            is MatchExercise -> json.encodeToJsonElement(MatchExercise.serializer(), value)
            is DescribeImageExercise -> json.encodeToJsonElement(DescribeImageExercise.serializer(), value)
            is SpeakExercise -> json.encodeToJsonElement(SpeakExercise.serializer(), value)
            is ListenChoiceExercise -> json.encodeToJsonElement(ListenChoiceExercise.serializer(), value)
            is ListenTranslateExercise -> json.encodeToJsonElement(ListenTranslateExercise.serializer(), value)
            is SentenceMakingExercise -> json.encodeToJsonElement(SentenceMakingExercise.serializer(), value)
            is WriteTypedExercise -> json.encodeToJsonElement(WriteTypedExercise.serializer(), value)
            is WriteHandwritingExercise -> json.encodeToJsonElement(WriteHandwritingExercise.serializer(), value)
            is DictationExercise -> json.encodeToJsonElement(DictationExercise.serializer(), value)
            is OralExpressionExercise -> json.encodeToJsonElement(OralExpressionExercise.serializer(), value)
            is ConversationExercise -> json.encodeToJsonElement(ConversationExercise.serializer(), value)
            is UnknownExercise -> value.raw
        }.jsonObject
        output.encodeJsonElement(JsonObject(mapOf("type" to JsonPrimitive(value.type)) + body))
    }
}

/** Lenient JSON for specs (the API's settings). */
val LessonJson = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

/** Rules over a spec — ports of the helpers in shared/lesson/types.ts, voices.ts and diff.ts. */
object Lessons {
    private val SCOREABLE = setOf(
        "scramble", "choice", "translate", "match", "describe_image", "speak", "listen_choice", "listen_translate",
        "sentence_making", "write_typed", "write_handwriting", "dictation", "oral_expression", "conversation",
    )

    /** Types the Lab player can show (everything but [UnknownExercise]). */
    fun isPlayable(ex: LessonExercise) = ex !is UnknownExercise

    /**
     * Port of `renderable` in components/editor/LessonPreview.tsx: is the exercise complete
     * enough to render without crashing? The validator is the authority; this keeps a
     * half-typed editor form (or a stray spec) from blowing up the player.
     */
    fun renderable(ex: LessonExercise): Boolean = when (ex) {
        is ScrambleExercise -> ex.tiles.isNotEmpty() && ex.correctOrder.isNotEmpty()
        is ChoiceExercise -> ex.options.size >= 2 && ex.correct in ex.options.indices
        is ListenChoiceExercise -> ex.options.size >= 2 && ex.correct in ex.options.indices
        is MatchExercise -> ex.pairs.size >= 2
        is SentenceMakingExercise -> ex.words.isNotEmpty()
        is ConversationExercise -> ex.speakers.size >= 2 && ex.lines.isNotEmpty() && ex.questions.isNotEmpty() &&
            ex.lines.all { it.speaker in ex.speakers.indices }
        else -> true
    }

    /** A spec as the player takes it, or null when it doesn't decode (e.g. mid-edit). */
    fun decodeSpec(json: JsonElement?): CustomLessonSpec? =
        json?.let { runCatching { LessonJson.decodeFromJsonElement(CustomLessonSpec.serializer(), it) }.getOrNull() }

    fun isScoreable(ex: LessonExercise) = ex.type in SCOREABLE

    fun countScoreable(spec: CustomLessonSpec) = spec.sections.sumOf { s -> s.exercises.count(::isScoreable) }

    fun exerciseCount(spec: CustomLessonSpec) = spec.sections.sumOf { it.exercises.size }

    /** `exercisePoints`: a conversation scores one per question, every other scoreable exercise one. */
    fun exercisePoints(ex: LessonExercise): Int {
        if (!isScoreable(ex)) return 0
        return if (ex is ConversationExercise) Math.max(1, ex.questions.size) else 1
    }

    /** `lessonTtsTexts`: every default-voice text a lesson speaks (offline prefetch). */
    fun ttsTexts(spec: CustomLessonSpec): List<String> {
        val texts = ArrayList<String>()
        for (section in spec.sections) for (ex in section.exercises) {
            when (ex) {
                is NoteExercise -> ex.sentences.orEmpty().forEach { texts += it.hanzi }
                is ScrambleExercise -> texts += ex.correctOrder.joinToString("")
                is ChoiceExercise -> ex.options.forEach { texts += it.hanzi }
                is TranslateExercise -> texts += ex.referenceHanzi
                is MatchExercise -> ex.pairs.forEach { texts += it.hanzi }
                is DescribeImageExercise -> texts += ex.referenceHanzi
                is SpeakExercise -> ex.example?.let { texts += it.hanzi }
                is ListenChoiceExercise -> { texts += ex.audio.hanzi; ex.options.forEach { texts += it.hanzi } }
                is ListenTranslateExercise -> texts += ex.audio.hanzi
                is SentenceMakingExercise -> { ex.words.forEach { texts += it.hanzi }; ex.example?.let { texts += it.hanzi } }
                is WriteTypedExercise -> texts += ex.answer.hanzi
                is WriteHandwritingExercise -> texts += ex.answer.hanzi
                is DictationExercise -> texts += ex.audio.hanzi
                is OralExpressionExercise -> {
                    ex.questionAudio?.let { texts += it.hanzi }
                    ex.hints.orEmpty().forEach { texts += it.hanzi }
                    ex.example?.let { texts += it.hanzi }
                }
                is ConversationExercise, is UnknownExercise -> Unit
            }
        }
        return texts
    }

    data class TtsClip(val text: String, val voice: String? = null)

    /** `lessonTtsClips`: [ttsTexts] plus every conversation line in its speaker's voice. */
    fun ttsClips(spec: CustomLessonSpec): List<TtsClip> {
        val clips = ttsTexts(spec).map { TtsClip(it) }.toMutableList()
        for (section in spec.sections) for (ex in section.exercises) {
            if (ex !is ConversationExercise) continue
            val voices = conversationVoices(ex.speakers)
            for (line in ex.lines) clips += TtsClip(line.hanzi, voices.getOrNull(line.speaker))
        }
        return clips
    }

    /** DEFAULT_LESSON_VOICE — Radio Host, the app's default voice. */
    const val DEFAULT_VOICE = "Chinese (Mandarin)_Radio_Host"

    val VOICE_POOLS: Map<String, List<String>> = mapOf(
        "female" to listOf("Chinese (Mandarin)_Wise_Women", "Chinese (Mandarin)_Warm_Bestie", "Chinese (Mandarin)_Sweet_Lady"),
        "male" to listOf("Chinese (Mandarin)_Gentleman", "Chinese (Mandarin)_Sincere_Adult", "Chinese (Mandarin)_Male_Announcer"),
    )

    /** `resolveConversationVoices`: a distinct voice id per speaker, deterministic. */
    fun conversationVoices(speakers: List<ConversationSpeaker>): List<String> {
        val used = HashMap<String, Int>()
        return speakers.mapIndexed { i, speaker ->
            val gender = if (speaker.voice == "male" || speaker.voice == "female") speaker.voice else if (i % 2 == 0) "female" else "male"
            val pool = VOICE_POOLS.getValue(gender)
            val n = used[gender] ?: 0
            used[gender] = n + 1
            pool[n % pool.size]
        }
    }

    /** The gender a speaker plays with (the web's speaker icon). */
    fun speakerGender(speakers: List<ConversationSpeaker>, i: Int): String =
        speakers.getOrNull(i)?.voice?.takeIf { it == "male" || it == "female" } ?: if (i % 2 == 0) "female" else "male"

    /** `exercisePrimaryText` (diff.ts) — the one line that names an exercise. */
    fun primaryText(ex: LessonExercise): String = when (ex) {
        is NoteExercise -> ex.title?.takeIf { it.isNotEmpty() } ?: ex.sentences?.firstOrNull()?.hanzi ?: (ex.body ?: "").take(60)
        is ScrambleExercise -> ex.english
        is ChoiceExercise -> ex.question
        is TranslateExercise -> ex.english
        is MatchExercise -> ex.pairs.joinToString(" · ") { it.hanzi }
        is DescribeImageExercise -> ex.task?.takeIf { it.isNotEmpty() } ?: ex.referenceHanzi
        is SpeakExercise -> ex.prompt
        is ListenChoiceExercise -> ex.audio.hanzi
        is ListenTranslateExercise -> ex.audio.hanzi
        is SentenceMakingExercise -> ex.task?.takeIf { it.isNotEmpty() } ?: ex.words.joinToString(" · ") { it.hanzi }
        is WriteTypedExercise -> ex.answer.hanzi
        is WriteHandwritingExercise -> ex.answer.hanzi
        is DictationExercise -> ex.audio.hanzi
        is OralExpressionExercise -> ex.prompt
        is ConversationExercise -> ex.situation
        is UnknownExercise -> ""
    }

    /** The Mini Lessons page summary (`exerciseSummary` in MiniLessonsPage.tsx). */
    fun summary(ex: LessonExercise): String = when (ex) {
        is NoteExercise -> ex.title?.takeIf { it.isNotEmpty() }
            ?: ex.body?.takeIf { it.isNotEmpty() }?.let { if (it.length > 70) it.take(70) + "…" else it }
            ?: "${ex.sentences?.size ?: 0} example sentence(s)"
        is ListenChoiceExercise -> ex.question?.takeIf { it.isNotEmpty() } ?: ex.audio.hanzi
        else -> primaryText(ex)
    }

    /** Every character a lesson asks to be written by hand (`lessonHandwritingText`). */
    fun handwritingText(spec: CustomLessonSpec): String = buildString {
        for (s in spec.sections) for (ex in s.exercises) {
            if (ex is WriteHandwritingExercise) append(ex.answer.hanzi)
            else if (ex is DictationExercise && ex.input == WritingInput.HANDWRITE) append(ex.audio.hanzi)
        }
    }
}

/** One entry of shared/lesson/registry.ts — what the UI needs. */
data class ExerciseTypeInfo(val type: String, val icon: String, val name: String)

object ExerciseTypes {
    val INFO: Map<String, ExerciseTypeInfo> = listOf(
        ExerciseTypeInfo("note", "📖", "Note"),
        ExerciseTypeInfo("scramble", "🧩", "Word order"),
        ExerciseTypeInfo("choice", "🔘", "Multiple choice"),
        ExerciseTypeInfo("translate", "✍️", "Translate"),
        ExerciseTypeInfo("match", "🔗", "Match pairs"),
        ExerciseTypeInfo("describe_image", "🖼", "Describe picture"),
        ExerciseTypeInfo("speak", "🎤", "Speak"),
        ExerciseTypeInfo("listen_choice", "👂", "Listen & pick"),
        ExerciseTypeInfo("listen_translate", "👂", "Listen & translate"),
        ExerciseTypeInfo("sentence_making", "🛠", "Sentence making"),
        ExerciseTypeInfo("write_typed", "⌨️", "Writing — typed"),
        ExerciseTypeInfo("write_handwriting", "🖌", "Writing — handwriting"),
        ExerciseTypeInfo("dictation", "📝", "Dictation"),
        ExerciseTypeInfo("oral_expression", "🗣", "Oral expression"),
        ExerciseTypeInfo("conversation", "💬", "Conversation"),
    ).associateBy { it.type }

    fun label(type: String): String = INFO[type]?.let { "${it.icon} ${it.name}" } ?: type
}
