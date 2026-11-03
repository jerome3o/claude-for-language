package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
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
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
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
    /** Listening mode (docs/CHAT.md): the settings, and the ids revealed on this phone per conversation. */
    val listening: dev.jeromeswannack.chineselearning.lab.data.api.ListeningStateDto? = null,
    val revealed: Map<String, List<String>> = emptyMap(),
    /** A tutor account / an account with students: people first, "Your Claude chats" folded, a smaller box. */
    val teacher: Boolean = false,
    /** The filter chip picked (all · people · claude). */
    val filter: String = ClaudeInbox.ALL,
    /** The tutor's "✦ Your Claude chats" unfolded (per device). */
    val claudeOpen: Boolean = false,
    /** The box at the bottom. */
    val draft: String = "",
    val sending: Boolean = false,
    val sendError: String? = null,
    /** Each new value > 0: the box opens, typing (More → Ask Claude, `/coach`, ✏️ → ✦ Claude). */
    val composeRequest: Int = 0,
    /** Ask Claude's answer language (the box's 🎤 listens in it). */
    val language: String = "zh",
) {
    /** The row's last line: "🎧 New message" while listening mode hides it, else the usual preview. */
    fun previewOf(row: ChatListRow): String =
        dev.jeromeswannack.chineselearning.lab.data.chat.ChatListeningStore.inboxPreview(row, myId, listening, revealed[row.conversationId].orEmpty())
            ?: ChatInbox.rowPreview(row, myId)

    /** People and Claude in one list (a learner's unread tutor chats pinned). */
    val items: List<ClaudeInbox.Item> get() = ClaudeInbox.merge(rows, threads, pinUnreadTutors = !teacher)

    /** All · Tutor · ✦ Claude — a learner's, only when there are both. */
    val chips: List<ClaudeInbox.FilterChip> get() = if (teacher) emptyList() else ClaudeInbox.filters(items)

    val activeFilter: String get() = if (chips.any { it.id == filter }) filter else ClaudeInbox.ALL

    /** What the list shows: the filter, then the search. */
    val shown: List<ClaudeInbox.Item> get() {
        val byFilter = when (activeFilter) {
            ClaudeInbox.CLAUDE -> items.filter { it.kind == ClaudeInbox.CLAUDE }
            ClaudeInbox.PEOPLE -> items.filter { it.kind != ClaudeInbox.CLAUDE }
            else -> items
        }
        return ClaudeInbox.search(byFilter, query)
    }

    /** The composer's "To:" — each tutor once. */
    val recipients: List<ClaudeInbox.Recipient> get() = ClaudeInbox.composeRecipients(rows)
}

class ChatsActions(
    /** A row (a chat with a person, or with Claude). */
    val onOpen: (ClaudeInbox.Item) -> Unit = {},
    /** A Claude row's "📇 Asked on card · 银行" chip: that card's hub (the note id). */
    val onCard: (String) -> Unit = {},
    /** A reader page's / exercise's chip ("📖 Reader · 成都 p.3", "🧩 Exercise · Translate"): that page / lesson (a path). */
    val onPath: (String) -> Unit = {},
    val onQuery: (String) -> Unit = {},
    val onFilter: (String) -> Unit = {},
    val onToggleClaude: () -> Unit = {},
    val onNewChat: () -> Unit = {},
    /** The picker's "✦ Claude": the box, typing. */
    val onPickClaude: () -> Unit = {},
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
    const val CONTEXT_CHIP = "chats-context-chip"
    const val CLAUDE_SECTION = "chats-claude-section"
    const val EMPTY = "chats-empty"
    const val PEOPLE_TITLE = "chats-people-title"
    fun item(key: String) = "chats-item-$key"
    fun kind(key: String) = "chats-kind-$key"
    fun filter(id: String) = "chats-filter-$id"
}

/**
 * The Chats tab (`/chats`; docs/CHAT.md "Chats tab — one list for people and Claude"; the web's
 * pages/ChatsPage.tsx): ONE list of the chats with people and the chats with Claude
 * ([ClaudeInbox.merge]). Every row is its own outlined card with its kind written ON the outline —
 * "🧑‍🏫 TUTOR" (blue), "✦ CLAUDE" (orange), "🎓 STUDENT" (grey): the icon + the word are the signal,
 * the colour only a second one (Jerome is red / green colour-blind). A Claude row carries its context
 * chip (📇 Asked on card · 银行 → the card hub). A learner's unread tutor chats are pinned on top;
 * filter chips All · Tutor · ✦ Claude. The box at the bottom ([ChatsComposer]) sends to Claude, or
 * "To:" a tutor.
 *
 * A tutor account / an account with students ([ChatsUi.teacher]): people first under "Students",
 * newest first, no pinning, no chips; "✦ Your Claude chats (N)" folded; a smaller box.
 */
