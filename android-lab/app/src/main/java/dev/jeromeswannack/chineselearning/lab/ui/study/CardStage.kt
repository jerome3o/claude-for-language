package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.expandVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.zIndex
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.ui.fx.ShakeState
import dev.jeromeswannack.chineselearning.lab.ui.fx.SparkBurst
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import androidx.compose.runtime.collectAsState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText

/** Card-local state that tests / screenshots can start from. */
data class CardStartState(
    /** Start revealed, showing the answer side. */
    val flipped: Boolean = false,
    /** Start revealed but peeking back at the question side (tap empty space on the answer). */
    val peeking: Boolean = false,
    val answer: String = "",
    val showClue: Boolean = false,
    /** The answer came from the multiple-choice grid: its per-row result (shown row by row on the back). */
    val mcSlots: List<MultipleChoice.Slot>? = null,
)

/** The sheets a card can open over itself. */
private sealed interface CardSheet {
    data object More : CardSheet
    data object Edit : CardSheet
    data object Flag : CardSheet
    data object Ask : CardSheet
    data object Write : CardSheet
    data class Define(val hanzi: String) : CardSheet
}

@Composable
fun CardStage(
    view: CardView,
    ui: StudyUi,
    playingKey: String?,
    actions: StudyActions,
    start: CardStartState = CardStartState(),
    autoplay: Boolean = true,
) {
    val note = view.note
    val typing = view.card.cardType != CardTypes.HANZI_TO_MEANING
    // [revealed]: the answer has been shown (checked once — the ratings are up). [flipped]: which
    // face is showing. They only differ while peeking back at the question (tap empty space on the
    // answer side; tap the question to come back): a view-only flip — no re-check, nothing recorded.
    var revealed by remember(view.presentation) { mutableStateOf(start.flipped || start.peeking) }
    var flipped by remember(view.presentation) { mutableStateOf(start.flipped && !start.peeking) }
    var answer by remember(view.presentation) { mutableStateOf(start.answer) }
    var mcSlots by remember(view.presentation) { mutableStateOf(start.mcSlots) }
    var verdict by remember(view.presentation) {
        mutableStateOf(if ((start.flipped || start.peeking) && typing && start.answer.isNotBlank()) AnswerKey.check(start.answer, note.hanzi, view.alternatives) else null)
    }
    var rated by remember(view.presentation) { mutableStateOf(false) }
    var sheet by remember(view.presentation) { mutableStateOf<CardSheet?>(null) }
    var burst by remember { mutableIntStateOf(0) }
    val startedAt = remember(view.presentation) { System.currentTimeMillis() }
    val shake = remember { ShakeState() }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }

    val rotation by animateFloatAsState(
        targetValue = if (flipped) 180f else 0f,
        animationSpec = spring(dampingRatio = 0.78f, stiffness = 240f),
        label = "flip",
    )
    val glow by animateColorAsState(
        targetValue = when {
            verdict == null -> Lab.colors.cardBorder
            AnswerKey.isAccepted(verdict!!) -> Palette.Good
            else -> Palette.Again.copy(alpha = 0.75f)
        },
        label = "glow",
    )

    LaunchedEffect(view.presentation) {
        if (!autoplay) return@LaunchedEffect
        if (view.card.cardType == CardTypes.AUDIO_TO_HANZI && !revealed) {
            delay(250)
            actions.onPlayWord(false)
        } else if (typing && !revealed) {
            runCatching { focus.requestFocus() }
        }
    }

    fun reveal() {
        if (revealed) return
        val v = if (typing && answer.isNotBlank()) AnswerKey.check(answer, note.hanzi, view.alternatives) else null
        verdict = v
        revealed = true
        flipped = true
        actions.onReveal(v)
        if (v != null && AnswerKey.isAccepted(v)) burst++
        if (v != null && !AnswerKey.isAccepted(v)) scope.launch { shake.shake() }
        scope.launch {
            delay(if (v != null && AnswerKey.isAccepted(v)) 380 else 160)
            if (autoplay) actions.onPlayWord(false)
        }
    }

    /** Peek: turn a revealed card to [toBack] (the same flip + haptic) — nothing checked, played or recorded. */
    fun peek(toBack: Boolean) {
        if (!revealed || flipped == toBack) return
        flipped = toBack
        actions.onPeek()
    }
    val peekToFront by rememberUpdatedState { peek(false) }

    val typed = answer.trim().takeIf { typing && it.isNotEmpty() }
    val mc = ui.extras.mc
    val mcGridUp = !revealed && typing && mc.showing && mc.rows != null
    BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
    // A long multiple-choice answer (a sentence: a dozen rows) must never push the question off
    // the top or the submit button off the bottom: the card keeps [cardMin] for the prompt and
    // the grid gets the rest, scrolling its rows above a pinned button.
    val cardMin = (maxHeight * 0.26f).coerceIn(160.dp, 240.dp)
    val controlsMax = (maxHeight - cardMin).coerceAtLeast(0.dp)
    Column(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            val wide = maxWidth >= 640.dp
            val density = LocalDensity.current
            Box(
                Modifier
                    .fillMaxSize()
                    .offset { IntOffset(shake.offset.value.roundToInt(), 0) }
                    .graphicsLayer {
                        rotationY = rotation
                        cameraDistance = 14f * density.density
                    }
                    .shadow(if (flipped) 10.dp else 6.dp, RoundedCornerShape(28.dp))
                    .clip(RoundedCornerShape(28.dp))
                    .background(Lab.colors.card)
                    .border(if (verdict != null) 2.dp else 1.dp, glow, RoundedCornerShape(28.dp)),
            ) {
                // Once revealed both faces stay composed (the answer side keeps its scroll
                // position and opened sentence rows through a peek); the one turned away is
                // invisible, silent to accessibility and under the other, which takes every touch.
                val backShowing = rotation > 90f
                Box(Modifier.fillMaxSize().face(visible = !backShowing)) {
                    CardFront(
                        view, ui, playingKey, actions, start.showClue, revealed,
                        onTapToReveal = { if (revealed) peek(true) else if (!typing) reveal() },
                    )
                }
                if (revealed) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .face(visible = backShowing)
                            .graphicsLayer { rotationY = 180f }
                            .testTag(CARD_BACK_TAG)
                            // A tap on empty space peeks at the question. Buttons, links, rows and
                            // the answer consume their own taps; a drag (scroll) or a long press never flips.
                            .pointerInput(Unit) { detectTapGestures(onLongPress = {}) { peekToFront() } },
                    ) {
                        CardBack(view, ui, typed, verdict, mcSlots, playingKey, actions, wide, onCharacter = { sheet = CardSheet.Define(it) })
                    }
                }
            }
            SparkBurst(burst, listOf(Palette.Good, Palette.Gold, Palette.Easy, Color.White), origin = Offset(0.5f, 0.3f))
        }

        // Bottom controls
        Column(
            Modifier
                .fillMaxWidth()
                .then(if (mcGridUp) Modifier.heightIn(max = controlsMax) else Modifier)
                .padding(horizontal = 16.dp)
                .padding(bottom = 12.dp),
        ) {
            if (!revealed) {
                if (mcGridUp) {
                    McGrid(
                        rows = mc.rows!!,
                        aiAvailable = ui.aiAvailable,
                        regenerating = mc.loading,
                        onSubmit = { chosen, slots -> answer = chosen; mcSlots = slots; reveal() },
                        onTypeInstead = actions.onTypeInstead,
                        onRegenerate = actions.onRegenerateMc,
                        onPick = actions.onTick,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                } else if (typing && mc.ready && view.card.cardType == CardTypes.AUDIO_TO_HANZI) {
                    PrimaryPill("Show options", Modifier.fillMaxWidth().height(60.dp), onClick = actions.onRevealMc)
                } else if (typing && mc.auto && mc.loading && !mc.skip) {
                    McLoading(actions.onTypeInstead)
                } else if (typing) {
                    mc.fallbackNote?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp), textAlign = TextAlign.Center)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = answer,
                            onValueChange = { answer = it },
                            modifier = Modifier.weight(1f).focusRequester(focus),
                            placeholder = { Text(if (view.card.cardType == CardTypes.AUDIO_TO_HANZI) "Type what you hear…" else "Type in Chinese…") },
                            singleLine = true,
                            textStyle = MaterialTheme.typography.titleLarge,
                            shape = RoundedCornerShape(18.dp),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { reveal() }),
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
                        )
                        Spacer(Modifier.width(10.dp))
                        PrimaryPill(if (answer.isBlank()) "Show" else "Check", Modifier.height(56.dp)) { reveal() }
                    }
                } else {
                    RecordControls(ui.extras.take, actions, onReveal = { reveal() })
                }
            } else {
                StudyActionRow(
                    aiAvailable = ui.aiAvailable,
                    onAskClaude = { sheet = CardSheet.Ask },
                    onEditCard = { sheet = CardSheet.Edit },
                    onMore = { sheet = CardSheet.More },
                )
                Spacer(Modifier.height(10.dp))
                RatingBar(view.previews, enabled = !rated) { rating ->
                    rated = true
                    actions.onRate(rating, System.currentTimeMillis() - startedAt, answer.takeIf { typing && it.isNotEmpty() })
                }
            }
        }
    }
    }

    when (val s = sheet) {
        null -> Unit
        CardSheet.More -> StudyMoreSheet(
            items = studyMenuItems(view, ui, actions, hasRecording = ui.extras.take.hasTake, onFlag = { sheet = CardSheet.Flag }, onWrite = { sheet = CardSheet.Write }),
            footer = CardExtrasLogic.formatAddedDate(note.createdAt),
            onDismiss = { if (sheet == CardSheet.More) sheet = null },
        )
        CardSheet.Flag -> FlagCardSheet(ui.extras.flagTutors, note.hanzi, actions.sendFlag, onDismiss = { sheet = null })
        CardSheet.Edit -> EditCardSheet(note, ui.aiAvailable, actions.edit, onDismiss = { sheet = null })
        CardSheet.Write -> dev.jeromeswannack.chineselearning.lab.ui.strokes.WritingSheet(note.hanzi, onClose = { sheet = null }, pinyin = note.pinyin, english = note.english)
        CardSheet.Ask -> AskClaudeSheet(view, ui.extras.ask, typed, actions.ask, onDismiss = { sheet = null })
        is CardSheet.Define -> WordDefinitionSheet(
            hanzi = s.hanzi,
            context = note.hanzi,
            define = actions.define,
            deckHolding = actions.deckHolding,
            addNote = actions.addDefinition,
            onDismiss = { sheet = null },
        )
    }
}

