package dev.jeromeswannack.chineselearning.lab.ui.picturehunt

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** The web's SCENE_IDEAS: the chip shows the Chinese, a tap fills in the English prompt. */
val PICTURE_HUNT_SCENE_IDEAS = listOf(
    "热闹的厨房" to "a busy home kitchen",
    "街边市场" to "a street food market in China",
    "教室" to "a classroom",
    "公园野餐" to "a picnic in the park",
    "超市" to "a supermarket aisle",
    "卧室" to "a messy bedroom",
    "火车站" to "a train station platform",
)

enum class HuntSourceMode { GENERATE, UPLOAD }

/** A photo picked for upload (name + a small preview). */
data class PickedPhoto(val name: String, val preview: ImageBitmap? = null)

data class PictureHuntsUi(
    val hunts: Loadable<List<PictureHuntDto>> = Loadable(),
    val thumbs: Map<String, ImageBitmap> = emptyMap(),
    val mode: HuntSourceMode = HuntSourceMode.GENERATE,
    val prompt: String = "",
    val useWords: Boolean = true,
    val photo: PickedPhoto? = null,
    val caption: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val online: Boolean = true,
    val busyId: String? = null,
) {
    val canStart: Boolean get() = online && !busy && (if (mode == HuntSourceMode.GENERATE) prompt.trim().isNotEmpty() else photo != null)
}

data class PictureHuntsActions(
    val onBack: (() -> Unit)? = null,
    val onMode: (HuntSourceMode) -> Unit = {},
    val onPrompt: (String) -> Unit = {},
    val onUseWords: (Boolean) -> Unit = {},
    val onPickPhoto: () -> Unit = {},
    val onTakePhoto: () -> Unit = {},
    val onCaption: (String) -> Unit = {},
    val onStart: () -> Unit = {},
    val onOpen: (String) -> Unit = {},
    val onRetry: (String) -> Unit = {},
    val onDelete: (String) -> Unit = {},
    val onRefresh: () -> Unit = {},
)

/** `statusLine` from PictureHuntsPage. */
fun pictureHuntStatusLine(h: PictureHuntDto): String = when (h.status) {
    "generating" -> "Building… ${h.progress ?: "queued"}"
    "error" -> h.error?.takeIf { it.isNotEmpty() } ?: "Couldn't build this one"
    else -> "${h.object_count} objects" + (h.best_found?.let { " · best $it / ${h.object_count}" } ?: " · not played yet")
}