@Composable
fun ChatsScreen(ui: ChatsUi, actions: ChatsActions, voicePreview: VoiceDictationUi? = null) {
    val items = ui.items
    val shown = ui.shown
    val chips = ui.chips
    LabScreenFrame { Column(Modifier.fillMaxSize()) {
        ScreenTitle("Chats", actions = {
            IconButton(onClick = actions.onNewChat, modifier = Modifier.testTag(ChatsTags.NEW)) {
                Icon(Icons.Outlined.Edit, "New chat", tint = SignalBlue)
            }
        })
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(bottom = 16.dp)) {
            if (items.isNotEmpty() || ui.query.isNotEmpty()) item(key = "search") { SearchField(ui.query, actions.onQuery) }
            if (chips.isNotEmpty()) item(key = "filters") { FilterChips(chips, ui.activeFilter, actions.onFilter) }
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
                !ui.teacher -> items(shown, key = { it.key }) { item -> InboxRow(item, ui, actions) }
                else -> teacherList(ui, shown, actions)
            }
        }
        ChatsComposer(ui, actions.compose, compact = ui.teacher, voicePreview = voicePreview)
    } }
    if (ui.pickerOpen) PersonPicker(ui.people, actions)
}

/** The tutor's view: the people first ("Students" / "People"), then "✦ Your Claude chats (N)", folded. */
private fun LazyListScope.teacherList(ui: ChatsUi, shown: List<ClaudeInbox.Item>, actions: ChatsActions) {
    val sections = ClaudeInbox.teacherSections(shown)
    if (sections.people.isNotEmpty()) {
        val title = if (sections.people.all { it.kind == ClaudeInbox.STUDENT }) "Students" else "People"
        item(key = "people-title") {
            Text(
                title, style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 2.dp).testTag(ChatsTags.PEOPLE_TITLE),
            )
        }
        items(sections.people, key = { it.key }) { item -> InboxRow(item, ui, actions) }
    }
    if (sections.claude.isNotEmpty()) {
        val open = ui.claudeOpen || ui.query.isNotBlank()
        item(key = "claude-toggle") {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .heightIn(min = 52.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .bouncyClickable(pressedScale = 0.98f, role = Role.Button, onClick = actions.onToggleClaude)
                    .padding(horizontal = 8.dp)
                    .semantics { contentDescription = "Your Claude chats, ${sections.claude.size}, ${if (open) "open" else "folded"}" }
                    .testTag(ChatsTags.CLAUDE_SECTION),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (open) "▾" else "▸", color = Lab.colors.muted, fontSize = 16.sp)
                Spacer(Modifier.width(8.dp))
                Text("✦ Your Claude chats", color = Lab.colors.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.width(8.dp))
                Text(
                    sections.claude.size.toString(), color = Lab.colors.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 8.dp, vertical = 2.dp),
                )
                if (!open && sections.claude.any { it.unread > 0 }) {
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.size(10.dp).clip(CircleShape).background(SignalBlue).semantics { contentDescription = "unread replies" })
                }
            }
        }
        if (open) items(sections.claude, key = { it.key }) { item -> InboxRow(item, ui, actions) }
    }
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

@Composable
private fun FilterChips(chips: List<ClaudeInbox.FilterChip>, active: String, onFilter: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (c in chips) {
            LabChip(c.label, Modifier.testTag(ChatsTags.filter(c.id)), selected = c.id == active) { onFilter(c.id) }
        }
    }
}

/** The outline's colours per kind (light / dark, as the web's ChatsPage.css): outline, label. */
@Composable
private fun kindColors(kind: String): Pair<Color, Color> {
    val dark = chatColors().dark
    return when (kind) {
        ClaudeInbox.TUTOR -> if (dark) Color(0xFF6E9BFF) to Color(0xFF9DBBFF) else Color(0xFF2C6BED) to Color(0xFF1F56C8)
        ClaudeInbox.CLAUDE -> if (dark) Color(0xFFE8956F) to Color(0xFFF0B08F) else Color(0xFFD97757) to Color(0xFFA8482A)
        else -> Lab.colors.outline to Lab.colors.muted
    }
}

/** Claude's orange (the ✦ avatar, the context chip's edge). */
private val ClaudeOrange = Color(0xFFD97757)

/**
 * One row: an outlined card with its kind written on the outline (a fieldset legend: "🧑‍🏫 TUTOR",
 * "✦ CLAUDE"), the avatar, the name, the time, one line of preview, the unread count — and for a
 * Claude row its context chip.
 */