@Composable
private fun CardFront(view: CardView, ui: StudyUi, playingKey: String?, actions: StudyActions, startShowClue: Boolean, revealed: Boolean, onTapToReveal: () -> Unit) {
    val note = view.note
    var showClue by remember(view.presentation) { mutableStateOf(startShowClue) }
    val generating = CardBusy.SENTENCE_CLUE in ui.extras.busy
    BoxWithConstraints(Modifier.fillMaxSize()) {
    // Short card (a long multiple-choice grid below takes most of the screen): a tighter front
    // that scrolls rather than clipping — the prompt stays readable above the grid.
    val short = maxHeight < SHORT_FRONT
    val frontScroll = rememberScrollState()
    Column(
        (if (short) Modifier.fillMaxSize().verticalScroll(frontScroll).heightIn(min = maxHeight) else Modifier.fillMaxSize())
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onTapToReveal)
            .padding(if (short) 14.dp else 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = if (short) Arrangement.spacedBy(6.dp, Alignment.CenterVertically) else Arrangement.Top,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            TypeChip(view.card.cardType)
            view.deckName?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, maxLines = 1) }
        }
        note.context?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(12.dp))
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = Lab.colors.muted,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(10.dp).heightIn(max = 80.dp),
            )
        }
        if (!short) Spacer(Modifier.weight(1f))
        when (view.card.cardType) {
            CardTypes.HANZI_TO_MEANING -> Text(
                note.hanzi,
                fontSize = hanziSize(note.hanzi),
                fontWeight = FontWeight.Medium,
                color = Lab.colors.ink,
                textAlign = TextAlign.Center,
                lineHeight = hanziSize(note.hanzi) * 1.2f,
            )
            CardTypes.MEANING_TO_HANZI -> Text(
                note.english,
                style = if (short) MaterialTheme.typography.titleLarge else MaterialTheme.typography.headlineMedium,
                color = Lab.colors.ink,
                textAlign = TextAlign.Center,
            )
            else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                BigPlayButton(playing = isWordPlaying(playingKey, view, ui), size = if (short) 76.dp else 132.dp) { actions.onPlayWord(true) }
                val voices = ui.extras.voices
                if (voices.size > 1) {
                    Spacer(Modifier.height(8.dp))
                    Text("Voice ${ui.extras.voiceIndex + 1}/${voices.size} · tap for the next", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                }
                OfflineAudioNote(view, ui)
            }
        }
        if (!short) Spacer(Modifier.weight(1f))
        if (revealed) {
            // Peeking back at the question: the hints are spent, the answer is one tap away.
            Text("Tap to see the answer", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        } else {
            val clue = note.sentenceClue?.takeIf { it.isNotBlank() }
            val reading = view.card.cardType == CardTypes.HANZI_TO_MEANING
            // On the front only what doesn't give the answer away: the sentence text on a read
            // card, its audio on the typing cards (the text would show the hanzi).
            AnimatedVisibility(showClue && clue != null && reading, enter = fadeIn() + expandVertically()) {
                Text(clue.orEmpty(), style = MaterialTheme.typography.titleMedium, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 4.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val clueEnabled = !generating && (clue != null || ui.aiAvailable)
                TextButton(
                    enabled = clueEnabled,
                    onClick = {
                        when {
                            clue == null -> actions.onGenerateSentenceClue()
                            reading -> showClue = !showClue
                            else -> actions.onPlay(note.sentenceClueAudioUrl, clue)
                        }
                    },
                ) {
                    val tint = if (clueEnabled) Lab.colors.accent else Lab.colors.muted
                    Icon(Icons.Filled.Lightbulb, null, Modifier.size(18.dp), tint = tint)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        when {
                            generating -> "Generating…"
                            clue == null && !ui.aiAvailable -> "Use in sentence · $NEEDS_INTERNET"
                            reading && showClue -> "Hide sentence"
                            reading || clue == null -> "Use in a sentence"
                            else -> "Play a sentence"
                        },
                        color = tint,
                    )
                }
                if (clue != null && (showClue || !reading) && ui.aiAvailable) {
                    TextButton(enabled = !generating, onClick = actions.onGenerateSentenceClue) { Text("↻", color = Lab.colors.muted, fontSize = 18.sp) }
                }
            }
            val mc = ui.extras.mc
            if (!reading && !mc.showing && !mc.ready) {
                val mcEnabled = !mc.loading && (mc.cached || ui.aiAvailable)
                TextButton(enabled = mcEnabled, onClick = actions.onShowMc) {
                    Text(
                        when { mc.loading -> "Building options…"; !mcEnabled -> "Multiple choice · $NEEDS_INTERNET"; else -> "Multiple choice" },
                        color = if (mcEnabled) Lab.colors.accent else Lab.colors.muted,
                    )
                }
            }
            if (reading) {
                Text("Say it aloud, then tap to check", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
            }
        }
    }
    }
}

