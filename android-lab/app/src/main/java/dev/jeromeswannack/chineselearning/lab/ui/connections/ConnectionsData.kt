package dev.jeromeswannack.chineselearning.lab.ui.connections

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.NotificationDto
import dev.jeromeswannack.chineselearning.lab.data.api.markNotificationsReadByConversation
import dev.jeromeswannack.chineselearning.lab.data.api.notifications
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

object ConnectionsKeys {
    const val KIND = "connections"
    /** My user id (from /api/auth/me) — who "me" is in relationships and chat messages. */
    const val ME = "connections/me"
    /** GET /api/notifications — unread chat messages (Tutor tab badge, Home's "From <tutor>" card). */
    const val NOTIFICATIONS = "connections/notifications"
    fun relationship(id: String) = "connections/rel/$id"
    fun conversations(relId: String) = "connections/rel/$relId/conversations"
    fun flags(relId: String) = "connections/rel/$relId/flags"
    fun sharedDecks(relId: String) = "connections/rel/$relId/shared-decks"
    fun studentSharedDecks(relId: String) = "connections/rel/$relId/student-shared-decks"
    const val CLAUDE_CHATS = "connections/claude-chats"
}

/** An unread chat message the notifications feed knows about (web: Header's bell, useHomework). */
fun NotificationDto.isUnreadChat(): Boolean = !is_read && type == "new_chat_message" && conversation_id != null

/** Registered in FeatureSyncs: my id (once) and the notifications feed. */
object ConnectionsSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        if (ctx.cache.get<String>(ConnectionsKeys.ME) == null) ctx.cache.put(ConnectionsKeys.ME, ConnectionsKeys.KIND, ctx.api.me().id)
        ctx.cache.put(ConnectionsKeys.NOTIFICATIONS, ConnectionsKeys.KIND, ctx.api.notifications())
    }
}

object Connections {
    suspend fun myId(cache: JsonCache): String? = cache.get<String>(ConnectionsKeys.ME)

    /**
     * Unread chat messages for the Tutor tab's badge. Refreshes the feed every minute while
     * something collects it and the phone is online (the web's Header polls every 60 s).
     */
    fun unreadBadge(app: LabApp): Flow<Int> = channelFlow {
        launch {
            while (true) {
                if (app.online.value && app.prefs.sessionToken != null) {
                    runCatching { app.cache.put(ConnectionsKeys.NOTIFICATIONS, ConnectionsKeys.KIND, app.repo.api.notifications()) }
                }
                delay(60_000)
            }
        }
        app.cache.observe<List<NotificationDto>>(ConnectionsKeys.NOTIFICATIONS).map { list -> list.orEmpty().count { it.isUnreadChat() } }.collect { send(it) }
    }

    /** Opening a chat reads its notifications (web: markNotificationsReadByConversation); updates the badge at once. */
    suspend fun markConversationRead(app: LabApp, conversationId: String) {
        val list = app.cache.get<List<NotificationDto>>(ConnectionsKeys.NOTIFICATIONS)
        if (list != null && list.any { it.conversation_id == conversationId && !it.is_read }) {
            app.cache.put(ConnectionsKeys.NOTIFICATIONS, ConnectionsKeys.KIND, list.map { if (it.conversation_id == conversationId) it.copy(is_read = true) else it })
        }
        runCatching { app.repo.api.markNotificationsReadByConversation(conversationId) }
    }
}
