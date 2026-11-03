package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** The box's rules (the web's components/chats/ChatsComposer.tsx). */
object ChatsCompose {
    const val PLACEHOLDER = "Ask Claude anything…"
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
)

object ChatsComposeTags {
    const val ROOT = "chats-composer"
    const val INTENTS = "chats-compose-intents"
    const val ERROR = "chats-compose-error"
    const val OFFLINE = "chats-compose-offline"
    fun intent(id: String) = "chats-compose-$id"
}

/**
 * The box at the bottom of the Chats tab, Claude.ai style, voice-first and compact: it always goes to
 * Claude (a person is reached from ✏️ New chat or their row). Idle it is one small row — ✏️ Type ·
 * 🎤 Say it. Ask is the main button; once there is text (typed, or a finished take) ✏️ Check and
 * 🔍 Explain appear for Chinese, 🔤 Translate for English ([ChatsCompose.composerFor]) — beside Ask
 * while typing, under the review after speaking; never before. Sending starts a new general thread
 * with that intent and opens it (offline: queued).
 *
 * [compact] (the tutor's view): Ask · Translate only. [ChatsUi.composeRequest] opens the box, typing.
 */
@Composable
fun ChatsComposer(ui: ChatsUi, actions: ChatsComposeActions, compact: Boolean, voicePreview: VoiceDictationUi? = null) {
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
        if (ui.composeRequest > 0 && voicePreview == null) voice.type()
    }
    // What a Check / Explain / Translate button sends: the take under review, else the box.
    val typing = voiceUi.state.mode != VoiceDictation.VOICE
    val current = NoteSearch.jsTrim(if (!typing) voiceUi.finalText.ifEmpty { ui.draft } else ui.draft)
    val composer = ChatsCompose.composerFor(current, compact)
    // Only once there is text: nothing to check before he has typed or finished speaking (the review).
    val ready = current.isNotEmpty() && (typing || voiceUi.phase == "review")
    val others = if (!ready) emptyList() else composer.intents.filter { it != "ask" }
    val send: (String) -> Unit = { intent ->
        actions.onDraft(current)
        actions.onSendToClaude(current, intent, !typing && voiceUi.finalText.isNotEmpty())
    }
    Column(
        Modifier.fillMaxWidth().background(Lab.colors.background).padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 6.dp).testTag(ChatsComposeTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
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
            compact = true,
            submitRowExtra = if (typing && others.isNotEmpty()) {
                { for (intent in others) IntentButton(ClaudeChats.INTENT_LABELS.getValue(intent), composer.enabled && !ui.sending, ChatsComposeTags.intent(intent), Modifier) { send(intent) } }
            } else null,
        )
        if (!typing && others.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().testTag(ChatsComposeTags.INTENTS), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (intent in others) {
                    IntentButton(ClaudeChats.INTENT_LABELS.getValue(intent), composer.enabled && !ui.sending, ChatsComposeTags.intent(intent), Modifier.weight(1f)) { send(intent) }
                }
            }
        }
        composer.hint?.takeIf { others.isNotEmpty() }?.let { Text(it, fontSize = 12.sp, color = Lab.colors.muted) }
        ui.sendError?.let { Text(it, fontSize = 14.sp, color = Lab.colors.ink, modifier = Modifier.testTag(ChatsComposeTags.ERROR)) }
        if (ui.offline) Text(ChatsCompose.OFFLINE_NOTE, fontSize = 13.sp, color = Lab.colors.muted, modifier = Modifier.testTag(ChatsComposeTags.OFFLINE))
    }
}

/** ✏️ Check / 🔍 Explain / 🔤 Translate: quiet outlined pills (no accent colour), 44 dp. */
@Composable
private fun IntentButton(label: String, enabled: Boolean, tag: String, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    Box(
        modifier.heightIn(min = 44.dp).clip(shape).border(1.dp, Lab.colors.outline, shape).alpha(if (enabled) 1f else 0.45f)
            .bouncyClickable(enabled, 0.95f, onClick = onClick).padding(horizontal = 12.dp).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Lab.colors.ink, fontWeight = FontWeight.Medium, fontSize = 14.sp, maxLines = 1) }
}
