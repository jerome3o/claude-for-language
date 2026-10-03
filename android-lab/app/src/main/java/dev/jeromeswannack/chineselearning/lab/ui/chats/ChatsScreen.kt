package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.profile.ProfilePhoto
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Signal's blue — the inbox's accents (unread badges, times, the new-chat pencil). */
val SignalBlue = Color(0xFF2C6BED)

/** Someone I can start a new conversation with (the ✏️ picker). */
data class ChatPerson(val relationshipId: String, val name: String, val pictureUrl: String? = null, val role: String? = null)

data class ChatsUi(
    /** False until the cached list (or the first fetch) is in. */
    val loaded: Boolean = false,
    val rows: List<ChatListRow> = emptyList(),
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
)

class ChatsActions(
    val onOpen: (ChatListRow) -> Unit = {},
    val onQuery: (String) -> Unit = {},
    val onNewChat: () -> Unit = {},
    val onPick: (ChatPerson) -> Unit = {},
    val onDismissPicker: () -> Unit = {},
    val onConnections: () -> Unit = {},
    val onRetry: () -> Unit = {},
)

/**
 * The Chats tab (web `/chats`, shared/chats/inbox.ts): one row per conversation, Signal style —
 * round avatar, name, the title when there are several chats with that person, one-line preview,
 * relative time, a blue unread pill. People first, then "Practice with Claude". Search filters
 * by name, title and last message. ✏️ starts a new conversation.
 */
@Composable
fun ChatsScreen(ui: ChatsUi, actions: ChatsActions) {
    val filtered = ChatInbox.filter(ui.rows, ui.query)
    val groups = ChatInbox.group(filtered)
    LabScreenFrame {
        ScreenTitle("Chats", actions = {
            IconButton(onClick = actions.onNewChat, modifier = Modifier.testTag("chats-new")) {
                Icon(Icons.Outlined.Edit, "New chat", tint = SignalBlue)
            }
        })
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (ui.rows.isNotEmpty() || ui.query.isNotEmpty()) item(key = "search") { SearchField(ui.query, actions.onQuery) }
            if (ui.offline && ui.loaded) item(key = "offline") {
                Text(
                    "Offline — showing your chats as they were at the last sync.",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
            when {
                !ui.loaded && ui.error != null -> item(key = "error") { ErrorState(ui.error, onRetry = actions.onRetry) }
                !ui.loaded && ui.offline -> item(key = "offline-empty") {
                    EmptyState("📡", "You're offline", body = "Your chats will appear here after the next sync with a connection.")
                }
                !ui.loaded -> item(key = "loading") { LoadingState() }
                ui.rows.isEmpty() -> item(key = "empty") {
                    EmptyState(
                        "💬", "No chats yet",
                        body = "No chats yet — connect with a tutor or student to start chatting.",
                        actionLabel = "Find your tutor or students", onAction = actions.onConnections,
                    )
                }
                filtered.isEmpty() -> item(key = "no-match") {
                    Text(
                        "No chats match “${ui.query.trim()}”.",
                        style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 24.dp),
                    )
                }
                else -> {
                    items(groups.people, key = { it.conversationId }) { row -> ChatRow(row, ui, actions) }
                    if (groups.practice.isNotEmpty()) {
                        item(key = "practice-header") {
                            Text(
                                "Practice with Claude",
                                style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted,
                                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = if (groups.people.isEmpty()) 4.dp else 18.dp, bottom = 4.dp),
                            )
                        }
                        items(groups.practice, key = { it.conversationId }) { row -> ChatRow(row, ui, actions) }
                    }
                }
            }
        }
    }
    if (ui.pickerOpen) PersonPicker(ui.people, actions)
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
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag("chats-search"),
    )
}

@Composable
private fun ChatRow(row: ChatListRow, ui: ChatsUi, actions: ChatsActions) {
    val title = ChatInbox.rowTitle(row, ui.rows)
    val unread = row.unread > 0
    val time = ChatInbox.relativeTime(row.lastActivityAt, ui.nowMs, ui.offsetMinutes)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .bouncyClickable(pressedScale = 0.985f) { actions.onOpen(row) }
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .animateContentSize()
            .testTag("chat-row-${row.conversationId}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ChatAvatar(row, 52.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title.name, color = Lab.colors.ink, fontSize = 17.sp,
                    fontWeight = if (unread) FontWeight.Bold else FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Text(time, fontSize = 13.sp, color = if (unread) SignalBlue else Lab.colors.muted, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1)
            }
            title.subtitle?.let { sub ->
                Text(sub, fontSize = 13.sp, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    ChatInbox.rowPreview(row, ui.myId), fontSize = 15.sp,
                    color = if (unread) Lab.colors.ink else Lab.colors.muted,
                    fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (unread) {
                    Spacer(Modifier.width(8.dp))
                    UnreadPill(row.unread)
                }
            }
        }
    }
}

@Composable
private fun UnreadPill(count: Int) {
    Box(
        Modifier.heightIn(min = 22.dp).widthIn(min = 22.dp).clip(RoundedCornerShape(11.dp)).background(SignalBlue).padding(horizontal = 7.dp).testTag("chat-unread"),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

private val AVATAR_COLORS = listOf(Color(0xFF5B8DEF), Color(0xFFE0716B), Color(0xFF4CAF84), Color(0xFFB77FE0), Color(0xFFE0A84C))

/** The other person's picture, else a coloured circle with their initial (🤖 for Claude). */
@Composable
fun ChatAvatar(row: ChatListRow, size: Dp) {
    val url = row.otherUser.pictureUrl
    when {
        row.isAi -> Initial("🤖", Lab.colors.accentSoft, size, emoji = true)
        !url.isNullOrBlank() -> ProfilePhoto(url, row.otherUser.name, size = size)
        else -> PersonInitial(row.otherUser.name, size)
    }
}

@Composable
private fun PersonInitial(name: String?, size: Dp) {
    val display = ChatInbox.personName(name)
    Initial(ChatInbox.initial(name), AVATAR_COLORS[Math.floorMod(display.hashCode(), AVATAR_COLORS.size)], size)
}

@Composable
private fun Initial(text: String, bg: Color, size: Dp, emoji: Boolean = false) {
    Box(Modifier.size(size).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Text(text, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * if (emoji) 0.48f else 0.42f).sp)
    }
}

@Composable
private fun PersonPicker(people: List<ChatPerson>, actions: ChatsActions) {
    LabBottomSheet(onDismiss = actions.onDismissPicker, title = "New chat with…") {
        people.forEachIndexed { i, p ->
            if (i > 0) HorizontalDivider(Modifier.padding(start = 82.dp), color = Lab.colors.faint)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable { actions.onPick(p) }.padding(horizontal = 20.dp, vertical = 8.dp).testTag("chat-pick-${p.relationshipId}"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!p.pictureUrl.isNullOrBlank()) ProfilePhoto(p.pictureUrl, p.name, size = 44.dp) else PersonInitial(p.name, 44.dp)
                Spacer(Modifier.width(18.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.name, color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (p.role != null) Text(p.role, color = Lab.colors.muted, fontSize = 13.sp)
                }
            }
        }
        if (people.isEmpty()) {
            InlineNotice("Connect with a tutor or student first.", Modifier.padding(16.dp), actionLabel = "Connections", onAction = actions.onConnections)
        }
    }
}
