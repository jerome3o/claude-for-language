package dev.jeromeswannack.chineselearning.lab.ui.connections

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.PendingInvitationDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

data class ConnectionsUi(
    val relationships: Loadable<MyRelationshipsDto> = Loadable(loading = true),
    val myId: String? = null,
    val online: Boolean = true,
    val busy: Boolean = false,
    /** A sentence after an action ("Invitation sent to …") or its failure. */
    val notice: String? = null,
    val noticeIsError: Boolean = false,
)

class ConnectionsActions(
    val onOpen: (relId: String) -> Unit = {},
    val onAccept: (relId: String) -> Unit = {},
    /** Decline an incoming request / cancel an outgoing one (DELETE /api/relationships/:id). */
    val onRemove: (relId: String) -> Unit = {},
    val onCancelInvitation: (id: String) -> Unit = {},
    val onInvite: (email: String, role: String) -> Unit = { _, _ -> },
    val onRetry: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
)

/**
 * `/connections` for a student (web: ConnectionsPage without a dashboard): pending requests,
 * sent requests, email invitations, My Tutors, and "+ Invite" by email.
 */
@Composable
fun ConnectionsScreen(ui: ConnectionsUi, actions: ConnectionsActions) {
    var showForm by rememberSaveable { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    LabScreen(
        "Connections",
        actions = { SecondaryPill(if (showForm) "Cancel" else "+ Invite", Modifier.padding(end = 8.dp)) { showForm = !showForm } },
    ) {
        ui.notice?.let { n ->
            item { InlineNotice(n, kind = if (ui.noticeIsError) NoticeKind.Error else NoticeKind.Success, actionLabel = "OK", onAction = actions.onDismissNotice) }
        }
        if (showForm) item { InviteForm(ui.online, ui.busy) { email, role -> actions.onInvite(email, role) } }
        item {
            LoadableContent(ui.relationships, onRetry = actions.onRetry) { rel -> ConnectionsBody(rel, ui.myId, ui.busy, actions) { text, run -> confirm = text to run } }
        }
    }
    confirm?.let { (text, run) ->
        ConfirmDialog(text, "", confirmLabel = "Yes", onConfirm = run, onDismiss = { confirm = null }, danger = true)
    }
}

@Composable
private fun ConnectionsBody(rel: MyRelationshipsDto, myId: String?, busy: Boolean, actions: ConnectionsActions, confirm: (String, () -> Unit) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (rel.pending_incoming.isNotEmpty()) {
            SectionHeader("Pending Requests")
            for (r in rel.pending_incoming) {
                PendingCard(r, myId, pendingDescription(r, myId)) {
                    PrimaryPill("Accept", Modifier.weight(1f).height(48.dp), enabled = !busy) { actions.onAccept(r.id) }
                    SecondaryPill("Decline", Modifier.weight(1f), enabled = !busy) { confirm("Decline this request?") { actions.onRemove(r.id) } }
                }
            }
        }
        if (rel.pending_outgoing.isNotEmpty()) {
            SectionHeader("Sent Requests")
            for (r in rel.pending_outgoing) {
                val other = r.other(myId) ?: r.recipient
                PendingCard(r, myId, "Waiting for ${other?.name ?: other?.email ?: "them"} to accept") {
                    SecondaryPill("Cancel", Modifier.weight(1f), enabled = !busy) { confirm("Cancel this request?") { actions.onRemove(r.id) } }
                }
            }
        }
        if (rel.pending_invitations.isNotEmpty()) {
            SectionHeader("Pending Invitations")
            Text("Waiting for these people to sign up", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            for (inv in rel.pending_invitations) InvitationCard(inv, busy) { confirm("Cancel this invitation?") { actions.onCancelInvitation(inv.id) } }
        }
        if (rel.tutors.isNotEmpty()) {
            SectionHeader("My Tutors")
            LabCard {
                rel.tutors.forEachIndexed { i, r ->
                    if (i > 0) RowDivider()
                    val other = r.other(myId) ?: if (r.requester_role == "tutor") r.requester else r.recipient
                    val isClaude = other?.id == CLAUDE_USER_ID
                    PersonRow(
                        name = other.displayName() + if (isClaude) " · AI" else "",
                        sub = if (isClaude) "Practice Chinese conversations" else other?.email,
                        avatarName = other?.name, avatarEmail = other?.email, isClaude = isClaude,
                        modifier = Modifier.testTag("connection-tutor"),
                        trailing = { StatusPill("Tutor", Palette.Easy) },
                        onClick = { actions.onOpen(r.id) },
                    )
                }
            }
        }
        val empty = rel.tutors.isEmpty() && rel.pending_incoming.isEmpty() && rel.pending_outgoing.isEmpty() && rel.pending_invitations.isEmpty()
        if (empty) {
            Text(
                "No one is connected yet. Invite someone who already has an account by email.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
                modifier = Modifier.padding(vertical = 24.dp).testTag("connections-empty"),
            )
        }
    }
}

/** web getPendingDescription: only for requests someone else sent. */
fun pendingDescription(r: RelationshipDto, myId: String?): String {
    if (r.requester_id == myId) return ""
    val name = r.requester?.name?.takeIf { it.isNotBlank() } ?: r.requester?.email ?: "Someone"
    return if (r.requester_role == "tutor") "$name wants to be your tutor" else "$name wants you to be their tutor"
}

@Composable
private fun PendingCard(r: RelationshipDto, myId: String?, description: String, buttons: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val other = r.other(myId) ?: r.requester
    LabCard(Modifier.testTag("connection-pending")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(other?.name, other?.email)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(other.displayName(), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    other?.email?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
                }
            }
            if (description.isNotEmpty()) Text(description, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically, content = buttons)
        }
    }
}

