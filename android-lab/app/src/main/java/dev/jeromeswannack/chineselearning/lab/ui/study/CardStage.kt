package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.ui.kit.AnswerTile
import dev.jeromeswannack.chineselearning.lab.ui.kit.StudyCardFlip
import dev.jeromeswannack.chineselearning.lab.ui.kit.studyCardSurface
import dev.jeromeswannack.chineselearning.lab.ui.kit.studyHanziSize
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
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
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.zIndex
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
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
    /** Time already spent on the card (resumed): the review's time_spent_ms carries on from it. */
    val elapsedMs: Long = 0,
)

/** The sheets a card can open over itself. */
private sealed interface CardSheet {
    data object More : CardSheet
    data object Edit : CardSheet
    data object Flag : CardSheet
    data object Ask : CardSheet
    data object Write : CardSheet
    /** "✍️ Write it" from the character sheet: one character's stroke-order practice. */
    data class WriteText(val text: String) : CardSheet
    /** Tap a character on the back: the card-independent dictionary sheet (ui/chars). */
    data class Character(val char: String) : CardSheet
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
    // The box's own value (selection + the IME's composition, kept while he types). An answer put there
    // from outside (✏️ Edit, a resume) gets the cursor at its end, so editing goes on from it.
    var answerField by remember(view.presentation) { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(start.answer, androidx.compose.ui.text.TextRange(start.answer.length))) }
    var mcSlots by remember(view.presentation) { mutableStateOf(start.mcSlots) }
    // Voice first (docs/STUDY_SESSION.md): a typing card's question opens on the big 🎤 — no box, no
    // keyboard; ✏️ Type switches THIS card to the box (focused). A resumed answer, or a transcript sent
    // to the box by ✏️ Edit on the review, shows the box. Offline (no live transcription) the box comes first.
    var typingMode by remember(view.presentation) { mutableStateOf(start.answer.isNotBlank()) }
    val voiceFirst = ui.aiAvailable && !typingMode
    // Say the answer (🎤): the answer as spoken. While the box still holds exactly it, the back
    // checks it in spoken mode — a homophone (油 for 由) is right by sound (core AnswerKey.checkSpoken).
    var spokenText by remember(view.presentation) { mutableStateOf<String?>(null) }
    // The spoken answer went through the review step (study.spoken_answer_checked `reviewed`).
    var spokenReviewed by remember(view.presentation) { mutableStateOf(false) }
    var consumedSpoken by remember(view.presentation) { mutableIntStateOf(0) }
    fun answerIsSpoken(a: String) = spokenText != null && a.trim() == spokenText
    fun checkAnswer(a: String): AnswerKey.Verdict =
        if (answerIsSpoken(a)) AnswerKey.checkSpoken(a, note.hanzi, view.alternatives, note.pinyin) else AnswerKey.check(a, note.hanzi, view.alternatives)
    var verdict by remember(view.presentation) {
        mutableStateOf(if ((start.flipped || start.peeking) && typing && start.answer.isNotBlank()) AnswerKey.check(start.answer, note.hanzi, view.alternatives) else null)
    }
    var rated by remember(view.presentation) { mutableStateOf(false) }
    var sheet by remember(view.presentation) { mutableStateOf<CardSheet?>(null) }
    var burst by remember { mutableIntStateOf(0) }
    val startedAt = remember(view.presentation) { System.currentTimeMillis() - start.elapsedMs }
    // Tell the session how the card stands, so leaving Study (the coach, Home, the app going
    // away) and coming back shows it exactly like this (StudyViewModel.onCardProgress).
    LaunchedEffect(view.presentation, revealed, answer, mcSlots) { actions.onCardProgress(view.presentation, revealed, answer, mcSlots) }
    val shake = remember { ShakeState() }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }

    val rotation by animateFloatAsState(
        targetValue = if (flipped) 180f else 0f,
        animationSpec = StudyCardFlip,
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
        }
    }
    // The box gets the focus (keyboard up) only once it shows: ✏️ Type, offline, or a resumed answer.
    LaunchedEffect(view.presentation, voiceFirst) {
        if (typing && !revealed && !voiceFirst && (autoplay || typingMode)) runCatching { focus.requestFocus() }
    }

    fun reveal() {
        if (revealed) return
        val v = if (typing && answer.isNotBlank()) checkAnswer(answer) else null
        verdict = v
        revealed = true
        flipped = true
        actions.onReveal(v)
        if (v != null && answerIsSpoken(answer)) actions.onSpokenChecked(v, false, spokenReviewed)
        if (v != null && AnswerKey.isAccepted(v)) burst++
        if (v != null && !AnswerKey.isAccepted(v)) scope.launch { shake.shake() }
        scope.launch {
            delay(if (v != null && AnswerKey.isAccepted(v)) 380 else 160)
            if (autoplay) actions.onPlayWord(false)
        }
    }

    // A spoken answer arrived — ✓ Submit on the review (or at once with "Skip the review" on): checked
    // in spoken mode; ✏️ Edit: into the box, focused, keyboard up. From a "Say it again" (already
    // revealed): the NEW answer is checked (as typed when edited) as the card turns back to it (the
    // ViewModel plays the card's clip once after it).
    val spoken = ui.extras.spoken
    LaunchedEffect(spoken.result?.seq) {
        val r = spoken.result ?: return@LaunchedEffect
        if (r.seq <= consumedSpoken || (revealed && !r.again)) return@LaunchedEffect
        consumedSpoken = r.seq
        answer = r.text
        spokenText = r.transcript
        spokenReviewed = r.reviewed
        if (r.again && revealed) {
            val v = checkAnswer(r.text)
            verdict = v
            actions.onReveal(v)
            if (answerIsSpoken(r.text)) actions.onSpokenChecked(v, true, r.reviewed)
            if (AnswerKey.isAccepted(v)) burst++ else scope.launch { shake.shake() }
        } else if (r.submit) reveal() else {
            typingMode = true
            delay(50)
            runCatching { focus.requestFocus() }
        }
    }

    /** Peek: turn a revealed card to [toBack] (the same flip + haptic) — nothing checked, played or recorded. */
    fun peek(toBack: Boolean) {
        if (!revealed || flipped == toBack) return
        flipped = toBack
        actions.onPeek()
    }
    val peekToFront by rememberUpdatedState { peek(false) }

    // Record again (answer side): the card turns to the question while the new take records, so
    // he reads it from the hanzi alone, not the pinyin / English. A tap anywhere on the card (or
    // Stop) stops it and turns back to the answer, where the take is transcribed as usual; back /
    // Cancel throws the new take away and keeps the previous one. Ratings and FSRS are untouched.
    val reRecording = revealed && ui.extras.take.recording
    var recordFlip by remember(view.presentation) { mutableStateOf(false) }
    LaunchedEffect(reRecording) {
        if (reRecording) {
            recordFlip = true
            flipped = false
        } else if (recordFlip) {
            recordFlip = false
            flipped = true
        }
    }
    BackHandler(enabled = reRecording) { actions.onCancelRecording() }

    // Say it again (a typing card answered by speaking): the same turn to the question while the new
    // take is said — the live transcript there, the previous verdict out of sight — and back to the
    // answer once it is checked or cancelled (✕ / back keeps the previous answer and take).
    val sayingAgain = revealed && spoken.again && spoken.phase != SpokenPhase.IDLE
    var sayFlip by remember(view.presentation) { mutableStateOf(false) }
    LaunchedEffect(sayingAgain) {
        if (sayingAgain) {
            sayFlip = true
            flipped = false
        } else if (sayFlip) {
            sayFlip = false
            flipped = true
        }
    }
    BackHandler(enabled = sayingAgain) { actions.onCancelSpoken() }

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
                    .studyCardSurface(Lab.colors.card, glow, lifted = flipped, borderWidth = if (verdict != null) 2.dp else 1.dp),
            ) {
                // Once revealed both faces stay composed (the answer side keeps its scroll
                // position and opened sentence rows through a peek); the one turned away is
                // invisible, silent to accessibility and under the other, which takes every touch.
                val backShowing = rotation > 90f
                Box(Modifier.fillMaxSize().face(visible = !backShowing).testTag(CARD_FRONT_TAG)) {
                    // Only a revealed card's front takes a tap (peek back to the answer). An
                    // unrevealed card is revealed by its buttons alone — Show answer / Record /
                    // Check / the grid — so a stray tap on the face never gives the answer away.
                    CardFront(
                        view, ui, playingKey, actions, start.showClue, revealed,
                        onTapToAnswer = {
                            when {
                                reRecording -> actions.onStopRecording(true)
                                sayingAgain -> if (spoken.listening) actions.onStopSpoken() // a tap anywhere stops the take
                                else -> peek(true)
                            }
                        },
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
                        // A tapped character opens the language explorer (ui/explorer) — the old sheet only where there is none (previews).
                        val explore = dev.jeromeswannack.chineselearning.lab.ui.explorer.rememberExplorerTap("study", context = note.hanzi)
                        CardBack(view, ui, typed, verdict, mcSlots, playingKey, actions, wide, canSayAgain = typing && mcSlots == null && answerIsSpoken(answer), onCharacter = { ch ->
                            if (explore != null) explore(dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem.Char(ch)) else sheet = CardSheet.Character(ch)
                        })
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
                    if (spoken.reviewing) {
                        // The review step (voice first or from the box's small 🎤 alike): what was
                        // said, big and clear, then 🔁 Retry · ✏️ Edit · ✓ Submit — no box, no keyboard.
                        SpokenReviewControls(spoken, actions)
                    } else if (voiceFirst) {
                        VoiceFirstControls(spoken, ui.aiAvailable, actions, onType = { typingMode = true }, onShow = { reveal() })
                    } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (spoken.busy) {
                            SpokenLiveBox(spoken, Modifier.weight(1f))
                        } else {
                            OutlinedTextField(
                                value = if (answerField.text == answer) answerField else androidx.compose.ui.text.input.TextFieldValue(answer, androidx.compose.ui.text.TextRange(answer.length)),
                                onValueChange = { answerField = it; answer = it.text },
                                modifier = Modifier.weight(1f).focusRequester(focus),
                                placeholder = { Text(if (view.card.cardType == CardTypes.AUDIO_TO_HANZI) "Type what you hear…" else "Type in Chinese…") },
                                singleLine = true,
                                textStyle = MaterialTheme.typography.titleLarge,
                                shape = RoundedCornerShape(18.dp),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { reveal() }),
                                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        SpokenMicButton(spoken, ui.aiAvailable, actions)
                        if (!spoken.busy) {
                            Spacer(Modifier.width(8.dp))
                            PrimaryPill(if (answer.isBlank()) "Show" else "Check", Modifier.height(56.dp)) { reveal() }
                        }
                    }
                    SpokenStatus(spoken, ui.aiAvailable, actions)
                    }
                } else {
                    RecordControls(ui.extras.take, actions, onReveal = { reveal() })
                }
            } else {
                StudyActionRow(
                    aiAvailable = ui.aiAvailable,
                    onAskClaude = { sheet = CardSheet.Ask },
                    onEditCard = { sheet = CardSheet.Edit; dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("study.edit_card") },
                    onMore = { sheet = CardSheet.More },
                )
                Spacer(Modifier.height(10.dp))
                RatingBar(view.previews, enabled = !rated) { rating ->
                    rated = true
                    // Rated during a "Say it again": the ViewModel drops it; [answer] is still the one before it.
                    actions.onRate(rating, System.currentTimeMillis() - startedAt, answer.takeIf { typing && it.isNotEmpty() })
                }
            }
        }
    }
    }

    when (val s = sheet) {
        null -> Unit
        CardSheet.More -> StudyMoreSheet(
            items = studyMenuItems(view, ui, actions, hasRecording = ui.extras.take.hasTake, onFlag = { sheet = CardSheet.Flag }, onWrite = { sheet = CardSheet.Write; dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("study.write_it") }),
            footer = CardExtrasLogic.formatAddedDate(note.createdAt),
            onDismiss = { if (sheet == CardSheet.More) sheet = null },
        )
        CardSheet.Flag -> FlagCardSheet(ui.extras.flagTutors, note.hanzi, actions.sendFlag, onDismiss = { sheet = null })
        CardSheet.Edit -> EditCardSheet(note, ui.aiAvailable, actions.edit, onDismiss = { sheet = null })
        CardSheet.Write -> dev.jeromeswannack.chineselearning.lab.ui.strokes.WritingSheet(note.hanzi, onClose = { sheet = null }, pinyin = note.pinyin, english = note.english)
        CardSheet.Ask -> AskClaudeSheet(
            view, ui.extras.ask, ui.askLanguage, typed, ui.aiAvailable, actions.ask, actions.sentences, onDismiss = { sheet = null },
            listening = ui.askListening, listen = ui.askListen, listenNotice = ui.askListenNotice,
        )
        is CardSheet.WriteText -> dev.jeromeswannack.chineselearning.lab.ui.strokes.WritingSheet(s.text, onClose = { sheet = null })
        is CardSheet.Character -> dev.jeromeswannack.chineselearning.lab.ui.chars.CharacterSheet(
            char = s.char,
            cardHanzi = note.hanzi,
            actions = actions.chars,
            addActions = actions.sentences,
            onClose = { if (sheet == s) sheet = null },
            onWrite = { ch -> sheet = CardSheet.WriteText(ch) },
        )
    }
}

