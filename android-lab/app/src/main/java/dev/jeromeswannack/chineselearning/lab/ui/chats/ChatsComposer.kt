package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeInbox
import dev.jeromeswannack.chineselearning.lab.ui.chat.chatColors
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** The box's rules (the web's components/chats/ChatsComposer.tsx). */
object ChatsCompose {
    const val PLACEHOLDER = "Ask Claude anything…"
    const val COLLAPSED = "Ask Claude…"
    const val SUBMIT = "Ask"
    const val OFFLINE_NOTE = "Offline — it will be sent to Claude when you're back online."

    /**
     * Port of chatsComposerFor: a new general chat's buttons (Ask + ✏️ Check / 🔍 Explain for Chinese,
     * 🔤 Translate for English); [compact] (the tutor's view) = Ask + Translate only.
     */
    fun composerFor(text: String, compact: Boolean): ClaudeChats.Composer {
        val c = ClaudeChats.composerFor(ClaudeChats.GENERAL, text, started = false)
        if (!compact) return c
        val intents = c.intents.filter { it == "ask" || it == "translate" }
        return c.copy(intents = intents, hint = if (intents.size > 1) c.hint else null)
    }
}

class ChatsComposeActions(
    val onDraft: (String) -> Unit = {},
    /** text, intent (ask · check · explain · translate), spoken. */
    val onSendToClaude: (String, String, Boolean) -> Unit = { _, _, _ -> },
    /** "To: <tutor>": her chat with the text as its draft. */
    val onSendToPerson: (ClaudeInbox.Recipient, String) -> Unit = { _, _ -> },
)

object ChatsComposeTags {
    const val ROOT = "chats-composer"
    const val OPEN = "chats-compose-open"
    const val TO = "chats-compose-to"
    const val TO_CLAUDE = "chats-compose-to-claude"
    const val INTENTS = "chats-compose-intents"
    const val ERROR = "chats-compose-error"
    const val OFFLINE = "chats-compose-offline"
    fun to(relationshipId: String) = "chats-compose-to-$relationshipId"
    fun intent(id: String) = "chats-compose-$id"
}

private val ClaudeOutline = Color(0xFFD97757)

/**
 * The box at the bottom of the Chats tab, Claude.ai style and voice-first (🎤 Say it / ✏️ Type):
 * whatever is said or typed goes to Claude unless "To:" says otherwise. Ask is the main button; for
 * Chinese ✏️ Check and 🔍 Explain sit beside it, for English 🔤 Translate ([ChatsCompose.composerFor]).
 * Sending starts a new general thread with that intent and opens it (offline: queued).
 * "To: ✦ Claude ▾" lists the tutors: picking one opens her chat with the text as its draft.
 *
 * [compact] (the tutor's student-centric view): one "✦ Ask Claude…" button until tapped, then
 * Ask · Translate only. [ChatsUi.composeRequest] opens the box, typing.
 */
