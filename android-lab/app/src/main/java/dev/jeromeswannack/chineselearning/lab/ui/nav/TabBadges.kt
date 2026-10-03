package dev.jeromeswannack.chineselearning.lab.ui.nav

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.chats.Chats
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

/**
 * Counts shown on tab icons — the registry, one line per feature. The Chats tab shows how many
 * conversations with people have unread messages (`unreadConversationCount` over the cached
 * inbox, kept live by [Chats.unreadBadge]). The notifications feed is still polled (Home's
 * "From <tutor>" card reads it), but no longer badges Tutor / Students: chats live in Chats.
 */
object TabBadges {
    fun observe(app: LabApp): Flow<Map<TabId, Int>> =
        combine(Chats.unreadBadge(app), Connections.unreadBadge(app)) { chats, _ -> mapOf(TabId.CHATS to chats) }
}
