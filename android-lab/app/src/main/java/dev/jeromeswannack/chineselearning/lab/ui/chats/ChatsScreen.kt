package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeInbox
import dev.jeromeswannack.chineselearning.lab.ui.chat.chatColors
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.profile.ProfilePhoto
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Signal's blue — the inbox's accents (unread badges, times, the new-chat pencil). */
private val SignalBlue: Color
    @Composable get() = chatColors().mine // the chat screens' own blue (#2c6bed light)

/** Someone I can message (the ✏️ picker): opens the one chat with them. */
data class ChatPerson(val relationshipId: String, val name: String, val pictureUrl: String? = null, val role: String? = null)

data class ChatsUi(
    /** False until the cached chats with people (or the first fetch) are in. */
    val loaded: Boolean = false,
    val rows: List<ChatListRow> = emptyList(),
    /** The Claude threads (the list on the phone + threads started offline). */
    val threads: List<ClaudeInbox.Thread> = emptyList(),
    /** False until the thread list was cached / fetched once (true offline: nothing more will come). */
    val threadsLoaded: Boolean = true,
    val myId: String? = null,
    val query: String = "",
    val nowMs: Long = System.currentTimeMillis(),
    /** The device's offset, minutes east of UTC (chatRelativeTime). */
    val offsetMinutes: Int = 0,
    /** A failed fetch with nothing cached. */
    val error: String? = null,
    val offline: Boolean = false,
    /** People with an active relationship (new chat). */
    val people: List<ChatPerson> = emptyList(),
    val pickerOpen: Boolean = false,
    /** "🎭 Practice a situation" is open (drawn by the route: ChatsNav). */
    val practiceOpen: Boolean = false,
    /** A tutor account / an account with students: no pinning, a box with Ask · Translate only. */
    val teacher: Boolean = false,
    /** The Claude row (its key) whose context emoji's popover is open. */
    val contextInfo: String? = null,
    /** The box at the bottom. */
    val draft: String = "",
    val sending: Boolean = false,
    val sendError: String? = null,
    /** Each new value > 0: the box opens, typing (More → Ask Claude, `/coach`, ✏️ → ✦ Claude). */
    val composeRequest: Int = 0,
    /** Ask Claude's answer language (the box's 🎤 listens in it). */
    val language: String = "zh",
    /** The tutor's view: per student relationship, his chats with Claude she may read written in today. */
    val claudeToday: Map<String, Int> = emptyMap(),
) {
    /** People and Claude in one list (a learner's unread tutor chats pinned). */
    val items: List<ClaudeInbox.Item> get() = ClaudeInbox.merge(rows, threads, pinUnreadTutors = !teacher)

    /** What the list shows: the search. */
    val shown: List<ClaudeInbox.Item> get() = ClaudeInbox.search(items, query)
}

class ChatsActions(
    /** A row (a chat with a person, or with Claude). */
    val onOpen: (ClaudeInbox.Item) -> Unit = {},
    /** A Claude row's context popover → "Open card ›": that card's hub (the note id). */
    val onCard: (String) -> Unit = {},
    /** "Open story ›" / "Open lesson ›" (a reader page, an exercise) — and "✦ Asked Claude 3× today": a path. */
    val onPath: (String) -> Unit = {},
    val onQuery: (String) -> Unit = {},
    /** A Claude row's context emoji: its popover (the row's key), or null to close it. */
    val onContextInfo: (String?) -> Unit = {},
    val onNewChat: () -> Unit = {},
    /** The picker's "✦ Claude": the box, typing. */
    val onPickClaude: () -> Unit = {},
    /** The picker's "🎭 Practice a situation…": the situation sheet. */
    val onPickPractice: () -> Unit = {},
    val onPick: (ChatPerson) -> Unit = {},
    val onDismissPicker: () -> Unit = {},
    val onConnections: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val compose: ChatsComposeActions = ChatsComposeActions(),
)

object ChatsTags {
    const val SEARCH = "chats-search"
    const val NEW = "chats-new"
    const val NEW_CLAUDE = "chats-new-claude"
    const val NEW_PRACTICE = "chats-new-practice"
    const val CONTEXT_CHIP = "chats-context-chip"
    const val CONTEXT_POP = "chats-context-pop"
    const val CONTEXT_OPEN = "chats-context-open"
    const val DIVIDER = "chats-divider"
    const val EMPTY = "chats-empty"
    fun item(key: String) = "chats-item-$key"
    /** The avatar, which carries the kind in words ("Tutor", "Claude") for screen readers. */
    fun kind(key: String) = "chats-kind-$key"
    fun status(key: String) = "chats-status-$key"
}