private fun isWordPlaying(playingKey: String?, view: CardView, ui: StudyUi): Boolean =
    playingKey != null && (playingKey == view.note.audioUrl || playingKey == "tts:${view.note.hanzi}" || playingKey in ui.extras.voices)

/** One quiet line: offline and this word's clip was never downloaded (OfflineAudioNote.tsx). */
@Composable
private fun OfflineAudioNote(view: CardView, ui: StudyUi) {
    if (ui.aiAvailable || view.audioCached) return
    Spacer(Modifier.height(8.dp))
    Text("Audio not downloaded for this word — using the device voice.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
}

@Composable
private fun CardBack(
    view: CardView,
    ui: StudyUi,
    typed: String?,
    verdict: AnswerKey.Verdict?,
    mcSlots: List<MultipleChoice.Slot>?,
    playingKey: String?,
    actions: StudyActions,
    wide: Boolean,
    onCharacter: (String) -> Unit,
) {
    val note = view.note
    val onChar: (String) -> Unit = { ch -> if (CardExtrasLogic.isLookupCharacter(ch)) onCharacter(ch) }
    val main: @Composable () -> Unit = {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            if (typed != null && verdict != null && mcSlots != null && !MultipleChoice.allRight(mcSlots)) {
                // A multiple-choice answer (possibly partial): row by row
                Box(Modifier.keepTaps()) { McAnswerDiff(mcSlots, hanziSize(note.hanzi) * 0.7f, onChar) }
            } else if (typed != null && verdict != null) {
                Box(Modifier.keepTaps()) { AnswerDiff(typed, note.hanzi, verdict, onChar) }
            } else {
                TappableHanzi(note.hanzi, hanziSize(note.hanzi) * 0.85f, Lab.colors.ink, onChar)
            }
            Box(Modifier.keepTaps()) { TranscriptionLine(ui.extras.take.transcription) }
            Spacer(Modifier.height(8.dp))
            Text(note.pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent, textAlign = TextAlign.Center)
            if (ui.extras.tutorNotes.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Box(Modifier.keepTaps()) { TutorNoteLine(ui.extras.tutorNotes) }
            }
            Spacer(Modifier.height(4.dp))
            Text(note.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            val playing = isWordPlaying(playingKey, view, ui)
            val voices = ui.extras.voices
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    Modifier.clip(CircleShape).background(if (playing) Lab.colors.accentSoft else Lab.colors.faint).clickable { actions.onPlayWord(true) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.AutoMirrored.Filled.VolumeUp, null, Modifier.size(18.dp), tint = Lab.colors.accent)
                    Spacer(Modifier.width(6.dp))
                    Text(if (voices.size > 1) "Play (${ui.extras.voiceIndex + 1}/${voices.size})" else "Play", color = Lab.colors.ink, style = MaterialTheme.typography.labelLarge)
                }
                if (view.card.cardType == CardTypes.HANZI_TO_MEANING) RecordAgainPill(ui.extras.take, actions)
            }
            OfflineAudioNote(view, ui)
            ui.extras.notice?.let {
                Spacer(Modifier.height(10.dp))
                Box(Modifier.keepTaps()) { InlineNotice(it, kind = NoticeKind.Error, actionLabel = "OK", onAction = actions.onDismissNotice) }
            }
        }
    }
    val details: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth()) {
            note.funFacts?.takeIf { it.isNotBlank() }?.let {
                MarkdownText(
                    it,
                    Modifier.fillMaxWidth().keepTaps().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).padding(14.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(16.dp))
            }
            Box(Modifier.keepTaps()) { SentenceList(view, ui, playingKey, actions) }
        }
    }
    if (wide) {
        Row(Modifier.fillMaxSize().padding(24.dp)) {
            Box(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) { main() }
            Spacer(Modifier.width(24.dp))
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) { details() }
        }
    } else {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp)) {
            Spacer(Modifier.height(8.dp))
            main()
            Spacer(Modifier.height(20.dp))
            details()
        }
    }
}

