package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudePractice
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFormSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

/*
 * Practice with Claude — "🎭 Practice a situation" (the web's components/claude/PracticeSituationSheet.tsx;
 * docs/CHAT.md "Practice with Claude"; core [ClaudePractice]). A ready-made situation or his own, who
 * Claude plays, who he is, a level → ▶ Start: a practice thread with no message (Claude speaks first),
 * then the thread screen. Opened from the Chats tab's ✏️ picker, the Claude page (Connections →
 * Claude) and an old "new chat with Claude" link. Online only.
 */

object PracticeTags {
    const val SHEET = "practice-sheet"
    const val START = "practice-start"
    const val SCENARIO = "practice-scenario"
    const val AI_ROLE = "practice-ai-role"
    const val USER_ROLE = "practice-user-role"
    fun preset(id: String) = "practice-preset-$id"
    fun level(id: String) = "practice-level-$id"
}

/** The form as typed / picked. [preset] = the situation picked (until a field changes). */
data class PracticeForm(
    val scenario: String = "",
    val aiRole: String = "",
    val userRole: String = "",
    val level: String = ClaudePractice.DEFAULT_LEVEL,
    val preset: ClaudePractice.Scenario? = null,
) {
    val context: ClaudePractice.Context? get() = ClaudePractice.practiceContext(scenario, aiRole, userRole, level)

    /** The analytics `preset`: the situation picked, or `custom` once he changed it. */
    val presetId: String get() {
        val p = preset ?: return "custom"
        return if (p.scenario == scenario.trim() && p.aiRole == aiRole.trim() && p.userRole == userRole.trim()) p.id else "custom"
    }

    fun pick(p: ClaudePractice.Scenario) = copy(scenario = p.scenario, aiRole = p.aiRole, userRole = p.userRole, preset = p)
}

/** A practice context as the API takes it. */
fun ClaudePractice.Context.toDto() = ClaudeContextDto(
    ClaudeChats.PRACTICE,
    note_id = noteId,
    scenario = scenario,
    ai_role = aiRole,
    user_role = userRole,
    level = level,
    voice_id = voiceId,
    label = label,
)

/**
 * Start a role-play and return its thread id (Claude's opener pending): the situation sheet and the
 * study card's "🎭 Roleplay this word". Throws when offline / refused.
 */
suspend fun startPractice(app: LabApp, ctx: ClaudePractice.Context, source: String, preset: String): String {
    val id = ClaudeThreads.of(app).startPractice(ctx.toDto(), app.prefs.askClaudeLanguage)
    app.analytics.track("claude.practice_start", mapOf("source" to source, "preset" to preset, "level" to ctx.level))
    return id
}

/** The form (stateless — the sheet and the screenshots). */
@Composable
fun PracticeSituationForm(form: PracticeForm, online: Boolean, error: String?, onForm: (PracticeForm) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "Claude plays someone in the situation and talks with you in Chinese — Claude starts. Stuck? 💡 a hint, 🆘 how to say something, ✏️ a correction.",
            color = Lab.colors.muted, fontSize = 14.sp,
        )
        ClaudePractice.SCENARIOS.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (p in row) PresetTile(p, form.preset?.id == p.id, Modifier.weight(1f)) { onForm(form.pick(p)) }
                if (row.size == 1) androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
            }
        }
        OutlinedTextField(
            form.scenario, { onForm(form.copy(scenario = it)) },
            label = { Text("The situation") }, placeholder = { Text("e.g. 在咖啡店点咖啡 — or: buying a train ticket") },
            minLines = 2, modifier = Modifier.fillMaxWidth().testTag(PracticeTags.SCENARIO),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(form.aiRole, { onForm(form.copy(aiRole = it)) }, label = { Text("Claude plays") }, singleLine = true, modifier = Modifier.weight(1f).testTag(PracticeTags.AI_ROLE))
            OutlinedTextField(form.userRole, { onForm(form.copy(userRole = it)) }, label = { Text("You are") }, singleLine = true, modifier = Modifier.weight(1f).testTag(PracticeTags.USER_ROLE))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (l in ClaudePractice.LEVELS) LevelPill(l.label, form.level == l.id, Modifier.weight(1f).testTag(PracticeTags.level(l.id))) { onForm(form.copy(level = l.id)) }
        }
        Text(ClaudePractice.LEVELS.firstOrNull { it.id == form.level }?.hint.orEmpty(), color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
        error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        if (!online) InlineNotice("Practising with Claude needs a connection.", kind = NoticeKind.Offline)
    }
}

private val Amber = Color(0xFFD97706)

@Composable
private fun PresetTile(p: ClaudePractice.Scenario, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier.heightIn(min = 60.dp).clip(shape).background(if (on) Amber.copy(alpha = 0.10f) else Lab.colors.card)
            .border(1.dp, if (on) Amber else Lab.colors.cardBorder, shape)
            .bouncyClickable(pressedScale = 0.97f, role = Role.Button, onClick = onClick).padding(horizontal = 10.dp, vertical = 6.dp)
            .testTag(PracticeTags.preset(p.id)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(p.icon, fontSize = 22.sp)
        Column {
            Text(p.label, color = Lab.colors.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, lineHeight = 17.sp)
            Text(p.scenario, color = Lab.colors.muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun LevelPill(label: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Row(
        modifier.height(44.dp).clip(shape).background(if (on) Amber else Lab.colors.card).border(1.dp, if (on) Amber else Lab.colors.cardBorder, shape)
            .bouncyClickable(pressedScale = 0.95f, role = Role.RadioButton, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) { Text(label, color = if (on) Color.White else Lab.colors.ink, fontSize = 14.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal) }
}

/**
 * The sheet: the form, Cancel · ▶ Start. [source] = analytics (chats | claude_page | chat_link);
 * [onStarted] gets the new thread's id (open `/chats/claude/{id}`).
 */
@Composable
fun PracticeSituationSheet(source: String, onDismiss: () -> Unit, onStarted: (String) -> Unit) {
    val app = LocalContext.current.applicationContext as LabApp
    val online by app.online.collectAsState()
    var form by remember { mutableStateOf(PracticeForm()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val ctx = form.context
    LabFormSheet(
        onDismiss = onDismiss,
        title = "🎭 Practice a situation",
        footer = {
            SecondaryPill("Cancel", Modifier.weight(0.6f), onClick = onDismiss)
            PrimaryPill(if (busy) "Starting…" else "▶ Start", Modifier.weight(1f).height(52.dp).testTag(PracticeTags.START), enabled = ctx != null && online && !busy) {
                val c = ctx ?: return@PrimaryPill
                busy = true
                error = null
                scope.launch {
                    try {
                        val id = startPractice(app, c, source, form.presetId)
                        app.haptics.tick()
                        onStarted(id)
                    } catch (e: kotlinx.coroutines.CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        error = "Couldn't start the role-play. ${e.userMessage()}"
                        busy = false
                    }
                }
            }
        },
    ) {
        Column(Modifier.testTag(PracticeTags.SHEET)) { PracticeSituationForm(form, online, error) { form = it; error = null } }
    }
}
