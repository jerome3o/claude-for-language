package dev.jeromeswannack.chineselearning.lab.ui.homework

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
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.put
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection
import dev.jeromeswannack.chineselearning.lab.ui.settings.StatusLine
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data class HomeworkEmailPrefsBody(val email_homework: Boolean)

@Serializable
data class HomeworkEmailPrefsResult(val email_homework: Boolean = true)

/** Settings → Homework e-mails (web: NotificationsSection → "Homework e-mails"; docs/HOMEWORK.md §12). */
suspend fun Api.setHomeworkEmails(on: Boolean): HomeworkEmailPrefsResult =
    put("/api/profile/email-prefs", HomeworkEmailPrefsBody(on))

/** Stateless for screenshots. */
@Composable
fun HomeworkEmailsSection(on: Boolean, note: String?, onChange: (Boolean) -> Unit) {
    SettingsSection("Homework e-mails", "An e-mail when your tutor sends homework, and the evening before it's due.") {
        ToggleRow("📚", "E-mail me about homework", on, onChange = onChange)
        Text(
            if (on) "When your tutor sends homework, and a reminder around 6 pm the evening before it's due (only if it isn't done yet). Every one has a “Turn off homework emails” link."
            else "Off — no homework e-mails. Your homework is still on Home and in Homework.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
        StatusLine(note)
    }
}

private const val PREFS = "homework_emails"
private const val KEY_ON = "on"

@Composable
fun HomeworkEmailsSettings(app: LabApp) {
    val sp = remember { app.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    var on by remember { mutableStateOf(sp.getBoolean(KEY_ON, true)) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // The account's value (another device or the e-mail's own link may have changed it).
    LaunchedEffect(Unit) {
        runCatching { app.repo.api.me() }.getOrNull()?.let {
            on = it.email_homework
            sp.edit().putBoolean(KEY_ON, on).apply()
        }
    }
    HomeworkEmailsSection(on, note) { next ->
        val prev = on
        on = next
        note = null
        scope.launch {
            runCatching { app.repo.api.setHomeworkEmails(next) }
                .onSuccess {
                    on = it.email_homework
                    sp.edit().putBoolean(KEY_ON, it.email_homework).apply()
                    Analytics.track("settings.change", mapOf("setting" to "email_homework", "value" to if (it.email_homework) "on" else "off"))
                }
                .onFailure { on = prev; note = "Couldn't save: ${it.userMessage()}" }
        }
    }
}
