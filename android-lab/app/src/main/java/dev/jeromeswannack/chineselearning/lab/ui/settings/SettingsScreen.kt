package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.OfflineMode
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.data.api.FeatureRequestDto
import dev.jeromeswannack.chineselearning.lab.ui.home.LastSyncDetails
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** What Settings shows that isn't its own state: role, sync, connection, Lab toggles. */
data class SettingsEnv(
    val role: NavRole = NavRole(),
    val sync: SyncStatus = SyncStatus(),
    val online: Boolean = true,
    val forcedOffline: Boolean = false,
    val soundOn: Boolean = true,
    val hapticsOn: Boolean = true,
    val pendingWrites: Int = 0,
    val nowMs: Long = System.currentTimeMillis(),
)

class SettingsActions(
    val onBack: (() -> Unit)? = null,
    val editBio: (String) -> Unit = {},
    val saveBio: () -> Unit = {},
    val downloadAudio: () -> Unit = {},
    val setForcedOffline: (Boolean) -> Unit = {},
    val exportBackup: () -> Unit = {},
    val setBudget: (StudyBudget) -> Unit = {},
    val saveBudget: () -> Unit = {},
    val chooseLanding: (String?) -> Unit = {},
    val toggleSound: (Boolean) -> Unit = {},
    val toggleHaptics: (Boolean) -> Unit = {},
    val signOut: () -> Unit = {},
    val openAdvanced: () -> Unit = {},
    val classifyAudio: () -> Unit = {},
    val regenerateAudio: () -> Unit = {},
    val open: (String) -> Unit = {},
    val openRequest: (String) -> Unit = {},
    val fullSync: () -> Unit = {},
    val checkForUpdates: () -> Unit = {},
    val newFeedback: () -> Unit = {},
)

private val LANDING_OPTIONS = listOf<Pair<String?, String>>(null to "Automatic", "study" to "Study", "students" to "Students", "decks" to "Decks")

/**
 * Settings, section for section as the web (pages/SettingsPage.tsx): bio, offline audio,
 * offline mode, backup, new cards a day, Start on, sign out, and Advanced (audio quality,
 * sentence coverage, feature requests, duplicate finder, full sync, updates, debug report,
 * last-sync timings). The Lab's own toggles (sound, haptics) sit with the app settings.
 */
@Composable
fun SettingsScreen(
    ui: SettingsUi,
    env: SettingsEnv,
    actions: SettingsActions,
    startAdvanced: Boolean = false,
    debugRow: @Composable () -> Unit = {},
    listState: androidx.compose.foundation.lazy.LazyListState = androidx.compose.foundation.lazy.rememberLazyListState(),
) {
    var advanced by rememberSaveable { mutableStateOf(startAdvanced) }
    var confirmSignOut by remember { mutableStateOf(false) }
    val role = env.role
    LabScreen(title = "Settings", onBack = actions.onBack, listState = listState) {
        if (!role.isTutorOnly) item { BioSection(ui, env, actions) }
        if (!role.isTutorOnly) item { OfflineAudioLine(env, actions) }
        item { OfflineModeSection(env, actions) }
        item { BackupSection(ui, actions, env) }
        if (!role.isTutorOnly) item { BudgetSection(ui, env, actions) }
        item { StartOnSection(ui, role, actions) }
        item {
            LabCard {
                ToggleRow("🔔", "Sounds", env.soundOn, desc = "Flip, rating and celebration sounds", onChange = actions.toggleSound)
                RowDivider()
                ToggleRow("📳", "Haptics", env.hapticsOn, desc = "Taps you can feel on every rating", onChange = actions.toggleHaptics)
            }
        }
        item {
            SecondaryPill("Sign out", Modifier.fillMaxWidth(), danger = true) {
                if (env.sync.unsynced > 0 || env.pendingWrites > 0) confirmSignOut = true else actions.signOut()
            }
        }
        item {
            AdvancedToggle(advanced) {
                advanced = !advanced
                if (advanced) actions.openAdvanced()
            }
        }
        item {
            AnimatedVisibility(advanced) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    AudioQualitySection(ui, env, actions)
                    SettingsSection("Example Sentences", "How many of your words have example sentences, what the background generation is doing, and a button to push a batch through now.") {
                        SecondaryPill("Sentence Coverage →", onClick = { actions.open(dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.sentenceCoverage()) })
                    }
                    FeatureRequestsSection(ui, actions)
                    LabCard {
                        NavRow("🪞", "Duplicate Finder", desc = "Find words that appear in more than one deck", onClick = { actions.open(dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.duplicateFinder()) })
                        RowDivider()
                        val waiting = env.sync.unsynced + env.pendingWrites
                        NavRow(
                            "🔄", if (env.sync.running) "Syncing…" else "Full Sync",
                            desc = if (waiting > 0) "$waiting change${if (waiting == 1) "" else "s"} waiting to upload · reconcile and recompute every card" else "Reconcile all reviews with the server and recompute every card",
                            enabled = !env.sync.running, onClick = actions.fullSync,
                        )
                        if (env.sync.lastRun != null) {
                            Box(Modifier.padding(start = 60.dp, end = 16.dp, bottom = 8.dp)) { LastSyncDetails(env.sync.lastRun) }
                        }
                        RowDivider()
                        NavRow("⬇️", "Update App", desc = "Lab builds are pre-releases on GitHub (Obtainium updates them)", external = true, onClick = actions.checkForUpdates)
                        RowDivider()
                        debugRow()
                    }
                }
            }
        }
    }

    if (confirmSignOut) {
        val waiting = env.sync.unsynced + env.pendingWrites
        ConfirmDialog(
            title = "Sign out?",
            text = "$waiting change${if (waiting == 1) " hasn't" else "s haven't"} reached the server yet. Signing out deletes ${if (waiting == 1) "it" else "them"} from this phone.",
            confirmLabel = "Sign out anyway",
            danger = true,
            onConfirm = actions.signOut,
            onDismiss = { confirmSignOut = false },
        )
    }
}

