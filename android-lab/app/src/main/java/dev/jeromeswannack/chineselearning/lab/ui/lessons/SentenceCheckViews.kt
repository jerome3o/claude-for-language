package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.LessonFeedback
import dev.jeromeswannack.chineselearning.lab.core.SentenceCheck
import dev.jeromeswannack.chineselearning.lab.core.SentenceFeedback
import dev.jeromeswannack.chineselearning.lab.core.SentenceFix
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.isOffline
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiBurst
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextField
import dev.jeromeswannack.chineselearning.lab.ui.study.AnswerDiffView
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

/*
 * Claude's grade of a sentence the learner MADE (core SentenceCheck = shared/lesson/sentenceCheck.ts; web
 * components/lessons/SentenceCheck.tsx; docs/STUDY_SESSION.md "Sentence making: an honest verdict"): the grade's icon +
 * colour on ONE headline (no box), at most one muted reason + More ▸, then — for needs work / wrong — 🎤 Try again (a
 * new sentence checked in place, practice only) and ✨ Show a fixed version (on tap; his sentence lined up with the fix,
 * ▶ + pinyin, 🎤 Say it).
 */

object SentenceCheckTags {
    const val VERDICT = "sentence-feedback"
    const val RETRY_VERDICT = "sentence-retry-feedback"
    const val TRY_AGAIN = "sentence-try-again"
    const val SHOW_FIX = "sentence-show-fix"
    const val FIX = "sentence-fix"
    const val RETRY = "sentence-retry"
    const val EXAMPLE_TOGGLE = "sentence-example-toggle"
}

/** The grade line: icon + headline in the grade's colour, the reason under it, More ▸ when there is more. */
@Composable
fun SentenceVerdictLine(f: SentenceFeedback, words: List<String>, tag: String = SentenceCheckTags.VERDICT, compact: Boolean = false) {
    val v = remember(f, words) { SentenceCheck.view(f, words) }
    var more by remember(f) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().testTag(tag).semantics { contentDescription = "${v.label}: ${v.headline}" }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("${v.icon} ${v.headline}", Modifier.testTag("$tag-headline"), color = dev.jeromeswannack.chineselearning.lab.ui.study.ResultColors.ink(v.state), fontWeight = FontWeight.Bold, fontSize = if (compact) 15.sp else 17.sp)
        // More ▸ opens the fuller text in place of a reason line it already holds (never the line, then all of it again).
        if (v.reason.isNotEmpty() && !(more && v.moreIncludesReason)) Text(v.reason, Modifier.testTag("$tag-reason"), color = Lab.colors.muted, fontSize = 14.sp)
        if (v.more.isNotEmpty()) {
            if (more) Text(v.more, Modifier.testTag("$tag-full"), color = Lab.colors.muted, fontSize = 14.sp)
            else Text(
                "${SentenceCheck.MORE_LABEL} ▸", color = Lab.colors.accent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.testTag("$tag-more").heightIn(min = 44.dp).bouncyClickable(onClick = { more = true }).padding(vertical = 10.dp),
            )
        }
    }
}

/** One 🎤 Try again: his new sentence and its check (practice only). */
data class SentenceRetry(val text: String, val input: String, val state: String, val feedback: SentenceFeedback? = null)

/** A ✨ fixed version: for which sentence, loading / done / offline / failed. */
data class SentenceFixState(val forText: String, val state: String, val fix: SentenceFix? = null)

/** Screenshots / tests: a fixed starting state. */
data class SentenceCheckPreview(val retries: List<SentenceRetry> = emptyList(), val fix: SentenceFixState? = null, val composing: Boolean = false)