@Composable
fun ChatsComposer(ui: ChatsUi, actions: ChatsComposeActions, compact: Boolean, voicePreview: VoiceDictationUi? = null) {
    var expanded by remember(compact) { mutableStateOf(!compact) }
    var toOpen by remember { mutableStateOf(false) }
    val voiceLang = if (ui.language == AskClaude.EN) "en" else "zh"
    val voice = androidx.compose.runtime.key(voiceLang) { rememberVoiceDictation("chats_compose", voiceLang) }
    val liveVoice by voice.ui.collectAsState()
    val voiceUi = voicePreview ?: liveVoice
    val voiceActions = rememberVoiceFirstActions(voice, ui.draft, onFill = actions.onDraft) { a ->
        actions.onDraft(a.text)
        actions.onSendToClaude(a.text, "ask", a.source == "spoken")
    }
    // More → Ask Claude, /coach, ✏️ → ✦ Claude: the box opens, typing.
    LaunchedEffect(ui.composeRequest) {
        if (ui.composeRequest > 0) {
            expanded = true
            if (voicePreview == null) voice.type()
        }
    }
    val shape = RoundedCornerShape(20.dp)
    val boxModifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 8.dp)
    if (!expanded) {
        Row(
            boxModifier
                .heightIn(min = 52.dp)
                .clip(shape)
                .background(Lab.colors.card)
                .border(1.5.dp, ClaudeOutline, shape)
                .bouncyClickable(pressedScale = 0.97f, role = Role.Button) {
                    expanded = true
                    if (voicePreview == null) voice.type()
                }
                .padding(horizontal = 16.dp)
                .testTag(ChatsComposeTags.OPEN),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("✦", color = ClaudeOutline, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(10.dp))
            Text(ChatsCompose.COLLAPSED, color = Lab.colors.muted, fontSize = 16.sp)
        }
        return
    }
    Column(
        boxModifier.clip(shape).background(Lab.colors.card).border(1.5.dp, ClaudeOutline, shape).padding(12.dp).testTag(ChatsComposeTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val recipients = ui.recipients
        if (recipients.isNotEmpty()) {
            Box {
                Row(
                    Modifier
                        .heightIn(min = 40.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .bouncyClickable(pressedScale = 0.96f, role = Role.Button) { toOpen = true }
                        .padding(horizontal = 6.dp)
                        .semantics { contentDescription = "To: Claude. Change who this goes to" }
                        .testTag(ChatsComposeTags.TO),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("To: ", color = Lab.colors.muted, fontSize = 15.sp)
                    Text("✦ Claude", color = Lab.colors.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    Text(" ▾", color = Lab.colors.muted, fontSize = 15.sp)
                }
                DropdownMenu(toOpen, onDismissRequest = { toOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("✦ Claude  ✓", fontWeight = FontWeight.SemiBold) },
                        onClick = { toOpen = false },
                        modifier = Modifier.testTag(ChatsComposeTags.TO_CLAUDE),
                    )
                    for (r in recipients) {
                        DropdownMenuItem(
                            text = { Text("🧑‍🏫 ${r.name} · your tutor") },
                            onClick = {
                                toOpen = false
                                actions.onSendToPerson(r, ui.draft)
                            },
                            modifier = Modifier.testTag(ChatsComposeTags.to(r.relationshipId)),
                        )
                    }
                }
            }
        }
        VoiceTextFieldContent(
            ui = voiceUi,
            value = ui.draft,
            onValueChange = actions.onDraft,
            actions = voiceActions,
            submitLabel = if (ui.sending) "…" else ChatsCompose.SUBMIT,
            placeholder = ChatsCompose.PLACEHOLDER,
            multiline = true,
            lang = voiceLang,
            enabled = !ui.sending,
        )
        // What a Check / Explain / Translate button sends: the take under review, else the box.
        val current = NoteSearch.jsTrim(if (voiceUi.state.mode == VoiceDictation.VOICE) voiceUi.finalText.ifEmpty { ui.draft } else ui.draft)
        val composer = ChatsCompose.composerFor(current, compact)
        val others = composer.intents.filter { it != "ask" }
        if (others.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().testTag(ChatsComposeTags.INTENTS), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (intent in others) {
                    val enabled = composer.enabled && !ui.sending && current.isNotEmpty()
                    IntentButton(ClaudeChats.INTENT_LABELS.getValue(intent), enabled, ChatsComposeTags.intent(intent), Modifier.weight(1f)) {
                        actions.onDraft(current)
                        actions.onSendToClaude(current, intent, voiceUi.state.mode == VoiceDictation.VOICE && voiceUi.finalText.isNotEmpty())
                    }
                }
            }
        }
        composer.hint?.takeIf { current.isNotEmpty() }?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
        ui.sendError?.let { Text(it, fontSize = 14.sp, color = Lab.colors.ink, modifier = Modifier.testTag(ChatsComposeTags.ERROR)) }
        if (ui.offline) Text(ChatsCompose.OFFLINE_NOTE, fontSize = 13.sp, color = Lab.colors.muted, modifier = Modifier.testTag(ChatsComposeTags.OFFLINE))
    }
}

@Composable
private fun IntentButton(label: String, enabled: Boolean, tag: String, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    val color = chatColors().let { if (it.dark) Color(0xFFF0B08F) else Color(0xFFA8482A) }
    Box(
        modifier.heightIn(min = 48.dp).clip(shape).border(1.5.dp, ClaudeOutline.copy(alpha = 0.6f), shape).alpha(if (enabled) 1f else 0.45f)
            .bouncyClickable(enabled, 0.95f, onClick = onClick).padding(horizontal = 10.dp).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = color, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1) }
}
