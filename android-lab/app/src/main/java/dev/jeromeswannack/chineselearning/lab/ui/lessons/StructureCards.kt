package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.LessonImages
import dev.jeromeswannack.chineselearning.lab.core.LessonPattern
import dev.jeromeswannack.chineselearning.lab.core.LessonPatterns
import dev.jeromeswannack.chineselearning.lab.core.PatternPiece
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonPicture
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.kit.dashedBorder
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * Port of frontend/src/components/lessons/StructureCards.tsx (docs/STUDY_SESSION.md "Structure cards"):
 * a note's grammar structures as cards, one per screen — the pattern as coloured pieces (fixed words as
 * solid chips, slots as dashed tinted boxes with their label), the meaning, an optional picture, the
 * examples big and coloured part by part like the piece each part fills, then the usage / ✗ ✓ lines.
 * Progress dots, swipe, ‹ Back / Next ›, Continue on the last. Nothing plays by itself: ▶ plays an
 * example and lights its parts up in turn. Rules in core LessonPatterns (parity-tested).
 */

object StructureCardTags {
    const val NOTE = "structure-note"
    const val CARD = "structure-card"
    const val FIXED = "structure-fixed"
    const val SLOT = "structure-slot"
    const val EXAMPLE = "structure-example"
    const val PLAY = "structure-play"
    const val NEXT = "structure-next"
}

/** The card colours: every fixed word one strong colour, each slot its own (no red-vs-green pairs: shapes carry it too). */
private class StructurePalette(val fixed: Color, val onFixed: Color, val slots: List<Color>, val right: Color) {
    fun tone(tone: String?): Color? = when {
        tone == null || tone == "punct" -> null
        tone == "fixed" -> fixed
        else -> slots[tone.removePrefix("s").toIntOrNull()?.coerceIn(0, slots.size - 1) ?: 0]
    }
}

@Composable
private fun structurePalette(): StructurePalette {
    val dark = Lab.colors.background.luminance() < 0.5f
    return if (dark) {
        StructurePalette(Lab.colors.accent, Lab.colors.onAccent, listOf(Color(0xFF60A5FA), Color(0xFFA78BFA), Color(0xFF22D3EE), Color(0xFFF472B6), Color(0xFFFBBF24)), Color(0xFF4ADE80))
    } else {
        StructurePalette(Lab.colors.accent, Lab.colors.onAccent, listOf(Color(0xFF2563EB), Color(0xFF7C3AED), Color(0xFF0E7490), Color(0xFFBE185D), Color(0xFFA16207)), Color(0xFF15803D))
    }
}

private fun track(app: LabApp?, action: String, source: String, index: Int, count: Int) {
    app?.analytics?.track("lesson.structure_card", mapOf("action" to action, "source" to source, "index" to index, "count" to count))
}

@Composable
fun StructureCardsView(title: String?, view: LessonPatterns.View, env: ExerciseEnv, onNext: () -> Unit) {
    val app = LocalContext.current.applicationContext as? LabApp
    val count = view.cards.size
    var index by remember { mutableIntStateOf(0) }
    var forward by remember { mutableStateOf(true) }
    val last = index >= count - 1
    LaunchedEffect(Unit) { track(app, "open", view.source, 0, count) }
    fun go(to: Int, how: String) {
        if (to < 0 || to >= count || to == index) return
        forward = to > index
        index = to
        track(app, how, view.source, to, count)
    }

    Column(Modifier.fillMaxWidth().testTag(StructureCardTags.NOTE), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        title?.takeIf { it.isNotBlank() }?.let { PhaseLabel(it) }
        if (index == 0) NoteBlocks(view.intro)
        var drag by remember { mutableStateOf(0f) }
        Box(
            Modifier.fillMaxWidth().pointerInput(index, count) {
                detectHorizontalDragGestures(
                    onDragStart = { drag = 0f },
                    onDragEnd = {
                        if (drag < -120f) go(index + 1, "swipe") else if (drag > 120f) go(index - 1, "swipe")
                        drag = 0f
                    },
                    onHorizontalDrag = { _, amount -> drag += amount },
                )
            },
        ) {
            AnimatedContent(
                targetState = index,
                transitionSpec = {
                    val dir = if (forward) 1 else -1
                    (slideInHorizontally(tween(260)) { it / 4 * dir } + fadeIn(tween(260))) togetherWith
                        (slideOutHorizontally(tween(200)) { -it / 4 * dir } + fadeOut(tween(200)))
                },
                label = "structure-card",
            ) { i ->
                CardView(view.cards[i], i, count, showHead = count > 1 || title.isNullOrBlank(), env) { track(app, "play", view.source, i, count) }
            }
        }
        if (count > 1) Dots(count, index) { go(it, "dot") }
        if (last && view.extras.isNotEmpty()) {
            SmallHeading("More examples")
            view.extras.forEach { s ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card)
                        .border(1.dp, Lab.colors.outline, RoundedCornerShape(16.dp)).clickable { env.speak(s.hanzi) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    ExplorableText("${s.hanzi}", source = "lesson", fontSize = 21.sp)
                    s.pinyin?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.accent, fontSize = 14.sp) }
                    s.english?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp) }
                }
            }
        }
        ActionRow {
            if (index > 0) Secondary("‹ Back") { go(index - 1, "back") }
            if (last) Primary("Continue") { track(app, "done", view.source, index, count); onNext() }
            else Box(Modifier.weight(1f).testTag(StructureCardTags.NEXT)) {
                Row { Primary("Next structure ›") { go(index + 1, "next") } }
            }
        }
    }
}

