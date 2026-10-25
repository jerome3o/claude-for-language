package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CoachMistakeLesson
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.RevisitState
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.CompletionUpload
import dev.jeromeswannack.chineselearning.lab.data.api.coachConversation
import dev.jeromeswannack.chineselearning.lab.data.api.saveCoachMistakeLesson
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonPlayer
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PlayerContext
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PreviewSave
import dev.jeromeswannack.chineselearning.lab.ui.lessons.rememberExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

/*
 * "🎯 Mini lesson on this mistake" (core CoachMistakeLesson, web SentenceCoachPage + CoachLessonPage):
 * the lesson card in the conversation and `/coach/:c/lesson/:m` — the lesson in the real player as a
 * PREVIEW (nothing recorded while he plays it), "＋ Save" in the top bar or a rating at the end puts it
 * in his mini lessons (a rating also records this run as its first completion, so it comes back when the
 * rating says instead of waiting as a new lesson). Plays offline from the cached conversation.
 */

/** The coach conversation's lesson route (web: `/coach/:conversationId/lesson/:messageId`). */
fun Routes.coachLesson(conversationId: String, messageId: String) = "/coach/${android.net.Uri.encode(conversationId)}/lesson/${android.net.Uri.encode(messageId)}"

/** Test tags (the web's data-testids). */
object CoachLessonTags {
    const val CHIP = "coach-quick-mistake-lesson"
    const val CARD = "coach-lesson-card"
    const val PENDING = "coach-lesson-pending"
    const val FAILED = "coach-lesson-failed"
    const val PLAY = "coach-lesson-play"
    const val SAVE = "coach-lesson-save"
    const val SAVED = "coach-lesson-saved-chip"
    const val DONE = "coach-lesson-saved"
}

/** The lesson card in the conversation: what it is, ▶ Do it, Save to my mini lessons / ✓ In your mini lessons. */
@Composable
fun MistakeLessonCard(content: CoachMistakeLesson.Content, saving: Boolean, error: String?, onPlay: () -> Unit, onSave: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    val saved = content.lessonId != null
    Column(
        Modifier.fillMaxWidth().clip(shape).background(Lab.colors.card).border(1.dp, Violet.copy(alpha = 0.45f), shape).padding(16.dp).testTag(CoachLessonTags.CARD),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(content.spec.icon ?: "🎯", fontSize = 32.sp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(CoachMistakeLesson.cardLine(CoachMistakeLesson.exerciseCount(content.spec)).uppercase(), color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, letterSpacing = 0.6.sp)
                Text(content.spec.title, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                content.spec.description?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            PrimaryPill("▶ Do it", Modifier.weight(1f).heightIn(min = 48.dp).testTag(CoachLessonTags.PLAY), onClick = onPlay)
            if (saved) {
                Text("✓ In your mini lessons", color = Palette.Good, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.weight(1f).testTag(CoachLessonTags.SAVED))
            } else {
                SecondaryPill(if (saving) "Saving…" else "Save to my mini lessons", Modifier.weight(1f).heightIn(min = 48.dp).testTag(CoachLessonTags.SAVE), enabled = !saving, onClick = onSave)
            }
        }
        if (!saved) Text("Try it first — nothing is recorded until you save it.", color = Lab.colors.muted, fontSize = 13.sp)
        error?.let { InlineNotice(it, kind = dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind.Error) }
    }
}

internal val Violet = androidx.compose.ui.graphics.Color(0xFF7C3AED)

// ============ The player: /coach/:c/lesson/:m ============

data class CoachLessonUi(
    val loading: Boolean = true,
    val content: CoachMistakeLesson.Content? = null,
    val savedHere: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    /** Saved with this run as its completion: the done screen, with the run's end line. */
    val finishedLine: String? = null,
) {
    val saved: Boolean get() = savedHere || content?.lessonId != null
}

class CoachLessonViewModel(private val app: LabApp, private val conversationId: String, private val messageId: String) : ViewModel() {
    private val _ui = MutableStateFlow(CoachLessonUi())
    val ui: StateFlow<CoachLessonUi> = _ui.asStateFlow()
    private val key = "coach/c/$conversationId"

    init {
        viewModelScope.launch {
            // The conversation as this phone has it (offline too), else fetched.
            var thread = app.safely("coach lesson cache") { app.cache.get<CoachThreadDto>(key) }
            if (lessonOf(thread) == null && app.online.value) {
                thread = app.safely("coach lesson load") { app.repo.api.coachConversation(conversationId).also { app.cache.put(key, "coach-thread", it) } } ?: thread
            }
            val content = lessonOf(thread)
            _ui.value = CoachLessonUi(loading = false, content = content)
            if (content != null) app.analytics.track("coach.mistake_lesson_play", mapOf("exercises" to CoachMistakeLesson.exerciseCount(content.spec), "saved" to (content.lessonId != null)))
        }
    }

    private fun lessonOf(t: CoachThreadDto?): CoachMistakeLesson.Content? =
        t?.messages?.firstOrNull { it.id == messageId && it.content_type == CoachMistakeLesson.CONTENT_TYPE && it.status == null }?.let { CoachMistakeLesson.parse(it.content) }

    /** "＋ Save" (no completion) or "Save to my mini lessons" at the end ([result]: this run is its first completion). */
    fun save(result: LessonResult?) {
        if (_ui.value.busy) return
        if (!app.online.value) {
            _ui.update { it.copy(error = "You're offline — saving needs a connection. Try again when you're back online, or save it from the conversation later.") }
            return
        }
        _ui.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val completion = result?.let { CompletionUpload(UUID.randomUUID().toString(), "", it.correct, it.total, Js.toIsoString(System.currentTimeMillis()), null, it.attempt, it.outcome) }
                val res = app.repo.api.saveCoachMistakeLesson(conversationId, messageId, completion)
                res.message?.let { m -> app.cache.get<CoachThreadDto>(key)?.let { t -> app.cache.put(key, "coach-thread", t.copy(messages = t.messages.map { if (it.id == m.id) m else it })) } }
                app.analytics.track("coach.mistake_lesson_save", mapOf("done" to (result != null), "missed" to result?.outcome?.missed?.size))
                app.haptics.correct()
                if (result != null) app.sounds.play(Sounds.Sfx.CORRECT, 0.6f)
                _ui.update { it.copy(busy = false, savedHere = true, finishedLine = result?.let { r -> dev.jeromeswannack.chineselearning.lab.core.LessonRevision.runEndLine(r.outcome, false) }) }
                // Onto the phone now (with its completion), so it is scheduled — and works offline.
                app.scope.launch { app.safely("coach lesson sync") { LessonRuntime.of(app).store.sync(online = true) } }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, error = CoachRules.errorText(e, "Couldn't save it", app.online.value)) }
            }
        }
    }

    class Factory(private val app: LabApp, private val c: String, private val m: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CoachLessonViewModel(app, c, m) as T
    }
}