@Composable
private fun CardFront(view: CardView, ui: StudyUi, playingKey: String?, actions: StudyActions, startShowClue: Boolean, revealed: Boolean, onTapToAnswer: () -> Unit) {
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
            // Peeking (revealed): a tap anywhere on the question turns back to the answer.
            // Unrevealed: the face is inert — only the controls below reveal.
            .then(if (revealed) Modifier.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onTapToAnswer) else Modifier)
            .padding(if (short) 14.dp else 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = if (short) Arrangement.spacedBy(6.dp, Alignment.CenterVertically) else Arrangement.Top,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                TypeChip(view.card.cardType)
                if (view.bumped) dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpChip(view.bumpedBy)
            }
            view.deckName?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).padding(start = 8.dp)) }
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
                BigPlayButton(playing = isWordPlaying(playingKey, view, ui), size = if (short) 76.dp else 132.dp, generating = ui.cardAudio.word == ClipState.GENERATING) { actions.onPlayWord(true) }
                val voices = ui.extras.voices
                if (voices.size > 1) {
                    Spacer(Modifier.height(8.dp))
                    Text("Voice ${ui.extras.voiceIndex + 1}/${voices.size} · tap for the next", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                }
                OfflineAudioNote(view, ui)
                // "Audio coming…" only while there is no other voice to play (web: recordings.length === 0).
                if (ui.cardAudio.word != ClipState.READY && !(ui.cardAudio.word == ClipState.COMING && voices.isNotEmpty())) {
                    Spacer(Modifier.height(8.dp))
                    AudioStatusLine(ui.cardAudio.word, actions.onRetryAudio)
                }
            }
        }
        if (!short) Spacer(Modifier.weight(1f))
        if (revealed && ui.extras.take.recording) {
            // Record again: the question while the new take records — a tap anywhere stops it.
            RecordingAgainPanel(actions)
        } else if (revealed && ui.extras.spoken.again && ui.extras.spoken.phase != SpokenPhase.IDLE) {
            // Say it again: the question while the new answer is said — a tap anywhere stops it.
            SayAgainPanel(ui.extras.spoken, ui.aiAvailable, actions)
        } else if (revealed) {
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
                val clueAudioBusy = clue != null && !reading && ui.cardAudio.sentence == ClipState.GENERATING
                val clueEnabled = !generating && !clueAudioBusy && (clue != null || ui.aiAvailable)
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
                            clueAudioBusy -> CardAudioRules.GENERATING
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
                Text("Say it aloud, then check with the buttons below", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
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
    // A clip still to be made says so itself (AudioStatusLine).
    if (ui.aiAvailable || view.audioCached || ui.cardAudio.word != ClipState.READY) return
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
    /** The answer was spoken: "🎤 Say it again" sits beside Play (Record again's place on a read card). */
    canSayAgain: Boolean = false,
    onCharacter: (String) -> Unit,
) {
    val note = view.note
    val onChar: (String) -> Unit = { ch -> if (CardExtrasLogic.isLookupCharacter(ch)) onCharacter(ch) }
    val main: @Composable () -> Unit = {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            if (typed != null && verdict != null && mcSlots != null && !MultipleChoice.allRight(mcSlots)) {
                // A multiple-choice answer (possibly partial): row by row
                KeepTaps { McAnswerDiff(mcSlots, hanziSize(note.hanzi) * 0.7f, onChar) }
            } else if (typed != null && verdict != null) {
                KeepTaps { AnswerDiff(typed, note.hanzi, verdict, onChar) }
            } else {
                TappableHanzi(note.hanzi, hanziSize(note.hanzi) * 0.85f, Lab.colors.ink, onChar)
            }
            KeepTaps { TranscriptionLine(ui.extras.take.transcription, actions.onRetryTranscription) }
            Spacer(Modifier.height(8.dp))
            Text(note.pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent, textAlign = TextAlign.Center)
            if (ui.extras.tutorNotes.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                KeepTaps { TutorNoteLine(ui.extras.tutorNotes) }
            }
            Spacer(Modifier.height(4.dp))
            Text(note.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            val playing = isWordPlaying(playingKey, view, ui)
            val voices = ui.extras.voices
            val making = voices.isEmpty() && ui.cardAudio.word == ClipState.GENERATING
            // Wraps when "Audio coming…" joins Play and Record again on a folded phone.
            @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
            androidx.compose.foundation.layout.FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    Modifier.testTag(PLAY_WORD_TAG).clip(CircleShape).background(if (playing) Lab.colors.accentSoft else Lab.colors.faint).clickable { actions.onPlayWord(true) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (making) CircularProgressIndicator(Modifier.size(16.dp), color = Lab.colors.accent, strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Filled.VolumeUp, null, Modifier.size(18.dp), tint = Lab.colors.accent)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        when {
                            making -> CardAudioRules.GENERATING
                            voices.size > 1 -> "Play (${ui.extras.voiceIndex + 1}/${voices.size})"
                            else -> "Play"
                        },
                        color = Lab.colors.ink,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                // The real clip is queued on the server: say so quietly; it plays itself when it lands.
                if (voices.isEmpty() && ui.cardAudio.word == ClipState.COMING) AudioComingPill()
                if (view.card.cardType == CardTypes.HANZI_TO_MEANING) RecordAgainPill(ui.extras.take, actions)
                if (canSayAgain) SayAgainPill(ui.aiAvailable, actions)
            }
            OfflineAudioNote(view, ui)
            if (voices.isEmpty() && ui.cardAudio.word != ClipState.READY && ui.cardAudio.word != ClipState.COMING && !making) {
                Spacer(Modifier.height(6.dp))
                KeepTaps { AudioStatusLine(ui.cardAudio.word, actions.onRetryAudio) }
            }
            ui.extras.notice?.let {
                Spacer(Modifier.height(10.dp))
                KeepTaps { InlineNotice(it, kind = NoticeKind.Error, actionLabel = "OK", onAction = actions.onDismissNotice) }
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
            SentenceList(view, ui, playingKey, actions, modifier = Modifier.keepTaps())
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

/** Test tag of the question side (inert until revealed; then a tap turns back to the answer). */
const val CARD_FRONT_TAG = "card-front"

/** One face of the card: the one turned away is see-through, has no semantics and sits under the other. */
private fun Modifier.face(visible: Boolean): Modifier =
    zIndex(if (visible) 1f else 0f).then(if (visible) Modifier else Modifier.graphicsLayer { alpha = 0f }.clearAndSetSemantics { })

/**
 * A block on the answer side whose taps are its own (the answer diff, notes, the sentences):
 * a tap on it — even between its controls — never peeks back at the question. Drags pass through.
 */
private fun Modifier.keepTaps(): Modifier = pointerInput(Unit) { detectTapGestures { } }

/**
 * [keepTaps] around a block that may emit several nodes (TranscriptionLine is a spacer + a line):
 * a Column stacks them, where a Box would draw them on top of each other.
 */
@Composable
private fun KeepTaps(content: @Composable ColumnScope.() -> Unit) =
    Column(Modifier.keepTaps(), horizontalAlignment = Alignment.CenterHorizontally, content = content)

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
        AnswerKey.Verdict.SOUND -> Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.testTag(SPOKEN_SOUND_TAG)) {
            // Said right, written with other characters (speech can't tell 由 / 油 apart): the answer in green.
            TappableHanzi(correct, size, Palette.Good, onChar)
            Text(Pinyin.of(correct), style = pinyinStyle, color = Lab.colors.muted, textAlign = TextAlign.Center)
            Text(AnswerKey.spokenVerdictNote(verdict, correct).orEmpty(), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = Palette.Good, textAlign = TextAlign.Center)
            Text("You said: $typed", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
        }
        AnswerKey.Verdict.CLOSE, AnswerKey.Verdict.WRONG -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            AnswerKey.spokenVerdictNote(verdict, correct)?.let {
                Text(it, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = Palette.Hard, textAlign = TextAlign.Center)
            }
            // Wrong characters red + underlined, missing ones a "?" with a dashed underline (AnswerMarks).
            val diff = AnswerMarks.typedDiff(typed, correct)
            MarkedAnswerRow(diff.typed, size * 0.8f, onChar)
            Text(Pinyin.of(typed), style = pinyinStyle, color = Lab.colors.muted, textAlign = TextAlign.Center)
            Text("↓", color = Lab.colors.muted)
            ExpectedAnswerRow(diff.expected.map { it.char }, diff.expected.map { it.matched }, size, Lab.colors.ink, onChar)
        }
    }
}

@Composable
fun RatingBar(previews: List<IntervalPreview>, enabled: Boolean, onRate: (Int) -> Unit) {
    val labels = listOf("Again", "Hard", "Good", "Easy")
    val colors = listOf(Palette.Again, Palette.Hard, Palette.Good, Palette.Easy)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (r in Rating.ALL) {
            AnswerTile(labels[r], colors[r], Modifier.weight(1f), sub = previews.getOrNull(r)?.intervalText, enabled = enabled) { onRate(r) }
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
private fun BigPlayButton(playing: Boolean, size: Dp = 132.dp, generating: Boolean = false, onClick: () -> Unit) {
    val pulse by animateFloatAsState(if (playing) 1.08f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow), label = "pulse")
    Box(
        Modifier.size(size).scale(pulse).clip(CircleShape).background(Lab.colors.accentSoft).clickable(onClick = onClick).testTag(PLAY_WORD_TAG),
        contentAlignment = Alignment.Center,
    ) {
        // Auto-audio: the clip is being made — a ring round the speaker; it plays when it lands.
        if (generating) CircularProgressIndicator(Modifier.fillMaxSize().padding(6.dp), color = Lab.colors.accent, strokeWidth = 3.dp)
        Icon(Icons.AutoMirrored.Filled.VolumeUp, if (generating) CardAudioRules.GENERATING else "Play", Modifier.size(size * 0.42f), tint = Lab.colors.accent.copy(alpha = if (generating) 0.5f else 1f))
    }
}

/** The word's Play button (front speaker or back pill), for tests. */
const val PLAY_WORD_TAG = "play-word"

private fun hanziSize(hanzi: String): TextUnit = studyHanziSize(hanzi)

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
            LevelMeter(actions)
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

/** The microphone level while recording (green when it hears speech, red when loud). */
@Composable
private fun LevelMeter(actions: StudyActions, modifier: Modifier = Modifier.fillMaxWidth(0.8f)) {
    val level by actions.recordingLevel.collectAsState()
    val shown by animateFloatAsState((level * 2f).coerceIn(0.03f, 1f), spring(stiffness = 600f), label = "level")
    Box(modifier.height(6.dp).clip(CircleShape).background(Lab.colors.faint)) {
        Box(
            Modifier.fillMaxWidth(shown).fillMaxSize().clip(CircleShape)
                .background(if (level > 0.4f) Palette.Again else if (level > 0.15f) Palette.Good else Lab.colors.muted),
        )
    }
}

/** Test tag of the recording state on the question side (Record again). */
const val RECORD_AGAIN_FRONT_TAG = "record-again-front"

/**
 * Record again, on the question side: a pulsing mic, the time so far, the level, "Tap anywhere to
 * stop", and Stop / Cancel (the web's `.study-rerecord`). The card's own tap stops it too.
 */
@Composable
private fun RecordingAgainPanel(actions: StudyActions) {
    var seconds by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1_000); seconds++ } }
    val pulse by rememberInfiniteTransition(label = "rec-again").animateFloat(
        1f, 1.18f, infiniteRepeatable(tween(650), RepeatMode.Reverse), label = "pulse",
    )
    Column(
        Modifier.fillMaxWidth().testTag(RECORD_AGAIN_FRONT_TAG),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(40.dp).scale(pulse).clip(CircleShape).background(Palette.Again.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) { Text("🎤", fontSize = 18.sp) }
            Spacer(Modifier.width(10.dp))
            Text(
                "Recording · ${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = Palette.Again,
            )
        }
        Spacer(Modifier.height(10.dp))
        LevelMeter(actions, Modifier.fillMaxWidth(0.6f))
        Spacer(Modifier.height(8.dp))
        Text("Tap anywhere to stop", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = actions.onCancelRecording, modifier = Modifier.height(48.dp)) { Text("Cancel", color = Lab.colors.muted) }
            PrimaryPill("⏹  Stop", Modifier.height(52.dp), color = Palette.Again) { actions.onStopRecording(true) }
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

/** Test tags of "Say it again" (answer side pill / the panel on the question side). */
const val SAY_AGAIN_TAG = "spoken-say-again"
const val SAY_AGAIN_FRONT_TAG = "study-sayagain"

/** 🎤 Say it again on the back of a typing card answered by speaking (the web's study-back-pills). Offline: dimmed, a tap says why. */
@Composable
private fun SayAgainPill(online: Boolean, actions: StudyActions) {
    val start = rememberRecordPermission { actions.onSayAgain() }
    Text(
        "🎤 Say it again",
        color = Lab.colors.ink,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier
            .testTag(SAY_AGAIN_TAG)
            .graphicsLayer { alpha = if (online) 1f else 0.45f }
            .clip(CircleShape)
            .background(Lab.colors.faint)
            .clickable { if (online) start() else actions.onSayAgain() }
            .padding(horizontal = 16.dp, vertical = 10.dp),
    )
}

/**
 * Say it again, on the question side (the web's `.study-sayagain`): the live transcript in the answer
 * box's place and ⏹, then the same review step as a first answer (🔁 Retry · ✏️ Edit · ✓ Submit; ✏️
 * Edit = a box here, Check submits it), "Couldn't transcribe — tap to retry" with 🔁 Retry after a take
 * that gave nothing, and ✕ Cancel back to the answer as it was. The card's own tap stops the take too.
 */
@Composable
private fun SayAgainPanel(spoken: SpokenUi, online: Boolean, actions: StudyActions) {
    Column(Modifier.fillMaxWidth().testTag(SAY_AGAIN_FRONT_TAG), horizontalAlignment = Alignment.CenterHorizontally) {
        when (spoken.phase) {
            SpokenPhase.REVIEW -> {
                SpokenReviewText(spoken.finalText, compact = true)
                Spacer(Modifier.height(10.dp))
                SpokenReviewRow(actions)
            }
            SpokenPhase.EDITING -> SayAgainEditor(spoken, actions)
            SpokenPhase.FAILED -> {
                SpokenStatus(spoken, online, actions, again = true)
                Spacer(Modifier.height(10.dp))
                SpokenFailedRow(actions, onType = null)
            }
            else -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SpokenLiveBox(spoken, Modifier.weight(1f), placeholder = "Listening… say the answer")
                    Spacer(Modifier.width(8.dp))
                    SpokenMicButton(spoken, online, actions, onStart = actions.onSayAgain)
                }
                if (spoken.listening) {
                    Spacer(Modifier.height(8.dp))
                    Text("Tap anywhere to stop", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                }
            }
        }
        TextButton(onClick = actions.onCancelSpoken, modifier = Modifier.heightIn(min = 44.dp)) { Text("✕ Cancel", color = Lab.colors.muted) }
    }
}

