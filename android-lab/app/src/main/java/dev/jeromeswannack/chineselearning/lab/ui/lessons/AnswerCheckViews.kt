package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckInput
import dev.jeromeswannack.chineselearning.lab.core.AnswerTry
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSegmentInput
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckResult
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckUnavailable
import dev.jeromeswannack.chineselearning.lab.data.api.AskTurnDto
import dev.jeromeswannack.chineselearning.lab.ui.chat.DiffLine
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextField
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/*
 * Claude's check of a self-assessed lesson answer — the Lab twin of the web's
 * components/lessons/AnswerCheckCard.tsx, AskAboutAnswerSheet.tsx and useLessonAnswerCheck.tsx
 * (rules in core LessonAnswerCheck; docs/STUDY_SESSION.md "Claude checks your answer"):
 * started the moment the answer is final (the model answer itself is checked locally, no call), a slim "Checking…" row that never blocks the buttons,
 * then the verdict chip, the headline, the red-pen fix of the learner's OWN sentence, tips with
 * the quoted Chinese tappable into the explorer, a natural alternative with 🔊, the suggested
 * button ringed, 🔁 Try again and 💬 Ask about this. Offline / failed: nothing.
 */

/** The lesson's title / grammar point (LessonPlayer provides it), so the check stays on topic. */
val LocalLessonFocus = staticCompositionLocalOf<String?> { null }

sealed interface AnswerCheckUi {
    data object Idle : AnswerCheckUi
    data object Checking : AnswerCheckUi
    /** local = the answer IS the model answer: checked on the device, no call (LessonAnswerCheck.exact). */
    data class Done(val check: AnswerCheck, val cached: Boolean, val local: Boolean = false) : AnswerCheckUi
    data class Unavailable(val offline: Boolean) : AnswerCheckUi
}

/** Port of useLessonAnswerCheck(): one exercise's check, its earlier tries and the 💬 sheet. */
class LessonAnswerCheckState(
    private val exerciseType: String,
    private val promptEn: String?,
    private val modelAnswer: String,
    private val modelPinyin: String?,
    private val focus: String?,
    private val env: ExerciseEnv,
    private val scope: CoroutineScope,
    private val onRetry: () -> Unit,
    /** Free speaking: the task's useful words and the question played in Chinese. */
    private val hints: List<String>? = null,
    private val question: String? = null,
) {
    var ui by mutableStateOf<AnswerCheckUi>(AnswerCheckUi.Idle)
        private set
    var input by mutableStateOf<AnswerCheckInput?>(null)
        private set
    var asking by mutableStateOf(false)
    val tries = mutableStateListOf<AnswerTry>()
    private var job: Job? = null

    val check: AnswerCheck? get() = (ui as? AnswerCheckUi.Done)?.check
    /** got_it | missed_it | null while checking / without a check. */
    val suggested: String? get() = check?.suggested

    fun onFinal(text: String, source: String?) {
        job?.cancel()
        if (promptEn.isNullOrBlank() || !LessonAnswerCheck.applies(exerciseType, text)) {
            input = null
            ui = AnswerCheckUi.Idle
            return
        }
        val next = AnswerCheckInput(
            promptEn, modelAnswer, modelPinyin?.ifBlank { null }, text.trim(), exerciseType, source ?: "typed", focus?.ifBlank { null },
            hints = hints?.filter { it.isNotBlank() }?.ifEmpty { null }, questionAudio = question?.ifBlank { null },
        )
        input = next
        val tryNumber = tries.size + 1
        // The model answer itself ("✓ Exact match"): nothing for Claude to add — shown at once, offline too.
        LessonAnswerCheck.exact(next)?.let { exact ->
            ui = AnswerCheckUi.Done(exact, cached = false, local = true)
            Analytics.track("lesson.answer_check", mapOf("verdict" to exact.verdict, "ms" to 0L, "cached" to false, "local" to true, "exercise_type" to exerciseType, "input" to next.input, "try" to tryNumber))
            return
        }
        ui = AnswerCheckUi.Checking
        val began = System.currentTimeMillis()
        job = scope.launch {
            ui = try {
                val r = env.answerCheck(next)
                Analytics.track("lesson.answer_check", mapOf("verdict" to r.check.verdict, "ms" to System.currentTimeMillis() - began, "cached" to r.cached, "exercise_type" to exerciseType, "input" to next.input, "try" to tryNumber))
                AnswerCheckUi.Done(r.check, r.cached)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                val offline = e is AnswerCheckUnavailable && e.offline
                Analytics.track("lesson.answer_check", mapOf("verdict" to if (offline) "offline" else "error", "ms" to System.currentTimeMillis() - began, "cached" to false, "exercise_type" to exerciseType, "input" to next.input, "try" to tryNumber))
                AnswerCheckUi.Unavailable(offline)
            }
        }
    }

    /** Keep this try (with its check) and clear the card; the exercise re-opens its input. */
    fun retry() {
        job?.cancel()
        input?.let { tries += AnswerTry(it.answer, it.input, check) }
        Analytics.track("lesson.answer_retry", mapOf("verdict" to (check?.verdict ?: "none"), "exercise_type" to exerciseType, "try" to tries.size))
        input = null
        asking = false
        ui = AnswerCheckUi.Idle
        onRetry()
    }

    fun report(answer: ExerciseAnswer): ExerciseAnswer {
        val c = check
        val i = input
        return answer.copy(
            check = if (c != null && i != null && answer.text?.trim() == i.answer) c else null,
            tries = tries.toList().ifEmpty { null },
        )
    }

    suspend fun ask(history: List<AskTurnDto>, question: String): String {
        val i = input ?: throw AnswerCheckUnavailable("nothing to ask about")
        Analytics.track("lesson.answer_ask", mapOf("verdict" to (check?.verdict ?: "none"), "exercise_type" to exerciseType, "turn" to history.size / 2 + 1))
        return env.askAboutAnswer(i, check, history, question)
    }
}