@Composable
private fun BioSection(ui: SettingsUi, env: SettingsEnv, actions: SettingsActions) {
    SettingsSection(
        "Personal Bio",
        "Tell us a bit about yourself. This is used to personalize example sentences — e.g. if you mention you like coffee, you might get sentences about ordering coffee.",
    ) {
        if (!ui.bioLoaded) {
            Text("Loading…", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            return@SettingsSection
        }
        OutlinedTextField(
            value = ui.bio,
            onValueChange = actions.editBio,
            modifier = Modifier.fillMaxWidth().heightIn(min = 110.dp),
            placeholder = { Text("e.g. I'm a software developer living in New Zealand. I like hiking, coffee, and cooking. I'm learning Chinese to talk to my partner's family.", color = Lab.colors.muted) },
            enabled = !ui.bioBusy.busy,
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent, unfocusedBorderColor = Lab.colors.cardBorder),
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = Lab.colors.ink),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            PrimaryPill(if (ui.bioBusy.busy) "Saving…" else "Save Bio", enabled = !ui.bioBusy.busy && ui.bio != ui.bioSaved && env.online, onClick = actions.saveBio)
            Spacer(Modifier.width(12.dp))
            Text("${ui.bio.length}/${SettingsViewModel.BIO_MAX}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.weight(1f))
            if (ui.bio == ui.bioSaved) StatusLine(ui.bioBusy.status)
        }
        ui.bioBusy.error?.let { StatusLine(it, error = true) }
    }
}

/** The web's OfflineAudioLine: audio downloads itself after every sync; this says how far along it is. */
@Composable
private fun OfflineAudioLine(env: SettingsEnv, actions: SettingsActions) {
    val s = env.sync
    val missing = (s.audioTotal - s.audioCached).coerceAtLeast(0)
    LabCard {
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("🎧", fontSize = 20.sp)
            Spacer(Modifier.width(12.dp))
            Text(
                when {
                    s.audioTotal == 0 -> "Audio for your words: nothing to download yet"
                    else -> "Audio for your words: ${"%,d".format(s.audioCached)} of ${"%,d".format(s.audioTotal)} clips on this phone${if (missing == 0) " ✓" else ""}"
                },
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.weight(1f),
            )
            if (missing > 0) {
                Text(
                    "Download now",
                    color = if (env.online) Lab.colors.accent else Lab.colors.muted,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = env.online, onClick = actions.downloadAudio).padding(8.dp),
                )
            }
        }
    }
}

