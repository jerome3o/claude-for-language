package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
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
import dev.jeromeswannack.chineselearning.lab.core.claude.TutorVisibility
import dev.jeromeswannack.chineselearning.lab.data.api.setClaudeTutorVisibility
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection
import dev.jeromeswannack.chineselearning.lab.ui.settings.StatusLine
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

object ClaudeTutorVisibilityTags {
    const val SECTION = "claude-tutor-visibility"
    fun option(id: String) = "claude-tutor-visibility-$id"
}

/**
 * Settings → "✦ Your tutor can see your chats with Claude" (web components/ChatSettingsSection.tsx
 * `ClaudeTutorVisibilitySetting`; core claude.TutorVisibility): Card questions (default) · All Claude
 * chats · None. One chat's own ⋯ overrides it. Stateless for screenshots.
 */
@Composable
fun ClaudeTutorVisibilitySection(value: String, note: String?, onPick: (String) -> Unit) {
    SettingsSection("✦ Your tutor can see your chats with Claude", TutorVisibility.EXPLAINER, Modifier.testTag(ClaudeTutorVisibilityTags.SECTION)) {
        Column(Modifier.selectableGroup()) {
            for (o in TutorVisibility.OPTIONS) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .selectable(selected = value == o.id, role = Role.RadioButton) { onPick(o.id) }
                        .padding(vertical = 6.dp).testTag(ClaudeTutorVisibilityTags.option(o.id)),
                    verticalAlignment = Alignment.Top,
                ) {
                    RadioButton(selected = value == o.id, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = Lab.colors.accent))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(o.label + if (o.id == TutorVisibility.DEFAULT) " (default)" else "", style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                        Text(o.hint, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    }
                }
            }
        }
        StatusLine(note)
    }
}

@Composable
fun ClaudeTutorVisibilitySettings(app: LabApp) {
    var value by remember { mutableStateOf(app.prefs.claudeTutorVisibility) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // The account's value (another device may have changed it).
    LaunchedEffect(Unit) {
        runCatching { app.repo.api.me() }.getOrNull()?.let { me ->
            app.prefs.claudeTutorVisibility = TutorVisibility.parse(me.claude_tutor_visibility)
            value = app.prefs.claudeTutorVisibility
        }
    }
    ClaudeTutorVisibilitySection(value, note) { next ->
        if (next == value) return@ClaudeTutorVisibilitySection
        val prev = value
        value = next
        note = null
        app.haptics.tick()
        scope.launch {
            runCatching { app.repo.api.setClaudeTutorVisibility(if (next == TutorVisibility.DEFAULT) null else next) }
                .onSuccess { r ->
                    app.prefs.claudeTutorVisibility = TutorVisibility.parse(r.claude_tutor_visibility)
                    app.analytics.track("claude.share_with_tutor", mapOf("on" to (next != TutorVisibility.NONE), "scope" to "account", "visibility" to next))
                }
                .onFailure { value = prev; note = "Couldn't save: ${it.userMessage()}" }
        }
    }
}