@Composable
fun rememberLessonAnswerCheck(
    exerciseType: String,
    promptEn: String?,
    modelAnswer: String,
    modelPinyin: String?,
    env: ExerciseEnv,
    hints: List<String>? = null,
    question: String? = null,
    onRetry: () -> Unit,
): LessonAnswerCheckState {
    val scope = rememberCoroutineScope()
    val focus = LocalLessonFocus.current
    return remember(exerciseType, promptEn, modelAnswer) { LessonAnswerCheckState(exerciseType, promptEn, modelAnswer, modelPinyin, focus, env, scope, onRetry, hints, question) }
}

/** The card under "You said" + the 💬 sheet. */
@Composable
fun AnswerCheckView(state: LessonAnswerCheckState, answer: String, env: ExerciseEnv) {
    if (state.input == null) return
    AnswerCheckCard(state.ui, answer, onPlay = env.speak, onRetry = state::retry, onAsk = { state.asking = true })
    val input = state.input
    if (state.asking && input != null) {
        AskAboutAnswerSheet(input, state.check, ask = state::ask, onClose = { state.asking = false })
    }
}

/** Stateless (screenshots): Checking… / the check / nothing. */
@Composable
fun AnswerCheckCard(ui: AnswerCheckUi, answer: String, onPlay: (String) -> Unit, onRetry: (() -> Unit)? = null, onAsk: (() -> Unit)? = null) {
    when (ui) {
        AnswerCheckUi.Checking -> CheckingRow()
        is AnswerCheckUi.Done -> AnimatedVisibility(true, enter = fadeIn() + expandVertically()) {
            AnswerCheckBody(ui.check, answer, onPlay, onRetry, onAsk)
        }
        else -> Unit
    }
}

@Composable
private fun CheckingRow() {
    val t = rememberInfiniteTransition(label = "checking")
    val a by t.animateFloat(0.3f, 1f, infiniteRepeatable(tween(500), RepeatMode.Reverse), label = "dot")
    Row(
        Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp)
            .semantics { contentDescription = "Checking your answer" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).alpha(a).clip(CircleShape).background(Violet))
        Text("  Checking your answer…", color = Lab.colors.muted, fontSize = 14.sp)
    }
}

