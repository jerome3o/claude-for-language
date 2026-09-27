package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.ReaderExport
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonObject

class ReaderEditorActions(
    val onSpec: (JsonObject) -> Unit = {},
    val onSave: () -> Unit = {},
    val onBack: () -> Unit = {},
    val onView: (EditorView) -> Unit = {},
    val onDiscardDraft: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onRead: () -> Unit = {},
    val onExport: (ExportFormat, share: Boolean) -> Unit = { _, _ -> },
    val onPrint: () -> Unit = {},
    val onAnki: () -> Unit = {},
    val onRawJson: (String) -> List<String> = { emptyList() },
    val onDelete: () -> Unit = {},
    val onAssist: (Int, String) -> Unit = { _, _ -> },
    val onIllustrate: (Int) -> Unit = {},
    val speak: Speak = {},
    val chat: EditorChatActions = EditorChatActions(),
    val haptic: () -> Unit = {},
)

/** The graded-reader editor (web: ReaderEditorPage + ReaderForm + ReaderPreview + EditorChat). */
@Composable
fun ReaderEditorScreen(ui: ReaderEditorUi, chat: EditorChatUi, actions: ReaderEditorActions, forceWide: Boolean? = null) {
    val spec = ui.spec
    if (spec == null) {
        LabScreenFrame {
            ScreenTitle("Reader editor", onBack = actions.onBack)
            if (ui.loadError != null) ErrorState(ui.loadError, onRetry = actions.onRetry) else LoadingState(text = "Loading reader…")
        }
        return
    }
    val open = remember { mutableStateMapOf<Int, Boolean>() }
    var confirm by remember { mutableStateOf<Triple<String, String, () -> Unit>?>(null) }
    var rawJson by remember { mutableStateOf(false) }
    var export by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val host = ReaderFormHost(
        onChange = actions.onSpec,
        speak = actions.speak,
        open = open,
        confirm = { t, x, yes -> confirm = Triple(t, x, yes) },
        assist = if (ui.online) actions.onAssist else null,
        illustrate = if (ui.online) actions.onIllustrate else null,
        busy = ui.busy,
        pageNotes = ui.pageNotes,
        haptic = actions.haptic,
    )
    val errorCount = ui.errors.size
    val pageCount = spec.objs("pages").size
    val subtitle = "$pageCount page${if (pageCount == 1) "" else "s"} · ${spec.text("difficulty_level")}${if (ui.isPublished == 0) " · draft" else ""}"
    val kind = EditorChatKind.READER
    val pending = pendingChangesFor(chat.messages, spec, kind)
    val menu = listOf(
        EditorMenuItem("📖", "Read it", onClick = actions.onRead),
        EditorMenuItem("⬇", "Export (Markdown, JSON, CSV)", section = true) { export = true },
        EditorMenuItem("🖨", "Print view", onClick = actions.onPrint),
        EditorMenuItem("⬇", "Export Anki (.apkg)", external = true, onClick = actions.onAnki),
        EditorMenuItem("{ }", "Advanced: raw JSON", section = true) { rawJson = true },
        EditorMenuItem("🗑", "Delete reader", danger = true, section = true) { confirmDelete = true },
    )

    EditorShell(
        title = spec.text("title_chinese").ifEmpty { spec.text("title_english") },
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
                if (ui.restoredDraft || ui.notice != null) androidx.compose.foundation.layout.Spacer(Modifier.height(6.dp))
            }
        },
        edit = {
            LazyColumn(
                Modifier.fillMaxSize(), state = listState,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 40.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) { readerFormItems(spec, ui.savedSpec, ui.errors, host) }
        },
        preview = { ReaderPreview(spec, actions.speak) },
        chat = { EditorChatPane(chat, kind, pending, actions.chat) },
    )

    confirm?.let { (t, x, yes) -> ConfirmDialog(t, x, "Delete", onConfirm = yes, onDismiss = { confirm = null }, danger = true) }
    if (confirmDelete) {
        ConfirmDialog(
            "Delete “${spec.text("title_english").ifEmpty { spec.text("title_chinese") }}”?", "This can't be undone.", "Delete",
            onConfirm = actions.onDelete, onDismiss = { confirmDelete = false }, danger = true,
        )
    }
    if (export) ExportSheet("reader", onDismiss = { export = false }) { format, share -> export = false; actions.onExport(format, share) }
    if (rawJson) RawJsonSheet(spec, "reader", onApply = actions.onRawJson, onDismiss = { rawJson = false })
}

