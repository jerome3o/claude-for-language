package dev.jeromeswannack.chineselearning.lab.ui.connections

import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.FlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.FlagsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.PracticeConversationBody
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.SharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentSharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

data class TutorPageUi(
    /** A video call in progress in this relationship (Join banner). */
    val liveCallId: String? = null,
    /** "王老师 is calling" (CallAlerts.pickCallBanner) and whether they started it. */
    val liveCallTitle: String? = null,
    val liveCallIncoming: Boolean = true,
    val callBusy: Boolean = false,
    val relationship: Loadable<RelationshipDto> = Loadable(loading = true),
    val myId: String? = null,
    val conversations: Loadable<List<ChatConversationDto>> = Loadable(loading = true),
    val flags: Loadable<FlagsDto> = Loadable(loading = true),
    val sharedDecks: Loadable<List<SharedDeckDto>> = Loadable(loading = true),
    val studentSharedDecks: List<StudentSharedDeckDto> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
    val online: Boolean = true,
    /** Fixed clock for the tutor's local time (screenshots); null = live. */
    val now: java.time.Instant? = null,
    /** Draws the tutor's photo directly (screenshots). */
    val previewPhoto: androidx.compose.ui.graphics.ImageBitmap? = null,
)

class TutorPageActions(
    val onBack: () -> Unit = {},
    val onMessage: () -> Unit = {},
    val onNewPracticeConversation: (PracticeConversationBody) -> Unit = {},
    val onVideoCall: () -> Unit = {},
    val onJoinCall: (String) -> Unit = {},
    val onOpenConversation: (String) -> Unit = {},
    val onOpenCard: (noteId: String) -> Unit = {},
    val onToggleFlag: (FlagDto) -> Unit = {},
    val onDeleteFlag: (FlagDto) -> Unit = {},
    val onOpenClaudeChats: () -> Unit = {},
    val onRemoveConnection: () -> Unit = {},
    val onRetry: () -> Unit = {},
)

/**
 * `/connections/:relId` seen by the student (web: ConnectionDetailPage, "Student's tutor page /
 * Claude"): Message, video call, conversations, cards you flagged, homework decks, decks you
 * shared; ⋯ → Remove connection. The Claude practice partner gets "New practice conversation".
 */
