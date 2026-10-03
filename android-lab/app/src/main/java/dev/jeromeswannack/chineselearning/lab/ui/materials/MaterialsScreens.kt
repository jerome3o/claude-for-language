package dev.jeromeswannack.chineselearning.lab.ui.materials

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Materials
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDto
import dev.jeromeswannack.chineselearning.lab.data.materials.UploadStage
import dev.jeromeswannack.chineselearning.lab.ui.calls.materialIcon
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFormSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** A student a material can be shared with (one of my active tutor relationships). */
data class MaterialStudent(val relationshipId: String, val name: String)

/** `/materials` (web MaterialsPage). */
data class MaterialsUi(
    /** null = loading (nothing cached yet). */
    val materials: List<MaterialDto>? = null,
    val offline: Boolean = false,
    val error: String? = null,
    val stage: UploadStage? = null,
    val students: List<MaterialStudent> = emptyList(),
)

data class MaterialsActions(
    val onBack: () -> Unit = {},
    val onOpen: (String) -> Unit = {},
    val onUpload: () -> Unit = {},
    val onRename: (MaterialDto, String) -> Unit = { _, _ -> },
    val onDelete: (MaterialDto) -> Unit = {},
    val onShare: (MaterialDto, String, Boolean) -> Unit = { _, _, _ -> },
    val onRefresh: () -> Unit = {},
)

private fun pagesLabel(n: Int) = "$n page${if (n == 1) "" else "s"}"

/**
 * Lesson materials (calls round 4 PR 5): the PDFs, PowerPoints and pictures a tutor teaches from —
 * upload (pages drawn on this phone, uploaded as pictures, the original kept), share with a student,
 * rename, delete; "From your tutor" for what was shared with me. Presenting happens in a call.
 */
@Composable
fun MaterialsScreen(
    ui: MaterialsUi,
    actions: MaterialsActions,
    /** Screenshots: the Share / Rename sheet already open. */
    initialSharing: MaterialDto? = null,
    initialRenaming: MaterialDto? = null,
) {
    var sharing by remember { mutableStateOf(initialSharing) }
    var renaming by remember { mutableStateOf(initialRenaming) }
    var deleting by remember { mutableStateOf<MaterialDto?>(null) }
    val mine = ui.materials.orEmpty().filter { it.mine }
    val shared = ui.materials.orEmpty().filter { !it.mine }

    LabScreen("Lesson materials", onBack = actions.onBack) {
        item {
            Text(
                "PDFs, PowerPoints and pictures to teach from. Present one in a video call (⋯ → 📑 Present material): you both see it, turn the pages together and draw or type on it.",
                color = Lab.colors.muted, fontSize = 15.sp,
            )
        }
        item {
            PrimaryPill(ui.stage?.label ?: "+ Add a PDF, PowerPoint or picture", Modifier.fillMaxWidth().testTag("materials-upload"), enabled = ui.stage == null, onClick = actions.onUpload)
            Text(
                "Up to ${Materials.MAX_MATERIAL_BYTES / (1024 * 1024)} MB. PowerPoint slides are drawn from their text and pictures — for exact slides, export as PDF.",
                color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp),
            )
        }
        ui.error?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }
        if (ui.offline) item { InlineNotice("You’re offline — showing the list on this phone.") }
        if (ui.materials == null && ui.error == null) item { Text("Loading…", color = Lab.colors.muted) }
        if (mine.isNotEmpty()) {
            item { SectionHeader("Mine") }
            items(mine, key = { it.id }) { m ->
                MaterialRow(m, ui.students.isNotEmpty(), onOpen = { actions.onOpen(m.id) }, onShare = { sharing = m }, onRename = { renaming = m }, onDelete = { deleting = m })
            }
        }
        if (shared.isNotEmpty()) {
            item { SectionHeader("From your tutor") }
            items(shared, key = { it.id }) { m -> MaterialRow(m, false, onOpen = { actions.onOpen(m.id) }) }
        }
        if (ui.materials?.isEmpty() == true) item { Text("Nothing here yet.", color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp)) }
    }

    sharing?.let { m ->
        // The list's copy carries the latest shared_with after a toggle.
        val current = ui.materials?.firstOrNull { it.id == m.id } ?: m
        LabFormSheet(
            onDismiss = { sharing = null },
            title = "Share “${current.title}”",
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
            spacing = 0.dp,
            footer = { SecondaryPill("Done", Modifier.weight(1f).height(52.dp)) { sharing = null } },
        ) {
            Column(Modifier.testTag("material-share-sheet")) {
                Text("They can read it and see it in calls. Presenting it in a call with them shares it automatically.", color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                ui.students.forEach { st ->
                    val on = current.shared_with?.contains(st.relationshipId) == true
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).bouncyClickable(role = Role.Checkbox) { actions.onShare(current, st.relationshipId, !on) }.padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = on, onCheckedChange = { actions.onShare(current, st.relationshipId, it) }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
                        Text(st.name, color = Lab.colors.ink, fontSize = 16.sp)
                    }
                }
            }
        }
    }
    renaming?.let { m ->
        var title by remember(m.id) { mutableStateOf(m.title) }
        LabFormSheet(
            onDismiss = { renaming = null },
            title = "Rename",
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
            footer = { PrimaryPill("Save", Modifier.weight(1f).height(52.dp), enabled = title.isNotBlank() && title.trim() != m.title) { actions.onRename(m, title.trim()); renaming = null } },
        ) {
            OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Title") })
        }
    }
    deleting?.let { m ->
        ConfirmDialog("Delete “${m.title}”?", "Drawings made on it in lessons go too.", "Delete", onConfirm = { actions.onDelete(m) }, onDismiss = { deleting = null }, danger = true)
    }
}

