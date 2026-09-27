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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
    val onSignIn: () -> Unit = {},
    /** "All decks" under the queue → the Decks tab. */
    val onAllDecks: () -> Unit = {},
)

/** The Study tab's home (`/`). Lab settings live in the More tab. */
@Composable
fun HomeScreen(
    ui: HomeUi,
    sync: SyncStatus,
    online: Boolean,
    actions: HomeActions,
    nowMs: Long = System.currentTimeMillis(),
    /** Package E: the Homework card + "From <tutor>" card, under the Study button (web HomePage order). */
    homework: (@Composable () -> Unit)? = null,
) {
    Box(Modifier.fillMaxSize().background(Lab.colors.background).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)), contentAlignment = Alignment.TopCenter) {
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
                }
            }
            if (sync.signedOut) item { SignedOutBanner(actions.onSignIn) }
            item { StudyHero(ui, sync, actions.onStudyAll) }
            if (homework != null) item { homework() }
            if (ui.decks.isNotEmpty()) {
                item {
                    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Your deck queue", style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted, modifier = Modifier.weight(1f))
                        TextButton(onClick = actions.onAllDecks) { Text("All decks", color = Lab.colors.accent) }
                    }
                }
                items(ui.decks, key = { it.id }) { deck -> DeckRow(deck) { actions.onStudyDeck(deck.id) } }
            }
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
        sync.running -> syncProgressText(sync)
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
    val empty = ui.loaded && due.total == 0 && !sync.running
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
                !ui.loaded || (sync.running && due.total == 0) -> "Getting your cards…" + (sync.progress?.let { "\n${sync.phase} · $it" } ?: "")
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

/** One deck of the queue with its due counts (Home and the interim Decks tab). */
@Composable
internal fun DeckRow(deck: DeckSummary, onClick: () -> Unit) {
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