/**
 * The Chats tab (`/chats`; docs/CHAT.md "Chats tab — one list for people and Claude"; the web's
 * pages/ChatsPage.tsx): the chats with people first (a learner's unread tutor chats on top), a thin
 * full-width divider, then the chats with Claude ([ClaudeInbox.merge] + [ClaudeInbox.sections]).
 * Compact one-line rows (~60 dp): avatar, name, time, unread — a Claude row adds ONE context emoji
 * (📇 / 📖 / 🧩 / 🎭 / ✏️ …) whose popover has the full text and "Open card ›". No previews, no filter
 * chips, no outlines (Jerome, Nov 2026). The sections + avatars carry the kind — never colour (Jerome is
 * red / green colour-blind); the avatar says it in words for TalkBack. The box at the bottom
 * ([ChatsComposer]) always goes to Claude.
 *
 * A tutor account / an account with students ([ChatsUi.teacher]): the same layout, no pinning, a
 * box with Ask · Translate only.
 */
@Composable
fun ChatsScreen(ui: ChatsUi, actions: ChatsActions, voicePreview: VoiceDictationUi? = null) {
    val items = ui.items
    val shown = ui.shown
    LabScreenFrame { Column(Modifier.fillMaxSize()) {
        ScreenTitle("Chats", actions = {
            IconButton(onClick = actions.onNewChat, modifier = Modifier.testTag(ChatsTags.NEW)) {
                Icon(Icons.Outlined.Edit, "New chat", tint = SignalBlue)
            }
        })
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(bottom = 8.dp)) {
            if (items.isNotEmpty() || ui.query.isNotEmpty()) item(key = "search") { SearchField(ui.query, actions.onQuery) }
            if (ui.offline && ui.loaded) item(key = "offline") {
                Text(
                    "Offline — showing your chats as they were at the last sync.",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
            when {
                items.isEmpty() && !ui.loaded && ui.error != null -> item(key = "error") { ErrorState(ui.error, onRetry = actions.onRetry) }
                items.isEmpty() && !ui.offline && (!ui.loaded || !ui.threadsLoaded) -> item(key = "loading") { LoadingState() }
                items.isEmpty() -> item(key = "empty") { EmptyInbox(noPeople = ui.people.isEmpty(), offline = ui.offline && !ui.loaded, onConnections = actions.onConnections) }
                shown.isEmpty() -> item(key = "no-match") {
                    Text(
                        if (ui.query.isNotBlank()) "No chats match “${ui.query.trim()}”." else "Nothing here yet.",
                        style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 24.dp),
                    )
                }
                else -> sectionedList(ui, shown, actions)
            }
        }
        ChatsComposer(ui, actions.compose, compact = ui.teacher, voicePreview = voicePreview)
    } }
    if (ui.pickerOpen) PersonPicker(ui.people, actions)
}

/** The people (tutors / students), a thin full-width divider, then the Claude chats. */
private fun LazyListScope.sectionedList(ui: ChatsUi, shown: List<ClaudeInbox.Item>, actions: ChatsActions) {
    val sections = ClaudeInbox.sections(shown)
    items(sections.people, key = { it.key }) { item -> InboxRow(item, ui, actions) }
    if (sections.people.isNotEmpty() && sections.claude.isNotEmpty()) item(key = "divider") {
        HorizontalDivider(Modifier.padding(vertical = 4.dp).testTag(ChatsTags.DIVIDER), thickness = 1.dp, color = Lab.colors.outline.copy(alpha = 0.6f))
    }
    items(sections.claude, key = { it.key }) { item -> InboxRow(item, ui, actions) }
}

@Composable
private fun EmptyInbox(noPeople: Boolean, offline: Boolean, onConnections: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 32.dp).testTag(ChatsTags.EMPTY),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        ClaudeAvatar(64.dp)
        Text(
            "Ask Claude anything in the box below — in Chinese or English.",
            style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center,
        )
        if (offline) Text("You're offline — your chats will appear here after the next sync with a connection.", color = Lab.colors.muted, textAlign = TextAlign.Center)
        if (noPeople && !offline) {
            Text("No chats with people yet.", color = Lab.colors.muted, textAlign = TextAlign.Center)
            SecondaryPill("Connect with a tutor or student", onClick = onConnections)
        }
    }
}

@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit) {
    TextField(
        value = query,
        onValueChange = onQuery,
        placeholder = { Text("Search", color = Lab.colors.muted) },
        leadingIcon = { Text("🔍", fontSize = 15.sp) },
        trailingIcon = if (query.isNotEmpty()) {
            { Text("✕", color = Lab.colors.muted, modifier = Modifier.clip(CircleShape).clickable { onQuery("") }.padding(12.dp)) }
        } else null,
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        shape = RoundedCornerShape(24.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Lab.colors.faint,
            unfocusedContainerColor = Lab.colors.faint,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            cursorColor = SignalBlue,
            focusedTextColor = Lab.colors.ink,
            unfocusedTextColor = Lab.colors.ink,
        ),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag(ChatsTags.SEARCH),
    )
}

