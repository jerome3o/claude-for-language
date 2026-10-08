package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.data.api.setAskClaudeLanguage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection
import dev.jeromeswannack.chineselearning.lab.ui.settings.StatusLine
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

/** The two choices, as on the web (components/settings/AskClaudeLanguageSection.tsx). */
private val OPTIONS = listOf(
    Triple(AskClaude.ZH, "中文 Chinese", "Simple Chinese explanations — tap any word to look it up, hold a message to translate it."),
    Triple(AskClaude.EN, "English", "Explanations in English, with the Chinese and pinyin in the examples."),
)

/** Settings → "Ask Claude answers in" (stateless for screenshots). */
@Composable
fun AskClaudeLanguageSection(language: String, note: String?, onChange: (String) -> Unit) {
    SettingsSection("Ask Claude answers in", OPTIONS.first { it.first == language }.third + " Asking “in English please” always works for one answer.") {
        for ((value, label, _) in OPTIONS) {
            val on = language == value
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = on, role = Role.RadioButton) { if (!on) onChange(value) }.testTag("ask-claude-language-$value"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = on, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = Lab.colors.accent))
                Spacer(Modifier.width(10.dp))
                Text(label, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
            }
        }
        StatusLine(note)
    }
}

/**
 * The account's choice (`/api/auth/me` → prefs, so it is known offline and the study sheet starts
 * from it); a change shows at once and is saved with `PUT /api/profile/ask-claude-language`.
 */
@Composable
fun AskClaudeLanguageSettings(app: LabApp) {
    var language by remember { mutableStateOf(app.prefs.askClaudeLanguage) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        runCatching { app.repo.api.me() }.getOrNull()?.let { me ->
            app.prefs.saveProfile(me)
            language = app.prefs.askClaudeLanguage
        }
    }
    AskClaudeLanguageSection(language, note) { next ->
        language = next
        note = null
        app.prefs.askClaudeLanguage = next
        app.analytics.track("study.ask_claude_language", mapOf("language" to next, "source" to "settings"))
        scope.launch {
            runCatching { app.repo.api.setAskClaudeLanguage(next) }
                .onFailure { note = "Saved on this phone — the account will follow when you're online (${it.userMessage()})." }
        }
    }
}
