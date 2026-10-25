package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Handwriting
import dev.jeromeswannack.chineselearning.lab.core.HomeHomeworkRow
import dev.jeromeswannack.chineselearning.lab.core.HomeworkRowActions
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkStore
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.data.lessons.SkipHandwriting
import dev.jeromeswannack.chineselearning.lab.data.revisit.RevisitStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The long-press / ⋯ menu on a homework or mini lesson row (web components/homework/RowActions.tsx;
 * rules in core [HomeworkRowActions], parity-tested): Home's card, /homework and Mini Lessons' To do.
 *
 *  - Skip this homework (the tutor's) → a `skip` pass event; confirmed (she will see it); Undo.
 *  - Stop revising — done for good (a revision / his own lesson) → a revisit retire; Undo = restore.
 *  - Delete lesson → DELETE /api/custom-lessons/:id (confirmed, needs a connection).
 *  - Skip handwriting exercises → the account switch on; Undo turns it off.
 */
data class RowActionTarget(
    /** "assignment" | "tutor_lesson" | "revision" | "lesson" (core HomeworkRowActions). */
    val kind: String,
    val title: String,
    val tutorName: String?,
    val assignmentId: String?,
    /** The assignment's kind (deck / lesson / reader / link), for analytics. */
    val assignmentKind: String?,
    val lessonId: String?,
)

/** A Home / homework card row's menu target (web rowActionTarget). */
fun HomeHomeworkRow.actionTarget(): RowActionTarget = RowActionTarget(
    kind = HomeworkRowActions.homeRowKind(key),
    title = title,
    tutorName = tutorName,
    assignmentId = assignmentId,
    assignmentKind = if (assignmentId != null) (if (kind == "revision") "lesson" else kind) else null,
    lessonId = lessonId,
)

data class RowMenuOpen(val target: RowActionTarget, val actions: List<String>)

data class RowActionToast(val text: String, val undo: (suspend () -> Unit)?)

/** What the menu, its confirm and its toast show; [RowActionsHost] draws them. */
@Stable
class RowActionsController(
    private val app: LabApp,
    private val from: String,
    private val scope: CoroutineScope,
    private val onChanged: (String) -> Unit,
) {
    var opened by mutableStateOf<RowMenuOpen?>(null)
    var confirm by mutableStateOf<String?>(null)
    var toast by mutableStateOf<RowActionToast?>(null)
    var busy by mutableStateOf(false)

    fun open(target: RowActionTarget) {
        scope.launch {
            val hasHandwriting = target.lessonId?.let { id ->
                runCatching { LessonRuntime.of(app).store.entry(id)?.lesson?.spec?.let(Handwriting::lessonHasHandwriting) }.getOrNull()
            } ?: false
            val actions = HomeworkRowActions.actions(target.kind, target.assignmentId, target.lessonId, hasHandwriting, app.prefs.skipHandwriting)
            if (actions.isNotEmpty()) {
                app.haptics.tick()
                opened = RowMenuOpen(target, actions)
            }
        }
    }

    fun choose(action: String) {
        val o = opened ?: return
        if (HomeworkRowActions.confirm(action, o.target.title, o.target.tutorName) != null && confirm == null) {
            confirm = action
            return
        }
        confirm = null
        run(o.target, action)
    }

    private fun run(target: RowActionTarget, action: String) {
        busy = true
        scope.launch {
            val props = mapOf("action" to action, "kind" to target.kind, "from" to from)
            try {
                var undo: (suspend () -> Unit)? = null
                when (action) {
                    HomeworkRowActions.SKIP_HOMEWORK -> target.assignmentId?.let { id ->
                        val event = HomeworkStore.recordSkip(app, id)
                        Analytics.track("homework.skipped", mapOf("kind" to (target.assignmentKind ?: "lesson"), "undo" to false))
                        undo = {
                            HomeworkStore.recordUndoOf(app, id, event.id)
                            Analytics.track("homework.skipped", mapOf("kind" to (target.assignmentKind ?: "lesson"), "undo" to true))
                        }
                    }
                    HomeworkRowActions.DONE_FOR_GOOD -> target.lessonId?.let { id ->
                        val store = LessonRuntime.of(app).store
                        store.markDone(id, RevisitStore.RETIRE)
                        undo = { store.markDone(id, RevisitStore.RESTORE) }
                    }
                    // Offline-first: gone here at once, the DELETE goes through the Outbox (now when online).
                    HomeworkRowActions.DELETE_LESSON -> target.lessonId?.let { id -> LessonRuntime.of(app).run { store.delete(id); uploadSoon() } }
                    HomeworkRowActions.SKIP_HANDWRITING -> {
                        SkipHandwriting.save(app, true, "row_menu")
                        undo = { SkipHandwriting.save(app, false, "undo") }
                    }
                }
                Analytics.track("lesson.row_action", props + ("undo" to false))
                app.haptics.correct()
                opened = null
                onChanged(action)
                val undoFn = undo
                toast = RowActionToast(
                    HomeworkRowActions.toast(action, target.tutorName),
                    if (HomeworkRowActions.undoable(action) && undoFn != null) {
                        {
                            undoFn()
                            Analytics.track("lesson.row_action", props + ("undo" to true))
                            onChanged(action)
                        }
                    } else null,
                )
            } catch (e: Exception) {
                opened = null
                toast = RowActionToast(if (action == HomeworkRowActions.DELETE_LESSON) "Couldn't delete it — are you online?" else "Something went wrong — try again", null)
            } finally {
                busy = false
            }
        }
    }

    fun undo() {
        val u = toast?.undo ?: return
        toast = null
        scope.launch { runCatching { u() } }
    }
}

@Composable
fun rememberRowActions(app: LabApp, from: String, onChanged: (String) -> Unit = {}): RowActionsController {
    val scope = rememberCoroutineScope()
    val changed by rememberUpdatedState(onChanged)
    return remember(app, from) { RowActionsController(app, from, scope) { changed(it) } }
}

/** The sheet, the confirm and the Undo toast of a [RowActionsController]. */
@Composable
fun RowActionsHost(c: RowActionsController) {
    c.opened?.let { o ->
        LabBottomSheet(onDismiss = { if (!c.busy) c.opened = null }) {
            RowActionsSheetContent(o.target, o.actions, onChoose = c::choose)
        }
        c.confirm?.let { action ->
            ConfirmDialog(
                title = HomeworkRowActions.label(action, o.target.kind),
                text = HomeworkRowActions.confirm(action, o.target.title, o.target.tutorName).orEmpty(),
                confirmLabel = HomeworkRowActions.label(action, o.target.kind),
                onConfirm = { c.choose(action) },
                onDismiss = { c.confirm = null },
                danger = action == HomeworkRowActions.DELETE_LESSON,
            )
        }
    }
    c.toast?.let { t ->
        LaunchedEffect(t) {
            delay(6000)
            if (c.toast === t) c.toast = null
        }
        Popup(alignment = Alignment.BottomCenter) {
            RowActionToastPill(t.text, t.undo != null, onUndo = c::undo)
        }
    }
}

/** The menu's body: the row's title, then one 48dp row per action (stateless, for screenshots). */
@Composable
fun RowActionsSheetContent(target: RowActionTarget, actions: List<String>, onChoose: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().testTag("row-actions-sheet")) {
        Text(
            target.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
        )
        Spacer(Modifier.size(4.dp))
        actions.forEachIndexed { i, a ->
            if (i > 0) HorizontalDivider(Modifier.padding(start = 64.dp, end = 16.dp), color = Lab.colors.faint)
            val danger = a == HomeworkRowActions.DELETE_LESSON
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { onChoose(a) }.padding(horizontal = 24.dp).testTag("row-action-$a"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(HomeworkRowActions.icon(a), fontSize = 18.sp, modifier = Modifier.width(28.dp), textAlign = TextAlign.Center)
                Spacer(Modifier.width(12.dp))
                Text(
                    HomeworkRowActions.label(a, target.kind), style = MaterialTheme.typography.bodyLarge,
                    color = if (danger) Palette.Again else Lab.colors.ink,
                )
            }
        }
    }
}

