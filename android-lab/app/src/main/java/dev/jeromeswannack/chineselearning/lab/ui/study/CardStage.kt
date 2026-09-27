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
import dev.jeromeswannack.chineselearning.lab.ui.kit.markdownLite

/** Card-local state that tests / screenshots can start from. */
data class CardStartState(val flipped: Boolean = false, val answer: String = "")

@Composable
fun CardStage(
    view: CardView,
    playingKey: String?,
    actions: StudyActions,
    start: CardStartState = CardStartState(),
    autoplay: Boolean = true,
) {
    val note = view.note
    val typing = view.card.cardType != CardTypes.HANZI_TO_MEANING
    var flipped by remember(view.presentation) { mutableStateOf(start.flipped) }
    var answer by remember(view.presentation) { mutableStateOf(start.answer) }
    var verdict by remember(view.presentation) {
        mutableStateOf(if (start.flipped && typing && start.answer.isNotBlank()) AnswerKey.check(start.answer, note.hanzi, view.alternatives) else null)
    }
    var rated by remember(view.presentation) { mutableStateOf(false) }
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
        if (view.card.cardType == CardTypes.AUDIO_TO_HANZI && !start.flipped) {
            delay(250)
            actions.onPlay(note.audioUrl, note.hanzi)
        } else if (typing && !start.flipped) {
            runCatching { focus.requestFocus() }
        }
    }

    fun reveal() {
        if (flipped) return
        val v = if (typing && answer.isNotBlank()) AnswerKey.check(answer, note.hanzi, view.alternatives) else null
        verdict = v
        flipped = true
        actions.onReveal(v)
        if (v != null && AnswerKey.isAccepted(v)) burst++
        if (v != null && !AnswerKey.isAccepted(v)) scope.launch { shake.shake() }
        scope.launch {
            delay(if (v != null && AnswerKey.isAccepted(v)) 380 else 160)
            if (autoplay) actions.onPlay(note.audioUrl, note.hanzi)
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
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
                if (rotation <= 90f) {
                    CardFront(view, playingKey, actions, onTapToReveal = { if (!typing) reveal() })
                } else {
                    Box(Modifier.fillMaxSize().graphicsLayer { rotationY = 180f }) {
                        CardBack(view, answer.trim().takeIf { typing && it.isNotEmpty() }, verdict, playingKey, actions, wide)
                    }
                }
            }
            SparkBurst(burst, listOf(Palette.Good, Palette.Gold, Palette.Easy, Color.White), origin = Offset(0.5f, 0.3f))
        }

        // Bottom controls
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 12.dp)) {
            if (!flipped) {
                if (typing) {
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
                    PrimaryPill("Show answer", Modifier.fillMaxWidth().height(60.dp)) { reveal() }
                }
            } else {
                RatingBar(view.previews, enabled = !rated) { rating ->
                    rated = true
                    actions.onRate(rating, System.currentTimeMillis() - startedAt, answer.takeIf { typing && it.isNotEmpty() })
                }
            }
        }
    }
}

@Composable
private fun CardFront(view: CardView, playingKey: String?, actions: StudyActions, onTapToReveal: () -> Unit) {
    val note = view.note
    var showClue by remember(view.presentation) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onTapToReveal).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
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
        Spacer(Modifier.weight(1f))
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
                style = MaterialTheme.typography.headlineMedium,
                color = Lab.colors.ink,
                textAlign = TextAlign.Center,
            )
            else -> BigPlayButton(playing = playingKey != null && playingKey == note.audioUrl || playingKey == "tts:${note.hanzi}") {
                actions.onPlay(note.audioUrl, note.hanzi)
            }
        }
        Spacer(Modifier.weight(1f))
        if (!note.sentenceClue.isNullOrBlank()) {
            AnimatedVisibility(showClue && view.card.cardType == CardTypes.HANZI_TO_MEANING, enter = fadeIn() + expandVertically()) {
                Text(note.sentenceClue, style = MaterialTheme.typography.titleMedium, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 8.dp))
            }
            TextButton(onClick = {
                showClue = true
                // For the typing cards the text would give the answer away: play it instead.
                if (view.card.cardType != CardTypes.HANZI_TO_MEANING) actions.onPlay(note.sentenceClueAudioUrl, note.sentenceClue)
            }) {
                Icon(Icons.Filled.Lightbulb, null, Modifier.size(18.dp), tint = Lab.colors.accent)
                Spacer(Modifier.width(6.dp))
                Text(if (view.card.cardType == CardTypes.HANZI_TO_MEANING) "Use in a sentence" else "Play a sentence", color = Lab.colors.accent)
            }
        }
        if (view.card.cardType == CardTypes.HANZI_TO_MEANING) {
            Text("Say it aloud, then tap to check", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        }
    }
}

