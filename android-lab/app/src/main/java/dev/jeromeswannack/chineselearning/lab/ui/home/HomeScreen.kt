package dev.jeromeswannack.chineselearning.lab.ui.home

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.LocalTime

class HomeActions(
    val onStudyAll: () -> Unit = {},
    val onStudyDeck: (String) -> Unit = {},
    val onSync: () -> Unit = {},
    val onFullSync: () -> Unit = {},
    val onOpenFullApp: () -> Unit = {},
    val onSignOut: () -> Unit = {},
    val onSignIn: () -> Unit = {},
    val onToggleSound: (Boolean) -> Unit = {},
    val onToggleHaptics: (Boolean) -> Unit = {},
    val onSendDebugReport: () -> Unit = {},
)

/** [debugReport]: the last "Send debug report" outcome (data/DebugReport.kt), null = none yet. */
data class HomeSettings(val soundOn: Boolean, val hapticsOn: Boolean, val debugReport: String? = null, val sendingDebugReport: Boolean = false)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(ui: HomeUi, sync: SyncStatus, online: Boolean, settings: HomeSettings, actions: HomeActions, nowMs: Long = System.currentTimeMillis()) {
    var showSettings by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            Modifier.fillMaxSize().widthIn(max = 720.dp),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(greeting() + (ui.userName?.substringBefore(' ')?.let { ", $it" } ?: ""), style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink)
                        SyncLine(sync, online, nowMs)
                    }
                    IconButton(onClick = actions.onSync, enabled = online && !sync.running) {
                        if (sync.running) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                        else Icon(Icons.Filled.Sync, "Sync now", tint = Lab.colors.muted)
                    }
                    IconButton(onClick = { showSettings = true }) { Icon(Icons.Filled.Settings, "Settings", tint = Lab.colors.muted) }
                }
            }
            if (sync.signedOut) item { SignedOutBanner(actions.onSignIn) }
            item { StudyHero(ui, sync, actions.onStudyAll) }
            if (ui.decks.isNotEmpty()) {
                item { Text("Your deck queue", style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp)) }
                items(ui.decks, key = { it.id }) { deck -> DeckRow(deck) { actions.onStudyDeck(deck.id) } }
            }
            item {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick = actions.onOpenFullApp).padding(vertical = 14.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.AutoMirrored.Filled.OpenInNew, null, tint = Lab.colors.muted, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Decks, tutor, readers, Claude — open the main app", color = Lab.colors.muted, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
    if (showSettings) {
        ModalBottomSheet(onDismissRequest = { showSettings = false }, containerColor = Lab.colors.card) {
            SettingsSheet(sync, settings, actions)
        }
    }
}

private fun greeting(): String = when (LocalTime.now().hour) {
    in 5..11 -> "早上好"
    in 12..17 -> "下午好"
    else -> "晚上好"
}

@Composable
private fun SyncLine(sync: SyncStatus, online: Boolean, nowMs: Long) {
    val text = when {
        sync.running -> "Syncing…"
        !online -> "Offline" + if (sync.unsynced > 0) " · ${sync.unsynced} review${if (sync.unsynced == 1) "" else "s"} waiting" else " · studying from this phone"
        sync.error != null -> "Sync failed: ${sync.error}"
        sync.lastSyncAt == 0L -> "Not synced yet"
        else -> "Synced ${ago(nowMs - sync.lastSyncAt)}" + if (sync.unsynced > 0) " · ${sync.unsynced} to upload" else ""
    }
    Text(text, style = MaterialTheme.typography.bodySmall, color = if (sync.error != null && online) Palette.Again else Lab.colors.muted)
}

private fun ago(ms: Long): String = when {
    ms < 60_000 -> "just now"
    ms < 3_600_000 -> "${ms / 60_000} min ago"
    ms < 86_400_000 -> "${ms / 3_600_000} h ago"
    else -> "${ms / 86_400_000} d ago"
}