/**
 * The reading view on the unsaved spec (web: ReaderPreview.tsx): illustration first, tap to
 * reveal the Chinese, then pinyin, then the translation; 🔊 per page; nothing recorded.
 */
@Composable
fun ReaderPreview(spec: JsonObject, speak: Speak) {
    val pages = spec.objs("pages")
    var index by rememberSaveable { mutableIntStateOf(0) }
    var jumping by remember { mutableStateOf(false) }
    if (pages.isEmpty()) {
        Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Text("Add a page to preview the reader.", color = Lab.colors.muted) }
        return
    }
    val current = index.coerceIn(0, pages.size - 1)
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MiniButton("◀", { index = current - 1 }, enabled = current > 0, description = "Previous page")
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp))
                    .bouncyClickable { jumping = true }.padding(horizontal = 12.dp),
                contentAlignment = Alignment.CenterStart,
            ) { Text("Page ${current + 1} of ${pages.size} — ${pages[current].text("content_chinese").take(18).ifEmpty { "…" }}", maxLines = 1, color = Lab.colors.ink) }
            MiniButton("▶", { index = current + 1 }, enabled = current < pages.size - 1, description = "Next page")
        }
        val progress by animateFloatAsState((current + 1f) / pages.size, label = "reader-progress")
        Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Lab.colors.faint)) {
            Box(Modifier.fillMaxWidth(progress).fillMaxHeight().background(Lab.colors.accent))
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(spec.text("title_chinese").ifEmpty { "Untitled" }, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            Text(
                ReaderExport.difficultyLabel(spec.text("difficulty_level")),
                style = MaterialTheme.typography.labelMedium, color = Lab.colors.accent,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(Lab.colors.accentSoft).padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
        AnimatedContent(current, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "page", modifier = Modifier.weight(1f)) { i ->
            PreviewPage(pages[i], speak)
        }
        Text("Exactly what the learner sees — tap to reveal; nothing is recorded.", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
    }
    if (jumping) {
        LabBottomSheet({ jumping = false }, title = "Jump to page") {
            pages.forEachIndexed { i, p -> NavRow("📄", "Page ${i + 1}", desc = p.text("content_chinese").take(40).ifEmpty { "…" }, onClick = { jumping = false; index = i }) }
        }
    }
}

@Composable
private fun PreviewPage(page: JsonObject, speak: Speak) {
    var showChinese by remember { mutableStateOf(false) }
    var showPinyin by remember { mutableStateOf(false) }
    var showEnglish by remember { mutableStateOf(false) }
    val key = page.str("image_url")
    val prompt = page.text("image_prompt").trim()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            !key.isNullOrEmpty() -> EditorImage(key, Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)), description = "Story illustration")
            prompt.isNotEmpty() -> Box(Modifier.fillMaxWidth().height(150.dp).clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
                Text("🖼\nIllustration not drawn yet", color = Lab.colors.muted, textAlign = TextAlign.Center)
            }
        }
        RevealBox(showChinese, "Tap to reveal Chinese", { showChinese = !showChinese }) {
            Text(page.text("content_chinese").ifEmpty { "(no Chinese yet)" }, fontSize = 24.sp, lineHeight = 36.sp, color = Lab.colors.ink)
        }
        SecondaryPill("🔊 Play audio", Modifier.fillMaxWidth().height(48.dp), enabled = page.text("content_chinese").isNotBlank()) { speak(page.text("content_chinese")) }
        RevealBox(showPinyin, "Tap to reveal pinyin", { showPinyin = !showPinyin }) { Text(page.text("content_pinyin").ifEmpty { "(no pinyin)" }, color = Lab.colors.muted, fontSize = 17.sp) }
        RevealBox(showEnglish, "Tap to reveal translation", { showEnglish = !showEnglish }) { Text(page.text("content_english").ifEmpty { "(no translation)" }, color = Lab.colors.ink, fontSize = 17.sp) }
        androidx.compose.foundation.layout.Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun RevealBox(shown: Boolean, label: String, onTap: () -> Unit, content: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(14.dp))
            .background(if (shown) Lab.colors.card else Lab.colors.faint).bouncyClickable(onClick = onTap).padding(14.dp),
        contentAlignment = if (shown) Alignment.CenterStart else Alignment.Center,
    ) {
        AnimatedContent(shown, label = "reveal") { s -> if (s) content() else Text(label, color = Lab.colors.muted, fontWeight = FontWeight.Medium) }
    }
}
