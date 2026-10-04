package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.VocabularyDefinition
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The one action row on the card back (components/study/StudyActionRow.tsx):
 * Ask Claude · Edit card · ⋯. Ask Claude is disabled with a "needs internet" hint offline.
 */
@Composable
fun StudyActionRow(aiAvailable: Boolean, onAskClaude: () -> Unit, onEditCard: () -> Unit, onMore: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ActionButton("💬", if (aiAvailable) "Ask Claude" else "Ask Claude · offline", Modifier.weight(1f), enabled = aiAvailable, onClick = onAskClaude)
        ActionButton("✏️", "Edit card", Modifier.weight(1f), onClick = onEditCard)
        ActionButton(null, "⋯", Modifier.width(56.dp), onClick = onMore)
    }
}

@Composable
private fun ActionButton(icon: String?, label: String, modifier: Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Row(
        modifier
            .height(46.dp)
            .alpha(if (enabled) 1f else 0.5f)
            .clip(RoundedCornerShape(14.dp))
            .background(Lab.colors.faint)
            .bouncyClickable(enabled = enabled, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Text(icon, fontSize = 15.sp)
            Spacer(Modifier.width(6.dp))
        }
        Text(label, color = Lab.colors.ink, fontWeight = FontWeight.Medium, fontSize = if (icon == null) 20.sp else 14.sp, maxLines = 1)
    }
}

/** One row of the ⋯ sheet (components/study/StudyMoreMenu.tsx `StudyMenuItem`). */
data class StudyMenuItem(
    val key: String,
    val label: String,
    val icon: String,
    val hint: String? = null,
    val disabled: Boolean = false,
    val busy: Boolean = false,
    val onSelect: () -> Unit,
)

/**
 * The card's ⋯ items, in the web's order (`renderBackActions`): fun fact (only when the
 * note has none), regenerate audio, new voice, roleplay (with a Claude tutor), Write it,
 * flag for tutor (human tutors only), play my recording (when there is one).
 */
fun studyMenuItems(view: CardView, ui: StudyUi, actions: StudyActions, hasRecording: Boolean, onFlag: () -> Unit, onWrite: () -> Unit = {}): List<StudyMenuItem> {
    val needsInternet = if (ui.aiAvailable) null else NEEDS_INTERNET
    val busy = ui.extras.busy
    return buildList {
        if (view.note.funFacts.isNullOrBlank()) add(StudyMenuItem("fun-fact", "Generate fun fact", "💡", needsInternet, !ui.aiAvailable, CardBusy.FUN_FACT in busy, actions.onGenerateFunFact))
        add(StudyMenuItem("regen-audio", "Regenerate audio", "🔊", needsInternet, !ui.aiAvailable, CardBusy.REGEN_AUDIO in busy, actions.onRegenerateAudio))
        add(StudyMenuItem("new-voice", "New voice", "🗣️", needsInternet, !ui.aiAvailable, CardBusy.NEW_VOICE in busy, actions.onNewVoice))
        if (ui.extras.roleplayRelId != null) add(StudyMenuItem("roleplay", "Roleplay this word", "🎭", needsInternet, !ui.aiAvailable, CardBusy.ROLEPLAY in busy, actions.onRoleplay))
        // To the coach and back: the card stays exactly as it is (the session keeps it) and the
        // coach's back returns to it. Prefilled with the card's sentence, not sent (web: same item).
        add(StudyMenuItem("coach", "Sentence coach", "✏️", needsInternet, onSelect = { actions.onOpenCoach(view.note.sentenceClue?.takeIf { it.isNotBlank() } ?: view.note.hanzi) }))
        if (CardExtrasLogic.canWriteHanzi(view.note.hanzi)) add(StudyMenuItem("write", "Write it", "✍️", "Preview", onSelect = onWrite))
        if (ui.extras.flagTutors.isNotEmpty()) add(StudyMenuItem("flag", "Flag for tutor", "🚩", onSelect = onFlag))
        if (hasRecording) add(StudyMenuItem("my-recording", "Play my recording", "🎙️", onSelect = actions.onPlayMyRecording))
    }
}

