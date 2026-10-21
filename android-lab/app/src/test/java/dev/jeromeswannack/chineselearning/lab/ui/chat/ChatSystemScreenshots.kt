package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatSystemSamples as S

/**
 * System messages (docs/CHAT.md "System messages"): centred rows in the third person, from each
 * side — Jerome reads "Minghui set your new cards…", Minghui reads "You set Jerome's new cards…" —
 * with Join on a live call and Open card on a flag, in light and dark.
 */
class ChatSystemScreenshots : LabScreenshotTest() {
    @Test fun student() = shoot("chat-system-01-student") { ChatScreen(S.student, ChatActions()) }

    @Test fun tutor() = shoot("chat-system-02-tutor") { ChatScreen(S.tutor, ChatActions()) }

    @Test fun studentDark() = shoot("chat-system-03-student-dark", dark = true) { ChatScreen(S.student, ChatActions()) }
}
