package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.MaterialToc
import dev.jeromeswannack.chineselearning.lab.core.Materials
import dev.jeromeswannack.chineselearning.lab.core.PresentedMaterial
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText
import dev.jeromeswannack.chineselearning.lab.core.calls.VideoFit
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.materials.MaterialContentsSheet
import dev.jeromeswannack.chineselearning.lab.ui.materials.trackContentsOpen
import kotlinx.coroutines.launch

/**
 * Where the material tile gets its pages (the app: [dev.jeromeswannack.chineselearning.lab.data.materials.MaterialStore],
 * cache-first; screenshots: a stand-in). [page] = the picture of one page (null = couldn't load it);
 * [notes] = each page's speaker notes (null = not known yet); [prefetch] keeps the whole material on the phone;
 * [contents] = its ☰ Contents (core MaterialToc; null = not known yet).
 */
interface MaterialPageSource {
    suspend fun page(materialId: String, page: Int): ImageBitmap?
    suspend fun notes(materialId: String): List<String>?
    suspend fun prefetch(materialId: String) {}
    suspend fun contents(materialId: String, pageCount: Int): MaterialToc.Contents? = null
}

/** What the material tile does (CallController's material actions). */
data class MaterialActions(
    val onTurn: (Int) -> Unit = {},
    val onStop: () -> Unit = {},
    val onStroke: (AnnotStroke) -> Unit = {},
    val onPing: (Double, Double) -> Unit = { _, _ -> },
    val onText: (AnnotText) -> Unit = {},
    val onTextDelete: (String) -> Unit = {},
    val onClear: () -> Unit = {},
)

/** Screenshots: the material tile's tools already open, the tool, the Contents sheet open. */
data class MaterialUiSeed(val drawing: Boolean = false, val tool: AnnotTool = AnnotTool.PEN, val editor: AnnotTextEditor? = null, val contentsOpen: Boolean = false)

/** The bar's height: TILE_HEADER.material (56) — in a top corner the faces box sits below it, never over it. */
private val BAR = 56.dp

/**
 * A lesson material presented in the call (web components/calls/MaterialTile.tsx): the current page's
 * picture (from the phone when it has it), page turns both people share (‹ ›, and a swipe-free tap so the
 * phone's tile swipe keeps moving between tiles), the same Pen / Text layer as a shared screen scoped to
 * this page (kept per page per lesson by the room), and the speaker notes. The next page is fetched ahead
 * so turning is instant; the whole material is kept on the phone while it is presented. ☰ Contents
 * (round 6) jumps to a section — a page turn both people follow. [barAction] = the tutor's
 * "Show for student", in the bar so it never sits on the page's tools.
 */