/** The ⋯ bottom sheet: every secondary action, with "Added <date>" as the footer. */
@Composable
fun StudyMoreSheet(items: List<StudyMenuItem>, footer: String?, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss) {
        StudyMoreList(items, footer, onDismiss)
    }
}

@Composable
fun StudyMoreList(items: List<StudyMenuItem>, footer: String?, onDismiss: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        for (item in items) {
            NavRow(
                icon = item.icon,
                label = if (item.busy) "${item.label}…" else item.label,
                enabled = !item.disabled && !item.busy,
                trailing = {
                    when {
                        item.busy -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                        item.hint != null -> Text(item.hint, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                        else -> Unit
                    }
                },
                onClick = { onDismiss(); item.onSelect() },
            )
        }
        if (footer != null) {
            Text(footer, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 10.dp))
        }
    }
}

/**
 * "From Wang Laoshi: second tone, not fourth" / "Wang Laoshi replied to your flag: …"
 * (components/study/TutorNoteLine.tsx) — under the pinyin, once; rating marks it seen.
 */
@Composable
fun TutorNoteLine(notes: List<TutorNote>, modifier: Modifier = Modifier) {
    if (notes.isEmpty()) return
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (note in notes) {
            Text(
                buildTutorNote(note),
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.ink,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Palette.Hard.copy(alpha = 0.12f))
                    .border(1.dp, Palette.Hard.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp, vertical = 9.dp),
            )
        }
    }
}

private fun buildTutorNote(note: TutorNote) = androidx.compose.ui.text.buildAnnotatedString {
    pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold, color = Palette.Hard))
    append("👩‍🏫 ")
    append(CardExtrasLogic.tutorNoteFrom(note))
    pop()
    append(" ")
    append(note.comment)
}

/**
 * Flag this card for a tutor (components/study/FlagCardSheet.tsx): tutor picker when there
 * are several, a message, Send. Queued offline; "Saved — it goes to X when you're back online".
 */
@Composable
fun FlagCardSheet(tutors: List<FlagTutor>, hanzi: String, send: suspend (FlagTutor, String) -> Boolean, onDismiss: () -> Unit) {
    LabSheetFrame(onDismiss = onDismiss) { FlagCardForm(tutors, hanzi, send, onDismiss) }
}

@Composable
fun FlagCardForm(tutors: List<FlagTutor>, hanzi: String, send: suspend (FlagTutor, String) -> Boolean, onDismiss: () -> Unit, startMessage: String = "", startDone: String? = null, modifier: Modifier = Modifier) {
    var tutor by remember { mutableStateOf(tutors.firstOrNull()) }
    var message by remember { mutableStateOf(startMessage) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(startDone) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(done) { if (done != null && startDone == null) { delay(1400); onDismiss() } }

    fun submit() {
        val t = tutor ?: return
        busy = true
        error = null
        scope.launch {
            try {
                val sent = send(t, message)
                done = if (sent) "Sent to ${t.name}" else "Saved — it goes to ${t.name} when you're back online"
            } catch (e: Exception) {
                error = e.message ?: "Could not save the flag"
            } finally {
                busy = false
            }
        }
    }

    SheetScaffold(
        modifier,
        spacing = 12.dp,
        header = {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "🚩 Flag $hanzi for " + (if (tutors.size > 1) "your tutor" else tutor?.name ?: "your tutor"),
                    style = MaterialTheme.typography.titleLarge,
                    color = Lab.colors.ink,
                )
                if (tutors.size > 1) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Send to", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                        for (t in tutors) LabChip(t.name, selected = t == tutor, enabled = !busy && done == null) { tutor = t }
                    }
                }
            }
        },
        footerAbove = error?.takeIf { done == null }?.let { e -> { InlineNotice(e, kind = NoticeKind.Error) } },
        footer = {
            if (done != null) {
                SecondaryPill("Close", Modifier.weight(1f).height(50.dp), onClick = onDismiss)
            } else {
                SecondaryPill("Cancel", Modifier.weight(1f).height(50.dp), enabled = !busy, onClick = onDismiss)
                PrimaryPill(if (busy) "Sending…" else "Send", Modifier.weight(1f).height(50.dp), enabled = !busy && message.isNotBlank() && tutor != null) { submit() }
            }
        },
    ) {
        AnimatedContent(done, transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.9f)) togetherWith fadeOut() }, label = "flag") { d ->
            if (d != null) {
                InlineNotice("✓ $d", kind = NoticeKind.Success)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = message,
                        onValueChange = { if (it.length <= 2000) message = it },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 110.dp),
                        placeholder = { Text("What's confusing? e.g. I keep mixing this up with 很行") },
                        enabled = !busy,
                        shape = RoundedCornerShape(16.dp),
                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
                    )
                    Text(
                        "Your tutor gets it in the chat with a link to this card, and their reply shows here next time.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Lab.colors.muted,
                    )
                }
            }
        }
    }
}

