package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkDeckSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.PendingInviteDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorDashboardDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant

/** What the dashboard's buttons do (wired by TeachingNav; no-ops in screenshots). */
data class DashboardActions(
    val open: (String) -> Unit = {},
    val message: (StudentOverviewDto) -> Unit = {},
    val sendHomework: (StudentOverviewDto) -> Unit = {},
    val invite: () -> Unit = {},
    val revokeInvite: (PendingInviteDto) -> Unit = {},
    val copy: (String) -> Unit = {},
    val share: (String) -> Unit = {},
    val createDeck: (String) -> Unit = {},
    val refresh: () -> Unit = {},
)

/** "Studied today · 🔥 3 days · 84% today" (web: studyStatusLine in StudentCard.tsx). */
fun studyStatusLine(o: StudentOverviewDto, now: Instant = Instant.now()): String {
    val s = o.status
    if (s.last_studied_at == null) return "Hasn't studied yet"
    val parts = mutableListOf<String>()
    parts += if (s.studied_today) "Studied today" else "Last studied ${TeachingFormat.relativeDay(s.last_studied_at, now)}"
    parts += "🔥 ${s.streak_days} day${if (s.streak_days == 1) "" else "s"}"
    if (s.studied_today && s.today.accuracy != null) parts += "${TeachingFormat.percent(s.today.accuracy)} today"
    return parts.joinToString(" · ")
}

fun studentName(o: StudentOverviewDto): String = o.student.name?.takeIf { it.isNotBlank() } ?: o.student.email ?: "Student"

/**
 * The tutor's Students tab (web: ConnectionsPage → StudentsDashboard): one card per student,
 * pending invite links as muted rows, "My homework decks". Cached, so it opens instantly
 * and offline (with a stale notice).
 */
@Composable
fun StudentsDashboardScreen(
    state: Loadable<TutorDashboardDto>,
    canInvite: Boolean,
    actions: DashboardActions,
    notice: String? = null,
    now: Instant = Instant.now(),
) {
    LabScreen(
        title = "My students",
        actions = {
            if (canInvite) {
                PrimaryPill("+ Invite", Modifier.height(44.dp).padding(end = 8.dp), onClick = actions.invite)
            }
        },
    ) {
        item {
            LoadableContent(state, onRetry = actions.refresh) { data ->
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (notice != null) InlineNotice(notice, kind = NoticeKind.Success)
                    if (data.students.isEmpty() && data.invites.isEmpty()) {
                        EmptyState("👥", "No students yet", body = if (canInvite) "Tap + Invite to make a link your student opens on their phone." else "Ask Jerome to turn on invites for your account.")
                    }
                    data.students.forEach { StudentCard(it, actions, now) }
                    if (canInvite) data.invites.forEach { PendingInviteRow(it, actions, now) }
                    HomeworkDecksSection(data.homework_decks, actions)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StudentCard(o: StudentOverviewDto, actions: DashboardActions, now: Instant = Instant.now()) {
    val name = studentName(o)
    val relId = o.relationship_id
    var showQr by remember { mutableStateOf(false) }
    TeachCard {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).bouncyClickable(pressedScale = 0.98f) { actions.open(Routes.connection(relId)) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(o.student.name, o.student.email)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (o.is_new) {
                        Spacer(Modifier.width(8.dp))
                        TeachPill("Getting set up", PillTone.Setup)
                    }
                }
                Text(
                    if (o.is_new) "Joined ${TeachingFormat.relativeDay(o.joined_at, now)} · hasn't studied yet" else studyStatusLine(o, now),
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                )
            }
            Text("›", color = Lab.colors.muted, fontSize = 22.sp)
        }
        if (o.is_new) {
            SetupChecklistCompact(o, now)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (o.setup.invite != null) TeachButton("Show invite QR again", Modifier.weight(1f)) { showQr = true }
                else TeachButton("📤 Send homework", Modifier.weight(1f)) { actions.sendHomework(o) }
                TeachButton("💬 Message", Modifier.weight(1f)) { actions.message(o) }
            }
        } else {
            val p = o.pills
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (p.struggling_words > 0) TeachPill("${TeachingFormat.plural(p.struggling_words, "word")} struggling", PillTone.Struggling) { actions.open(Routes.insights(relId)) }
                else TeachPill("No words struggling", PillTone.Ok)
                if (p.flags_open > 0) TeachPill("🚩 ${TeachingFormat.plural(p.flags_open, "flagged card")}", PillTone.Flags) { actions.open(Routes.connection(relId)) }
                if (p.recordings_to_hear > 0) TeachPill("🎤 ${TeachingFormat.plural(p.recordings_to_hear, "recording")} to hear", PillTone.Recordings) { actions.open(Routes.recordings(relId)) }
                if (p.homework_percent != null) TeachPill("Homework ${p.homework_percent}%", PillTone.Homework) { actions.open(Routes.connection(relId)) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TeachButton("💬 Message", Modifier.weight(1f)) { actions.message(o) }
                TeachButton("📤 Send homework", Modifier.weight(1f)) { actions.sendHomework(o) }
            }
        }
    }
    val invite = o.setup.invite
    if (showQr && invite != null) {
        InviteQrSheet(
            url = invite.url, title = "Invite link for $name",
            hint = "Created ${TeachingFormat.shortDate(o.joined_at, now)} · scanning it again just opens the app.",
            onCopy = actions.copy, onShare = actions.share, onDismiss = { showQr = false },
        )
    }
}