/** ✏️ Edit on a "Say it again" review: the transcript in a box, focused (keyboard up); Check submits it. */
@Composable
private fun SayAgainEditor(spoken: SpokenUi, actions: StudyActions) {
    var draft by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(spoken.finalText, androidx.compose.ui.text.TextRange(spoken.finalText.length))) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(50); runCatching { focus.requestFocus() } }
    Text("You said: ${spoken.finalText}", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
    Spacer(Modifier.height(6.dp))
    OutlinedTextField(
        value = draft,
        onValueChange = { draft = it },
        modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag(SPOKEN_EDIT_TAG),
        singleLine = true,
        textStyle = MaterialTheme.typography.titleLarge,
        shape = RoundedCornerShape(18.dp),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { actions.onSubmitEditedSpoken(draft.text) }),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
    )
    Spacer(Modifier.height(10.dp))
    val retake = rememberRecordPermission { actions.onRetakeSpoken() }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SecondaryPill(
            "🔁 Retry",
            Modifier.height(60.dp).testTag(SPOKEN_REVIEW_RETRY_TAG).semantics { contentDescription = RETRY_LABEL },
            horizontalPadding = 12.dp, fontSize = 14.sp,
            onClick = retake,
        )
        PrimaryPill("Check", Modifier.weight(1f).height(60.dp).testTag(SPOKEN_EDIT_CHECK_TAG), enabled = draft.text.isNotBlank()) {
            actions.onSubmitEditedSpoken(draft.text)
        }
    }
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