/** Below this the question side goes compact (a long multiple-choice grid is under it). */
private val SHORT_FRONT = 330.dp

/** Test tag of the answer side (its empty space peeks back at the question). */
const val CARD_BACK_TAG = "card-back"

/** One face of the card: the one turned away is see-through, has no semantics and sits under the other. */
private fun Modifier.face(visible: Boolean): Modifier =
    zIndex(if (visible) 1f else 0f).then(if (visible) Modifier else Modifier.graphicsLayer { alpha = 0f }.clearAndSetSemantics { })

/**
 * A block on the answer side whose taps are its own (the answer diff, notes, the sentences):
 * a tap on it — even between its controls — never peeks back at the question. Drags pass through.
 */
private fun Modifier.keepTaps(): Modifier = pointerInput(Unit) { detectTapGestures { } }

/** Hanzi where each character can be tapped for its definition (`hanzi-char-clickable`). */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun TappableHanzi(text: String, size: TextUnit, color: Color, onChar: (String) -> Unit, weight: FontWeight = FontWeight.Medium) {
    val chars = text.codePoints().toArray().map { String(Character.toChars(it)) }
    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.Center) {
        for (ch in chars) {
            Text(
                ch,
                fontSize = size,
                fontWeight = weight,
                color = color,
                lineHeight = size * 1.15f,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { onChar(ch) },
            )
        }
    }
}

