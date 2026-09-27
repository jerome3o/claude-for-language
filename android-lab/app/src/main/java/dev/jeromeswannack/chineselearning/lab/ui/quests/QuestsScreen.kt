package dev.jeromeswannack.chineselearning.lab.ui.quests

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.QuestSummaryDto
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
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** The web's TOPIC_IDEAS — one tap instead of thinking up a scene. */
val QUEST_TOPIC_IDEAS = listOf("厨房做早饭", "在超市买东西", "打扫房间", "在公园遛狗", "收拾行李去旅行", "在花园浇花", "开一家小咖啡店")

val QUEST_DIFFICULTIES = listOf(
    "easy" to "Easy — single-verb instructions",
    "medium" to "Medium — some two-step chains",
    "hard" to "Hard — long chains, doors, containers",
)

data class QuestsUi(
    val quests: Loadable<List<QuestSummaryDto>> = Loadable(),
    val generating: Boolean = false,
    val generateError: String? = null,
    val busyId: String? = null,
    val actionError: String? = null,
)

data class QuestsActions(
    val onBack: (() -> Unit)? = null,
    val onOpen: (String) -> Unit = {},
    val onGenerate: (topic: String, difficulty: String, goals: Int) -> Unit = { _, _, _ -> },
    val onRetry: (String) -> Unit = {},
    val onDelete: (String) -> Unit = {},
    val onRefresh: () -> Unit = {},
)

/** `/quests` — the web's QuestsPage: build a level, the list with live progress, play / retry / delete. */
@Composable
fun QuestsScreen(ui: QuestsUi, actions: QuestsActions) {
    var topic by remember { mutableStateOf("") }
    var difficulty by remember { mutableStateOf("medium") }
    var goals by remember { mutableStateOf(5) }
    var confirmDelete by remember { mutableStateOf<QuestSummaryDto?>(null) }
    val q = ui.quests

    LabScreen("🎮 Quests", onBack = actions.onBack) {
        item {
            Text(
                "A little tile world with a character you drive around. Each quest gives you instructions in Chinese — 拿起, 打开, 把…放在…上 — and you carry them out by walking, picking things up and using the verb buttons. Claude builds the whole level.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
            )
        }
        item {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(20.dp)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("新任务 · New quest", fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Lab.colors.ink)
                OutlinedTextField(
                    value = topic,
                    onValueChange = { topic = it.take(200) },
                    placeholder = { Text("e.g. 厨房做早饭 (or leave blank for a surprise)") },
                    label = { Text("What should it be about?") },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.background, unfocusedContainerColor = Lab.colors.background),
                    modifier = Modifier.fillMaxWidth(),
                )
                ChipRow { QUEST_TOPIC_IDEAS.forEach { idea -> LabChip(idea, selected = topic == idea) { topic = idea } } }
                Text("Difficulty", fontSize = 13.sp, color = Lab.colors.muted, fontWeight = FontWeight.SemiBold)
                ChipRow { QUEST_DIFFICULTIES.forEach { (k, label) -> LabChip(label.substringBefore(" —"), selected = difficulty == k) { difficulty = k } } }
                Text(QUEST_DIFFICULTIES.first { it.first == difficulty }.second.substringAfter("— "), fontSize = 13.sp, color = Lab.colors.muted)
                Text("Instructions", fontSize = 13.sp, color = Lab.colors.muted, fontWeight = FontWeight.SemiBold)
                ChipRow { (3..8).forEach { n -> LabChip("$n", selected = goals == n) { goals = n } } }
                PrimaryPill(
                    if (ui.generating) "Sending to Claude…" else "✨ Build the level",
                    Modifier.fillMaxWidth().height(56.dp),
                    enabled = !ui.generating,
                ) { actions.onGenerate(topic.trim(), difficulty, goals) }
                ui.generateError?.let { InlineNotice(it, kind = NoticeKind.Error) }
            }
        }
        if (q.offline && q.hasData) item { OfflineNotice(updatedAt = q.updatedAt) }
        else if (q.error != null && q.hasData) item { InlineNotice(q.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
        ui.actionError?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }
        val list = q.data
        when {
            list == null && q.loading -> item { LoadingState(text = "Loading…") }
            list == null -> item { InlineNotice(q.error ?: "Couldn't load your quests.", kind = if (q.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
            list.isEmpty() -> item { EmptyState("🗺️", "No quests yet", body = "Build your first level above.") }
            else -> items(list.size, key = { list[it].id }) { i -> QuestRow(list[i], ui.busyId == list[i].id, actions, onDelete = { confirmDelete = it }) }
        }
    }
    confirmDelete?.let { quest ->
        ConfirmDialog(
            title = "Delete “${quest.title.ifBlank { "this quest" }}”?",
            text = "The level and its best score are removed.",
            confirmLabel = "Delete",
            danger = true,
            onConfirm = { confirmDelete = null; actions.onDelete(quest.id) },
            onDismiss = { confirmDelete = null },
        )
    }
}

/** "Sep 27" from the server's `YYYY-MM-DD HH:MM:SS` (UTC). */
internal fun questDate(created: String): String = runCatching {
    val d = java.time.LocalDateTime.parse(created.replace(' ', 'T').removeSuffix("Z")).atZone(java.time.ZoneOffset.UTC).withZoneSameInstant(java.time.ZoneId.systemDefault())
    d.format(java.time.format.DateTimeFormatter.ofPattern("d MMM"))
}.getOrDefault("")

@Composable
private fun QuestRow(q: QuestSummaryDto, busy: Boolean, actions: QuestsActions, onDelete: (QuestSummaryDto) -> Unit) {
    val playable = q.status == "ready"
    Row(
        Modifier.fillMaxWidth().animateContentSize().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp))
            .bouncyClickable(q.status != "error") { actions.onOpen(q.id) }.padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(q.title.ifBlank { q.topic ?: "Quest" }, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink)
            val sub = buildString {
                append(questDate(q.created_at))
                if (q.status == "generating") append(" · ${q.progress ?: "queued"}")
                if (q.status == "ready") append(" · ${q.goal_count} instructions · ${q.object_count} objects")
                if (q.completed_at != null) append(" · ✅ done in ${q.best_moves} moves")
            }
            Text(sub, fontSize = 13.sp, color = Lab.colors.muted)
            if (q.status == "error") Text("Couldn't build this one — tap Retry.", fontSize = 13.sp, color = Palette.Again)
        }
        Spacer(Modifier.width(8.dp))
        when (q.status) {
            "generating" -> BuildingBadge()
            "error" -> SecondaryPill(if (busy) "…" else "🔄 Retry", enabled = !busy) { actions.onRetry(q.id) }
            else -> PrimaryPill(if (q.completed_at != null) "Replay" else "Play", enabled = playable) { actions.onOpen(q.id) }
        }
        Box(Modifier.size(44.dp).clip(CircleShape).clickable { onDelete(q) }, contentAlignment = Alignment.Center) { Text("🗑️", fontSize = 18.sp) }
    }
}

