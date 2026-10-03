package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFormSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonObject

class LessonEditorActions(
    val onSpec: (JsonObject) -> Unit = {},
    val onSave: () -> Unit = {},
    val onBack: () -> Unit = {},
    val onView: (EditorView) -> Unit = {},
    val onDiscardDraft: () -> Unit = {},
    val onRetry: () -> Unit = {},
    /** Library only. */
    val onDuplicate: (() -> Unit)? = null,
    val onExport: (ExportFormat, share: Boolean) -> Unit = { _, _ -> },
    val onPrint: () -> Unit = {},
    /** Opens the Anki export sheet (built on the phone, ui/kit/AnkiExportSheet.kt). */
    val onAnki: () -> Unit = {},
    /** Returns the problems (empty = applied). */
    val onRawJson: (String) -> List<String> = { emptyList() },
    val onArchive: (() -> Unit)? = null,
    val speak: Speak = {},
    /** The real player's environment for the Preview tab (TTS, images, strokes); null = [speak] only. */
    val previewEnv: dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv? = null,
    val chat: EditorChatActions = EditorChatActions(),
    val haptic: () -> Unit = {},
)

/**
 * The lesson editor (web: LessonEditorPage + EditorShell + LessonForm + LessonPreview + EditorChat).
 * Stateless over [ui] / [chat] so it renders in screenshot tests.
 */
@Composable
fun LessonEditorScreen(
    ui: LessonEditorUi,
    chat: EditorChatUi,
    target: String,
    subtitle: String,
    actions: LessonEditorActions,
    forceWide: Boolean? = null,
) {
    val spec = ui.spec
    if (spec == null) {
        LabScreenFrame {
            ScreenTitle("Lesson editor", onBack = actions.onBack)
            if (ui.loadError != null) ErrorState(ui.loadError, onRetry = actions.onRetry) else LoadingState(text = "Loading lesson…")
        }
        return
    }
    val open = remember { mutableStateMapOf<String, Boolean>() }
    var picking by remember { mutableStateOf<Int?>(null) }
    var confirm by remember { mutableStateOf<Triple<String, String, () -> Unit>?>(null) }
    var rawJson by remember { mutableStateOf(false) }
    var export by remember { mutableStateOf(false) }
    var confirmArchive by remember { mutableStateOf(false) }
    var formNotice by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()

    val host = LessonFormHost(
        onChange = actions.onSpec,
        speak = actions.speak,
        open = open,
        confirm = { t, x, yes -> confirm = Triple(t, x, yes) },
        notice = { formNotice = it },
        pickType = { picking = it },
        haptic = actions.haptic,
    )
    val errorCount = ui.errors.size
    val kind = EditorChatKind.LESSON
    val pending = pendingChangesFor(chat.messages, spec, kind)

    val menu = buildList {
        actions.onDuplicate?.let { add(EditorMenuItem("⧉", "Duplicate", onClick = it)) }
        add(EditorMenuItem("⬇", "Export (Markdown, JSON, CSV)", section = true) { export = true })
        add(EditorMenuItem("🖨", "Print view", onClick = actions.onPrint))
        add(EditorMenuItem("⬇", "Export Anki (.apkg)", onClick = actions.onAnki))
        add(EditorMenuItem("{ }", "Advanced: raw JSON", section = true) { rawJson = true })
        if (actions.onArchive != null) add(EditorMenuItem(if (target == "library") "🗄" else "🗑", if (target == "library") "Archive" else "Delete lesson", danger = true, section = true) { confirmArchive = true })
    }

    EditorShell(
        title = spec.text("title"),
        subtitle = subtitle,
        dirty = ui.dirty,
        saving = ui.saving,
        canSave = errorCount == 0,
        saveBlockedHint = "$errorCount problem${if (errorCount == 1) "" else "s"} to fix",
        onSave = actions.onSave,
        onBack = actions.onBack,
        menu = menu,
        view = ui.view,
        onView = actions.onView,
        forceWide = forceWide,
        banner = {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (ui.restoredDraft) InlineNotice("Your unsaved changes from last time are back.", kind = NoticeKind.Info, actionLabel = "Discard", onAction = actions.onDiscardDraft)
                ui.notice?.let { InlineNotice(it, kind = if (ui.noticeIsError) NoticeKind.Error else NoticeKind.Success) }
                formNotice?.let { InlineNotice(it, kind = NoticeKind.Warning, actionLabel = "OK", onAction = { formNotice = null }) }
                if (ui.restoredDraft || ui.notice != null || formNotice != null) androidx.compose.foundation.layout.Spacer(Modifier.height(6.dp))
            }
        },
        edit = {
            LazyColumn(
                Modifier.fillMaxSize(),
                state = listState,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 40.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) { lessonFormItems(spec, ui.errors, host) }
        },
        preview = { LessonPreviewPane(spec, actions.previewEnv ?: dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv(speak = actions.speak), ui.errors) },
        chat = {
            EditorChatPane(
                chat, kind, pending,
                EditorChatActions(
                    onDraft = actions.chat.onDraft,
                    onSend = actions.chat.onSend,
                    onDecide = actions.chat.onDecide,
                    onRetry = actions.chat.onRetry,
                ),
            )
        },
    )

    picking?.let { si ->
        ExerciseTypePicker(onPick = { type ->
            val (next, key) = addExercise(spec, si, type)
            open[key] = true
            picking = null
            actions.haptic()
            actions.onSpec(next)
        }, onDismiss = { picking = null })
    }
    confirm?.let { (t, x, yes) -> ConfirmDialog(t, x, "Delete", onConfirm = yes, onDismiss = { confirm = null }, danger = true) }
    if (confirmArchive) {
        val title = spec.text("title")
        ConfirmDialog(
            if (target == "library") "Archive “$title”?" else "Delete “$title”?",
            if (target == "library") "Students keep their copies." else "This can't be undone.",
            if (target == "library") "Archive" else "Delete",
            onConfirm = { actions.onArchive?.invoke() },
            onDismiss = { confirmArchive = false },
            danger = true,
        )
    }
    if (export) ExportSheet("lesson", onDismiss = { export = false }) { format, share -> export = false; actions.onExport(format, share) }
    if (rawJson) RawJsonSheet(spec, "lesson", onApply = actions.onRawJson, onDismiss = { rawJson = false })
}

