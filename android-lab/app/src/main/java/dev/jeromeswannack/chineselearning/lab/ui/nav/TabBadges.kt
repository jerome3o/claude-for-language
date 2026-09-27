package dev.jeromeswannack.chineselearning.lab.ui.nav

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Counts shown on tab icons — the registry, one line per feature. Unread chat messages light
 * up the tab that holds the chats (Tutor for a student, Students for a tutor); package E.
 */
object TabBadges {
    fun observe(app: LabApp): Flow<Map<TabId, Int>> =
        Connections.unreadBadge(app).map { unread -> mapOf(TabId.TUTOR to unread, TabId.STUDENTS to unread) }
}