/** Where a Claude row's context leads ("Open card ›" → the card hub, a reader page, a lesson), or null. */
private fun contextTarget(item: ClaudeInbox.Item, actions: ChatsActions): Pair<String, () -> Unit>? {
    val link = item.thread?.let { ClaudeChats.headerChipFor(it.context)?.link } ?: return null
    val label = ClaudeInbox.contextOpenLabel(link.kind) ?: return null
    val go: () -> Unit = when (link.kind) {
        ClaudeChats.CARD -> link.noteId?.let { id -> { actions.onCard(id) } }
        ClaudeChats.READER -> link.readerId?.let { id -> { actions.onPath(dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.reader(id, link.page)) } }
        ClaudeChats.EXERCISE -> link.lessonId?.let { id -> { actions.onPath(dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.lessonPlay(id, from = "claude")) } }
        else -> null
    } ?: return null
    return label to go
}

/**
 * One compact row (~60 dp): the avatar (a photo / ✦ — it says the kind to TalkBack), the name on one
 * line, a Claude row's ONE context emoji (its popover: the full text + "Open card ›"), the time (or a
 * Claude row's "Writing…" / "Failed"), the unread count. A student's row (the tutor's view) adds
 * "✦ Asked Claude 3× today".
 */
@Composable
private fun InboxRow(item: ClaudeInbox.Item, ui: ChatsUi, actions: ChatsActions) {
    val name = ClaudeInbox.rowName(item)
    val unread = item.unread > 0
    val thread = item.thread
    val status = thread?.let { ClaudeInbox.claudeRowStatus(it.pending, it.failed, it.local) }
    val kindWord = ClaudeInbox.rowLabel(item.kind).text
    Column(Modifier.fillMaxWidth().testTag(ChatsTags.item(item.key))) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 60.dp)
                .clickable(role = Role.Button) { actions.onOpen(item) }
                .padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.semantics { contentDescription = kindWord }.testTag(ChatsTags.kind(item.key))) {
                if (item.kind == ClaudeInbox.CLAUDE) ClaudeAvatar(40.dp) else item.human?.let { ChatAvatar(it, 40.dp) }
            }
            Spacer(Modifier.width(12.dp))
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name, color = Lab.colors.ink, fontSize = 16.sp,
                    fontWeight = if (unread) FontWeight.Bold else FontWeight.Medium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                )
                item.badge?.let { ContextEmoji(item, it, ui.contextInfo == item.key, actions) }
            }
            Spacer(Modifier.width(8.dp))
            if (status != null) {
                Text(
                    "${status.icon} ${status.short}", fontSize = 12.sp, maxLines = 1,
                    color = if (status == ClaudeInbox.ROW_FAILED) Lab.colors.ink else Lab.colors.muted,
                    fontWeight = if (status == ClaudeInbox.ROW_FAILED) FontWeight.SemiBold else FontWeight.Normal,
                    modifier = Modifier.semantics { contentDescription = status.text }.testTag(ChatsTags.status(item.key)),
                )
            } else {
                val time = ChatInbox.relativeTime(item.activityAt, ui.nowMs, ui.offsetMinutes)
                Text(time, fontSize = 12.sp, color = if (unread) SignalBlue else Lab.colors.muted, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1)
            }
            if (unread) {
                Spacer(Modifier.width(8.dp))
                UnreadPill(item.unread)
            }
        }
        // A student's row (the tutor's view): "✦ Asked Claude 3× today" → his shared Claude chats.
        if (item.kind == ClaudeInbox.STUDENT) item.human?.let { h ->
            Box(Modifier.padding(start = 68.dp, end = 16.dp)) {
                dev.jeromeswannack.chineselearning.lab.ui.teaching.AskedClaudeTodayLine(h.relationshipId, ui.claudeToday[h.relationshipId] ?: 0, actions.onPath)
            }
        }
    }
}

/** A Claude row's ONE context emoji (40 dp target): tap → a small popover with the full text and "Open card ›". */
@Composable
private fun ContextEmoji(item: ClaudeInbox.Item, badge: ClaudeChats.Badge, open: Boolean, actions: ChatsActions) {
    val target = contextTarget(item, actions)
    Box {
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(if (open) Lab.colors.faint else Color.Transparent)
                .clickable(role = Role.Button, onClickLabel = "Show where this chat started") { actions.onContextInfo(if (open) null else item.key) }
                .semantics { contentDescription = badge.text }
                .testTag(ChatsTags.CONTEXT_CHIP),
            contentAlignment = Alignment.Center,
        ) { Text(badge.icon, fontSize = 15.sp) }
        DropdownMenu(
            expanded = open,
            onDismissRequest = { actions.onContextInfo(null) },
            shape = RoundedCornerShape(12.dp),
            containerColor = Lab.colors.card,
            modifier = Modifier.testTag(ChatsTags.CONTEXT_POP),
        ) {
            Text(
                "${badge.icon} ${badge.text}", color = Lab.colors.ink, fontSize = 14.sp,
                modifier = Modifier.widthIn(max = 280.dp).padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (target != null) {
                DropdownMenuItem(
                    text = { Text("${target.first} ›", color = SignalBlue, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) },
                    onClick = {
                        actions.onContextInfo(null)
                        target.second()
                    },
                    modifier = Modifier.testTag(ChatsTags.CONTEXT_OPEN),
                )
            }
        }
    }
}