@Composable
private fun Dots(count: Int, index: Int, onPick: (Int) -> Unit) {
    val palette = structurePalette()
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        for (i in 0 until count) {
            val width by animateDpAsState(if (i == index) 22.dp else 8.dp, label = "dot")
            Box(
                Modifier.size(width = 30.dp, height = 28.dp).clickable { onPick(i) }
                    .semantics { contentDescription = "Structure ${i + 1} of $count" },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.width(width).height(8.dp).clip(RoundedCornerShape(50)).background(if (i == index) palette.fixed else Lab.colors.cardBorder))
            }
        }
    }
}

@Composable
private fun SmallHeading(text: String) {
    Text(text.uppercase(), color = Lab.colors.muted, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
}

@Composable
private fun CardView(card: LessonPatterns.Card, index: Int, count: Int, showHead: Boolean, env: ExerciseEnv, onPlay: () -> Unit) {
    val tones = remember(card) { LessonPatterns.pieceTones(card.pattern.pieces) }
    val name = remember(card) { LessonPatterns.patternName(card.pattern) }
    val marker = card.pattern.name?.takeIf { it.length == 1 }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(20.dp)).padding(horizontal = 16.dp, vertical = 18.dp)
            .testTag(StructureCardTags.CARD),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (showHead && (name.isNotEmpty() || marker != null || count > 1)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                marker?.let { Text(it, color = structurePalette().fixed, fontSize = 19.sp, fontWeight = FontWeight.Bold) }
                if (name.isNotEmpty()) Text(name, color = Lab.colors.ink, fontSize = 19.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f, fill = false))
                Box(Modifier.weight(1f))
                if (count > 1) Text("${index + 1} / $count", color = Lab.colors.muted, fontSize = 13.sp)
            }
        }
        PatternChips(card.pattern.pieces)
        card.pattern.meaning?.takeIf { it.isNotBlank() }?.let {
            Text("= $it", color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        card.pattern.imagePrompt?.takeIf { it.isNotBlank() }?.let { PatternPicture(card.pattern, it, env) }
        card.examples.forEach { ExampleRow(it, tones, env, onPlay) }
        NoteBlocks(card.blocks)
    }
}

@Composable
private fun PatternPicture(pattern: LessonPattern, prompt: String, env: ExerciseEnv) {
    val source = env.picture
    val picture = if (source != null) {
        collectPicture(remember(pattern.imageUrl, prompt) { source(pattern.imageUrl, prompt) }, pattern.imageUrl to prompt)
    } else {
        val image = rememberImageFile(pattern.imageUrl, env)
        if (image != null) LessonPicture(LessonImages.State.Ready, image) else LessonPicture(if (pattern.imageUrl.isNullOrEmpty()) LessonImages.State.None else LessonImages.State.Loading)
    }
    LessonPictureView(picture, prompt)
}