@Composable
private fun CardBack(view: CardView, typed: String?, verdict: AnswerKey.Verdict?, playingKey: String?, actions: StudyActions, wide: Boolean) {
    val note = view.note
    val main: @Composable () -> Unit = {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            if (typed != null && verdict != null) {
                AnswerDiff(typed, note.hanzi, verdict)
            } else {
                Text(note.hanzi, fontSize = hanziSize(note.hanzi) * 0.85f, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center, lineHeight = hanziSize(note.hanzi))
            }
            Spacer(Modifier.height(8.dp))
            Text(note.pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent, textAlign = TextAlign.Center)
            Spacer(Modifier.height(4.dp))
            Text(note.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            val playing = playingKey != null && (playingKey == note.audioUrl || playingKey == "tts:${note.hanzi}")
            Row(
                Modifier.clip(CircleShape).background(if (playing) Lab.colors.accentSoft else Lab.colors.faint).clickable { actions.onPlay(note.audioUrl, note.hanzi) }.padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.AutoMirrored.Filled.VolumeUp, null, Modifier.size(18.dp), tint = Lab.colors.accent)
                Spacer(Modifier.width(6.dp))
                Text("Play", color = Lab.colors.ink, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
    val details: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth()) {
            note.funFacts?.takeIf { it.isNotBlank() }?.let {
                Text(
                    markdownLite(it),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Lab.colors.ink,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).padding(14.dp),
                )
                Spacer(Modifier.height(16.dp))
            }
            SentenceList(view, playingKey, actions)
            TextButton(onClick = { actions.onOpenInApp(note.id) }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, null, Modifier.size(16.dp), tint = Lab.colors.muted)
                Spacer(Modifier.width(6.dp))
                Text("Ask Claude · edit · flag — in the main app", color = Lab.colors.muted, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
    if (wide) {
        Row(Modifier.fillMaxSize().padding(24.dp)) {
            Box(Modifier.weight(1f).fillMaxSize(), contentAlignment = Alignment.Center) { main() }
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

/** The web's AnswerDiff: accepted answers in green; otherwise a character-by-character diff. */
@Composable
private fun AnswerDiff(typed: String, correct: String, verdict: AnswerKey.Verdict) {
    val size = hanziSize(correct) * 0.7f
    when (verdict) {
        AnswerKey.Verdict.EXACT -> Text(typed, fontSize = size, color = Palette.Good, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
        AnswerKey.Verdict.PUNCTUATION_ONLY -> Text(correct, fontSize = size, color = Palette.Good, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
        AnswerKey.Verdict.ALTERNATIVE, AnswerKey.Verdict.EQUIVALENT -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(typed, fontSize = size, color = Palette.Good, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
            Text("Also accepted — canonical answer:", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
            Text(correct, fontSize = size * 0.8f, color = Lab.colors.ink, textAlign = TextAlign.Center)
        }
        AnswerKey.Verdict.WRONG -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            val user = typed.codePoints().toArray().map { String(Character.toChars(it)) }
            val target = correct.codePoints().toArray().map { String(Character.toChars(it)) }
            Row { user.forEachIndexed { i, ch -> Text(ch, fontSize = size * 0.8f, color = if (target.getOrNull(i) == ch) Palette.Good else Palette.Again, fontWeight = FontWeight.Medium) } }
            Text("↓", color = Lab.colors.muted)
            Row { target.forEachIndexed { i, ch -> Text(ch, fontSize = size, color = if (user.getOrNull(i) == ch) Palette.Good else Lab.colors.ink, fontWeight = FontWeight.Medium) } }
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
private fun BigPlayButton(playing: Boolean, onClick: () -> Unit) {
    val pulse by animateFloatAsState(if (playing) 1.08f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow), label = "pulse")
    Box(
        Modifier.size(132.dp).scale(pulse).clip(CircleShape).background(Lab.colors.accentSoft).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.AutoMirrored.Filled.VolumeUp, "Play", Modifier.size(56.dp), tint = Lab.colors.accent)
    }
}

private fun hanziSize(hanzi: String): TextUnit = when {
    hanzi.length <= 2 -> 76.sp
    hanzi.length <= 4 -> 60.sp
    hanzi.length <= 8 -> 44.sp
    hanzi.length <= 14 -> 34.sp
    else -> 26.sp
}