@Composable
private fun SignedOutBanner(onSignIn: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Again.copy(alpha = 0.12f)).clickable(onClick = onSignIn).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Your session expired — tap to sign in again. Reviews on this phone are kept.", color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StudyHero(ui: HomeUi, sync: SyncStatus, onStudy: () -> Unit) {
    val due = ui.due
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "hero")
    val empty = ui.loaded && due.total == 0
    Column(
        Modifier
            .fillMaxWidth()
            .scale(scale)
            .clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(Color(0xFFEA580C), Color(0xFFDB2777))))
            .clickable(interactionSource = source, indication = null, enabled = ui.loaded, onClick = onStudy)
            .padding(24.dp),
    ) {
        Text(if (empty) "All caught up" else "Study today's cards", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        val minutes = Math.max(1, Math.round(due.total * 20 / 60f))
        Text(
            when {
                !ui.loaded || (sync.running && due.total == 0) -> "Getting your cards…"
                empty -> "Nothing due. ${ui.reviewedToday} reviews today — 很好！"
                else -> "${due.total} card${if (due.total == 1) "" else "s"} due · about $minutes min"
            },
            color = Color.White.copy(alpha = 0.9f),
            fontSize = 15.sp,
        )
        Spacer(Modifier.height(16.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            HeroChip(due.new, "new", Palette.New)
            HeroChip(due.secondaryNew, "more", Palette.Secondary)
            HeroChip(due.learning, "learning", Palette.Learning)
            HeroChip(due.review, "review", Palette.Review)
        }
    }
}

@Composable
private fun HeroChip(n: Int, label: String, color: Color) {
    Row(
        Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.18f)).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(6.dp))
        Text("$n $label", color = Color.White, fontSize = 13.sp, maxLines = 1)
    }
}

@Composable
private fun DeckRow(deck: DeckSummary, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).clickable(onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(deck.name, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, maxLines = 1)
            Text("${deck.noteCount} words", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        val d = deck.due
        if (d.total == 0) {
            Text("✓", color = Palette.Good, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (d.new + d.secondaryNew > 0) Text("${d.new + d.secondaryNew}", color = Palette.New, fontWeight = FontWeight.Bold)
                if (d.learning > 0) Text("${d.learning}", color = Palette.Learning, fontWeight = FontWeight.Bold)
                if (d.review > 0) Text("${d.review}", color = Palette.Review, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun SettingsSheet(sync: SyncStatus, settings: HomeSettings, actions: HomeActions) {
    var sound by remember { mutableStateOf(settings.soundOn) }
    var haptics by remember { mutableStateOf(settings.hapticsOn) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp)) {
        Text("Lab settings", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink)
        Spacer(Modifier.height(12.dp))
        ToggleRow("Sounds", sound) { sound = it; actions.onToggleSound(it) }
        ToggleRow("Haptics", haptics) { haptics = it; actions.onToggleHaptics(it) }
        HorizontalDivider(Modifier.padding(vertical = 12.dp), color = Lab.colors.faint)
        Text(
            if (sync.audioTotal == 0) "Offline audio: nothing to download yet" else "Offline audio: ${sync.audioCached} of ${sync.audioTotal} clips on this phone",
            style = MaterialTheme.typography.bodyMedium,
            color = Lab.colors.muted,
        )
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = actions.onFullSync) { Text("Full resync", color = Lab.colors.accent) }
        TextButton(onClick = actions.onOpenFullApp) { Text("Open the main app", color = Lab.colors.accent) }
        TextButton(onClick = actions.onSendDebugReport, enabled = !settings.sendingDebugReport) {
            Text(if (settings.sendingDebugReport) "Sending debug report…" else "Send debug report", color = Lab.colors.accent)
        }
        Text(
            settings.debugReport ?: "Uploads what this phone thinks is due, to compare with the web app",
            style = MaterialTheme.typography.bodySmall,
            color = Lab.colors.muted,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        TextButton(onClick = actions.onSignOut) {
            Text(if (sync.unsynced > 0) "Sign out (${sync.unsynced} reviews not uploaded yet!)" else "Sign out", color = Palette.Again)
        }
    }
}

@Composable
private fun ToggleRow(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, modifier = Modifier.weight(1f))
        Switch(checked = value, onCheckedChange = onChange)
    }
}