@Composable
private fun BuildingBadge() {
    val a by rememberInfiniteTransition(label = "building").animateFloat(0.45f, 1f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "a")
    StatusPill("Building…", Palette.Easy, Modifier.alpha(a))
}

/** `/quests/:id` while the level is being written / when it failed / when it can't load. */
@Composable
fun QuestWaitScreen(
    title: String,
    status: String,
    progress: String?,
    error: String?,
    loadError: String?,
    retrying: Boolean,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    var details by remember { mutableStateOf(false) }
    LabScreen(title.ifBlank { "Quest" }, onBack = onBack) {
        item {
            Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when {
                    loadError != null -> {
                        Text("😕", fontSize = 56.sp)
                        Text("Couldn't load this quest.", fontSize = 18.sp, color = Lab.colors.ink)
                        InlineNotice(loadError, kind = NoticeKind.Error, actionLabel = "Retry", onAction = onRetry)
                    }
                    status == "generating" -> {
                        val bob by rememberInfiniteTransition(label = "map").animateFloat(-6f, 6f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "bob")
                        Text("🗺️", fontSize = 72.sp, modifier = Modifier.padding(top = (8 + bob).coerceAtLeast(0f).dp))
                        Text("Claude is drawing the map, placing the objects and writing the instructions…", textAlign = TextAlign.Center, color = Lab.colors.ink, style = MaterialTheme.typography.bodyLarge)
                        StatusPill(progress ?: "queued", Palette.Easy)
                        Text("This usually takes a minute or two.", fontSize = 13.sp, color = Lab.colors.muted)
                    }
                    else -> {
                        Text("That level didn't come out playable", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center)
                        Text("Couldn't build this one — tap Retry.", color = Lab.colors.muted)
                        if (!error.isNullOrBlank()) {
                            Text(if (details) "Hide details" else "Show details", color = Lab.colors.accent, modifier = Modifier.clickable { details = !details }.padding(8.dp))
                            if (details) Text(error, fontSize = 12.sp, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(10.dp))
                        }
                        PrimaryPill(if (retrying) "Starting…" else "🔄 Try building it again", Modifier.fillMaxWidth().height(56.dp), enabled = !retrying, onClick = onRetry)
                    }
                }
                SecondaryPill("← Back to quests", Modifier.fillMaxWidth(), onClick = onBack)
            }
        }
    }
}