/** Test tags of the spoken answer (say the answer on a typing card). */
const val SPOKEN_TYPE_TAG = "spoken-type"
const val VOICE_FIRST_TAG = "study-voice-first"
const val VOICE_REVIEW_TAG = "study-voice-review"
const val SPOKEN_MIC_TAG = "spoken-mic"
const val SPOKEN_LIVE_TAG = "spoken-live"
const val SPOKEN_RETRY_TAG = "spoken-retry"
const val SPOKEN_SOUND_TAG = "spoken-answer-sound"
const val SPOKEN_REVIEW_TAG = "spoken-review"
const val SPOKEN_REVIEW_TEXT_TAG = "spoken-review-text"
const val SPOKEN_REVIEW_PINYIN_TAG = "spoken-review-pinyin"
const val SPOKEN_REVIEW_RETRY_TAG = "spoken-review-retry"
const val SPOKEN_REVIEW_EDIT_TAG = "spoken-review-edit"
const val SPOKEN_REVIEW_SUBMIT_TAG = "spoken-review-submit"
const val SPOKEN_FAILED_ROW_TAG = "spoken-failed-row"
const val SPOKEN_EDIT_TAG = "spoken-edit-input"
const val SPOKEN_EDIT_CHECK_TAG = "spoken-edit-check"