/** Share / Save for Markdown, JSON and CSV (the web's three download items). */
@Composable
fun ExportSheet(subject: String, onDismiss: () -> Unit, onPick: (ExportFormat, Boolean) -> Unit) {
    LabBottomSheet(onDismiss, title = "Export this $subject") {
        for (f in ExportFormat.entries) {
            NavRow(
                when (f) { ExportFormat.MD -> "📄"; ExportFormat.JSON -> "{ }"; ExportFormat.CSV -> "📊" },
                f.label,
                desc = when (f) {
                    ExportFormat.MD -> "Teaching notes, numbered exercises and the answer key"
                    ExportFormat.JSON -> "Re-importable into any account"
                    ExportFormat.CSV -> "term, definition, example — for Quizlet"
                },
                trailing = {
                    androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        MiniButton("Share", { onPick(f, true) })
                        MiniButton("Save", { onPick(f, false) })
                    }
                },
            )
        }
    }
}

/** "Advanced → Raw JSON": the spec as text; parse errors and the validator's problems before anything is applied. */
@Composable
fun RawJsonSheet(spec: JsonObject, subject: String, onApply: (String) -> List<String>, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(JsJson.stringifyPretty(spec)) }
    var problems by remember { mutableStateOf<List<String>>(emptyList()) }
    LabFormSheet(
        onDismiss,
        title = "Raw JSON",
        footer = {
            SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp), onClick = onDismiss)
            PrimaryPill("Apply", Modifier.weight(1f).height(52.dp)) {
                problems = onApply(text)
                if (problems.isEmpty()) onDismiss()
            }
        },
    ) {
        Text("The $subject spec exactly as it is stored. Edit and apply — changes go into the form (unsaved until you press Save).", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
        androidx.compose.material3.OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.fillMaxWidth().heightIn(min = 240.dp, max = 460.dp),
            textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Lab.colors.ink),
        )
        ErrorList(problems)
    }
}
