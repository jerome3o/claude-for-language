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
import dev.jeromeswannack.chineselearning.lab.core.SayBetter
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
data class ChatPrefsBody(val chat_auto_check: Boolean?)

/** Settings → Chat → "Check my Chinese automatically" (docs/CHAT.md "Auto-check"). */
suspend fun Api.setChatAutoCheck(on: Boolean?): ChatPrefsBody = put("/api/profile/chat-prefs", ChatPrefsBody(on))

/** Stateless for screenshots. */
@Composable
fun ChatAutoCheckSection(on: Boolean, note: String?, onChange: (Boolean) -> Unit) {
    SettingsSection("Chat", "Help with the Chinese you write to your tutor.") {
        ToggleRow("✎", "Check my Chinese automatically", on, onChange = onChange)
        Text(
            "Your Chinese chat messages get a quiet ✎ when they could be better",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
        StatusLine(note)
    }
}

private const val PREFS = "chat_auto_check"
/** The stored choice: absent = null (the default). */
private const val KEY_ON = "on"
private const val KEY_ROLE = "role"

@Composable
fun ChatAutoCheckSettings(app: LabApp) {
    val sp = remember { app.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    fun stored(): Boolean? = if (sp.contains(KEY_ON)) sp.getBoolean(KEY_ON, true) else null
    var on by remember { mutableStateOf(SayBetter.settingShown(stored(), sp.getString(KEY_ROLE, null))) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // The account's value (another device may have changed it) and role (a tutor account defaults to off).
    LaunchedEffect(Unit) {
        runCatching { app.repo.api.me() }.getOrNull()?.let { me ->
            sp.edit().apply {
                if (me.chat_auto_check == null) remove(KEY_ON) else putBoolean(KEY_ON, me.chat_auto_check)
                putString(KEY_ROLE, me.role)
            }.apply()
            on = SayBetter.settingShown(me.chat_auto_check, me.role)
        }
    }
    ChatAutoCheckSection(on, note) { next ->
        val prev = on
        on = next
        note = null
        scope.launch {
            runCatching { app.repo.api.setChatAutoCheck(next) }
                .onSuccess { r -> sp.edit().apply { if (r.chat_auto_check == null) remove(KEY_ON) else putBoolean(KEY_ON, r.chat_auto_check) }.apply() }
                .onFailure { on = prev; note = "Couldn't save: ${it.userMessage()}" }
        }
    }
}
