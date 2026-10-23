package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.core.DescribeImageExercise
import dev.jeromeswannack.chineselearning.lab.core.DictationExercise
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.GapChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.JudgeExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.ListenChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ListenTranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.MatchExercise
import dev.jeromeswannack.chineselearning.lab.core.NoteExercise
import dev.jeromeswannack.chineselearning.lab.core.OralExpressionExercise
import dev.jeromeswannack.chineselearning.lab.core.ScrambleExercise
import dev.jeromeswannack.chineselearning.lab.core.SentenceFeedback
import dev.jeromeswannack.chineselearning.lab.core.SentenceMakingExercise
import dev.jeromeswannack.chineselearning.lab.core.SpeakExercise
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.UnknownExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteHandwritingExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteTypedExercise
import java.io.File
import kotlin.random.Random

/**
 * What an exercise view may do outside itself: play audio, load an illustration, ask
 * Claude to check a sentence, make a recording, and give feedback (haptics / sounds).
 * The player builds it from [dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime];
 * screenshots and tests pass a fake.
 */
class ExerciseEnv(
    /** Fire-and-forget: speak Chinese text (cache-first TTS). */
    val speak: (String) -> Unit = {},
    /** One clip in a speaker's voice at a TTS speed (null = the default), awaited; false when it couldn't play. */
    val playClip: suspend (text: String, voice: String?, speed: Double?) -> Boolean = { _, _, _ -> false },
    /** The account's conversation voices cached on the phone (null = the shipped defaults). */
    val conversationVoices: suspend () -> List<String>? = { null },
    /** A conversation's speed / voices / delivery and the ⚙︎ Audio menu (ConversationAudioSheet.kt). */
    val conversationAudio: ConversationAudioControls = ConversationAudioControls.Preview,
    /** One conversation line in its voice / provider rate / delivery, awaited; regenerate = make it again first. */
    val playLine: suspend (clip: dev.jeromeswannack.chineselearning.lab.core.ConversationClip, regenerate: Boolean) -> Boolean = { _, _ -> false },
    val stopAudio: () -> Unit = {},
    /**
     * Runs while a lesson is open (docs/AUDIO.md "Lesson audio prefetch"): every clip it can play
     * that the phone doesn't have yet is fetched — the exercise in [current] first, refocused as it
     * changes. Not in the editor (its text changes as it is typed).
     */
    val prefetchLesson: suspend (spec: dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec, current: kotlinx.coroutines.flow.StateFlow<Int>) -> Unit = { _, _ -> },
    /** The exercise changed: a clip still on its way is dropped — it never plays on a later exercise. */
    val exerciseChanged: () -> Unit = {},
    /** A lesson opened: its audio counts start from zero. */
    val lessonAudioOpened: () -> Unit = {},
    /** The lesson closed: analytics `lesson.audio` with this run's counts (nothing when nothing was spoken). */
    val lessonAudioDone: (source: String) -> Unit = {},
    /** What is playing now (for lit-up buttons). */
    val playing: String? = null,
    /** An R2 image key → a local file (cached / downloaded), or null. */
    val image: suspend (key: String?) -> File? = { null },
    /** A file already on the device for [key] (no network) — the first frame renders it at once. */
    val cachedImage: (key: String?) -> File? = { null },
    /**
     * A describe_image picture over time — by its key, else asked by scene and polled while it
     * is drawn (data/lessons/LessonPictures). Null: only [image] / [cachedImage] by key.
     */
    val picture: ((key: String?, prompt: String) -> kotlinx.coroutines.flow.Flow<dev.jeromeswannack.chineselearning.lab.data.lessons.LessonPicture>)? = null,
    /** Claude's check of a made sentence; throws when it can't (offline, busy). */
    val sentenceFeedback: suspend (words: List<String>, task: String?, sentence: String) -> SentenceFeedback = { _, _, _ -> throw java.io.IOException("offline") },
    /** Claude's check of a self-assessed answer (device cache, then the API); throws when there is none (AnswerCheckViews.kt). */
    val answerCheck: AnswerCheckFn = { throw dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckUnavailable("offline", offline = true) },
    /** 💬 Ask about this: one follow-up reply about a checked answer; throws offline / busy. */
    val askAboutAnswer: suspend (
        input: dev.jeromeswannack.chineselearning.lab.core.AnswerCheckInput,
        check: dev.jeromeswannack.chineselearning.lab.core.AnswerCheck?,
        history: List<dev.jeromeswannack.chineselearning.lab.data.api.AskTurnDto>,
        question: String,
    ) -> String = { _, _, _, _ -> throw dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckUnavailable("offline", offline = true) },
    /** The voice recorder for oral expression (null: no microphone support here). */
    val recorder: LessonRecorder? = null,
    /** Transcribes a free-speaking take (live, else the upload) for Claude's check; null = no transcript. */
    val speaking: SpeakingTranscriber? = null,
    val playFile: (File) -> Unit = {},
    val onCorrect: () -> Unit = {},
    val onWrong: () -> Unit = {},
    val onTap: () -> Unit = {},
    /** Shuffles (options, tiles, match columns) — seeded in screenshots. */
    val random: Random = Random.Default,
    /** Stroke-order data for the writing pad (package H's StrokeStore); null = the sketch pad only. */
    val strokeLoader: (suspend (String) -> dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad)? = null,
)

/** correct = null for unscored exercises (notes); a recording comes with oral expression. */
typealias ExerciseDone = (correct: Boolean?, answer: ExerciseAnswer?, recording: File?) -> Unit

/** `ExerciseView`: the one switch over exercise types on the study side. */
@Composable
fun ExerciseView(exercise: LessonExercise, env: ExerciseEnv, mediaKey: String?, onDone: ExerciseDone) {
    val onNext: (Boolean, ExerciseAnswer?) -> Unit = { correct, answer -> onDone(correct, answer, null) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        when (exercise) {
            is NoteExercise -> NoteView(exercise, env) { onDone(null, null, null) }
            is ScrambleExercise -> ScrambleView(exercise, env, onNext)
            is ChoiceExercise -> ChoiceView(exercise, env, onNext)
            is TranslateExercise -> TranslateView(exercise, env, onNext)
            is MatchExercise -> MatchView(exercise, env, onNext)
            is DescribeImageExercise -> DescribeImageView(exercise, env, onNext)
            is SpeakExercise -> SpeakView(exercise, env, onNext)
            is ListenChoiceExercise -> ListenChoiceView(exercise, env, onNext)
            is ListenTranslateExercise -> ListenTranslateView(exercise, env, onNext)
            is SentenceMakingExercise -> SentenceMakingView(exercise, env, onNext)
            is WriteTypedExercise -> WriteTypedView(exercise, env, onNext)
            is WriteHandwritingExercise -> WriteHandwritingView(exercise, env, onNext)
            is DictationExercise -> DictationView(exercise, env, onNext)
            is OralExpressionExercise -> OralExpressionView(exercise, env, mediaKey, onDone)
            is ConversationExercise -> ConversationView(exercise, env, onNext)
            is JudgeExercise -> JudgeView(exercise, env, onNext)
            is GapChoiceExercise -> GapChoiceView(exercise, env, onNext)
            is UnknownExercise -> UnknownView(exercise) { onDone(null, null, null) }
        }
    }
}
