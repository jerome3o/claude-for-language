package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.runtime.Composable
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListLastMessage
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListPerson
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.ShellFrame
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabSpec
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config
import java.time.Instant

object ChatsSamples {
    val now: Long = Instant.parse("2026-10-03T12:00:00Z").toEpochMilli()
    private val minghui = ChatListPerson("u-minghui", "Minghui 明慧", null)
    private val claude = ChatListPerson("claude-ai", "Claude", null)

    private fun msg(id: String, from: String, text: String, at: String) = ChatListLastMessage(id, from, text, at)

    val rows = listOf(
        ChatListRow("c-hw", "rel-minghui", "Homework", false, minghui, "tutor",
            msg("m1", "u-minghui", "你做完第三课的作业了吗？明天上课前发给我看看。", "2026-10-03T10:42:00Z"), unread = 2, lastActivityAt = "2026-10-03T10:42:00Z"),
        ChatListRow("c-wei", "rel-wei", null, false, ChatListPerson("u-wei", "Wei Chen", null), "student",
            msg("m2", "u-wei", "📷 Photo: 这是我的猫，它叫馒头", "2026-10-03T08:15:00Z"), unread = 1, lastActivityAt = "2026-10-03T08:15:00Z"),
        ChatListRow("c-tue", "rel-minghui", "Tuesday lesson", false, minghui, "tutor",
            msg("m3", "me", "好的，明天见！", "2026-10-02T19:03:00Z"), lastActivityAt = "2026-10-02T19:03:00Z"),
        ChatListRow("c-anna", "rel-anna", null, false, ChatListPerson("u-anna", "Anna Müller", null), "student",
            msg("m4", "u-anna", "🎤 Voice message", "2026-09-28T16:20:00Z"), lastActivityAt = "2026-09-28T16:20:00Z"),
        ChatListRow("c-tom", "rel-tom", null, false, ChatListPerson("u-tom", "Tom", null), "student",
            null, lastActivityAt = "2026-09-12T09:00:00Z"),
        ChatListRow("c-cafe", "rel-claude", "At the café", true, claude, "tutor",
            msg("m5", "claude-ai", "您好！您想喝点什么？我们有拿铁、绿茶和珍珠奶茶。", "2026-10-01T18:30:00Z"), unread = 1, lastActivityAt = "2026-10-01T18:30:00Z"),
        ChatListRow("c-dir", "rel-claude", "Asking for directions", true, claude, "tutor",
            msg("m6", "me", "请问，地铁站怎么走？", "2026-09-20T11:00:00Z"), lastActivityAt = "2026-09-20T11:00:00Z"),
    )

    val loaded = ChatsUi(loaded = true, rows = rows, myId = "me", nowMs = now, offsetMinutes = 60)
}

/** The Chats tab: inbox (unread, sections), search, empty, the new-chat picker, and the tab bars. */
class ChatsScreenshots : LabScreenshotTest() {
    private val student = NavRules.tabsFor(NavRole(hasTutor = true, loaded = true))
    private val tutorAccount = NavRules.tabsFor(NavRole(hasStudents = true, isTutorOnly = true, loaded = true, isTutorAccount = true))

    private fun inShell(name: String, tabs: List<TabSpec> = student, unread: Int = 2, dark: Boolean = false, content: @Composable () -> Unit) =
        shoot(name, dark) { ShellFrame(tabs, TabId.CHATS, showBar = true, onSelect = {}, badges = mapOf(TabId.CHATS to unread)) { content() } }

    @Test fun inbox() = inShell("chats-01-inbox-unread") { ChatsScreen(ChatsSamples.loaded, ChatsActions()) }

    @Test fun search() = inShell("chats-02-search") { ChatsScreen(ChatsSamples.loaded.copy(query = "cafe"), ChatsActions()) }

    @Test fun searchChinese() = inShell("chats-03-search-chinese") { ChatsScreen(ChatsSamples.loaded.copy(query = "作业"), ChatsActions()) }

    @Test fun searchNoMatch() = inShell("chats-04-search-no-match") { ChatsScreen(ChatsSamples.loaded.copy(query = "火车"), ChatsActions()) }

    @Test fun empty() = inShell("chats-05-empty", unread = 0) { ChatsScreen(ChatsUi(loaded = true, nowMs = ChatsSamples.now), ChatsActions()) }

    @Test fun offline() = inShell("chats-06-offline-cached") { ChatsScreen(ChatsSamples.loaded.copy(offline = true), ChatsActions()) }

    @Test fun tutorTabs() = inShell("chats-07-tutor-account-tabs", tabs = tutorAccount, unread = 1) {
        ChatsScreen(ChatsSamples.loaded.copy(rows = ChatsSamples.rows.filter { it.otherRole == "student" }), ChatsActions())
    }

    @Test fun dark() = inShell("chats-08-dark", dark = true) { ChatsScreen(ChatsSamples.loaded, ChatsActions()) }

    @Config(qualifiers = UNFOLDED) @Test fun unfolded() = inShell("chats-09-unfolded") { ChatsScreen(ChatsSamples.loaded, ChatsActions()) }

    @Test fun picker() {
        val people = ChatsViewModel.peopleFor(ChatsSamples.rows, null, "me")
        compose.setContent { LabTheme { ChatsScreen(ChatsSamples.loaded.copy(people = people, pickerOpen = true), ChatsActions()) } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/chats-10-new-chat-picker.png")
    }
}