@Composable
fun MaterialTile(
    presenting: PresentedMaterial,
    annotations: Annotations,
    source: MaterialPageSource?,
    myColor: String,
    actions: MaterialActions,
    onKeep: (Boolean) -> Unit,
    onTick: () -> Unit,
    nowMs: () -> Long,
    modifier: Modifier = Modifier,
    /** Room at the bar's end for the tile's ⤢ (a wide layout with the material not focused). */
    endInset: Dp = 0.dp,
    seed: MaterialUiSeed = MaterialUiSeed(),
    barAction: (@Composable () -> Unit)? = null,
) {
    val id = presenting.materialId
    val page = presenting.page
    val count = presenting.pageCount
    var drawing by rememberSaveable(id) { mutableStateOf(seed.drawing) }
    var tool by rememberSaveable { mutableStateOf(seed.tool) }
    var color by rememberSaveable { mutableStateOf<String?>(null) }
    val pen = color ?: myColor
    var notes by remember(id) { mutableStateOf<List<String>?>(null) }
    var image by remember(id, page) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(id, page) { mutableStateOf(false) }
    var contents by remember(id) { mutableStateOf<MaterialToc.Contents?>(null) }
    var contentsOpen by remember(id) { mutableStateOf(seed.contentsOpen) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(id, source) {
        if (source == null) return@LaunchedEffect
        notes = source.notes(id)
        contents = source.contents(id, count)
        // The whole material on this phone for later / offline (web prefetchMaterial).
        scope.launch { runCatching { source.prefetch(id) } }
    }
    LaunchedEffect(id, page, source) {
        if (source == null) return@LaunchedEffect
        val bmp = source.page(id, page)
        image = bmp
        failed = bmp == null
        // The next page ahead, so turning is instant.
        if (page + 1 < count) scope.launch { runCatching { source.page(id, page + 1) } }
    }

    Column(modifier.fillMaxSize().background(Color(0xFF0B0F14)).testTag("material-tile")) {
        // The bar: title · ‹ page / count › · ✏️ Draw / type · ✕ (stop, for both).
        Row(
            Modifier.fillMaxWidth().height(BAR).padding(start = 8.dp, end = 8.dp + endInset),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "📑 ${presenting.title}", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            val toc = contents
            if (toc != null && count > 1 && toc.entries.isNotEmpty()) BarButton("☰", MaterialToc.CONTENTS_LABEL, enabled = true, tag = "material-contents") {
                trackContentsOpen("call", toc); contentsOpen = true; onTick()
            }
            BarButton("‹", "Previous page", enabled = page > 0) { actions.onTurn(Materials.turnPage(page, -1, count)); onTick() }
            Text("${page + 1} / $count", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.testTag("material-page"))
            BarButton("›", "Next page", enabled = page < count - 1) { actions.onTurn(Materials.turnPage(page, 1, count)); onTick() }
            Text(
                if (drawing) "✓ Done" else "✏️", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(if (drawing) Color(0xFFF43F5E) else Color(0x33FFFFFF))
                    .semantics { contentDescription = if (drawing) "Done drawing" else "Draw or type on this page" }
                    .bouncyClickable(role = Role.Button) { drawing = !drawing; onTick() }
                    .heightIn(min = 40.dp).padding(horizontal = 12.dp, vertical = 10.dp),
            )
            barAction?.invoke()
            BarButton("✕", "Stop presenting (for both)", enabled = true, onClick = actions.onStop)
        }
        Box(Modifier.fillMaxWidth().weight(1f)) {
            val img = image
            if (img != null) Image(img, "Page ${page + 1} of ${presenting.title}", Modifier.fillMaxSize().testTag("material-image"), contentScale = ContentScale.Fit)
            else Text(
                if (failed) "Couldn’t load this page" else "Loading page ${page + 1}…",
                color = Color(0xFF9CA3AF), fontSize = 14.sp, modifier = Modifier.align(Alignment.Center),
            )
            AnnotationCanvas(
                annotations, img?.let { VideoFit.Size(it.width.toDouble(), it.height.toDouble()) }, Modifier.fillMaxSize(),
                interactive = drawing, color = pen,
                onStroke = actions.onStroke, onPing = actions.onPing,
                tool = tool, onText = actions.onText, onTextDelete = actions.onTextDelete, onTick = onTick,
                nowMs = nowMs, initialEditor = seed.editor,
            )
            // Pen / Text, colours, Clear, Keep — at the bottom of the tile (web .mt-tools).
            if (drawing) AnnotateTools(
                Modifier.align(Alignment.BottomStart).padding(10.dp), "", on = true, color = pen, keep = annotations.persist, tool = tool,
                onToggle = {}, onColor = { color = it; onTick() }, onTool = { tool = it; onTick() },
                onClear = actions.onClear, onKeep = onKeep, showToggle = false,
            )
        }
        val note = notes?.getOrNull(page)?.takeIf { it.isNotBlank() }
        if (note != null) Text(
            "🗒 $note", color = Color(0xFFE5E7EB), fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().background(Color(0xFF1E232A)).padding(horizontal = 12.dp, vertical = 8.dp).semantics { contentDescription = "Speaker notes: $note" },
        )
    }
    val toc = contents
    if (contentsOpen && toc != null) MaterialContentsSheet(toc, page, "call", onJump = { p -> actions.onTurn(Materials.turnPage(p, 0, count)); onTick() }, onDismiss = { contentsOpen = false })
}

@Composable
private fun BarButton(label: String, desc: String, enabled: Boolean, tag: String? = null, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(CircleShape).background(Color(0x33FFFFFF)).alpha(if (enabled) 1f else 0.35f)
            .semantics { contentDescription = desc }
            .then(if (tag != null) Modifier.testTag(tag) else Modifier)
            .then(if (enabled) Modifier.bouncyClickable(role = Role.Button, onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
}

/** The Lab's "📑 Present material" sheet state (web PresentMaterialSheet). */
data class PresentSheetUi(
    /** Ready materials (mine + shared with me); null = loading. */
    val materials: List<dev.jeromeswannack.chineselearning.lab.data.api.MaterialDto>? = null,
    val error: String? = null,
    val stage: dev.jeromeswannack.chineselearning.lab.data.materials.UploadStage? = null,
    /** Offline: the list is the copy on this phone. */
    val offline: Boolean = false,
)

private val KIND_ICON = mapOf("pdf" to "📄", "pptx" to "📊", "image" to "🖼️")

fun materialIcon(kind: String) = KIND_ICON[kind] ?: "📑"

/** "Present a material": pick one of mine (or one shared with me), or add a PDF / PowerPoint / picture right here. */
@Composable
fun PresentMaterialSheet(ui: PresentSheetUi, onPick: (String) -> Unit, onAdd: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).testTag("present-material-sheet"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "Both of you see it; either of you can turn the pages, draw and type on it.",
            color = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 8.dp),
        )
        if (ui.offline) Text("Offline — showing the list on this phone.", color = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 8.dp))
        when {
            ui.materials == null && ui.error == null -> Text("Loading…", color = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.muted, modifier = Modifier.padding(8.dp))
            ui.materials?.isEmpty() == true -> Text("No materials yet — add one below.", color = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.muted, modifier = Modifier.padding(8.dp))
        }
        ui.materials.orEmpty().forEach { m ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.background)
                    .bouncyClickable(role = Role.Button) { onPick(m.id) }.heightIn(min = 56.dp).padding(horizontal = 14.dp, vertical = 10.dp).testTag("present-material-row"),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(materialIcon(m.kind), fontSize = 24.sp)
                Column(Modifier.weight(1f)) {
                    Text(m.title, color = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.ink, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        "${m.page_count} page${if (m.page_count == 1) "" else "s"}" + if (m.mine) "" else " · from ${m.owner_name ?: "your tutor"}",
                        color = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.muted, fontSize = 13.sp,
                    )
                }
            }
        }
        dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill(
            ui.stage?.label ?: "+ Add a PDF, PowerPoint or picture",
            Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 4.dp).widthIn(min = 200.dp),
            onClick = { if (ui.stage == null) onAdd() },
        )
        ui.error?.let { dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice(it, kind = dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind.Error) }
    }
}