@Composable
private fun OfflineModeSection(env: SettingsEnv, actions: SettingsActions) {
    val mode = OfflineMode.resolve(env.forcedOffline, env.online)
    SettingsSection("Offline mode", "For a spotty connection on the train: the phone says it's online but requests stall. Forced offline plays audio only from this phone (or its own voice).") {
        Segmented(listOf(false to "Automatic", true to "Force offline"), env.forcedOffline) { actions.setForcedOffline(it) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusPill(mode.label, if (mode.effectiveOffline) Palette.Hard else Palette.Good)
        }
        Text(mode.description.substringBefore(" Tap"), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}

@Composable
private fun BackupSection(ui: SettingsUi, actions: SettingsActions, env: SettingsEnv) {
    SettingsSection("Backup", "Download a backup of all your data as a JSON file. Includes decks, notes, cards, and review history.") {
        PrimaryPill(if (ui.exportBusy.busy) "Preparing backup…" else "Download Backup", Modifier.fillMaxWidth(), enabled = !ui.exportBusy.busy && env.online, onClick = actions.exportBackup)
        if (!env.online) StatusLine("Needs a connection.")
        ui.exportBusy.error?.let { StatusLine(it, error = true) } ?: StatusLine(ui.exportBusy.status)
        if (ui.lastExportAt > 0) {
            Text(
                "Last export: ${DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US).format(Instant.ofEpochMilli(ui.lastExportAt).atZone(ZoneId.systemDefault()))} · ${formatBytes(ui.lastExportSize)}",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            )
        }
    }
}

@Composable
private fun BudgetSection(ui: SettingsUi, env: SettingsEnv, actions: SettingsActions) {
    val d = ui.budgetDraft
    SettingsSection(
        "New cards a day",
        "One budget for all your decks, filled from the top of your deck list down. Your tutor can send as much homework as she likes; this is what decides your daily load.",
    ) {
        Stepper("New words", "Words you have never seen (blue)", d.newCardsPerDay, { actions.setBudget(d.copy(newCardsPerDay = it)) }, StudyBudget.MAX, !ui.budgetBusy.busy)
        Stepper("Extra cards", "More card types of words you have started (purple)", d.secondaryCardsPerDay, { actions.setBudget(d.copy(secondaryCardsPerDay = it)) }, StudyBudget.MAX, !ui.budgetBusy.busy)
        val dirty = d != ui.budget
        Row(verticalAlignment = Alignment.CenterVertically) {
            PrimaryPill(
                when {
                    ui.budgetBusy.busy -> "Saving…"
                    ui.budgetSavedFlash -> "Saved ✓"
                    else -> "Save"
                },
                enabled = !ui.budgetBusy.busy && dirty && env.online,
                color = if (ui.budgetSavedFlash) Palette.Good else Lab.colors.accent,
                onClick = actions.saveBudget,
            )
            Spacer(Modifier.width(12.dp))
            if (dirty && !env.online) StatusLine("Needs a connection to save.")
        }
        ui.budgetBusy.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
    }
}

@Composable
private fun StartOnSection(ui: SettingsUi, role: NavRole, actions: SettingsActions) {
    SettingsSection("Start on", "Automatic opens Students when you have students and nothing due today, otherwise Study.") {
        val options = LANDING_OPTIONS.filter { (v, _) -> v != "students" || role.hasStudents || ui.landing == "students" }
        Segmented(options, ui.landing, enabled = !ui.landingBusy.busy) { actions.chooseLanding(it) }
        ui.landingBusy.error?.let { StatusLine(it, error = true) }
    }
}

@Composable
private fun AdvancedToggle(open: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(start = 4.dp, end = 8.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Advanced", style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted)
        Spacer(Modifier.width(10.dp))
        Text(
            if (open) "Hide" else "Audio quality · Sentence coverage · Feature requests · Sync · Debug",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.weight(1f), maxLines = 1,
        )
        val turn by animateFloatAsState(if (open) 90f else 0f, label = "chevron")
        Text("›", color = Lab.colors.muted, fontSize = 22.sp, modifier = Modifier.rotate(turn))
    }
}

@Composable
private fun AudioQualitySection(ui: SettingsUi, env: SettingsEnv, actions: SettingsActions) {
    SettingsSection(
        "Audio Quality",
        "Clips are normally generated by MiniMax. When it was rate-limited, some fell back to Google — a different voice at half the quality that sounds crunchy. Those can be found and regenerated here.",
    ) {
        val q = ui.audioQuality
        if (q == null) {
            StatusLine(if (!env.online) "Requires internet connection." else ui.audioQualityError ?: "Loading…", error = ui.audioQualityError != null)
        } else {
            val fallback = q.notes.gtts + q.clues.gtts + q.sentences.gtts
            val unknown = q.notes.unknown + q.clues.unknown + q.sentences.unknown
            val good = q.notes.minimax + q.clues.minimax + q.sentences.minimax
            Text(
                "$fallback low-quality fallback clip${if (fallback == 1) "" else "s"}, $good good, $unknown not yet checked.",
                style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink,
            )
            Text("(words ${q.notes.gtts}, card sentences ${q.clues.gtts}, sentence sets ${q.sentences.gtts})", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow {
                SecondaryPill(if (ui.audioBusy.busy) "Working…" else "Check $unknown Unchecked", enabled = !ui.audioBusy.busy && env.online && unknown > 0, onClick = actions.classifyAudio)
                PrimaryPill("Regenerate $fallback Clips", enabled = !ui.audioBusy.busy && env.online && fallback > 0, onClick = actions.regenerateAudio)
            }
        }
        ui.audioBusy.error?.let { StatusLine(it, error = true) } ?: StatusLine(ui.audioBusy.status)
    }
}

private val REQUEST_STATUS = mapOf("new" to "New", "in_progress" to "In Progress", "agent_working" to "Agent Working", "done" to "Done", "declined" to "Declined")

fun requestStatusLabel(status: String) = REQUEST_STATUS[status] ?: status

fun requestStatusColor(status: String) = when (status) {
    "done" -> Palette.Good
    "declined" -> Palette.Again
    "in_progress", "agent_working" -> Palette.Easy
    else -> Palette.Hard
}

@Composable
private fun FeatureRequestsSection(ui: SettingsUi, actions: SettingsActions) {
    SettingsSection("Feature Requests", "Your submitted feedback and feature requests.") {
        SecondaryPill("💬 Send feedback", onClick = actions.newFeedback)
        val list = ui.requests
        when {
            list == null && ui.requestsError != null -> StatusLine(ui.requestsError, error = true)
            list == null -> StatusLine("Loading…")
            list.isEmpty() -> Text("No feature requests yet.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { list.forEach { RequestCard(it) { actions.openRequest(it.id) } } }
        }
    }
}

@Composable
private fun RequestCard(r: FeatureRequestDto, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        StatusPill(requestStatusLabel(r.status), requestStatusColor(r.status))
        Text(if (r.content.length > 150) r.content.take(150) + "..." else r.content, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
        Text(
            listOfNotNull(timeAgo(r.created_at), r.comment_count.takeIf { it > 0 }?.let { "$it comment${if (it != 1) "s" else ""}" }, r.page_context?.let { "from $it" }).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
    }
}

/** The web's timeAgo ("just now", "5m ago", "3h ago", "yesterday", "4d ago"); SQLite times are UTC. */
fun timeAgo(iso: String, nowMs: Long = System.currentTimeMillis()): String {
    val at = runCatching { dev.jeromeswannack.chineselearning.lab.core.Js.parseDate(iso) }.getOrNull() ?: return iso
    val mins = (nowMs - at) / 60_000
    if (mins < 1) return "just now"
    if (mins < 60) return "${mins}m ago"
    val hours = mins / 60
    if (hours < 24) return "${hours}h ago"
    val days = hours / 24
    return if (days == 1L) "yesterday" else "${days}d ago"
}

/** The web's formatBytes. */
fun formatBytes(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "%.1f KB".format(Locale.US, bytes / 1024.0)
    else -> "%.1f MB".format(Locale.US, bytes / (1024.0 * 1024.0))
}