/**
 * The web's AnswerDiff: accepted answers in green with their pinyin; otherwise a
 * character-by-character diff with the pinyin of what was typed — wrong characters red and
 * underlined, missing ones a "?" with a dashed underline ([AnswerMarks]). Characters are tappable.
 */
@Composable
private fun AnswerDiff(typed: String, correct: String, verdict: AnswerKey.Verdict, onChar: (String) -> Unit) {
    val size = hanziSize(correct) * 0.7f
    val pinyinStyle = MaterialTheme.typography.bodyMedium
    when (verdict) {
        AnswerKey.Verdict.EXACT, AnswerKey.Verdict.PUNCTUATION_ONLY -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // A punctuation-only difference shows the canonical answer (with its punctuation).
            val shown = if (verdict == AnswerKey.Verdict.EXACT) typed else correct
            TappableHanzi(shown, size, Palette.Good, onChar)
            Text(Pinyin.of(shown), style = pinyinStyle, color = Lab.colors.muted, textAlign = TextAlign.Center)
        }
        AnswerKey.Verdict.ALTERNATIVE, AnswerKey.Verdict.EQUIVALENT -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            TappableHanzi(typed, size, Palette.Good, onChar)
            Text(Pinyin.of(typed), style = pinyinStyle, color = Lab.colors.muted, textAlign = TextAlign.Center)
            Text("Also accepted — canonical answer:", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
            TappableHanzi(correct, size * 0.8f, Lab.colors.ink, onChar)
            Text(Pinyin.of(correct), style = pinyinStyle, color = Lab.colors.muted, textAlign = TextAlign.Center)
        }
        AnswerKey.Verdict.WRONG -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // Wrong characters red + underlined, missing ones a "?" with a dashed underline (AnswerMarks).
            val diff = AnswerMarks.typedDiff(typed, correct)
            MarkedAnswerRow(diff.typed, size * 0.8f, onChar)
            Text(Pinyin.of(typed), style = pinyinStyle, color = Lab.colors.muted, textAlign = TextAlign.Center)
            Text("↓", color = Lab.colors.muted)
            Row { diff.expected.forEach { e -> Text(e.char, fontSize = size, color = if (e.matched) Palette.Good else Lab.colors.ink, fontWeight = FontWeight.Medium, modifier = Modifier.clickable { onChar(e.char) }) } }
        }
    }
}