/** "Skipped — 明慧老师 will see it · Undo" (the Up next toast's look). */
@Composable
fun RowActionToastPill(text: String, undo: Boolean, onUndo: () -> Unit) {
    Row(
        Modifier.navigationBarsPadding().padding(16.dp).widthIn(max = 520.dp).shadow(8.dp, RoundedCornerShape(28.dp))
            .clip(RoundedCornerShape(28.dp)).background(Color(0xFF1F2937)).padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp)
            .heightIn(min = 44.dp).testTag("row-actions-toast"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(text, color = Color.White, fontSize = 15.sp, modifier = Modifier.weight(1f, fill = false))
        if (undo) {
            Box(
                Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(Color(0xFFFBBF24)).clickable(onClick = onUndo).padding(horizontal = 16.dp).testTag("row-actions-undo"),
                contentAlignment = Alignment.Center,
            ) { Text("Undo", color = Color(0xFF1F2937), fontWeight = FontWeight.Bold) }
        } else Spacer(Modifier.width(6.dp))
    }
}

/** The ⋯ next to a row (same menu as the long-press). */
@Composable
fun RowMenuButton(label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(onClickLabel = "More for $label", onClick = onClick).testTag("row-menu-btn"),
        contentAlignment = Alignment.Center,
    ) { Text("⋯", fontSize = 20.sp, color = Lab.colors.muted) }
}