/**
 * 🎤 in the typing row (the web's `.study-mic-btn`): tap to say the answer, ⏹ to stop and use it.
 * Offline it stays in place, dimmed; a tap says why ("needs a connection") — typing is never blocked.
 */
@Composable
private fun SpokenMicButton(spoken: SpokenUi, online: Boolean, actions: StudyActions, onStart: () -> Unit = actions.onStartSpoken) {
    val start = rememberRecordPermission { onStart() }
    val pulse by rememberInfiniteTransition(label = "spoken-mic").animateFloat(
        1f, if (spoken.listening) 1.1f else 1f, infiniteRepeatable(tween(650), RepeatMode.Reverse), label = "pulse",
    )
    val finishing = spoken.phase == SpokenPhase.FINISHING
    Box(
        Modifier
            .size(52.dp)
            .scale(pulse)
            .clip(CircleShape)
            .background(if (spoken.listening) Palette.Again.copy(alpha = 0.16f) else Lab.colors.faint)
            .border(1.dp, if (spoken.listening) Palette.Again.copy(alpha = 0.55f) else Lab.colors.cardBorder, CircleShape)
            .clickable {
                when {
                    finishing -> Unit
                    spoken.listening -> actions.onStopSpoken()
                    !online -> onStart() // the VM shows the offline hint
                    else -> start()
                }
            }
            .testTag(SPOKEN_MIC_TAG),
        contentAlignment = Alignment.Center,
    ) {
        if (finishing) CircularProgressIndicator(Modifier.size(22.dp), color = Lab.colors.accent, strokeWidth = 2.dp)
        else Text(if (spoken.listening) "⏹" else "🎤", fontSize = 20.sp, modifier = Modifier.graphicsLayer { alpha = if (online) 1f else 0.45f })
    }
}