@Composable
fun RatingBar(previews: List<IntervalPreview>, enabled: Boolean, onRate: (Int) -> Unit) {
    val labels = listOf("Again", "Hard", "Good", "Easy")
    val colors = listOf(Palette.Again, Palette.Hard, Palette.Good, Palette.Easy)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (r in Rating.ALL) {
            val source = remember { MutableInteractionSource() }
            val pressed by source.collectIsPressedAsState()
            val scale by animateFloatAsState(if (pressed) 0.92f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium), label = "press")
            Column(
                Modifier
                    .weight(1f)
                    .height(66.dp)
                    .scale(scale)
                    .clip(RoundedCornerShape(18.dp))
                    .background(colors[r].copy(alpha = if (enabled) 1f else 0.4f))
                    .clickable(interactionSource = source, indication = null, enabled = enabled) { onRate(r) },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(labels[r], color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                previews.getOrNull(r)?.let { Text(it.intervalText, color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp) }
            }
        }
    }
}

@Composable
private fun TypeChip(cardType: String) {
    val (label, color) = when (cardType) {
        CardTypes.HANZI_TO_MEANING -> "Read · 读" to Palette.Easy
        CardTypes.MEANING_TO_HANZI -> "Write · 写" to Palette.Secondary
        else -> "Listen · 听" to Palette.Hard
    }
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        modifier = Modifier.clip(CircleShape).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
private fun BigPlayButton(playing: Boolean, size: Dp = 132.dp, onClick: () -> Unit) {
    val pulse by animateFloatAsState(if (playing) 1.08f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow), label = "pulse")
    Box(
        Modifier.size(size).scale(pulse).clip(CircleShape).background(Lab.colors.accentSoft).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.AutoMirrored.Filled.VolumeUp, "Play", Modifier.size(size * 0.42f), tint = Lab.colors.accent)
    }
}

private fun hanziSize(hanzi: String): TextUnit = when {
    hanzi.length <= 2 -> 76.sp
    hanzi.length <= 4 -> 60.sp
    hanzi.length <= 8 -> 44.sp
    hanzi.length <= 14 -> 34.sp
    else -> 26.sp
}

/**
 * Front of a read card (StudyPage.tsx `renderSpeakingCardButtons`): record yourself saying
 * it (the primary button — the card prompts you to speak), or skip straight to the answer. While recording: a level meter and Stop (after half a
 * second, so a double tap can't end it); with a take: play it back / re-record / check.
 */