private fun toneColor(tone: String): Color = when (tone) {
    "good" -> Palette.Good
    "warn" -> Color(0xFFD97706)
    else -> Palette.Again
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AnswerCheckBody(
    check: AnswerCheck,
    answer: String,
    onPlay: ((String) -> Unit)? = null,
    onRetry: (() -> Unit)? = null,
    onAsk: (() -> Unit)? = null,
    compact: Boolean = false,
) {
    val chip = LessonAnswerCheck.chip(check.verdict, !check.cleaned.isNullOrEmpty())
    val tone = toneColor(chip.tone)
    val shape = RoundedCornerShape(14.dp)
    Row(Modifier.fillMaxWidth().padding(top = 8.dp).clip(shape).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, shape)) {
        Box(Modifier.width(4.dp).heightIn(min = 40.dp).background(tone))
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    chip.label, color = tone, fontWeight = FontWeight.Bold, fontSize = 13.sp,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(tone.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 2.dp),
                )
                Text(check.headline, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            }
            check.parts?.takeIf { it.isNotEmpty() }?.let { SpeakingParts(it) }
            if (!check.cleaned.isNullOrEmpty()) CleanerVersionBlock(check, onPlay, compact)
            if (check.corrected.isNotEmpty() && check.cleaned.isNullOrEmpty()) {
                val diff = remember(answer, check.corrected) { ChatLearning.correctionDiff(answer, check.corrected) }
                Column(
                    Modifier.fillMaxWidth().then(if (onPlay != null) Modifier.bouncyClickable(pressedScale = 0.98f) { onPlay(check.corrected) } else Modifier),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Row { Text("✗ ", color = Palette.Again.copy(alpha = 0.8f)); DiffLine(diff.original, added = false, fontSize = if (compact) 15.sp else 16.sp, base = Lab.colors.muted) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("✓ ", color = Palette.Good, fontWeight = FontWeight.Bold)
                        DiffLine(diff.corrected, added = true, fontSize = if (compact) 17.sp else 20.sp)
                        if (onPlay != null) Text(" 🔊", fontSize = 16.sp)
                    }
                    if (check.correctedPinyin.isNotEmpty()) Text(check.correctedPinyin, color = Lab.colors.accent, fontSize = 14.sp)
                }
            }
            for (tip in check.tips) {
                val segs = remember(tip) { LessonAnswerCheck.tipSegments(tip) }
                Row {
                    Text("•  ", color = Violet, fontWeight = FontWeight.Bold)
                    Column {
                        if (tip.quote != null && !segs.quoteInText) {
                            ExplorableText(tip.quote!!, source = "lesson", segments = listOf(WordSegmentInput(tip.quote!!)), color = Violet, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        }
                        ExplorableText(
                            tip.text, source = "lesson",
                            segments = segs.segments.map { WordSegmentInput(it.text) },
                            highlight = tip.quote?.takeIf { segs.quoteInText },
                            fontSize = 15.sp, color = Lab.colors.ink,
                        )
                        tip.fix?.let { fix ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("→ ", color = Palette.Good, fontWeight = FontWeight.Bold)
                                ExplorableText(fix, source = "lesson", fontSize = 17.sp, color = Palette.Good, fontWeight = FontWeight.SemiBold)
                                if (onPlay != null) {
                                    Box(Modifier.size(44.dp).bouncyClickable { onPlay(fix) }.semantics { contentDescription = "Play the better version" }, contentAlignment = Alignment.Center) { Text("🔊", fontSize = 16.sp) }
                                }
                            }
                            tip.fixPinyin?.let { Text(it, color = Lab.colors.accent, fontSize = 14.sp) }
                        }
                    }
                }
            }
            check.alternative?.let { alt ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Also natural: ", color = Lab.colors.muted, fontSize = 14.sp)
                        ExplorableText(alt.hanzi, source = "lesson", fontSize = 18.sp)
                        if (onPlay != null) {
                            Box(Modifier.size(44.dp).bouncyClickable { onPlay(alt.hanzi) }.semantics { contentDescription = "Play the alternative" }, contentAlignment = Alignment.Center) { Text("🔊", fontSize = 18.sp) }
                        }
                    }
                    alt.pinyin?.let { Text(it, color = Lab.colors.accent, fontSize = 14.sp) }
                    alt.english?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp) }
                }
            }
            if (onRetry != null || onAsk != null) {
                FlowRow(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    onRetry?.let { CheckAction("🔁 Try again", it) }
                    onAsk?.let { CheckAction("💬 Ask about this", it) }
                }
            }
        }
    }
}