@Composable
fun TutorPageScreen(ui: TutorPageUi, actions: TutorPageActions) {
    var menu by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }
    var newConv by rememberSaveable { mutableStateOf(false) }
    val rel = ui.relationship.data
    val other = rel?.other(ui.myId)
    val isClaude = other?.id == CLAUDE_USER_ID
    LabScreen(
        "",
        onBack = actions.onBack,
        actions = { IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More", tint = Lab.colors.muted) } },
    ) {
        if (rel == null) {
            item { LoadableContent(ui.relationship, onRetry = actions.onRetry) {} }
            return@LabScreen
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isClaude || other?.picture_url.isNullOrBlank()) Avatar(other?.name, other?.email, size = 64.dp, isClaude = isClaude)
                else dev.jeromeswannack.chineselearning.lab.ui.profile.ProfilePhoto(other?.picture_url, other?.name, other?.email, size = 64.dp, preview = ui.previewPhoto)
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(other.displayName(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                    Text(if (isClaude) "Practice Chinese conversations" else "Your tutor", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                }
            }
        }
        if (!isClaude && (!other?.about.isNullOrBlank() || !other?.time_zone.isNullOrBlank())) item {
            dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard {
                dev.jeromeswannack.chineselearning.lab.ui.profile.PersonAbout(other?.about, other?.time_zone, Modifier.padding(horizontal = 16.dp, vertical = 12.dp), now = ui.now)
            }
        }
        if (!isClaude && ui.liveCallId != null) item {
            dev.jeromeswannack.chineselearning.lab.ui.calls.InlineCallBanner(ui.liveCallId, ui.liveCallTitle, ui.liveCallIncoming) { actions.onJoinCall(ui.liveCallId) }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryPill(if (isClaude) "💬 New practice conversation" else "💬 Message", Modifier.weight(1f).height(52.dp), enabled = !ui.busy) {
                    if (isClaude) newConv = true else actions.onMessage()
                }
                if (!isClaude) SecondaryPill(if (ui.callBusy) "Starting…" else "📹 Video call", Modifier.weight(0.8f), enabled = !ui.callBusy) { actions.onVideoCall() }
            }
        }
        ui.error?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }

        item { SectionHeader("Conversations") }
        item {
            LoadableContent(ui.conversations, onRetry = actions.onRetry, isEmpty = { it.isEmpty() }, empty = {
                EmptyState("💬", "No conversations yet", body = "Send a message to get started", actionLabel = "Message", onAction = { if (isClaude) newConv = true else actions.onMessage() })
            }) { list -> ConversationList(list, actions.onOpenConversation) }
        }

        if (!isClaude) {
            item { FlagsSection(ui.flags, actions) }
            item { SectionHeader("Homework from your tutor") }
            item {
                LoadableContent(ui.sharedDecks, onRetry = actions.onRetry, isEmpty = { it.isEmpty() }, empty = {
                    EmptyState("📚", "No shared decks", body = "Your tutor hasn't shared any decks yet")
                }) { decks ->
                    LabCard {
                        decks.forEachIndexed { i, d ->
                            if (i > 0) RowDivider()
                            NavRow("📚", d.source_deck_name.ifEmpty { d.target_deck_name }, desc = "Shared ${Fmt.conversationDate(d.shared_at)}")
                        }
                    }
                }
            }
            if (ui.studentSharedDecks.isNotEmpty()) {
                item { SectionHeader("Decks you shared") }
                item {
                    LabCard {
                        ui.studentSharedDecks.forEachIndexed { i, d ->
                            if (i > 0) RowDivider()
                            NavRow("📤", d.deck_name, desc = "${d.note_count} notes • Shared ${Fmt.conversationDate(d.shared_at)}")
                        }
                    }
                }
            }
            item { LabCard { NavRow("🤖", "Your Claude conversations", desc = "Everything you asked Claude about your cards", onClick = actions.onOpenClaudeChats) } }
        }
    }
    if (menu) {
        LabBottomSheet(onDismiss = { menu = false }) {
            NavRow("🗑️", "Remove connection", danger = true, onClick = { menu = false; confirmRemove = true })
        }
    }
    if (confirmRemove) {
        ConfirmDialog(
            "Remove this connection?",
            "Chat history and shared decks will no longer be accessible.",
            confirmLabel = "Remove",
            onConfirm = actions.onRemoveConnection,
            onDismiss = { confirmRemove = false },
            danger = true,
        )
    }
    if (newConv) NewPracticeConversationSheet(onDismiss = { newConv = false }, busy = ui.busy) { newConv = false; actions.onNewPracticeConversation(it) }
}

