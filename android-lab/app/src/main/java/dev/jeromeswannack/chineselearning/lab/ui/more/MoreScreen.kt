package dev.jeromeswannack.chineselearning.lab.ui.more

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavSection
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

data class MoreUi(
    val userName: String? = null,
    val email: String? = null,
    val role: NavRole = NavRole(),
    val isAdmin: Boolean = false,
    val sync: SyncStatus = SyncStatus(),
    /** Outbox writes still waiting to upload (flags, recordings, homework events…). */
    val pendingWrites: Int = 0,
    val soundOn: Boolean = true,
    val hapticsOn: Boolean = true,
    /** Paths with a native screen (their rows get a chevron; the rest show ↗). */
    val native: Set<String> = emptySet(),
)

class MoreActions(
    val open: (String) -> Unit = {},
    val onToggleSound: (Boolean) -> Unit = {},
    val onToggleHaptics: (Boolean) -> Unit = {},
    val onFullSync: () -> Unit = {},
    val onOpenMainApp: () -> Unit = {},
    val onSignOut: () -> Unit = {},
)

/**
 * The More tab — the web's grouped More page (pages/MorePage.tsx) row for row, plus a
 * **Lab** section with the app's own settings. Every row opens its native screen or the
 * placeholder for it (↗ = opens the main app). New rows for Lab tools go in
 * [extraRows] (MoreExtraRows.kt), not here.
 */
@Composable
fun MoreScreen(ui: MoreUi, actions: MoreActions, extraRows: List<@Composable () -> Unit> = emptyList()) {
    var confirmSignOut by remember { mutableStateOf(false) }
    var showAdvanced by rememberSaveable { mutableStateOf(false) }
    val role = ui.role
    fun row(icon: String, label: String, desc: String, path: String): @Composable () -> Unit = {
        NavRow(icon, label, desc = desc, external = path !in ui.native, onClick = { actions.open(path) })
    }

    LabScreen(title = "More", spacing = 4.dp) {
        item { UserCard(ui) { actions.open(Routes.SETTINGS) } }

        if (role.isTutorAccount) {
            item {
                NavSection(
                    "Teaching",
                    rows = listOf(
                        row("👥", "Students", "Progress, homework, messages", Routes.CONNECTIONS),
                        row("🗂️", "Lesson Library", "Mini lessons you assign — tap one to try it", Routes.LIBRARY),
                        row("🧭", "Exercise catalogue", "All exercise types · try a sample", Routes.catalogue()),
                        row("📚", "Readers", "Graded stories to share with students", Routes.readers()),
                        row("📹", "Video calls (beta)", "Lessons with a whiteboard, then a transcript", Routes.calls()),
                    ),
                )
            }
            item {
                NavSection(
                    "Tools",
                    rows = listOf(
                        row("🧑‍🏫", "Sentence Coach", "Check or translate a sentence", Routes.coach()),
                        row("🔍", "Sentence Breakdown", "Split any sentence into words", Routes.analyze()),
                    ),
                )
            }
        } else {
            item {
                NavSection(
                    "Practice",
                    rows = buildList {
                        add(row("🧑‍🏫", "Sentence Coach", "Check a sentence you wrote", Routes.coach()))
                        add(row("🔍", "Sentence Breakdown", "Split any sentence into words", Routes.analyze()))
                        if (!role.isTutorOnly) add(row("📚", "Readers", "Short stories at your level", Routes.readers()))
                        add(row("🎓", "Mini Lessons", "Lessons made for you, mixed into study", Routes.lessons()))
                        if (!role.isTutorOnly) add(row("💬", "Claude conversations", "Everything you asked Claude about your cards", Routes.claudeChats()))
                        add(row("✍️", "Write characters (preview)", "Stroke order, checked stroke by stroke", Routes.strokes()))
                        add(row("🎮", "Quests", "Carry out instructions in a tiny world", Routes.quests()))
                        add(row("📹", "Video calls (beta)", "Live lessons with a whiteboard, then a transcript", Routes.calls()))
                    },
                )
            }
            if (!role.isTutorOnly) item {
                NavSection(
                    "From your tutor",
                    rows = listOf(
                        row("✅", "Homework", "One-off practice with a due date", Routes.homework()),
                        row("📝", "Lesson Notes", if (role.hasTutor) "Paste what your tutor sent you" else "Notes from lessons, for readers and sentences", Routes.lessonNotes()),
                    ),
                )
            }
            if (role.hasStudents || ui.isAdmin) item {
                NavSection(
                    "Teaching",
                    rows = listOf(
                        row("🗂️", "Lesson Library", "Lessons you assign to students", Routes.LIBRARY),
                        row("🧭", "Exercise catalogue", "All exercise types · try a sample", Routes.catalogue()),
                    ),
                )
            }
        }

        item {
            NavSection(
                "Account",
                rows = listOf(
                    row("⚙️", "Settings", if (role.isTutorOnly) "Backup · Start on" else "Study budget · Start on · Offline audio", Routes.SETTINGS),
                    {
                        NavRow("🚪", "Sign out", danger = true, onClick = { if (ui.sync.unsynced > 0 || ui.pendingWrites > 0) confirmSignOut = true else actions.onSignOut() })
                    },
                ),
            )
        }

        item { LabSection(ui, actions, extraRows) }

        item {
            Column {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).clickable { showAdvanced = !showAdvanced }.padding(start = 4.dp, end = 8.dp, top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Advanced", style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        if (showAdvanced) "Hide" else "Duplicate finder · Sentence coverage" + if (ui.isAdmin) " · Admin" else "",
                        style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.weight(1f), maxLines = 1,
                    )
                    val turn by animateFloatAsState(if (showAdvanced) 90f else 0f, label = "chevron")
                    Text("›", color = Lab.colors.muted, fontSize = 22.sp, modifier = Modifier.rotate(turn))
                }
                AnimatedVisibility(showAdvanced) {
                    LabCard(Modifier.padding(top = 4.dp)) {
                        row("🪞", "Duplicate Finder", "Find words that appear in more than one deck", Routes.duplicateFinder())()
                        RowDivider()
                        row("💬", "Sentence Coverage", "Example-sentence generation status", Routes.sentenceCoverage())()
                        if (ui.isAdmin) {
                            RowDivider()
                            row("🛠️", "Admin", "Users, invites, feature requests", Routes.admin())()
                        }
                    }
                }
            }
        }
    }

    if (confirmSignOut) {
        val waiting = ui.sync.unsynced + ui.pendingWrites
        ConfirmDialog(
            title = "Sign out?",
            text = "$waiting change${if (waiting == 1) " hasn't" else "s haven't"} reached the server yet. Signing out deletes ${if (waiting == 1) "it" else "them"} from this phone.",
            confirmLabel = "Sign out anyway",
            danger = true,
            onConfirm = actions.onSignOut,
            onDismiss = { confirmSignOut = false },
        )
    }
}

