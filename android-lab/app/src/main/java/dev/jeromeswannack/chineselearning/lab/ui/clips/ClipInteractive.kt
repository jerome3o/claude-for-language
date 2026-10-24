package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPlayState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipScene
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSpec
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.ui.coach.PractiseSentenceRow
import dev.jeromeswannack.chineselearning.lab.ui.study.devicePinyinLine

/**
 * 🎬 The interactive scenes of a clip (web components/clips/ClipInteractive.tsx): quiz, listen,
 * order, reveal, speak. The clip clock stops on them (core Clips.tick) and an obvious prompt says
 * what to do; big targets, instant feedback (✓ / ✗, a sound, a buzz — the ViewModel's onInteract)
 * and the answer; Skip after a while, "Next ›" once answered. Nothing here takes a vertical drag,
 * so a swipe always pages the feed.
 */
class InteractActions(
    val onOption: (Int) -> Unit = {},
    val onOrder: (List<Int>) -> Unit = {},
    val onFlip: () -> Unit = {},
    val onSpeak: (CoachPractise.Practised) -> Unit = {},
    val onSkip: () -> Unit = {},
    val onContinue: () -> Unit = {},
    /** Hear the scene's line again (listen / speak). */
    val onReplay: () -> Unit = {},
)

class InteractCtx(
    val spec: ClipSpec,
    val clipId: String,
    val index: Int,
    val play: ClipPlayState,
    val ctx: SceneCtx,
    val muted: Boolean,
    val clock: SpeechClock?,
    val actions: InteractActions,
    /** Previews: the speak row's state without a microphone. */
    val speakPreview: dev.jeromeswannack.chineselearning.lab.ui.coach.PractiseUi? = null,
)

private val HAN = Regex("\\p{IsHan}")

private fun verdictText(result: String?) = when (result) {
    "right" -> "✓ Right!"
    "close" -> "≈ Nearly — listen again"
    "wrong" -> "✗ Not quite"
    "skipped" -> "→ Here’s the answer"
    else -> ""
}

@Composable
private fun Pill(label: String, look: ClipLook, primary: Boolean, tag: String, onClick: () -> Unit) {
    Text(
        label,
        color = if (primary) Color.White else look.cardFg,
        fontWeight = FontWeight.ExtraBold, fontSize = 16.sp,
        modifier = Modifier.heightIn(min = 48.dp).background(if (primary) look.accent else look.cardBg, RoundedCornerShape(24.dp))
            .border(2.dp, if (primary) Color.Transparent else look.border, RoundedCornerShape(24.dp))
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 20.dp, vertical = 13.dp).testTag(tag),
    )
}