fun NavGraphBuilder.coachLessonGraph(nav: LabNav) {
    composable(Routes.route("/coach/{c}/lesson/{m}")) { entry ->
        val c = entry.arguments?.getString("c").orEmpty()
        val m = entry.arguments?.getString("m").orEmpty()
        val vm: CoachLessonViewModel = viewModel(key = "coach-lesson-$m", factory = CoachLessonViewModel.Factory(nav.app, c, m))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val env = rememberExerciseEnv(nav.app, preview = true)
        CoachLessonScreen(ui, onSave = vm::save, onBack = nav::back) { content, previewSave ->
            LessonPlayer(
                title = content.spec.title,
                icon = content.spec.icon ?: "🎯",
                spec = content.spec,
                env = env,
                context = PlayerContext.Preview,
                onComplete = {},
                onEnd = nav::back,
                previewSave = previewSave,
                skipHandwriting = nav.app.prefs.skipHandwriting,
            )
        }
    }
}

/** The route's screens: loading, missing, the player (via [player]) and the saved screen. */
@Composable
fun CoachLessonScreen(
    ui: CoachLessonUi,
    onSave: (LessonResult?) -> Unit,
    onBack: () -> Unit,
    player: @Composable (CoachMistakeLesson.Content, PreviewSave) -> Unit,
) {
    val content = ui.content
    when {
        ui.loading -> Box(Modifier.fillMaxSize().background(Lab.colors.background))
        content == null -> LabScreen("Mini lesson", onBack = onBack) {
            item { InlineNotice("This lesson isn't on this phone — open it from the conversation when you're online.") }
        }
        ui.finishedLine != null -> CoachLessonSaved(content, ui.finishedLine, onBack)
        else -> player(content, PreviewSave(saved = ui.saved, busy = ui.busy, error = ui.error, onSaveNow = { onSave(null) }, onSaveDone = { onSave(it) }))
    }
}

@Composable
private fun CoachLessonSaved(content: CoachMistakeLesson.Content, endLine: String, onBack: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding().testTag(CoachLessonTags.DONE)) {
        ConfettiRain(key = 1, colors = Palette.Confetti)
        Column(
            Modifier.fillMaxWidth().align(Alignment.Center).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(content.spec.icon ?: "🎯", fontSize = 64.sp)
            Text("Saved to your mini lessons", style = MaterialTheme.typography.headlineSmall, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Text(endLine, color = Lab.colors.muted, textAlign = TextAlign.Center)
            PrimaryPill("Back to the coach", Modifier.fillMaxWidth().height(54.dp), onClick = onBack)
        }
    }
}