@Composable
private fun UserCard(ui: MoreUi, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).clickable(onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(48.dp).clip(CircleShape).background(Lab.colors.accent), contentAlignment = Alignment.Center) {
            Text((ui.userName ?: ui.email ?: "?").take(1).uppercase(), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(ui.userName ?: "You", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
            if (ui.email != null) Text(ui.email, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        Text("›", color = Lab.colors.muted, fontSize = 22.sp)
    }
}

/** The Lab app's own settings (sound, haptics, offline audio, uploads, resync) + [extraRows]. */
@Composable
private fun LabSection(ui: MoreUi, actions: MoreActions, extraRows: List<@Composable () -> Unit>) {
    Column {
        SectionHeader("Lab app")
        LabCard {
            ToggleRow("🔔", "Sounds", ui.soundOn, desc = "Flip, rating and celebration sounds", onChange = actions.onToggleSound)
            RowDivider()
            ToggleRow("📳", "Haptics", ui.hapticsOn, desc = "Taps you can feel on every rating", onChange = actions.onToggleHaptics)
            RowDivider()
            NavRow(
                "🎧", "Offline audio",
                desc = if (ui.sync.audioTotal == 0) "Nothing to download yet" else "${ui.sync.audioCached} of ${ui.sync.audioTotal} clips on this phone",
            )
            RowDivider()
            val waiting = ui.sync.unsynced + ui.pendingWrites
            NavRow(
                "🔄", if (ui.sync.running) "Syncing…" else "Full resync",
                desc = if (waiting > 0) "$waiting change${if (waiting == 1) "" else "s"} waiting to upload" else "Everything on this phone is uploaded",
                enabled = !ui.sync.running,
                onClick = actions.onFullSync,
            )
            RowDivider()
            NavRow("📱", "Open the main app", desc = "Everything the Lab app doesn't do yet", external = true, onClick = actions.onOpenMainApp)
            for (extra in extraRows) {
                RowDivider()
                extra()
            }
        }
    }
}