@Composable
private fun RecordControls(take: TakeUi, actions: StudyActions, onReveal: () -> Unit) {
    val start = rememberRecordPermission { actions.onStartRecording(false) }
    when {
        take.recording && take.starting -> PrimaryPill("Recording…", Modifier.fillMaxWidth().height(60.dp), color = Palette.Again, enabled = false) {}
        take.recording -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            val level by actions.recordingLevel.collectAsState()
            val shown by animateFloatAsState((level * 2f).coerceIn(0.03f, 1f), spring(stiffness = 600f), label = "level")
            Box(Modifier.fillMaxWidth(0.8f).height(6.dp).clip(CircleShape).background(Lab.colors.faint)) {
                Box(
                    Modifier.fillMaxWidth(shown).fillMaxSize().clip(CircleShape)
                        .background(if (level > 0.4f) Palette.Again else if (level > 0.15f) Palette.Good else Lab.colors.muted),
                )
            }
            Spacer(Modifier.height(10.dp))
            PrimaryPill("⏹  Stop recording", Modifier.fillMaxWidth().height(60.dp), color = Palette.Again) { actions.onStopRecording(false) }
        }
        take.hasTake -> Column {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryPill("▶ Play recording", Modifier.weight(1f).height(48.dp), onClick = actions.onPlayMyRecording)
                SecondaryPill("Re-record", Modifier.weight(1f).height(48.dp), onClick = actions.onClearRecording)
            }
            Spacer(Modifier.height(8.dp))
            PrimaryPill("Check answer", Modifier.fillMaxWidth().height(60.dp), onClick = onReveal)
        }
        // Record is the prompt (the web's primary "Record Your Pronunciation"): the big filled
        // button on the thumb side; Show answer is the outlined skip.
        else -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryPill("Show answer", Modifier.weight(1f).height(60.dp), onClick = onReveal)
            PrimaryPill("🎤  Record", Modifier.weight(1.4f).height(60.dp), onClick = start)
        }
    }
}

/** 🎤 Record again / ⏹ Stop recording on the back (the web's study-back-pills). */
@Composable
private fun RecordAgainPill(take: TakeUi, actions: StudyActions) {
    val again = rememberRecordPermission { actions.onStartRecording(true) }
    val (label, onClick, color) = when {
        take.recording && take.starting -> Triple("Recording…", {}, Palette.Again)
        take.recording -> Triple("⏹ Stop recording", { actions.onStopRecording(true) }, Palette.Again)
        else -> Triple("🎤 Record again", again, Lab.colors.ink)
    }
    Text(
        label,
        color = color,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier.clip(CircleShape).background(if (take.recording) Palette.Again.copy(alpha = 0.12f) else Lab.colors.faint).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
    )
}

/** Asks for the microphone once, then runs [onGranted]. */
@Composable
private fun rememberRecordPermission(onGranted: () -> Unit): () -> Unit {
    val context = androidx.compose.ui.platform.LocalContext.current
    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { ok -> if (ok) onGranted() }
    return {
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (granted) onGranted() else launcher.launch(android.Manifest.permission.RECORD_AUDIO)
    }
}

/** "You said: …" under the answer (the web's renderTranscriptionResult). */
@Composable
private fun TranscriptionLine(t: TranscriptionUi?) {
    val (text, tint) = when (t) {
        null, TranscriptionUi.Failed -> return
        TranscriptionUi.Working -> "Transcribing…" to Palette.Easy
        TranscriptionUi.Offline -> "Recording saved, will transcribe when online" to Lab.colors.muted
        is TranscriptionUi.Done -> {
            val r = t.result
            val mark = if (r.isMatch || r.containsExpected) "✅" else "❌"
            val color = if (r.isMatch) Palette.Good else if (r.containsExpected) Palette.Hard else Palette.Again
            "You said: ${r.transcribedPinyin} (${r.transcribedHanzi}) $mark" + (if (r.containsExpected && !r.isMatch) "\nAnswer found in your sentence" else "") to color
        }
    }
    Spacer(Modifier.height(6.dp))
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = Lab.colors.ink,
        textAlign = TextAlign.Center,
        modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(tint.copy(alpha = 0.12f)).border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 7.dp),
    )
}
