package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatListeningStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

/** Settings → Chat → "Listening mode in new chats" (docs/CHAT.md "Listening mode"). Stateless for screenshots. */
@Composable
fun ChatListeningSection(on: Boolean, onChange: (Boolean) -> Unit) {
    SettingsSection("Chat", "Listening practice in your chats.") {
        ToggleRow("🎧", "Listening mode in new chats", on, onChange = onChange)
        Text(
            if (on) "New messages from your tutor or student arrive hidden: tap to listen, hold to reveal. Change it per chat in the chat's ⋯ menu."
            else "Off — messages show as text. You can still turn listening mode on in one chat from its ⋯ menu.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
    }
}

/** The account default, cached (works offline); a change goes through the outbox. */
@Composable
fun ChatListeningSettings(app: LabApp) {
    val state by ChatListeningStore.observe(app.cache).collectAsStateWithLifecycle(null)
    val scope = rememberCoroutineScope()
    ChatListeningSection(state?.default_on ?: false) { next ->
        app.haptics.tick()
        scope.launch { ChatListeningStore.setDefault(app, next) }
    }
}