@Composable
private fun UnreadPill(count: Int) {
    Box(
        Modifier.heightIn(min = 22.dp).widthIn(min = 22.dp).clip(RoundedCornerShape(11.dp)).background(SignalBlue).padding(horizontal = 7.dp)
            .semantics { contentDescription = "$count unread" }.testTag("chat-unread"),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

private val AVATAR_COLORS = listOf(Color(0xFF5B8DEF), Color(0xFFE0716B), Color(0xFF4CAF84), Color(0xFFB77FE0), Color(0xFFE0A84C))

/** The other person's picture, else a coloured circle with their initial (✦ for Claude). */
@Composable
fun ChatAvatar(row: ChatListRow, size: Dp) {
    val url = row.otherUser.pictureUrl
    when {
        row.isAi -> ClaudeAvatar(size)
        !url.isNullOrBlank() -> ProfilePhoto(url, row.otherUser.name, size = size)
        else -> PersonInitial(row.otherUser.name, size)
    }
}

/** Claude's avatar: ✦ on an orange gradient (the web's `.chats-avatar-claude`). */
@Composable
fun ClaudeAvatar(size: Dp) {
    Box(
        Modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFFD97757), Color(0xFFB8532F)))),
        contentAlignment = Alignment.Center,
    ) {
        Text("✦", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.42f).sp)
    }
}

@Composable
private fun PersonInitial(name: String?, size: Dp) {
    val display = ChatInbox.personName(name)
    Box(Modifier.size(size).clip(CircleShape).background(AVATAR_COLORS[Math.floorMod(display.hashCode(), AVATAR_COLORS.size)]), contentAlignment = Alignment.Center) {
        Text(ChatInbox.initial(name), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.42f).sp)
    }
}

/** ✏️ "New chat with…": ✦ Claude first (the box, typing), 🎭 Practice a situation…, then each person (THE chat with them). */
@Composable
private fun PersonPicker(people: List<ChatPerson>, actions: ChatsActions) {
    LabBottomSheet(onDismiss = actions.onDismissPicker, title = "New chat with…") {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(onClick = actions.onPickClaude).padding(horizontal = 20.dp, vertical = 8.dp).testTag(ChatsTags.NEW_CLAUDE),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ClaudeAvatar(44.dp)
            Spacer(Modifier.width(18.dp))
            Column(Modifier.weight(1f)) {
                Text("✦ Claude", color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Text("Ask anything", color = Lab.colors.muted, fontSize = 13.sp)
            }
        }
        HorizontalDivider(Modifier.padding(start = 82.dp), color = Lab.colors.faint)
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(onClick = actions.onPickPractice).padding(horizontal = 20.dp, vertical = 8.dp).testTag(ChatsTags.NEW_PRACTICE),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(Color(0xFFD97706).copy(alpha = 0.14f)), contentAlignment = Alignment.Center) { Text("🎭", fontSize = 20.sp) }
            Spacer(Modifier.width(18.dp))
            Column(Modifier.weight(1f)) {
                Text("🎭 Practice a situation…", color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Text("A role-play with Claude", color = Lab.colors.muted, fontSize = 13.sp)
            }
        }
        people.forEach { p ->
            HorizontalDivider(Modifier.padding(start = 82.dp), color = Lab.colors.faint)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable { actions.onPick(p) }.padding(horizontal = 20.dp, vertical = 8.dp).testTag("chat-pick-${p.relationshipId}"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!p.pictureUrl.isNullOrBlank()) ProfilePhoto(p.pictureUrl, p.name, size = 44.dp) else PersonInitial(p.name, 44.dp)
                Spacer(Modifier.width(18.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.name, color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (p.role != null) Text(if (p.role == "Your tutor") "🧑‍🏫 ${p.role}" else "🎓 ${p.role}", color = Lab.colors.muted, fontSize = 13.sp)
                }
            }
        }
        if (people.isEmpty()) {
            InlineNotice("No chats with people yet — connect with a tutor or student.", Modifier.padding(16.dp), actionLabel = "Connections", onAction = actions.onConnections)
        }
    }
}