/** Accessibility labels of the voice-first row (the web's aria-labels). */
const val SAY_IT_LABEL = "Say it"
const val TYPE_ANSWER_LABEL = "Type the answer"
const val SHOW_ANSWER_LABEL = "Show answer"
/** Accessibility labels of the review row (the web's aria-labels). */
const val RETRY_LABEL = "Retry"
const val EDIT_LABEL = "Edit what I said"
const val SUBMIT_LABEL = "Submit"

/**
 * Voice first (the web's `.study-voice-first`): ONE row of the app's pills where the read card's
 * Show answer / 🎤 Record row sits (same 60dp height, corners, type) — ✏️ Type (this card only) and
 * 👁 Show answer small on the left, the wide orange 🎤 Say it on the right taking the rest. While
 * the answer is said the live transcript shows above and the row turns into ✕ Cancel + a red
 * ⏹ Stop (the read card's Stop recording); "Finishing…" until the transcript is final.
 */
@Composable
private fun VoiceFirstControls(spoken: SpokenUi, online: Boolean, actions: StudyActions, onType: () -> Unit, onShow: () -> Unit) {
    val start = rememberRecordPermission { actions.onStartSpoken() }
    val finishing = spoken.phase == SpokenPhase.FINISHING
    Column(Modifier.fillMaxWidth().testTag(VOICE_FIRST_TAG), horizontalAlignment = Alignment.CenterHorizontally) {
        if (spoken.busy) {
            SpokenLiveBox(spoken, Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
        }
        if (spoken.phase == SpokenPhase.FAILED) {
            // A take that gave nothing: no Submit — ✏️ Type and the wide 🔁 Retry (a new take).
            SpokenFailedRow(actions, onType = onType)
        } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (spoken.busy) {
                SecondaryPill("✕ Cancel", Modifier.height(60.dp), horizontalPadding = 12.dp, fontSize = 14.sp, onClick = actions.onCancelSpoken)
            } else {
                SecondaryPill(
                    "✏️ Type",
                    Modifier.height(60.dp).testTag(SPOKEN_TYPE_TAG).semantics { contentDescription = TYPE_ANSWER_LABEL },
                    horizontalPadding = 12.dp, fontSize = 14.sp,
                    onClick = onType,
                )
                SecondaryPill(
                    "👁 Show answer",
                    Modifier.height(60.dp).semantics { contentDescription = SHOW_ANSWER_LABEL },
                    horizontalPadding = 12.dp, fontSize = 14.sp,
                    onClick = onShow,
                )
            }
            val (label, color, description) = when {
                finishing -> Triple("Finishing…", Lab.colors.accent, "Finishing")
                spoken.listening -> Triple("⏹  Stop", Palette.Again, "Stop and use what I said")
                else -> Triple("🎤  Say it", Lab.colors.accent, SAY_IT_LABEL)
            }
            PrimaryPill(
                label,
                Modifier.weight(1f).height(60.dp).testTag(SPOKEN_MIC_TAG).semantics { contentDescription = description },
                enabled = !finishing,
                color = color,
            ) {
                when {
                    spoken.listening -> actions.onStopSpoken()
                    else -> start()
                }
            }
        }
        SpokenStatus(spoken, online, actions, cancelInRow = true)
    }
}

