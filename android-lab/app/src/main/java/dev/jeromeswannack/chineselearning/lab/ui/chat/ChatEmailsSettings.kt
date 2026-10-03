package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.put
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection
import dev.jeromeswannack.chineselearning.lab.ui.settings.StatusLine
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data class EmailPrefsBody(val email_chat_messages: Boolean)

/** Settings → Chat e-mails (web: NotificationsSection → "Chat e-mails"; docs/CHAT.md "E-mail opt-out"). */
suspend fun Api.setChatEmails(on: Boolean): EmailPrefsBody = put("/api/profile/email-prefs", EmailPrefsBody(on))

/** Stateless for screenshots. */
@Composable
fun ChatEmailsSection(on: Boolean, note: String?, onChange: (Boolean) -> Unit) {
    SettingsSection("Chat e-mails", "An e-mail when your tutor or student sends a chat message.") {
        ToggleRow("✉️", "E-mail new messages", on, onChange = onChange)
        Text(
            if (on) "Every chat e-mail also has a “Turn off chat emails” link. Notifications on this phone are separate and stay on."
            else "Off — no e-mails for chat messages. Notifications on this phone still arrive.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
        StatusLine(note)
    }
}

private const val PREFS = "chat_emails"
private const val KEY_ON = "on"

@Composable
fun ChatEmailsSettings(app: LabApp) {
    val sp = remember { app.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    var on by remember { mutableStateOf(sp.getBoolean(KEY_ON, true)) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // The account's value (another device or the e-mail's own link may have changed it).
    LaunchedEffect(Unit) {
        runCatching { app.repo.api.me() }.getOrNull()?.let {
            on = it.email_chat_messages
            sp.edit().putBoolean(KEY_ON, on).apply()
        }
    }
    ChatEmailsSection(on, note) { next ->
        val prev = on
        on = next
        note = null
        scope.launch {
            runCatching { app.repo.api.setChatEmails(next) }
                .onSuccess { sp.edit().putBoolean(KEY_ON, it.email_chat_messages).apply() }
                .onFailure { on = prev; note = "Couldn't save: ${it.userMessage()}" }
        }
    }
}