/** `/picture-hunt` — the web's PictureHuntsPage: make a picture or use a photo, then the list. */
@Composable
fun PictureHuntsScreen(ui: PictureHuntsUi, actions: PictureHuntsActions) {
    var confirmDelete by remember { mutableStateOf<PictureHuntDto?>(null) }
    val h = ui.hunts
    LabScreen("🔎 Picture hunt", onBack = actions.onBack, subtitle = "看图找词") {
        item {
            Text(
                "Pick a picture — make one or use your own photo. Claude finds the things in it; you type what you see in Chinese, and each right answer lights up on the picture.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
            )
        }
        item { NewHuntCard(ui, actions) }
        if (h.offline && h.hasData) item { OfflineNotice(updatedAt = h.updatedAt) }
        else if (h.error != null && h.hasData) item { InlineNotice(h.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
        val list = h.data
        when {
            list == null && h.loading -> item { LoadingState(text = "Loading…") }
            list == null -> item {
                InlineNotice(h.error ?: "Couldn't load your picture hunts.", kind = if (h.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh)
            }
            list.isEmpty() -> item { EmptyState("🖼️", "No hunts yet", body = "Make your first picture above.") }
            else -> items(list.size, key = { list[it].id }) { i ->
                HuntRow(list[i], ui.thumbs[list[i].id], ui.online, ui.busyId == list[i].id, actions, onDelete = { confirmDelete = it })
            }
        }
    }
    confirmDelete?.let { hunt ->
        ConfirmDialog(
            title = "Delete “${hunt.title.ifBlank { "this hunt" }}”?",
            text = "The picture, its objects and your best score are removed.",
            confirmLabel = "Delete",
            danger = true,
            onConfirm = { confirmDelete = null; actions.onDelete(hunt.id) },
            onDismiss = { confirmDelete = null },
        )
    }
}

@Composable
private fun NewHuntCard(ui: PictureHuntsUi, actions: PictureHuntsActions) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(20.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Where the picture comes from: two segments.
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((mode, label) in listOf(HuntSourceMode.GENERATE to "✨ Make a picture", HuntSourceMode.UPLOAD to "📷 Use a photo")) {
                val selected = ui.mode == mode
                Box(
                    Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(11.dp)).background(if (selected) Lab.colors.card else Lab.colors.faint)
                        .clickable { actions.onMode(mode) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(label, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal, color = if (selected) Lab.colors.ink else Lab.colors.muted, fontSize = 15.sp)
                }
            }
        }
        val fieldColors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.background, unfocusedContainerColor = Lab.colors.background)
        if (ui.mode == HuntSourceMode.GENERATE) {
            OutlinedTextField(
                value = ui.prompt,
                onValueChange = { actions.onPrompt(it.take(300)) },
                label = { Text("What should be in the picture?") },
                placeholder = { Text("e.g. a busy kitchen") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            ChipRow { PICTURE_HUNT_SCENE_IDEAS.forEach { (zh, en) -> LabChip(zh, selected = ui.prompt == en) { actions.onPrompt(en) } } }
            Row(Modifier.fillMaxWidth().clickable { actions.onUseWords(!ui.useWords) }.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Lean toward words I'm learning", Modifier.weight(1f), color = Lab.colors.ink, fontSize = 15.sp)
                Switch(ui.useWords, onCheckedChange = actions.onUseWords, colors = SwitchDefaults.colors(checkedTrackColor = Lab.colors.accent))
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(72.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
                    val preview = ui.photo?.preview
                    if (preview != null) Image(preview, null, Modifier.size(72.dp), contentScale = ContentScale.Crop) else Text("📷", fontSize = 28.sp)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(ui.photo?.name ?: "Choose a photo or take one", color = if (ui.photo != null) Lab.colors.ink else Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryPill("🖼️ Gallery", onClick = actions.onPickPhoto)
                        SecondaryPill("📸 Camera", onClick = actions.onTakePhoto)
                    }
                }
            }
            OutlinedTextField(
                value = ui.caption,
                onValueChange = { actions.onCaption(it.take(120)) },
                label = { Text("Caption (optional)") },
                placeholder = { Text("e.g. My desk") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Resized on your phone and sent without location data.", fontSize = 13.sp, color = Lab.colors.muted)
        }
        PrimaryPill(
            when {
                ui.busy -> "Sending…"
                ui.mode == HuntSourceMode.GENERATE -> "✨ Make the picture"
                else -> "🔎 Find the objects"
            },
            Modifier.fillMaxWidth().height(56.dp),
            enabled = ui.canStart,
            onClick = actions.onStart,
        )
        if (!ui.online) InlineNotice("You're offline — making a new hunt needs a connection. Hunts you've built still play.", kind = NoticeKind.Offline)
        ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
    }
}

@Composable
private fun HuntRow(h: PictureHuntDto, thumb: ImageBitmap?, online: Boolean, busy: Boolean, actions: PictureHuntsActions, onDelete: (PictureHuntDto) -> Unit) {
    val ready = h.status == "ready"
    Row(
        Modifier.fillMaxWidth().animateContentSize().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp))
            .bouncyClickable(ready) { actions.onOpen(h.id) }.padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
            if (thumb != null) Image(thumb, null, Modifier.size(64.dp), contentScale = ContentScale.Crop)
            else if (h.status == "generating") BuildingEmoji()
            else Text(if (h.status == "error") "⚠️" else "🖼️", fontSize = 26.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(h.title.ifBlank { "Picture hunt" }, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                pictureHuntStatusLine(h),
                fontSize = 13.sp,
                color = if (h.status == "error") Palette.Again else Lab.colors.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(6.dp))
        when (h.status) {
            "error" -> SecondaryPill(if (busy) "…" else "🔄 Retry", enabled = online && !busy) { actions.onRetry(h.id) }
            "ready" -> PrimaryPill(if (h.play_count > 0) "Again" else "Play") { actions.onOpen(h.id) }
            else -> {}
        }
        Box(
            Modifier.size(44.dp).clip(CircleShape).clickable(enabled = online) { onDelete(h) }.alpha(if (online) 1f else 0.4f),
            contentAlignment = Alignment.Center,
        ) { Text("🗑️", fontSize = 18.sp) }
    }
}

@Composable
private fun BuildingEmoji() {
    val a by rememberInfiniteTransition(label = "building").animateFloat(0.45f, 1f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "a")
    Text("🎨", fontSize = 26.sp, modifier = Modifier.alpha(a))
}