@Composable
private fun CheckAction(label: String, onClick: () -> Unit) {
    Text(
        label, color = Color(0xFF6B21A8), fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
        modifier = Modifier.heightIn(min = 44.dp).bouncyClickable(onClick = onClick).clip(RoundedCornerShape(50))
            .background(Violet.copy(alpha = 0.10f)).border(1.dp, Violet.copy(alpha = 0.25f), RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 11.dp),
    )
}

/** 💬 Ask about this: a short chat about ONE checked answer, inside the lesson. Online only. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AskAboutAnswerSheet(input: AnswerCheckInput, check: AnswerCheck?, ask: suspend (List<AskTurnDto>, String) -> String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val turns = remember { mutableStateListOf<AskTurnDto>() }
    var draft by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun send(question: String) {
        val q = question.trim()
        if (q.isEmpty() || busy) return
        val history = turns.toList()
        turns += AskTurnDto("user", q)
        draft = ""
        busy = true
        error = null
        scope.launch {
            try {
                turns += AskTurnDto("assistant", ask(history, q))
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                error = if (e is AnswerCheckUnavailable && e.offline) "Asking needs a connection." else "Claude couldn’t answer just now — try again."
                turns.removeAt(turns.size - 1)
                draft = q
            } finally {
                busy = false
            }
        }
    }
    LabBottomSheet(onDismiss = onClose, title = "💬 Ask about your answer") {
        AskAboutAnswerContent(input, check, turns, busy, error, draft, onDraft = { draft = it }, onSend = ::send)
    }
}

/** The sheet's body (stateless, for screenshots). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AskAboutAnswerContent(
    input: AnswerCheckInput,
    check: AnswerCheck?,
    turns: List<AskTurnDto>,
    busy: Boolean,
    error: String?,
    draft: String,
    onDraft: (String) -> Unit,
    onSend: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(input.promptEn, color = Lab.colors.muted, fontSize = 14.sp)
            Text("You: ${check?.cleaned?.ifEmpty { null } ?: input.answer}", color = Lab.colors.ink, fontSize = 15.sp)
            if (check?.corrected?.isNotEmpty() == true) Text("Fix: ${check.corrected}", color = Lab.colors.ink, fontSize = 15.sp)
        }
        for (t in turns) {
            val mine = t.role == "user"
            Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
                Box(
                    Modifier.fillMaxWidth(0.88f).clip(RoundedCornerShape(14.dp))
                        .background(if (mine) Color(0xFFDBEAFE) else Lab.colors.faint).padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    if (mine) Text(t.text, color = Lab.colors.ink, fontSize = 15.sp)
                    else ExplorableText(t.text, source = "lesson", fontSize = 15.sp)
                }
            }
        }
        if (busy) Text("Thinking…", color = Lab.colors.muted, fontSize = 14.sp)
        error?.let { Text(it, color = Palette.Again, style = MaterialTheme.typography.bodyMedium) }
        if (turns.isEmpty() && !busy) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (q in LessonAnswerCheck.askQuickQuestions(check?.verdict, input.exerciseType)) {
                    Text(
                        q, color = Color(0xFF6B21A8), fontSize = 14.sp,
                        modifier = Modifier.heightIn(min = 40.dp).bouncyClickable { onSend(q) }.clip(RoundedCornerShape(50))
                            .background(Violet.copy(alpha = 0.08f)).border(1.dp, Violet.copy(alpha = 0.25f), RoundedCornerShape(50))
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
            }
        }
        VoiceTextField(
            value = draft, onValueChange = onDraft, onSubmit = { onSend(it.text) },
            surface = "lesson_answer_ask", submitLabel = "Ask", placeholder = "Ask about your answer…", lang = "en", enabled = !busy,
        )
    }
}

/** Builds the check from the device cache, else the API (online). */
typealias AnswerCheckFn = suspend (AnswerCheckInput) -> AnswerCheckResult

