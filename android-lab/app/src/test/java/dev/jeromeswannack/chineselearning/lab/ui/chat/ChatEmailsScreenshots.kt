package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/** Settings → Chat e-mails (docs/CHAT.md "E-mail opt-out"). */
class ChatEmailsScreenshots : LabScreenshotTest() {
    @Test fun on() = shoot("settings-chat-emails-on") { Box(Modifier.padding(16.dp)) { ChatEmailsSection(on = true, note = null, onChange = {}) } }

    @Test fun offDark() = shoot("settings-chat-emails-off", dark = true) { Box(Modifier.padding(16.dp)) { ChatEmailsSection(on = false, note = null, onChange = {}) } }
}