@Composable
private fun MaterialRow(m: MaterialDto, canShare: Boolean, onOpen: () -> Unit, onShare: () -> Unit = {}, onRename: () -> Unit = {}, onDelete: () -> Unit = {}) {
    LabCard(Modifier.fillMaxWidth().testTag("material-row")) {
        Row(
            Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.98f, role = Role.Button, onClick = onOpen).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(materialIcon(m.kind), fontSize = 28.sp)
            Column(Modifier.weight(1f)) {
                Text(m.title, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = if (m.mine) {
                    (when (m.status) { "ready" -> pagesLabel(m.page_count); "uploading" -> "Upload not finished"; else -> "Failed" }) +
                        (m.shared_with?.takeIf { it.isNotEmpty() }?.let { " · shared with ${it.size}" } ?: "")
                } else "${pagesLabel(m.page_count)} · from ${m.owner_name ?: "your tutor"}"
                Text(meta, color = Lab.colors.muted, fontSize = 13.sp)
            }
        }
        if (m.mine) Row(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canShare) SmallButton("Share", onShare)
            SmallButton("Rename", onRename)
            SmallButton("🗑", onDelete, danger = true, desc = "Delete ${m.title}")
        }
    }
}

@Composable
private fun SmallButton(label: String, onClick: () -> Unit, danger: Boolean = false, desc: String? = null) {
    Text(
        label, color = if (danger) Palette.Again else Lab.colors.accent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Lab.colors.accentSoft)
            .then(if (desc != null) Modifier.semantics { contentDescription = desc } else Modifier)
            .bouncyClickable(role = Role.Button, onClick = onClick).heightIn(min = 40.dp).padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

// ------------------------------------------------------------------ viewer

/** `/materials/:id` (web MaterialViewerPage). */
data class MaterialViewerUi(
    val detail: MaterialDetailDto? = null,
    val offline: Boolean = false,
    val loading: Boolean = true,
    val error: String? = null,
    val page: Int = 0,
    val image: ImageBitmap? = null,
    /** The page picture couldn't be loaded (offline and not on the phone). */
    val imageMissing: Boolean = false,
    /** ⬇ Keep on this device: no | saving | yes. */
    val kept: Kept = Kept.NO,
    val showText: Boolean = false,
    val downloading: Boolean = false,
) {
    enum class Kept { NO, SAVING, YES }
}

data class MaterialViewerActions(
    val onBack: () -> Unit = {},
    val onPage: (Int) -> Unit = {},
    val onKeep: () -> Unit = {},
    val onToggleText: () -> Unit = {},
    val onOriginal: () -> Unit = {},
)

/** Read a material page by page (cache-first, so one opened or presented before works offline), its text, the original. */
@Composable
fun MaterialViewerScreen(ui: MaterialViewerUi, actions: MaterialViewerActions) {
    val d = ui.detail
    LabScreen(d?.material?.title ?: "Material", onBack = actions.onBack) {
        if (d == null) {
            item { if (ui.error != null) InlineNotice(ui.error, kind = NoticeKind.Error) else Text("Loading…", color = Lab.colors.muted) }
            return@LabScreen
        }
        val m = d.material
        val count = d.pages.size
        val info = d.pages.getOrNull(ui.page)
        if (ui.offline) item { InlineNotice("Offline — showing the copy on this device.") }
        m.render_note?.let { item { Text(it, color = Lab.colors.muted, fontSize = 13.sp) } }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                PageButton("‹", "Previous page", ui.page > 0) { actions.onPage(Materials.turnPage(ui.page, -1, count)) }
                Text("${if (count > 0) ui.page + 1 else 0} / $count", color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.testTag("viewer-page"))
                PageButton("›", "Next page", ui.page < count - 1) { actions.onPage(Materials.turnPage(ui.page, 1, count)) }
            }
        }
        item {
            val ratio = info?.let { p -> if ((p.width ?: 0) > 0 && (p.height ?: 0) > 0) p.width!!.toFloat() / p.height!! else null } ?: ui.image?.let { it.width.toFloat() / it.height } ?: (4f / 3f)
            Box(
                Modifier.fillMaxWidth().aspectRatio(ratio).clip(RoundedCornerShape(12.dp)).background(Color.White),
                contentAlignment = Alignment.Center,
            ) {
                val img = ui.image
                if (img != null) Image(img, "Page ${ui.page + 1}", Modifier.fillMaxWidth().testTag("viewer-image"), contentScale = ContentScale.Fit)
                else Text(
                    when {
                        info?.image_url == null -> "This page has no picture."
                        ui.imageMissing -> "This page isn’t on this phone yet."
                        else -> "Loading page…"
                    },
                    color = Color(0xFF6B7280),
                )
            }
        }
        info?.notes?.takeIf { it.isNotBlank() }?.let { item { Text("🗒 $it", color = Lab.colors.ink, fontSize = 14.sp) } }
        item {
            @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
            androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryPill(
                    when (ui.kept) { MaterialViewerUi.Kept.YES -> "✓ On this device"; MaterialViewerUi.Kept.SAVING -> "Saving…"; else -> "⬇ Keep on this device" },
                    enabled = ui.kept == MaterialViewerUi.Kept.NO, onClick = actions.onKeep,
                )
                if (m.has_text) SecondaryPill(if (ui.showText) "Hide text" else "Show text", onClick = actions.onToggleText)
                if ((m.original_size ?: 0) > 0) SecondaryPill(if (ui.downloading) "Downloading…" else "Original file", enabled = !ui.downloading, onClick = actions.onOriginal)
            }
        }
        if (ui.showText) item {
            Text(
                info?.text?.takeIf { it.isNotBlank() } ?: "(no text on this page)", color = Lab.colors.ink, fontSize = 15.sp,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.card).padding(12.dp),
            )
        }
        ui.error?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }
    }
}

@Composable
private fun PageButton(label: String, desc: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(CircleShape).background(Lab.colors.accentSoft).alpha(if (enabled) 1f else 0.35f)
            .semantics { contentDescription = desc }
            .then(if (enabled) Modifier.bouncyClickable(role = Role.Button, onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Lab.colors.accent, fontSize = 22.sp, fontWeight = FontWeight.Bold) }
}