/**
 * Tap a character on the back → its definition (components/WordDefinitionPopup.tsx): cached
 * on the device first, "Already in <deck>", Add to Flashcards / Add anyway, Refresh.
 */
@Composable
fun WordDefinitionSheet(
    hanzi: String,
    context: String,
    define: suspend (hanzi: String, context: String, refresh: Boolean) -> CardTools.Definition,
    deckHolding: suspend (String) -> String?,
    addNote: suspend (VocabularyDefinition) -> Unit,
    onDismiss: () -> Unit,
    bump: dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi? = dev.jeromeswannack.chineselearning.lab.ui.bumps.rememberBumpHanzi("breakdown"),
) {
    LabSheetFrame(onDismiss = onDismiss) { WordDefinitionBody(hanzi, context, define, deckHolding, addNote, onDismiss, bump = bump) }
}

@Composable
fun WordDefinitionBody(
    hanzi: String,
    context: String,
    define: suspend (hanzi: String, context: String, refresh: Boolean) -> CardTools.Definition,
    deckHolding: suspend (String) -> String?,
    addNote: suspend (VocabularyDefinition) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    /** "⚡ Study it today" when the word is already a card (null = none: previews). */
    bump: dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi? = null,
) {
    var bumped by remember(hanzi) { mutableStateOf<String?>(null) }
    var definition by remember(hanzi) { mutableStateOf<CardTools.Definition?>(null) }
    var loading by remember(hanzi) { mutableStateOf(true) }
    var error by remember(hanzi) { mutableStateOf<String?>(null) }
    var existing by remember(hanzi) { mutableStateOf<String?>(null) }
    var saved by remember(hanzi) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun load(refresh: Boolean) {
        loading = true
        error = null
        scope.launch {
            try {
                definition = define(hanzi, context, refresh)
            } catch (e: Exception) {
                error = if (refresh) "Failed to refresh definition." else "Failed to load definition. Please try again."
            } finally {
                loading = false
            }
        }
    }
    LaunchedEffect(hanzi) {
        load(refresh = false)
        existing = runCatching { deckHolding(hanzi) }.getOrNull()
    }

    val d = definition?.value
    // A long explanation scrolls; Add to Flashcards / Refresh / Close stay pinned (SheetScaffold).
    SheetScaffold(
        modifier,
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
        spacing = 0.dp,
        footerAbove = if (saved) {
            { InlineNotice("Added — it arrives with the next sync.", kind = NoticeKind.Success) }
        } else bumped?.let { m -> { InlineNotice(m, kind = NoticeKind.Success) } },
        footer = if (d == null || loading || error != null || saved) null else if (existing != null && bump != null) {
            {
                // Already a card: "⚡ Study it today" first, adding it again second.
                SecondaryPill("Add anyway", Modifier.height(50.dp), enabled = bumped == null) {
                    scope.launch {
                        try { addNote(d); saved = true; delay(900); onDismiss() } catch (e: Exception) { error = CardTools.message(e) }
                    }
                }
                PrimaryPill(if (bumped != null) "⚡ Bumped" else dev.jeromeswannack.chineselearning.lab.ui.bumps.STUDY_IT_TODAY, Modifier.weight(1f).height(50.dp).testTag("bump-study-today"), enabled = bumped == null) {
                    scope.launch {
                        try { bumped = bump(listOf(d.hanzi), null); delay(1400); onDismiss() } catch (e: Exception) { error = CardTools.message(e) }
                    }
                }
            }
        } else {
            {
                PrimaryPill(if (existing != null) "Add anyway" else "Add to Flashcards", Modifier.weight(1f).height(50.dp)) {
                    scope.launch {
                        try { addNote(d); saved = true; delay(900); onDismiss() } catch (e: Exception) { error = CardTools.message(e) }
                    }
                }
                if (definition?.fromCache == true) SecondaryPill("Refresh", Modifier.height(50.dp)) { load(refresh = true) }
                SecondaryPill("Close", Modifier.height(50.dp), onClick = onDismiss)
            }
        },
    ) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            when {
                loading -> Box(Modifier.fillMaxWidth().height(140.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Lab.colors.accent) }
                error != null -> InlineNotice(error!!, kind = NoticeKind.Error, actionLabel = "Retry", onAction = { load(refresh = false) })
                d != null -> {
                    Text(d.hanzi, fontSize = 56.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                    Text(d.pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent)
                    Spacer(Modifier.height(4.dp))
                    Text(d.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    d.fun_facts?.takeIf { it.isNotBlank() }?.let {
                        Spacer(Modifier.height(12.dp))
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(12.dp))
                    }
                    d.example?.takeIf { it.isNotBlank() }?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth())
                    }
                    existing?.let {
                        Spacer(Modifier.height(12.dp))
                        InlineNotice("Already in \"$it\"", kind = NoticeKind.Warning)
                    }
                }
            }
        }
    }
}