@Composable
fun ConversationList(list: List<ChatConversationDto>, onOpen: (String) -> Unit) {
    LabCard(Modifier.testTag("conversations")) {
        list.forEachIndexed { i, c ->
            if (i > 0) RowDivider()
            Row(
                Modifier.fillMaxWidth().heightIn(min = 60.dp).bouncyClickable { onOpen(c.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(c.title?.takeIf { it.isNotBlank() } ?: "Chat", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1)
                    c.last_message?.let {
                        Text(it.content.take(50) + if (it.content.length > 50) "..." else "", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Spacer(Modifier.width(8.dp))
                Text(Fmt.conversationDate(c.last_message_at ?: c.created_at), style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
            }
        }
    }
}

/** "🚩 Cards you flagged": open first, resolved behind a toggle (web: FlaggedCardsSection role=student). */
@Composable
fun FlagsSection(flags: Loadable<FlagsDto>, actions: TutorPageActions) {
    var showResolved by rememberSaveable { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<FlagDto?>(null) }
    val data = flags.data
    val open = data?.flags.orEmpty().filter { it.status == "open" }
    val resolved = data?.flags.orEmpty().filter { it.status != "open" }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.testTag("flagged-cards-section")) {
        SectionHeader("🚩 Cards you flagged" + if (open.isNotEmpty()) " (${open.size})" else "")
        LoadableContent(flags, onRetry = actions.onRetry) {
            if (open.isEmpty()) {
                Text(
                    "Nothing waiting. On the back of a card during study, ⋯ → Flag for tutor sends a note with a link to that card.",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                )
            } else open.forEach { FlagCard(it, actions) { confirmDelete = it } }
            if (resolved.isNotEmpty()) {
                Text(
                    (if (showResolved) "Hide" else "Show") + " ${resolved.size} resolved",
                    color = Lab.colors.accent, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.bouncyClickable { showResolved = !showResolved }.padding(vertical = 10.dp),
                )
                if (showResolved) resolved.forEach { FlagCard(it, actions) { confirmDelete = it } }
            }
        }
    }
    confirmDelete?.let { f ->
        ConfirmDialog("Delete this flag?", "Your tutor keeps the chat message.", "Delete", onConfirm = { actions.onDeleteFlag(f) }, onDismiss = { confirmDelete = null }, danger = true)
    }
}

@Composable
private fun FlagCard(flag: FlagDto, actions: TutorPageActions, onDelete: () -> Unit) {
    LabCard(Modifier.testTag("card-flag")) {
        Row(
            Modifier.fillMaxWidth().bouncyClickable { actions.onOpenCard(flag.note_id) }.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(flag.hanzi, fontSize = 26.sp, color = Lab.colors.ink)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(flag.pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent)
                Text(flag.english, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("›", color = Lab.colors.muted, fontSize = 22.sp)
        }
        RowDivider()
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusPill(
                    if (flag.status == "open") "Waiting for a reply" else if (flag.tutor_reply != null) "Replied" else "Resolved",
                    if (flag.status == "open") Palette.Hard else Palette.Good,
                )
                Text("You flagged it ${Fmt.relativeDay(flag.created_at)} · ${flag.deck_name}", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(flag.message, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
            flag.tutor_reply?.let { reply ->
                Text(
                    "${flag.tutor_name ?: "Your tutor"} replied${flag.replied_at?.let { " " + Fmt.relativeDay(it) } ?: ""}: $reply",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill(if (flag.status == "open") "Resolve" else "Reopen", Modifier.weight(1f)) { actions.onToggleFlag(flag) }
                SecondaryPill("Delete", Modifier.weight(1f), danger = true, onClick = onDelete)
            }
        }
    }
}

/** Claude practice conversation: title, scenario, roles — all optional (web: New Conversation modal). */
@Composable
private fun NewPracticeConversationSheet(onDismiss: () -> Unit, busy: Boolean, onStart: (PracticeConversationBody) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var scenario by rememberSaveable { mutableStateOf("") }
    var userRole by rememberSaveable { mutableStateOf("") }
    var aiRole by rememberSaveable { mutableStateOf("") }
    LabBottomSheet(onDismiss = onDismiss, title = "New Practice Conversation") {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(title, { title = it }, label = { Text("Title (optional)") }, placeholder = { Text("e.g., Restaurant Practice") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(scenario, { scenario = it }, label = { Text("Scenario (optional)") }, placeholder = { Text("You are ordering food at a Chinese restaurant. The waiter only speaks Mandarin.") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            Text("This helps Claude understand the context for the conversation.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            OutlinedTextField(userRole, { userRole = it }, label = { Text("Your role (optional)") }, placeholder = { Text("e.g., A tourist visiting Beijing") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(aiRole, { aiRole = it }, label = { Text("Claude's role (optional)") }, placeholder = { Text("e.g., A friendly restaurant waiter") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            PrimaryPill(if (busy) "Creating..." else "Start Chat", Modifier.fillMaxWidth().height(52.dp), enabled = !busy) {
                onStart(PracticeConversationBody(title.trim().ifEmpty { null }, scenario.trim().ifEmpty { null }, userRole.trim().ifEmpty { null }, aiRole.trim().ifEmpty { null }))
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