/**
 * The review step (the web's `.study-spoken-review` + its row): what was said, big and clear — the
 * transcript in the card's hanzi style with the phone's own pinyin under it (`devicePinyinLine`: the
 * pinyin-pro port + the 一 / 不 tone changes), read-only, no keyboard — then 🔁 Retry · ✏️ Edit · ✓ Submit.
 */
@Composable
private fun SpokenReviewControls(spoken: SpokenUi, actions: StudyActions) {
    Column(Modifier.fillMaxWidth().testTag(VOICE_REVIEW_TAG), horizontalAlignment = Alignment.CenterHorizontally) {
        SpokenReviewText(spoken.finalText)
        Spacer(Modifier.height(10.dp))
        SpokenReviewRow(actions)
    }
}

/** The transcript on review: big hanzi (the card's sizes, capped) and the device's pinyin under it. */
@Composable
private fun SpokenReviewText(text: String, compact: Boolean = false) {
    val pinyin = remember(text) { devicePinyinLine(text) }
    val max = if (compact) 44f else 60f
    val size = studyHanziSize(text).let { if (it.value > max) max.sp else it }
    val appear = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(text) { appear.snapTo(0f); appear.animateTo(1f, spring(dampingRatio = 0.7f, stiffness = 500f)) }
    Column(
        Modifier
            .fillMaxWidth()
            .graphicsLayer { alpha = appear.value; translationY = (1f - appear.value) * 8f * density }
            .clip(RoundedCornerShape(18.dp))
            .background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .testTag(SPOKEN_REVIEW_TAG),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text,
            fontSize = size,
            fontWeight = FontWeight.Medium,
            color = Lab.colors.ink,
            textAlign = TextAlign.Center,
            lineHeight = size * 1.2f,
            modifier = Modifier.testTag(SPOKEN_REVIEW_TEXT_TAG),
        )
        if (pinyin.isNotEmpty()) {
            Text(pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.testTag(SPOKEN_REVIEW_PINYIN_TAG))
        }
    }
}