@Composable
private fun InvitationCard(inv: PendingInvitationDto, busy: Boolean, onCancel: () -> Unit) {
    LabCard {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(null, inv.recipient_email)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(inv.recipient_email, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Text("Not signed up yet · invited as your ${if (inv.inviter_role == "tutor") "student" else "tutor"}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
            SecondaryPill("Cancel", enabled = !busy, onClick = onCancel)
        }
    }
}

@Composable
private fun InviteForm(online: Boolean, busy: Boolean, onSend: (String, String) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("tutor") }
    LabCard(Modifier.testTag("invite-form")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Invite Someone", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            Text("Enter the email of someone who already uses the app.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            OutlinedTextField(
                email, { email = it },
                label = { Text("Their Email") },
                placeholder = { Text("email@example.com") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            Text("I want to be their...", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LabChip("Tutor · I'll teach them", selected = role == "tutor") { role = "tutor" }
                LabChip("Student · They'll teach me", selected = role == "student") { role = "student" }
            }
            if (!online) InlineNotice("You're offline. Invites can't be sent right now.", kind = NoticeKind.Offline)
            PrimaryPill(if (busy) "Sending..." else "Send Invite", Modifier.fillMaxWidth().height(52.dp), enabled = online && !busy && email.isNotBlank()) { onSend(email.trim(), role) }
        }
    }
}

/** Avatar · name + one line · trailing · chevron — a person in a list. */
@Composable
fun PersonRow(
    name: String,
    sub: String?,
    avatarName: String?,
    avatarEmail: String?,
    modifier: Modifier = Modifier,
    isClaude: Boolean = false,
    trailing: @Composable () -> Unit = {},
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 64.dp).then(if (onClick != null) Modifier.bouncyClickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(avatarName, avatarEmail, isClaude = isClaude)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1)
            if (!sub.isNullOrBlank()) Text(sub, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1)
        }
        trailing()
        if (onClick != null) Text("  ›", color = Lab.colors.muted, style = MaterialTheme.typography.titleLarge)
    }
}