/** The pattern as pieces: fixed words solid, slots dashed and tinted; each settles in, one after another. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PatternChips(pieces: List<PatternPiece>) {
    val palette = structurePalette()
    val tones = remember(pieces) { LessonPatterns.pieceTones(pieces) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        pieces.forEachIndexed { i, p ->
            val enter = remember(pieces) { Animatable(0f) }
            LaunchedEffect(pieces) {
                delay(i * 70L)
                enter.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))
            }
            val faded = if (p.optional == true) 0.75f else 1f
            val m = Modifier.align(Alignment.CenterVertically).graphicsLayer {
                alpha = enter.value.coerceIn(0f, 1f) * faded
                translationY = (1f - enter.value) * 24f
                scaleX = 0.9f + 0.1f * enter.value
                scaleY = 0.9f + 0.1f * enter.value
            }
            when {
                tones[i] == "punct" -> Text(p.hanzi ?: "", color = Lab.colors.muted, fontSize = 22.sp, modifier = m)
                LessonPatterns.isSlotPiece(p) -> {
                    val color = palette.tone(tones[i]) ?: Lab.colors.ink
                    Column(
                        m.heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).background(color.copy(alpha = 0.1f))
                            .dashedBorder(RoundedCornerShape(12.dp), color, 2.dp).padding(horizontal = 12.dp, vertical = 6.dp)
                            .testTag(StructureCardTags.SLOT),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(p.slot ?: "", color = color, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        p.zh?.takeIf { it.isNotBlank() }?.let { Text(it, color = color.copy(alpha = 0.8f), fontSize = 12.sp) }
                        if (p.optional == true) Text("OPTIONAL", color = color, fontSize = 9.sp, letterSpacing = 1.sp)
                    }
                }
                else -> {
                    val optional = p.optional == true
                    val base = m.heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp))
                    Column(
                        (if (optional) base.dashedBorder(RoundedCornerShape(12.dp), palette.fixed, 2.dp) else base.background(palette.fixed))
                            .padding(horizontal = 12.dp, vertical = 6.dp).testTag(StructureCardTags.FIXED),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        val ink = if (optional) palette.fixed else palette.onFixed
                        Text(p.hanzi ?: "", color = ink, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        val gloss = listOfNotNull(p.pinyin?.takeIf { it.isNotBlank() }, p.english?.takeIf { it.isNotBlank() }).joinToString(" · ")
                        if (gloss.isNotEmpty()) Text(gloss, color = ink.copy(alpha = 0.9f), fontSize = 11.sp)
                        if (optional) Text("OPTIONAL", color = ink, fontSize = 9.sp, letterSpacing = 1.sp)
                    }
                }
            }
        }
    }
}

/** One example: ▶, then the sentence big with every part coloured like its piece (a slot's part underlined too). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ExampleRow(example: LessonPatterns.Example, tones: List<String>, env: ExerciseEnv, onPlay: () -> Unit) {
    val palette = structurePalette()
    val scope = rememberCoroutineScope()
    var lit by remember { mutableStateOf<Int?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    Row(Modifier.fillMaxWidth().testTag(StructureCardTags.EXAMPLE), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(
            Modifier.size(44.dp).clip(CircleShape).background(palette.fixed).clickable {
                env.speak(example.hanzi)
                onPlay()
                job?.cancel()
                job = scope.launch {
                    delay(250)
                    example.parts.forEachIndexed { i, part ->
                        lit = i
                        delay(maxOf(1, part.text.codePointCount(0, part.text.length)) * 260L)
                    }
                    delay(200)
                    lit = null
                }
            }.testTag(StructureCardTags.PLAY).semantics { contentDescription = "Play ${example.hanzi}" },
            contentAlignment = Alignment.Center,
        ) { Text("▶", color = palette.onFixed, fontSize = 16.sp) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            FlowRow {
                example.parts.forEachIndexed { i, part ->
                    val tone = part.piece?.let { tones.getOrNull(it) }
                    val color = palette.tone(tone) ?: Lab.colors.ink
                    val isSlot = tone != null && tone.startsWith("s")
                    val litUp = lit == i
                    ExplorableText(
                        part.text,
                        source = "lesson",
                        fontSize = 28.sp,
                        fontWeight = if (tone == "fixed") FontWeight.ExtraBold else FontWeight.SemiBold,
                        color = color,
                        modifier = Modifier
                            .graphicsLayer { translationY = if (litUp) -4f else 0f }
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (litUp) color.copy(alpha = 0.16f) else Color.Transparent)
                            .drawBehind {
                                if (isSlot) drawLine(color.copy(alpha = 0.45f), Offset(0f, size.height - 3.dp.toPx()), Offset(size.width, size.height - 3.dp.toPx()), strokeWidth = 3.dp.toPx())
                            },
                    )
                }
            }
            example.pinyin?.let { Text(it, color = Lab.colors.muted, fontSize = 15.sp) }
            example.english?.let { Text(it, color = Lab.colors.ink.copy(alpha = 0.85f), fontSize = 14.sp) }
        }
    }
}

/** Usage text, headings, ✗ / ✓ rows (core LessonPatterns.textBlocks). */
@Composable
fun NoteBlocks(blocks: List<LessonPatterns.Block>) {
    if (blocks.isEmpty()) return
    val palette = structurePalette()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (b in blocks) when (b.kind) {
            "heading" -> SmallHeading(b.text)
            "wrong", "right" -> {
                val wrong = b.kind == "wrong"
                val color = if (wrong) Lab.colors.markWrong else palette.right
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(color.copy(alpha = 0.1f)).padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(if (wrong) "✗" else "✓", color = color, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold)
                    ExplorableText(b.text, source = "lesson", fontSize = 19.sp, color = color)
                }
            }
            else -> Text(b.text, color = Lab.colors.ink, fontSize = 15.sp, lineHeight = 22.sp)
        }
    }
}