/** The prompt while the scene waits (a gentle nudge), Skip after a while, "Next ›" once answered. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InteractBar(i: InteractCtx, hint: String, tag: String) {
    val look = i.ctx.look
    val waiting = Clips.waiting(i.play)
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (waiting) {
            val nudge = if (i.ctx.animate) rememberInfiniteTransition(label = "nudge").animateFloat(0f, 1f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "n").value else 0f
            Text(
                hint, color = Color.White, fontWeight = FontWeight.Black, fontSize = 17.sp, textAlign = TextAlign.Center,
                modifier = Modifier.graphicsLayer { translationY = -4.dp.toPx() * nudge }.background(look.accent, RoundedCornerShape(24.dp)).padding(horizontal = 16.dp, vertical = 10.dp).testTag("$tag-hint"),
            )
            if (Clips.skipShown(i.play)) Pill("Skip ›", look, primary = false, tag = "clip-skip", onClick = i.actions.onSkip)
        } else Pill("Next ›", look, primary = false, tag = "clip-continue", onClick = i.actions.onContinue)
    }
}

@Composable
private fun Verdict(i: InteractCtx) {
    val r = i.play.interact?.result ?: return
    val ok = r == "right"
    val p = entrance(i.ctx)
    Text(
        verdictText(r), fontSize = 19.sp, fontWeight = FontWeight.ExtraBold,
        color = if (ok) Color(0xFF15803D) else if (r == "skipped") i.ctx.look.cardFg else Color(0xFFB91C1C),
        modifier = Modifier.enter(p, Entrance.POP).background(Color.White.copy(alpha = 0.92f), RoundedCornerShape(20.dp)).padding(horizontal = 14.dp, vertical = 4.dp).testTag("clip-quiz-verdict"),
    )
}

@Composable
private fun Options(i: InteractCtx, options: List<String>, answer: Int) {
    val look = i.ctx.look
    val state = i.play.interact
    val answered = state?.result != null
    val han = options.any { HAN.containsMatchIn(it) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        options.forEachIndexed { k, o ->
            val isAnswer = k == answer
            val picked = state?.picked == k
            val p = entrance(i.ctx, k * 90)
            val ok = answered && isAnswer
            val bad = picked && !isAnswer
            val bg = when { ok -> Color(0x4716A34A); bad -> Color(0x40DC2626); else -> look.cardBg }
            val border = when { ok -> Color(0xFF16A34A); bad -> Color(0xFFDC2626); !answered -> look.accent; else -> look.border }
            Row(
                Modifier.fillMaxWidth().heightIn(min = 60.dp).enter(p, Entrance.UP)
                    .graphicsLayer { alpha = if (answered && !ok && !bad) 0.55f else 1f }
                    .background(bg, RoundedCornerShape(16.dp)).border(2.dp, border, RoundedCornerShape(16.dp))
                    .clickable(enabled = !answered, role = Role.Button) { i.actions.onOption(k) }
                    .semantics { contentDescription = "Option $o" + (if (ok) ", the answer" else "") + (if (bad) ", wrong" else "") }
                    .testTag("clip-quiz-option")
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
            ) {
                if (ok) Text("✓ ", color = look.cardFg, fontSize = 18.sp, fontWeight = FontWeight.Black)
                if (bad) Text("✗ ", color = look.cardFg, fontSize = 18.sp, fontWeight = FontWeight.Black)
                Text(o, color = look.cardFg, fontSize = if (han) 24.sp else 17.sp, fontWeight = FontWeight.ExtraBold, fontFamily = if (han) look.zhFont else look.enFont, textAlign = TextAlign.Center, modifier = Modifier.weight(1f, fill = false))
                if (i.ctx.pinyin && HAN.containsMatchIn(o)) Text("  " + devicePinyinLine(o), color = look.cardFg.copy(alpha = 0.8f), fontSize = 13.sp)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QuizView(i: InteractCtx, scene: ClipScene) {
    val q = scene.quiz ?: return
    val look = i.ctx.look
    val answered = i.play.interact?.result != null
    val answer = q.options.getOrNull(q.answer_index).orEmpty()
    q.prompt_zh?.takeIf { it.isNotBlank() }?.let { prompt ->
        val parts = prompt.split(Regex("_{2,}|＿+"))
        val style = TextStyle(fontFamily = look.zhFont, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = look.fg, textAlign = TextAlign.Center)
        FlowRow(horizontalArrangement = Arrangement.Center, verticalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
            parts.forEachIndexed { k, part ->
                if (part.isNotEmpty()) Zh(part, i.ctx, style)
                if (k < parts.size - 1) {
                    Text(
                        if (answered) answer else " ? ",
                        style = style.copy(color = look.accent),
                        modifier = Modifier.padding(horizontal = 4.dp).drawBehind { drawRect(look.accent, topLeft = Offset(0f, size.height - 4.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width, 4.dp.toPx())) },
                    )
                }
            }
        }
        if (i.ctx.pinyin) Text(devicePinyinLine(prompt.replace(Regex("_{2,}|＿+"), if (answered) answer else " ___ ")), color = look.muted, fontSize = 14.sp, textAlign = TextAlign.Center)
    }
    q.prompt_en?.let { if (i.ctx.english || q.prompt_zh.isNullOrBlank()) Text(it, color = look.muted, fontSize = 16.sp, fontFamily = look.enFont, textAlign = TextAlign.Center) }
    Options(i, q.options, q.answer_index)
    if (answered) {
        Verdict(i)
        q.explain?.let { Mixed(it, i.ctx, TextStyle(color = look.muted, fontSize = 16.sp, fontFamily = look.enFont, textAlign = TextAlign.Center)) }
    }
    InteractBar(i, "👆 Tap an answer", "clip-quiz")
}

@Composable
fun ListenView(i: InteractCtx, scene: ClipScene) {
    val l = scene.listen ?: return
    val look = i.ctx.look
    val answered = i.play.interact?.result != null
    var peek by remember { mutableStateOf(false) }
    val shown = answered || peek
    val playing = i.clock?.line == 0
    if (scene.emoji == null) Text("🎧", fontSize = 48.sp)
    if (!i.muted) Pill(if (playing) "🔊 Play again" else "▶ Play again", look, primary = false, tag = "clip-listen-play", onClick = i.actions.onReplay)
    else if (!shown) {
        Text("🔇 Turn the sound on to hear it — or", color = look.fg, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Pill("Show the Chinese", look, primary = false, tag = "clip-listen-peek") { peek = true }
    }
    if (shown) {
        Column(Modifier.fillMaxWidth().clipCard(look).padding(14.dp).testTag("clip-listen-text"), horizontalAlignment = Alignment.CenterHorizontally) {
            KaraokeLine(l.hanzi, "zh", i.clock, i.ctx.pinyin, TextStyle(fontFamily = look.zhFont, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, color = look.cardFg), look.accent, i.ctx.animate, i.ctx.onExplore)
            if (i.ctx.pinyin) Text(l.pinyin, color = look.cardFg.copy(alpha = 0.75f), fontSize = 15.sp, textAlign = TextAlign.Center)
            if (answered) Text(l.english, color = look.cardFg.copy(alpha = 0.75f), fontSize = 15.sp, textAlign = TextAlign.Center)
        }
    } else {
        // The line is hidden: a little sound wave while it plays.
        val wave = if (playing && i.ctx.animate) rememberInfiniteTransition(label = "wave").animateFloat(0.3f, 1f, infiniteRepeatable(tween(350), RepeatMode.Reverse), label = "w").value else 0.4f
        Row(Modifier.height(56.dp).testTag("clip-listen-hidden").semantics { contentDescription = "The sentence is hidden — listen" }, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            repeat(minOf(14, l.hanzi.length)) { k ->
                val h = 10 + 38 * (if (k % 2 == 0) wave else 1.3f - wave).coerceIn(0f, 1f)
                Box(Modifier.size(8.dp, h.dp).background(look.accent.copy(alpha = 0.8f), RoundedCornerShape(4.dp)))
            }
        }
    }
    l.prompt_en?.let { Text(it, color = look.fg, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center) }
    Options(i, l.options, l.answer_index)
    if (answered) {
        Verdict(i)
        l.explain?.let { Mixed(it, i.ctx, TextStyle(color = look.muted, fontSize = 16.sp, fontFamily = look.enFont, textAlign = TextAlign.Center)) }
    }
    InteractBar(i, "🎧 Listen, then tap what it means", "clip-listen")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OrderView(i: InteractCtx, scene: ClipScene) {
    val o = scene.order ?: return
    val look = i.ctx.look
    val offered = remember(o.tiles, i.clipId, i.index) { Clips.orderShuffle(o.tiles, "${i.clipId}:${i.index}") }
    val picked = remember(i.clipId, i.index) { mutableStateListOf<Int>() }
    val result = i.play.interact?.result
    val answered = result != null
    LaunchedEffect(picked.size) { if (picked.size == o.tiles.size && !answered) i.actions.onOrder(picked.toList()) }
    o.prompt_en?.let { Text(it, color = look.fg, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center) }
    val frame = when (result) { "right" -> Color(0xFF16A34A); null -> look.border; else -> Color(0xFFDC2626) }
    FlowRow(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).clipCard(look).border(2.dp, frame, RoundedCornerShape(look.radius)).padding(10.dp).testTag("clip-order-answer"),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
    ) {
        when {
            answered -> KaraokeLine(Clips.orderSentence(o.tiles), "zh", i.clock, i.ctx.pinyin, TextStyle(fontFamily = look.zhFont, fontSize = 30.sp, fontWeight = FontWeight.Black, color = look.cardFg), look.accent, i.ctx.animate, i.ctx.onExplore)
            picked.isEmpty() -> Text("Tap the words below…", color = look.cardFg.copy(alpha = 0.7f), fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 14.dp))
            else -> picked.forEach { t ->
                Text(
                    o.tiles[t], color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Black, fontFamily = look.zhFont,
                    modifier = Modifier.heightIn(min = 52.dp).background(look.accent, RoundedCornerShape(14.dp)).clickable(role = Role.Button) { if (!answered) picked.remove(t) }.padding(horizontal = 14.dp, vertical = 6.dp).testTag("clip-order-placed"),
                )
            }
        }
    }
    if (answered && result != "right" && picked.isNotEmpty()) Text(picked.joinToString("") { o.tiles[it] }, color = look.muted, fontSize = 17.sp, textDecoration = TextDecoration.LineThrough)
    if (!answered) FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        offered.forEach { t ->
            val used = t in picked
            val p = entrance(i.ctx, 60 * offered.indexOf(t))
            Column(
                Modifier.enter(p, Entrance.POP).graphicsLayer { alpha = if (used) 0.2f else 1f }.heightIn(min = 56.dp).widthIn(min = 56.dp).clipCard(look)
                    .clickable(enabled = !used, role = Role.Button) { picked.add(t) }
                    .semantics { contentDescription = "Tile ${o.tiles[t]}" }
                    .testTag("clip-order-tile").padding(horizontal = 14.dp, vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(o.tiles[t], color = look.cardFg, fontSize = 26.sp, fontWeight = FontWeight.Black, fontFamily = look.zhFont)
                if (i.ctx.pinyin && HAN.containsMatchIn(o.tiles[t])) Text(devicePinyinLine(o.tiles[t]), color = look.cardFg.copy(alpha = 0.8f), fontSize = 11.sp)
            }
        }
    }
    if (answered) {
        Verdict(i)
        if (i.ctx.pinyin) Text(o.pinyin, color = look.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
        Text(o.english, color = look.muted, fontSize = 16.sp, textAlign = TextAlign.Center)
    }
    InteractBar(i, "👆 Tap the words in order", "clip-order")
}

@Composable
fun RevealView(i: InteractCtx, scene: ClipScene) {
    val r = scene.reveal ?: return
    val look = i.ctx.look
    val flipped = i.play.interact?.result != null
    val turn = remember { Animatable(if (flipped) 180f else 0f) }
    LaunchedEffect(flipped) { if (flipped) { if (i.ctx.animate) turn.animateTo(180f, spring(dampingRatio = 0.7f)) else turn.snapTo(180f) } }
    val back = turn.value > 90f
    Box(
        Modifier.fillMaxWidth().heightIn(min = 200.dp)
            .graphicsLayer { rotationY = turn.value; cameraDistance = 14f * density }
            .clipCard(look).border(2.dp, if (back) look.accent else look.border, RoundedCornerShape(look.radius))
            .clickable(enabled = !flipped, role = Role.Button) { i.actions.onFlip() }
            .semantics { contentDescription = if (flipped) r.hanzi else "${r.prompt_en} — tap to see the Chinese" }
            .testTag("clip-reveal-card").padding(18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(Modifier.graphicsLayer { rotationY = if (back) 180f else 0f }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!back) {
                Text("ENGLISH", color = look.cardFg.copy(alpha = 0.7f), fontSize = 12.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp)
                Text(r.prompt_en, color = look.cardFg, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
                Text("Tap to flip ↻", color = look.accent, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
            } else {
                Text("中文", color = look.cardFg.copy(alpha = 0.7f), fontSize = 12.sp, fontWeight = FontWeight.Black)
                KaraokeLine(r.hanzi, "zh", i.clock, false, TextStyle(fontFamily = look.zhFont, fontSize = 36.sp, fontWeight = FontWeight.Black, color = look.cardFg), look.accent, i.ctx.animate, i.ctx.onExplore, tag = "clip-reveal-zh")
                Text(r.pinyin, color = look.cardFg.copy(alpha = 0.75f), fontSize = 16.sp, textAlign = TextAlign.Center)
            }
        }
    }
    if (flipped) r.note?.let { Mixed(it, i.ctx, TextStyle(color = look.muted, fontSize = 16.sp, fontFamily = look.enFont, textAlign = TextAlign.Center)) }
    InteractBar(i, "🤔 Say it in Chinese in your head — then tap to flip", "clip-reveal")
}

@Composable
fun SpeakView(i: InteractCtx, scene: ClipScene) {
    val s = scene.speak ?: return
    val look = i.ctx.look
    val answered = i.play.interact?.result != null
    if (scene.emoji == null) Text("🎤", fontSize = 48.sp)
    s.prompt_en?.let { Text(it, color = look.fg, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center) }
    Column(Modifier.fillMaxWidth().clipCard(look).padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        KaraokeLine(s.hanzi, "zh", i.clock, i.ctx.pinyin, TextStyle(fontFamily = look.zhFont, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, color = look.cardFg), look.accent, i.ctx.animate, i.ctx.onExplore)
        if (i.ctx.pinyin) Text(s.pinyin, color = look.cardFg.copy(alpha = 0.75f), fontSize = 15.sp, textAlign = TextAlign.Center)
        if (i.ctx.english) Text(s.english, color = look.cardFg.copy(alpha = 0.75f), fontSize = 15.sp, textAlign = TextAlign.Center)
        // The Coach's "🎤 Practise saying it" row: ▶, 🎤, the live words, the compact "You said" row.
        Box(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            PractiseSentenceRow(s.hanzi, tag = "clip-speak", preview = i.speakPreview, onPractised = { if (!answered) i.actions.onSpeak(it) })
        }
    }
    if (answered) Verdict(i)
    InteractBar(i, "👆 Tap 🎤 and say it", "clip-speak")
}