private val COMPACT_TITLES = mapOf(
    "signed_in" to "Signed in",
    "homework" to "Homework received",
    "installed" to "Installed the app",
    "first_session" to "First study session",
)

/** The four-step grid inside a new student's card. */
@Composable
fun SetupChecklistCompact(o: StudentOverviewDto, now: Instant = Instant.now()) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        o.setup.steps.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { s ->
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                        CheckBox(s.done)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            (COMPACT_TITLES[s.key] ?: s.title) + if (s.key == "signed_in" && s.done) " (${TeachingFormat.shortDate(o.joined_at, now)})" else "",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (s.done) Lab.colors.ink else Lab.colors.muted,
                        )
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun CheckBox(done: Boolean) {
    val c = if (done) Palette.Good else Lab.colors.faint
    Box(Modifier.size(22.dp).clip(RoundedCornerShape(7.dp)).background(c), contentAlignment = Alignment.Center) {
        if (done) Text("✓", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

/** A muted row for an invite nobody has used yet: Resend (QR / copy) and ⋯ → Copy / QR / Revoke. */
@Composable
fun PendingInviteRow(invite: PendingInviteDto, actions: DashboardActions, now: Instant = Instant.now()) {
    var showQr by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var confirmRevoke by remember { mutableStateOf(false) }
    val title = invite.email ?: invite.note ?: "Invite link"
    val opened = if (invite.opened_at != null) "opened, not signed in" else "link not opened yet"
    TeachCard(muted = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(null, null, muted = true, text = "?")
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "Invited ${TeachingFormat.relativeDay(invite.created_at, now)} · $opened" +
                        if (invite.share_deck_count > 0) " · ${TeachingFormat.plural(invite.share_deck_count, "deck")} attached" else "",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                )
            }
            InlineButton("Resend") { showQr = true }
            IconButton(onClick = { menu = true }) { Text("⋯", fontSize = 22.sp, color = Lab.colors.muted) }
        }
    }
    if (menu) {
        LabBottomSheet(onDismiss = { menu = false }, title = title) {
            NavRow("📋", "Copy link", onClick = { menu = false; actions.copy(invite.url) })
            NavRow("🔳", "Show QR", onClick = { menu = false; showQr = true })
            NavRow("🗑️", "Revoke invite", danger = true, onClick = { menu = false; confirmRevoke = true })
        }
    }
    if (showQr) InviteQrSheet(invite.url, "Resend invite", "Show the QR or send the link again — it is the same link.", actions.copy, actions.share) { showQr = false }
    if (confirmRevoke) {
        ConfirmDialog(
            "Revoke this invite link?", "Anyone who still has it will not be able to join.", "Revoke",
            onConfirm = { actions.revokeInvite(invite) }, onDismiss = { confirmRevoke = false }, danger = true,
        )
    }
}

/** Re-shows an existing invite's QR + link (web: InviteQRSheet). */
@Composable
fun InviteQrSheet(url: String, title: String, hint: String?, onCopy: (String) -> Unit, onShare: (String) -> Unit, onDismiss: () -> Unit) {
    var copied by remember { mutableStateOf(false) }
    LabBottomSheet(onDismiss = onDismiss, title = title) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            QrCode(url)
            Text(url, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryPill(if (copied) "Copied ✓" else "Copy link", Modifier.weight(1f).height(52.dp)) { onCopy(url); copied = true }
                TeachButton("Share…", Modifier.weight(1f).height(52.dp)) { onShare(url) }
            }
            if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}

/** "My homework decks" + "+ New homework deck (write, generate, or paste a list)". */
@Composable
fun HomeworkDecksSection(decks: List<HomeworkDeckSummaryDto>, actions: DashboardActions) {
    var showNew by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("My homework decks")
        TeachCard {
            if (decks.isEmpty()) MutedLine("No deck sent yet. Make one and send it from a student's card.")
            decks.forEach { d ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(pressedScale = 0.98f) { actions.open(Routes.deck(d.deck_id)) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(d.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                        MutedLine("${TeachingFormat.plural(d.note_count, "word")} · sent to ${TeachingFormat.plural(d.student_count, "student")}")
                    }
                    Text("›", color = Lab.colors.muted, fontSize = 22.sp)
                }
            }
            Text(
                "+ New homework deck (write, generate, or paste a list)",
                color = Lab.colors.accent, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).bouncyClickable(pressedScale = 0.98f) { showNew = !showNew }.padding(vertical = 12.dp),
            )
            AnimatedVisibility(showNew) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            name, { name = it }, Modifier.weight(1f),
                            placeholder = { Text("Deck name, e.g. 第四周作业：交通") }, singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { if (name.isNotBlank()) actions.createDeck(name.trim()) }),
                        )
                        PrimaryPill("Write it", Modifier.height(52.dp), enabled = name.isNotBlank()) { actions.createDeck(name.trim()) }
                    }
                    SecondaryPill("✨ Generate from a topic or a pasted word list", Modifier.fillMaxWidth()) { actions.open(Routes.generate()) }
                    MutedLine("\"Write it\" opens the empty deck so you can add words one by one; the generator turns a topic or a pasted list into cards with pinyin and audio.")
                }
            }
        }
    }
}