/** Speaking: the task's parts — ✓ used, ~ used with a slip, ✗ missing — each with its note. */
@Composable
private fun SpeakingParts(parts: List<dev.jeromeswannack.chineselearning.lab.core.AnswerCheckPart>) {
    Column(Modifier.fillMaxWidth().testTag("answer-check-parts"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (p in parts) {
            val mark = LessonAnswerCheck.partMark(p.status)
            val tone = toneColor(mark.tone)
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.size(22.dp).clip(CircleShape).background(tone.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
                    Text(mark.icon, color = tone, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
                Column(Modifier.padding(start = 8.dp)) {
                    Row {
                        Text(p.label, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                        if (p.status == "missing") Text("  missing", color = Palette.Again, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                    p.note?.let { ExplorableText(it, source = "lesson", fontSize = 14.sp, color = Lab.colors.muted) }
                }
            }
        }
    }
}

/** Speaking: "A cleaner version" — what they meant, the real fixes marked. */
@Composable
private fun CleanerVersionBlock(check: AnswerCheck, onPlay: ((String) -> Unit)?, compact: Boolean) {
    val v = LessonAnswerCheck.cleanerVersion(check)
    if (v.hanzi.isEmpty()) return
    Column(
        Modifier.fillMaxWidth().then(if (onPlay != null) Modifier.bouncyClickable(pressedScale = 0.98f) { onPlay(v.hanzi) } else Modifier),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(if (v.diffFrom != null) "A CLEANER VERSION" else "WHAT YOU SAID, TIDIED UP", color = Lab.colors.muted, fontWeight = FontWeight.Bold, fontSize = 11.sp)
        Row(verticalAlignment = Alignment.CenterVertically) {
            val from = v.diffFrom
            if (from != null) {
                val text = remember(from, v.hanzi) { cleanerWithFixes(from, v.hanzi) }
                Text(text, color = Lab.colors.ink, fontSize = if (compact) 15.sp else 17.sp, modifier = Modifier.weight(1f, fill = false))
            } else {
                Text(v.hanzi, color = Lab.colors.ink, fontSize = if (compact) 15.sp else 17.sp, modifier = Modifier.weight(1f, fill = false))
            }
            if (onPlay != null) Text(" 🔊", fontSize = 16.sp)
        }
        if (v.pinyin.isNotEmpty()) Text(v.pinyin, color = Lab.colors.accent, fontSize = 14.sp)
    }
}


/**
 * The cleaner version with the real fixes in green: the character diff (punctuation-blind, like the
 * web's correctionDiff) re-threaded through the text as written, so its punctuation stays.
 */
private fun cleanerWithFixes(from: String, corrected: String): androidx.compose.ui.text.AnnotatedString {
    val flat = ChatLearning.correctionDiff(from, corrected).corrected.flatMap { r -> r.text.codePoints().toArray().map { String(Character.toChars(it)) to r.same } }
    var p = 0
    return androidx.compose.ui.text.buildAnnotatedString {
        for (cp in corrected.codePoints().toArray()) {
            val ch = String(Character.toChars(cp))
            val hit = flat.getOrNull(p)?.takeIf { it.first.equals(ch, ignoreCase = true) }
            if (hit != null) p++
            if (hit != null && !hit.second) {
                pushStyle(androidx.compose.ui.text.SpanStyle(color = Palette.Good, fontWeight = FontWeight.Bold, background = Palette.Good.copy(alpha = 0.16f)))
                append(ch)
                pop()
            } else append(ch)
        }
    }
}