@Composable
private fun InboxRow(item: ClaudeInbox.Item, ui: ChatsUi, actions: ChatsActions) {
    val (outline, labelColor) = kindColors(item.kind)
    val label = ClaudeInbox.rowLabel(item.kind)
    val shape = RoundedCornerShape(16.dp)
    val width = if (item.kind == ClaudeInbox.STUDENT) 1.5.dp else 2.dp
    val name = ClaudeInbox.rowName(item)
    Box(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 6.dp).testTag(ChatsTags.item(item.key))) {
        Column(
            Modifier
                .padding(top = 10.dp)
                .fillMaxWidth()
                .clip(shape)
                .background(Lab.colors.card)
                .then(if (item.pinned) Modifier.background(outline.copy(alpha = 0.07f)) else Modifier)
                .border(width, outline, shape)
                .bouncyClickable(pressedScale = 0.985f, role = Role.Button) { actions.onOpen(item) }
                .padding(start = 14.dp, end = 14.dp, top = 16.dp, bottom = 12.dp)
                .animateContentSize(),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (item.kind == ClaudeInbox.CLAUDE) ClaudeAvatar(48.dp) else item.human?.let { ChatAvatar(it, 48.dp) }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) { RowBody(item, name, ui, actions) }
            }
        }
        // The kind, written on the outline (icon + word: never the colour alone).
        Text(
            "${label.icon} ${label.text.uppercase()}",
            color = labelColor, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.7.sp, maxLines = 1,
            modifier = Modifier
                .offset(x = 14.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Lab.colors.background)
                .padding(horizontal = 6.dp, vertical = 2.dp)
                .testTag(ChatsTags.kind(item.key)),
        )
    }
}

@Composable
private fun RowBody(item: ClaudeInbox.Item, name: String, ui: ChatsUi, actions: ChatsActions) {
    val unread = item.unread > 0
    val thread = item.thread
    val time = ChatInbox.relativeTime(item.activityAt, ui.nowMs, ui.offsetMinutes)
    val preview = when {
        thread != null -> ClaudeInbox.claudeRowPreview(thread.preview, thread.pending, thread.failed, thread.local, thread.title)
        item.kind == ClaudeInbox.CLAUDE -> item.human?.lastMessage?.preview?.takeIf { it.isNotBlank() } ?: "No messages yet"
        else -> ui.previewOf(item.human!!)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            name, color = Lab.colors.ink, fontSize = 17.sp,
            fontWeight = if (unread) FontWeight.Bold else FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        Text(time, fontSize = 13.sp, color = if (unread) SignalBlue else Lab.colors.muted, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1)
    }
    if (preview.isNotEmpty() || unread) {
        Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                preview, fontSize = 15.sp,
                color = if (unread) Lab.colors.ink else Lab.colors.muted,
                fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            if (unread) {
                Spacer(Modifier.width(8.dp))
                UnreadPill(item.unread)
            }
        }
    }
    item.badge?.let { badge ->
        val link = thread?.let { ClaudeChats.headerChipFor(it.context)?.link }
        val onClick: (() -> Unit)? = when (link?.kind) {
            ClaudeChats.CARD -> link.noteId?.let { id -> { actions.onCard(id) } }
            ClaudeChats.READER -> link.readerId?.let { id -> { actions.onPath(dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.reader(id, link.page)) } }
            ClaudeChats.EXERCISE -> link.lessonId?.let { id -> { actions.onPath(dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.lessonPlay(id, from = "claude")) } }
            else -> null
        }
        ContextChip(badge, onClick = onClick)
    }
}

/** "📇 Asked on card · 银行 ›" — a button to the card when it leads somewhere, else a plain chip. */
@Composable
private fun ContextChip(badge: ClaudeChats.Badge, onClick: (() -> Unit)?) {
    val shape = RoundedCornerShape(50)
    Row(
        Modifier
            .padding(top = 6.dp)
            .heightIn(min = if (onClick != null) 36.dp else 28.dp)
            .clip(shape)
            .background(ClaudeOrange.copy(alpha = 0.08f))
            .border(1.dp, ClaudeOrange.copy(alpha = 0.55f), shape)
            .then(if (onClick != null) Modifier.bouncyClickable(pressedScale = 0.95f, role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp)
            .testTag(ChatsTags.CONTEXT_CHIP),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${badge.icon} ${badge.text}", color = Lab.colors.ink, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (onClick != null) Text(" ›", color = Lab.colors.muted, fontSize = 14.sp)
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

/** ✏️ "New chat with…": ✦ Claude first (the box, typing), then each person (THE chat with them). */
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
