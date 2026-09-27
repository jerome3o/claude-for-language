package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

data class EditorMenuItem(val icon: String, val label: String, val danger: Boolean = false, val section: Boolean = false, val external: Boolean = false, val onClick: () -> Unit)

enum class EditorView { EDIT, PREVIEW, CHAT }

/** Width from which the chat sits beside the form (the unfolded Fold; the web uses 1024px). */
val EditorTwoPaneWidth = 700.dp

/**
 * The editors' layout (web: components/editor/EditorShell.tsx): header with ←, title + unsaved
 * dot, subtitle, Save and ⋯; on the phone a bottom bar Edit / Preview / Claude; unfolded, the
 * form (or preview) and the Claude chat side by side with Edit / Preview in the header.
 * Leaving with unsaved changes asks first (← and the system back).
 */
@Composable
fun EditorShell(
    title: String,
    subtitle: String?,
    dirty: Boolean,
    saving: Boolean,
    canSave: Boolean,
    saveBlockedHint: String,
    onSave: () -> Unit,
    onBack: () -> Unit,
    menu: List<EditorMenuItem>,
    view: EditorView,
    onView: (EditorView) -> Unit,
    edit: @Composable () -> Unit,
    preview: @Composable () -> Unit,
    chat: @Composable () -> Unit,
    banner: @Composable () -> Unit = {},
    forceWide: Boolean? = null,
) {
    var menuOpen by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    val tryBack = { if (dirty) confirmLeave = true else onBack() }
    BackHandler(enabled = dirty) { confirmLeave = true }

    BoxWithConstraints(
        Modifier.fillMaxSize().background(Lab.colors.background)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)),
    ) {
        val wide = forceWide ?: (maxWidth >= EditorTwoPaneWidth)
        val main = if (view == EditorView.PREVIEW) EditorView.PREVIEW else EditorView.EDIT
        Column(Modifier.fillMaxSize()) {
            // ---- header ----
            Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = 4.dp, end = 8.dp, top = 6.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = tryBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Lab.colors.ink) }
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(title.ifBlank { "Untitled" }, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        AnimatedVisibility(dirty, enter = scaleIn(spring(dampingRatio = Spring.DampingRatioMediumBouncy)) + fadeIn(), exit = scaleOut() + fadeOut()) {
                            Box(Modifier.padding(start = 8.dp).size(9.dp).clip(CircleShape).background(Palette.Hard))
                        }
                    }
                    if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (wide) {
                    Segmented(listOf("edit" to "Edit", "preview" to "Preview"), { it == main.name.lowercase() }, { onView(if (it == "edit") EditorView.EDIT else EditorView.PREVIEW) })
                    Spacer(Modifier.width(8.dp))
                }
                SaveButton(saving, enabled = dirty && canSave && !saving, onSave)
                IconButton(onClick = { menuOpen = true }) { Text("⋯", fontSize = 24.sp, color = Lab.colors.ink) }
            }
            if (dirty && !canSave) {
                Text("$saveBlockedHint before saving", color = Palette.Again, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 4.dp))
            }
            banner()
            HorizontalDivider(color = Lab.colors.faint)

            // ---- body ----
            Box(Modifier.weight(1f).fillMaxWidth().imePadding()) {
                if (wide) {
                    Row(Modifier.fillMaxSize()) {
                        Box(Modifier.weight(0.6f).fillMaxHeight()) { if (main == EditorView.PREVIEW) preview() else edit() }
                        VerticalDivider(color = Lab.colors.faint)
                        Box(Modifier.weight(0.4f).fillMaxHeight().background(Lab.colors.card.copy(alpha = 0.5f))) { chat() }
                    }
                } else {
                    when (view) {
                        EditorView.EDIT -> edit()
                        EditorView.PREVIEW -> preview()
                        EditorView.CHAT -> chat()
                    }
                }
            }
            if (!wide) EditorTabBar(view, onView)
        }
    }

    if (menuOpen) {
        LabBottomSheet({ menuOpen = false }) {
            menu.forEachIndexed { i, item ->
                if (item.section && i > 0) RowDivider()
                NavRow(item.icon, item.label, danger = item.danger, external = item.external, onClick = { menuOpen = false; item.onClick() })
            }
        }
    }
    if (confirmLeave) {
        ConfirmDialog(
            title = "Leave without saving?",
            text = "You have unsaved changes.",
            confirmLabel = "Leave",
            dismissLabel = "Keep editing",
            danger = true,
            onConfirm = onBack,
            onDismiss = { confirmLeave = false },
        )
    }
}

@Composable
private fun SaveButton(saving: Boolean, enabled: Boolean, onSave: () -> Unit) {
    val bg by animateColorAsState(if (enabled) Lab.colors.accent else Lab.colors.faint, label = "save")
    Box(
        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).background(bg)
            .bouncyClickable(enabled, 0.93f, onClick = onSave).padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (saving) "Saving…" else "Save", color = if (enabled) Color.White else Lab.colors.muted, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun EditorTabBar(view: EditorView, onView: (EditorView) -> Unit) {
    Column(Modifier.fillMaxWidth().background(Lab.colors.card).navigationBarsPadding()) {
        HorizontalDivider(color = Lab.colors.faint)
        Row(Modifier.fillMaxWidth().height(60.dp)) {
            for ((v, label) in listOf(EditorView.EDIT to "✏️ Edit", EditorView.PREVIEW to "👁 Preview", EditorView.CHAT to "✨ Claude")) {
                val on = v == view
                val fg by animateColorAsState(if (on) Lab.colors.accent else Lab.colors.muted, label = "tab")
                Box(Modifier.weight(1f).fillMaxHeight().clickable { onView(v) }, contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(label, color = fg, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, fontSize = 15.sp)
                        Spacer(Modifier.height(4.dp))
                        Box(Modifier.width(if (on) 28.dp else 0.dp).height(3.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.accent))
                    }
                }
            }
        }
    }
}