/** The review's row, in the voice-first row's pills: 🔁 Retry · ✏️ Edit small on the left, the wide ✓ Submit. */
@Composable
private fun SpokenReviewRow(actions: StudyActions) {
    val retake = rememberRecordPermission { actions.onRetakeSpoken() }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SecondaryPill(
            "🔁 Retry",
            Modifier.height(60.dp).testTag(SPOKEN_REVIEW_RETRY_TAG).semantics { contentDescription = RETRY_LABEL },
            horizontalPadding = 12.dp, fontSize = 14.sp,
            onClick = retake,
        )
        SecondaryPill(
            "✏️ Edit",
            Modifier.height(60.dp).testTag(SPOKEN_REVIEW_EDIT_TAG).semantics { contentDescription = EDIT_LABEL },
            horizontalPadding = 12.dp, fontSize = 14.sp,
            onClick = actions.onEditSpoken,
        )
        PrimaryPill(
            "✓  Submit",
            Modifier.weight(1f).height(60.dp).testTag(SPOKEN_REVIEW_SUBMIT_TAG).semantics { contentDescription = SUBMIT_LABEL },
            onClick = actions.onSubmitSpoken,
        )
    }
}

/** After a take that gave nothing: ✏️ Type (when there is a box to fall back on) and the wide 🔁 Retry. */
@Composable
private fun SpokenFailedRow(actions: StudyActions, onType: (() -> Unit)?) {
    val retake = rememberRecordPermission { actions.onRetakeSpoken() }
    Row(Modifier.fillMaxWidth().testTag(SPOKEN_FAILED_ROW_TAG), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (onType != null) {
            SecondaryPill(
                "✏️ Type",
                Modifier.height(60.dp).testTag(SPOKEN_TYPE_TAG).semantics { contentDescription = TYPE_ANSWER_LABEL },
                horizontalPadding = 12.dp, fontSize = 14.sp,
                onClick = onType,
            )
        }
        PrimaryPill(
            "🔁  Retry",
            Modifier.weight(1f).height(60.dp).testTag(SPOKEN_REVIEW_RETRY_TAG).semantics { contentDescription = RETRY_LABEL },
            onClick = retake,
        )
    }
}

/** What is being said, live (instead of the text field): confirmed text in ink, the provisional tail grey. */
@Composable
private fun SpokenLiveBox(spoken: SpokenUi, modifier: Modifier, placeholder: String = "Listening… say the answer") {
    Box(
        modifier
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(18.dp))
            .border(1.5.dp, Palette.Again.copy(alpha = 0.45f), RoundedCornerShape(18.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .testTag(SPOKEN_LIVE_TAG),
        contentAlignment = Alignment.Center,
    ) {
        if (spoken.finalText.isEmpty() && spoken.partialText.isEmpty()) {
            Text(if (spoken.phase == SpokenPhase.FINISHING) "Finishing…" else placeholder, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted)
        } else {
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    append(spoken.finalText)
                    pushStyle(androidx.compose.ui.text.SpanStyle(color = Lab.colors.muted.copy(alpha = 0.7f)))
                    append(spoken.partialText)
                    pop()
                },
                style = MaterialTheme.typography.titleLarge,
                color = Lab.colors.ink,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Under the typing row: ✕ Cancel while listening, "Couldn't transcribe — tap to retry", nothing heard,
 * offline. [again] (the Say it again panel): no typing to fall back on, and the panel has its own ✕.
 * [cancelInRow] (voice first): ✕ Cancel is a pill in the row itself, and "Say it" is the button to name.
 */
@Composable
private fun SpokenStatus(spoken: SpokenUi, online: Boolean, actions: StudyActions, again: Boolean = false, cancelInRow: Boolean = false) {
    val hint: @Composable (String) -> Unit = { text ->
        Text(text, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
    }
    when {
        spoken.busy -> if (!again && !cancelInRow) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            TextButton(onClick = actions.onCancelSpoken, modifier = Modifier.heightIn(min = 44.dp)) { Text("✕ Cancel", color = Lab.colors.muted) }
        }
        spoken.phase == SpokenPhase.FAILED && spoken.failure == SpokenFailure.EMPTY ->
            hint(
                when {
                    again -> "Didn’t catch anything — tap Retry to try again."
                    cancelInRow -> "Didn’t catch anything — tap Retry to try again, or type it."
                    else -> "Didn’t catch anything — tap 🎤 to try again, or type it."
                },
            )
        spoken.phase == SpokenPhase.FAILED -> Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Palette.Again.copy(alpha = 0.10f))
                .border(1.dp, Palette.Again.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
                .clickable(onClick = actions.onRetrySpoken)
                .heightIn(min = 44.dp)
                .padding(horizontal = 14.dp, vertical = 7.dp)
                .testTag(SPOKEN_RETRY_TAG),
        ) {
            Text("Couldn’t transcribe — tap to retry", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Text(if (again) "Or keep your first answer" else "Or type your answer", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
        }
        spoken.offlineHint && !online -> hint("Saying the answer needs a connection — type it instead.")
    }
}

/** "You said: …" under the answer (the web's renderTranscriptionResult). */
@Composable
private fun TranscriptionLine(t: TranscriptionUi?, onRetry: () -> Unit = {}) {
    val (text, tint) = when (t) {
        null -> return
        TranscriptionUi.Failed -> {
            // Never silent: both paths failed, the recording is saved, a tap sends it again.
            Spacer(Modifier.height(6.dp))
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(Palette.Again.copy(alpha = 0.10f))
                    .border(1.dp, Palette.Again.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
                    .clickable(onClick = onRetry)
                    .heightIn(min = 44.dp)
                    .padding(horizontal = 14.dp, vertical = 7.dp),
            ) {
                Text("Couldn’t transcribe — tap to retry", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center)
                Text("Your recording is saved", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
            }
            return
        }
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