/**
 * The one-time explainer over the very first card (components/onboarding/FirstCardExplainer.tsx),
 * shown while there are no review events anywhere yet.
 */
@Composable
fun FirstCardExplainer(onDismiss: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable(enabled = false) {}, contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(20.dp).widthIn(max = 480.dp).clip(RoundedCornerShape(24.dp)).background(Lab.colors.card).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Before your first card", style = MaterialTheme.typography.headlineSmall, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
            ExplainerLine("1", "You'll see each word three ways", " — read it and say it, hear it and type it, see the English and type it.")
            ExplainerLine("2", "Answer first, then check with the buttons below.", " Tap the speaker any time to hear the word again.")
            ExplainerLine("3", "Rate yourself honestly", " — if you didn't get it right, always tap Again. That is how the app knows what to show you tomorrow.")
            Text(
                "Recording your voice is optional — you can skip it. Your phone asks for the microphone the first time you tap Record.",
                style = MaterialTheme.typography.bodySmall,
                color = Lab.colors.muted,
            )
            PrimaryPill("Got it", Modifier.fillMaxWidth().height(54.dp), onClick = onDismiss)
        }
    }
}

@Composable
private fun ExplainerLine(n: String, bold: String, rest: String) {
    Row {
        Box(Modifier.size(26.dp).clip(CircleShape).background(Lab.colors.accentSoft), contentAlignment = Alignment.Center) {
            Text(n, color = Lab.colors.accent, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        }
        Spacer(Modifier.width(10.dp))
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold)); append(bold); pop(); append(rest)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = Lab.colors.ink,
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * The top-bar offline control (components/study/OfflineModeToggle.tsx): automatic from the
 * network, tap to force offline on a spotty connection; the label says which.
 */
@Composable
fun OfflinePill(online: Boolean, forced: Boolean, pending: Int, onToggle: () -> Unit) {
    val (label, color) = when {
        forced -> "Forced" to Palette.Hard
        !online -> "Offline" to Lab.colors.muted
        else -> "Auto" to Palette.Good
    }
    val suffix = if ((forced || !online) && pending > 0) " ($pending)" else ""
    Row(
        Modifier
            .heightIn(min = 32.dp)
            .clip(CircleShape)
            .background(color.copy(alpha = 0.13f))
            .bouncyClickable(onClick = onToggle)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("✈", color = color, fontSize = 13.sp)
        Spacer(Modifier.width(4.dp))
        Text(label + suffix, color = color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    }
}
