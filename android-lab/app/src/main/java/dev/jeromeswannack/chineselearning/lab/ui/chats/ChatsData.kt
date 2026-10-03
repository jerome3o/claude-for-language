package dev.jeromeswannack.chineselearning.lab.ui.chats

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListResponse
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.core.chat.IncomingChatMessage
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.chatList
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPresence
import dev.jeromeswannack.chineselearning.lab.data.chat.LiveEvent
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

object ChatsKeys {
    const val KIND = "chats"
    /** `GET /api/me/chats` — the Chats inbox, rendered from here offline (v2: one row per person since migration 0102). */
    const val LIST = "chats/list-v2"
}

/** Registered in FeatureSyncs: the inbox after every sync, so the tab opens instantly offline. */
object ChatsSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        ctx.cache.put(ChatsKeys.LIST, ChatsKeys.KIND, ctx.api.chatList())
        // The list cached before one chat per pair (several rows per person): gone.
        runCatching { ctx.cache.delete("chats/list") }
    }
}

/**
 * The Chats inbox's data: the cached `/api/me/chats` list, refetched on open / every minute
 * while the tab bar shows / when the live socket (re)connects, and patched in place by live
 * `message` / `message_updated` / `read` events (web: the same `applyIncomingMessage` /
 * `applyReadMarker`), so the inbox and the Chats tab badge follow without a round trip.
 */
object Chats {
    private val lock = Mutex()
    @Volatile private var refreshing = false

    fun observe(cache: JsonCache): Flow<ChatListResponse?> = cache.observe<ChatListResponse>(ChatsKeys.LIST)

    /** Refetch the list (no-op offline / signed out / already in flight). True when it got a fresh list. */
    suspend fun refresh(app: LabApp): Boolean {
        if (!app.online.value || app.prefs.sessionToken == null || refreshing) return false
        refreshing = true
        return try {
            val fresh = app.repo.api.chatList()
            lock.withLock { app.cache.put(ChatsKeys.LIST, ChatsKeys.KIND, fresh) }
            true
        } finally {
            refreshing = false
        }
    }

    /** Read-modify-write of the cached rows; [transform] returning null = unknown conversation → refetch. */
    private suspend fun patch(app: LabApp, transform: (List<ChatListRow>) -> List<ChatListRow>?) {
        val refetch = lock.withLock {
            val current = app.cache.get<ChatListResponse>(ChatsKeys.LIST) ?: return@withLock true
            val next = transform(current.conversations) ?: return@withLock true
            if (next != current.conversations) app.cache.put(ChatsKeys.LIST, ChatsKeys.KIND, current.copy(conversations = next))
            false
        }
        if (refetch) runCatching { refresh(app) }
    }

    /** The one-line preview the server would give this message (`messagePreviewText`). */
    fun previewOf(m: ChatMessageDto): String =
        ChatInbox.messagePreview(m.content, m.attachment?.kind?.takeIf { it.isNotEmpty() }, m.isDeleted, m.attachment?.name)

    /** A live event → the cached list. */
    suspend fun onLive(app: LabApp, event: LiveEvent) {
        if (event is LiveEvent.Typing) return
        val me = Connections.myId(app.cache)
        patch(app) { rows -> applyLive(rows, event, me, ChatPresence::isShowing) }
    }

    /**
     * Pure: a live event applied to the rows; null = refetch (a push-only nudge, or a message in
     * a conversation the list doesn't have yet). [showing] = that chat is on screen right now.
     */
    fun applyLive(rows: List<ChatListRow>, event: LiveEvent, me: String?, showing: (String) -> Boolean): List<ChatListRow>? = when (event) {
        is LiveEvent.Message -> event.message?.let { m ->
            val incoming = IncomingChatMessage(m.id, event.conversationId, m.sender_id.ifEmpty { m.sender.id }, previewOf(m), m.created_at, m.attachment?.kind?.takeIf { it.isNotEmpty() })
            val next = ChatInbox.applyIncomingMessage(rows, incoming, me)
            // The chat on screen reads it at once (it marks it read on the server too).
            if (next != null && showing(event.conversationId)) ChatInbox.applyReadMarker(next, event.conversationId) else next
        }
        // Only the row's own last message can change its preview; an edit / reaction / transcript
        // on an older message must not count as new.
        is LiveEvent.Updated -> {
            val row = rows.firstOrNull { it.conversationId == event.conversationId }
            val m = event.message
            if (row == null || row.lastMessage?.id != m.id) rows
            else ChatInbox.applyIncomingMessage(rows, IncomingChatMessage(m.id, event.conversationId, m.sender_id, previewOf(m), m.created_at, m.attachment?.kind?.takeIf { it.isNotEmpty() }), me)
        }
        // My own read marker (another device, or the chat here); the other person's receipts don't touch my unread.
        is LiveEvent.Read -> if (me == null || event.userId == me) ChatInbox.applyReadMarker(rows, event.conversationId) else rows
        is LiveEvent.Typing -> rows
    }

    /** Opening a chat here: its row has nothing unread (the badge drops at once). */
    suspend fun markRead(app: LabApp, conversationId: String) = patch(app) { rows -> ChatInbox.applyReadMarker(rows, conversationId) }

    /**
     * The Chats tab badge: conversations with unread messages (people, not Claude). While
     * collected (the tab bar is up) it also keeps the list live: socket events, a refetch on
     * every (re)connect, and every minute as the fallback.
     */
    fun unreadBadge(app: LabApp): Flow<Int> = channelFlow {
        launch { app.chatLive.events.collect { runCatching { onLive(app, it) } } }
        launch {
            var first = true
            app.chatLive.connected.collect { up -> if (up && !first) runCatching { refresh(app) }; first = false }
        }
        launch {
            while (true) {
                runCatching { refresh(app) }
                delay(60_000)
            }
        }
        observe(app.cache).map { ChatInbox.unreadConversationCount(it?.conversations.orEmpty()) }.distinctUntilChanged().collect { send(it) }
    }
}