/**
 * The grade + the iterate actions. [feedback] = the first check (the one that counts); Try again's checks live here and
 * never change it. [onExample] opens the example (offline Try again compares with it).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SentenceCheckPanel(
    feedback: SentenceFeedback,
    sentence: String,
    input: String,
    words: List<String>,
    task: String?,
    env: ExerciseEnv,
    onExample: () -> Unit,
    preview: SentenceCheckPreview? = null,
) {
    val scope = rememberCoroutineScope()
    val retries = remember { mutableStateListOf<SentenceRetry>().apply { preview?.retries?.let { addAll(it) } } }
    var composing by remember { mutableStateOf(preview?.composing ?: false) }
    var draft by remember { mutableStateOf("") }
    var fix by remember { mutableStateOf(preview?.fix) }

    val first = remember(feedback, words) { SentenceCheck.view(feedback, words) }
    val last = retries.lastOrNull()
    val lastView = last?.feedback?.takeIf { last.state == "done" }?.let { SentenceCheck.view(it, words) }
    val currentText = if (lastView != null) last.text else sentence
    val currentInput = if (lastView != null) last.input else input
    val currentFeedback = if (lastView != null) last.feedback!! else feedback
    val current = lastView ?: first
    val solved = current.right
    val busy = last?.state == "checking"

    fun tryAgain(text0: String, source: String) {
        val text = AnswerKey.spokenCheckAnswer(text0, source)
        if (text.isEmpty()) return
        val n = retries.size + 1
        composing = false
        draft = ""
        fix = null
        retries += SentenceRetry(text, source, "checking")
        scope.launch {
            val (state, fb) = try {
                "done" to env.sentenceFeedback(words, task, text, source)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                // Only a real network failure is "offline"; a server error (HttpException) is "Claude couldn't".
                (if (e.isOffline()) "offline" else "error") to null
            }
            if (n - 1 < retries.size) retries[n - 1] = retries[n - 1].copy(state = state, feedback = fb)
            val result = fb?.let { SentenceCheck.view(it, words).grade } ?: state
            Analytics.track("lesson.sentence_retry", mapOf("result" to result, "try" to n, "input" to source))
            if (fb != null) {
                val f = LessonFeedback.feel(if (result == "right") LessonFeedback.SAY_AGAIN_RIGHT else LessonFeedback.SAY_AGAIN_MISS)
                f.feel?.let { env.feel(it) }
            } else if (state == "offline") onExample()
        }
    }

    fun showFix() {
        val forText = currentText
        val forInput = currentInput
        // The fix is told what the check found wrong (a problem of meaning has no small edit to find on its own).
        val problem = SentenceCheck.fixProblem(currentFeedback, words)
        fix = SentenceFixState(forText, "loading")
        val started = System.currentTimeMillis()
        scope.launch {
            fix = try {
                val r = env.sentenceFix(words, task, forText, forInput, problem)
                Analytics.track("lesson.sentence_fix_shown", mapOf("result" to "shown", "ms" to System.currentTimeMillis() - started, "cached" to false))
                SentenceFixState(forText, "done", r)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                val offline = e.isOffline()
                Analytics.track("lesson.sentence_fix_shown", mapOf("result" to if (offline) "offline" else "failed", "ms" to System.currentTimeMillis() - started, "cached" to false))
                SentenceFixState(forText, if (offline) "offline" else "failed")
            }
        }
    }

    val shownFix = fix?.takeIf { it.forText == currentText }

    Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FeelBox(if (first.right) LessonFeedback.CLAUDE_RIGHT else null, env, key = feedback.grade ?: feedback.verdict) {
            SentenceVerdictLine(feedback, words)
        }

        retries.forEachIndexed { i, r ->
            Column(Modifier.fillMaxWidth().testTag(SentenceCheckTags.RETRY), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                HorizontalDivider(color = Lab.colors.cardBorder)
                Text("🎤 Try ${i + 2}   ${r.text}", color = Lab.colors.ink, fontSize = 16.sp)
                when (r.state) {
                    "checking" -> ClaudeCheckingRow()
                    "done" -> r.feedback?.let { fb ->
                        val right = SentenceCheck.view(fb, words).right && i == retries.lastIndex
                        Box(Modifier.fillMaxWidth()) {
                            SentenceVerdictLine(fb, words, tag = SentenceCheckTags.RETRY_VERDICT, compact = true)
                            if (right) ConfettiBurst(key = "retry-$i", colors = Palette.Confetti, modifier = Modifier.matchParentSize())
                        }
                    }
                    "offline" -> Text(SentenceCheck.RETRY_OFFLINE, color = Lab.colors.muted, fontSize = 14.sp)
                    else -> Text("Claude couldn’t check it just now — try once more.", color = Lab.colors.muted, fontSize = 14.sp)
                }
            }
        }

        if (!solved && !busy && !composing) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CheckAction("🎤 ${SentenceCheck.TRY_AGAIN_LABEL}", onClick = { composing = true }, tag = SentenceCheckTags.TRY_AGAIN)
                if (current.fixable && shownFix == null) CheckAction("✨ ${SentenceCheck.SHOW_FIX_LABEL}", onClick = { showFix() }, tag = SentenceCheckTags.SHOW_FIX)
            }
        }

        if (composing) {
            VoiceTextField(
                value = draft, onValueChange = { draft = it },
                onSubmit = { a -> tryAgain(a.text, a.source) },
                surface = "lesson_sentence_retry", submitLabel = "Check", placeholder = "Your new sentence…", multiline = true,
            )
            Text(SentenceCheck.RETRY_NOTE, color = Lab.colors.muted, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }

        if (shownFix != null && !solved) {
            Column(Modifier.fillMaxWidth().testTag(SentenceCheckTags.FIX), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (shownFix.state) {
                    "loading" -> Text(SentenceCheck.FIXING_LINE, color = Lab.colors.muted, fontSize = 14.sp)
                    "offline" -> Text(SentenceCheck.FIX_OFFLINE, color = Lab.colors.muted, fontSize = 14.sp)
                    "failed" -> Text(SentenceCheck.FIX_FAILED, color = Lab.colors.muted, fontSize = 14.sp)
                    else -> shownFix.fix?.let { fx ->
                        AnswerDiffView(
                            said = shownFix.forText, expected = fx.hanzi, expectedPinyin = fx.pinyin, expectedEnglish = fx.english,
                            expectedLabel = SentenceCheck.FIX_LABEL, saidLabel = "You said", hideLine = true,
                            onPlayExpected = { env.speak(fx.hanzi) }, tag = "sentence-fix-diff",
                        )
                        SayItAgainRow(fx.hanzi, "sentence_making", "fix", env, labelOverride = SentenceCheck.SAY_FIX_LABEL)
                    }
                }
            }
        }
    }
}
