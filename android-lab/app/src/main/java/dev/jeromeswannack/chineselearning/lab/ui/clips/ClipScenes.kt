package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPlayState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipScene
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSpec
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSegmentInput
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.study.devicePinyinLine
import kotlinx.coroutines.delay

/**
 * 🎬 One scene of a clip, by layout (web components/clips/ClipScenes.tsx). Every Chinese text opens
 * the language explorer (by word with the device segmenter; the clip pauses while it is open);
 * pinyin shows when 拼 is on (the spec's, else device pinyin), English when EN is on. Motion =
 * entrances (pop, drop, zoom, slide, stagger), springy; off with [SceneCtx.animate] false.
 */
class SceneCtx(
    val look: ClipLook,
    val pinyin: Boolean,
    val english: Boolean,
    val animate: Boolean,
    val onExplore: () -> Unit,
)

private val HAN = Regex("\\p{IsHan}")

enum class Entrance { POP, DROP, ZOOM, UP, FADE, LEFT, RIGHT, STAMP, BUBBLE }

/** 0 → 1 once, after [delayMs] (1 at once without motion). */
@Composable
fun entrance(ctx: SceneCtx, delayMs: Int = 0, bouncy: Boolean = true): Float {
    val a = remember { Animatable(if (ctx.animate) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (!ctx.animate) return@LaunchedEffect
        delay(delayMs.toLong())
        if (bouncy) a.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow))
        else a.animateTo(1f, tween(450))
    }
    return a.value
}

fun Modifier.enter(p: Float, kind: Entrance): Modifier = graphicsLayer {
    val q = p.coerceIn(0f, 1.2f)
    alpha = p.coerceIn(0f, 1f)
    when (kind) {
        Entrance.POP -> { scaleX = 0.4f + 0.6f * q; scaleY = scaleX }
        Entrance.DROP -> { translationY = -60.dp.toPx() * (1 - q); rotationZ = -8f * (1 - p.coerceIn(0f, 1f)) }
        Entrance.ZOOM -> { scaleX = 2.4f - 1.4f * q; scaleY = scaleX }
        Entrance.UP -> translationY = 24.dp.toPx() * (1 - q)
        Entrance.FADE -> Unit
        Entrance.LEFT -> translationX = -size.width * 1.2f * (1 - q)
        Entrance.RIGHT -> translationX = size.width * 1.2f * (1 - q)
        Entrance.STAMP -> { scaleX = 3f - 2f * q; scaleY = scaleX; rotationZ = -12f + 9f * q }
        Entrance.BUBBLE -> { translationY = 16.dp.toPx() * (1 - q); scaleX = 0.85f + 0.15f * q; scaleY = scaleX }
    }
}

private fun segmentsOf(text: String): List<WordSegmentInput>? = DeviceWords.of(text)?.map { WordSegmentInput(it.text, it.pinyin, it.gloss) }

/** A headline style for the theme (glow / outline / offset). */
fun headStyle(look: ClipLook, size: TextUnit, color: Color = look.fg): TextStyle {
    val shadow = when (look.headEffect) {
        "glow" -> Shadow(look.accent, Offset.Zero, 28f)
        "outline" -> Shadow(Color(0xFF111111), Offset(6f, 6f), 0f)
        "offset" -> Shadow(look.accent, Offset(8f, 8f), 0f)
        else -> null
    }
    return TextStyle(fontFamily = look.zhFont, fontSize = size, fontWeight = look.headWeight, color = color, shadow = shadow, textAlign = TextAlign.Center, lineHeight = size * 1.15f)
}

/** Chinese, tappable by word into the explorer. */
@Composable
fun Zh(text: String, ctx: SceneCtx, style: TextStyle, modifier: Modifier = Modifier) {
    if (!HAN.containsMatchIn(text)) {
        Text(text, modifier = modifier, style = style)
        return
    }
    val segments = remember(text, DeviceWords.of(text) != null) { segmentsOf(text) }
    ExplorableText(text, source = "clips", modifier = modifier, segments = segments, style = style, color = style.color, textAlign = style.textAlign, onTap = { ctx.onExplore() })
}

/** Text mixing English and Chinese: the Chinese runs tappable. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Mixed(text: String, ctx: SceneCtx, style: TextStyle, modifier: Modifier = Modifier) {
    if (!HAN.containsMatchIn(text)) {
        Text(text, modifier = modifier, style = style)
        return
    }
    Zh(text, ctx, style, modifier)
}

@Composable
fun Py(text: String, ctx: SceneCtx, pinyin: String? = null, size: TextUnit = 15.sp, color: Color = ctx.look.muted) {
    if (!ctx.pinyin || !HAN.containsMatchIn(text)) return
    val line = pinyin?.takeIf { it.isNotBlank() } ?: devicePinyinLine(text)
    if (line.isNotBlank()) Text(line, color = color, fontSize = size, fontFamily = ctx.look.enFont, textAlign = TextAlign.Center)
}

@Composable
fun En(text: String?, ctx: SceneCtx, size: TextUnit = 16.sp, color: Color = ctx.look.muted, modifier: Modifier = Modifier) {
    if (!ctx.english || text.isNullOrBlank()) return
    Text(if (ctx.look.uppercase) text.uppercase() else text, color = color, fontSize = size, fontFamily = ctx.look.enFont, textAlign = TextAlign.Center, modifier = modifier)
}

/** The theme's card: background, border (dashed on chalk), hard shadow (comic / retro). */
fun Modifier.clipCard(look: ClipLook): Modifier {
    val shape = RoundedCornerShape(look.radius)
    val shadowed = if (look.hardShadow) this.drawBehind {
        drawRoundRect(if (look.name == "retro") Color.Black else Color(0xFF111111), topLeft = Offset(5.dp.toPx(), 5.dp.toPx()), size = size, cornerRadius = androidx.compose.ui.geometry.CornerRadius(look.radius.toPx()))
    } else this
    val base = shadowed.background(look.cardBg, shape)
    return if (look.dashed) base.drawBehind {
        drawRoundRect(look.border, style = Stroke(width = look.borderWidth.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 8f))), cornerRadius = androidx.compose.ui.geometry.CornerRadius(look.radius.toPx()))
    } else base.border(BorderStroke(look.borderWidth, look.border), shape)
}

@Composable
fun HookBanner(text: String, ctx: SceneCtx) {
    val p = entrance(ctx)
    val look = ctx.look
    val shape = RoundedCornerShape(if (look.radius == 0.dp) 0.dp else 12.dp)
    val mod = if (look.hookOutlined) Modifier.border(3.dp, look.accent, shape) else Modifier.background(look.accent, shape)
    Text(
        if (look.uppercase) text.uppercase() else text,
        modifier = Modifier.enter(p, Entrance.POP).then(mod).padding(horizontal = 14.dp, vertical = 8.dp).semantics { contentDescription = "Hook: $text" },
        color = if (look.hookOutlined) look.accent else if (look.name == "retro") Color(0xFF140C2B) else Color.White,
        fontSize = 21.sp, fontWeight = FontWeight.ExtraBold, fontFamily = look.enFont, textAlign = TextAlign.Center, lineHeight = 26.sp,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SceneView(spec: ClipSpec, scene: ClipScene, index: Int, play: ClipPlayState, ctx: SceneCtx, spokenLine: Int, onAnswer: (Int) -> Unit) {
    val look = ctx.look
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (index == 0 && spec.hook.isNotBlank()) HookBanner(spec.hook, ctx)
        scene.emoji?.takeIf { it.isNotBlank() }?.let { e ->
            val p = entrance(ctx, 80)
            Text(e, fontSize = 52.sp, modifier = Modifier.enter(p, Entrance.POP))
        }
        when (scene.layout) {
            "title" -> scene.title?.let { t ->
                t.headline_zh?.takeIf { it.isNotBlank() }?.let { h ->
                    // Kinetic type: each word drops in, staggered.
                    val pieces = remember(h, DeviceWords.of(h) != null) { segmentsOf(h)?.map { it.text } ?: h.map { it.toString() } }
                    FlowRow(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
                        pieces.forEachIndexed { i, piece ->
                            val p = entrance(ctx, 120 + i * 70)
                            Zh(piece, ctx, headStyle(look, 54.sp), Modifier.enter(p, Entrance.DROP))
                        }
                    }
                    Py(h, ctx)
                }
                t.headline_en?.let { val p = entrance(ctx, 350); Text(if (look.uppercase) it.uppercase() else it, color = look.fg, fontSize = 22.sp, fontWeight = FontWeight.Bold, fontFamily = look.enFont, textAlign = TextAlign.Center, modifier = Modifier.enter(p, Entrance.UP)) }
                t.sub?.let { val p = entrance(ctx, 700, bouncy = false); Text(it, color = look.muted, fontSize = 16.sp, fontFamily = look.enFont, textAlign = TextAlign.Center, modifier = Modifier.enter(p, Entrance.FADE)) }
            }
            "big_word" -> scene.big_word?.let { w ->
                if (ctx.pinyin) { val p = entrance(ctx, 250, bouncy = false); Text(w.pinyin, color = look.accent2, fontSize = 24.sp, fontWeight = FontWeight.Bold, fontFamily = look.enFont, modifier = Modifier.enter(p, Entrance.FADE)) }
                val z = entrance(ctx)
                Zh(w.hanzi, ctx, headStyle(look, if (w.hanzi.length > 3) 72.sp else 96.sp), Modifier.enter(z, Entrance.ZOOM))
                val e = entrance(ctx, 450)
                En(w.english, ctx, 18.sp, modifier = Modifier.enter(e, Entrance.UP))
                if (w.breakdown.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    w.breakdown.forEachIndexed { i, b ->
                        val p = entrance(ctx, 700 + i * 160)
                        Column(Modifier.enter(p, Entrance.UP).clipCard(look).padding(horizontal = 12.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Zh(b.char, ctx, TextStyle(fontFamily = look.zhFont, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = look.cardFg))
                            if (ctx.pinyin) Text(devicePinyinLine(b.char), color = look.cardFg.copy(alpha = 0.8f), fontSize = 12.sp)
                            Text(b.meaning, color = look.cardFg.copy(alpha = 0.8f), fontSize = 12.sp, fontFamily = look.enFont)
                        }
                    }
                }
            }
            "sentence" -> scene.sentence?.let { s ->
                val p = entrance(ctx)
                Column(Modifier.fillMaxWidth().enter(p, Entrance.UP).clipCard(look).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val style = TextStyle(fontFamily = look.zhFont, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, color = look.cardFg, textAlign = TextAlign.Center, lineHeight = 40.sp)
                    val hl = s.highlight?.takeIf { it.isNotBlank() && s.hanzi.contains(it) }
                    if (hl == null) Zh(s.hanzi, ctx, style)
                    else {
                        val at = s.hanzi.indexOf(hl)
                        val sweep = entrance(ctx, 700, bouncy = false)
                        FlowRow(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
                            if (at > 0) Zh(s.hanzi.substring(0, at), ctx, style)
                            Zh(hl, ctx, style.copy(color = look.accent), Modifier.drawBehind {
                                drawRect(look.accent, topLeft = Offset(0f, size.height - 4.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width * sweep.coerceIn(0f, 1f), 5.dp.toPx()))
                            })
                            if (at + hl.length < s.hanzi.length) Zh(s.hanzi.substring(at + hl.length), ctx, style)
                        }
                    }
                    Py(s.hanzi, ctx, s.pinyin, color = look.cardFg.copy(alpha = 0.75f))
                    En(s.english, ctx, color = look.cardFg.copy(alpha = 0.75f))
                }
            }
            "compare" -> scene.compare?.let { c ->
                Box(Modifier.fillMaxWidth().padding(top = 24.dp)) {
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for ((which, side) in listOf("A" to c.left, "B" to c.right)) {
                            val p = entrance(ctx, if (which == "A") 0 else 150)
                            Column(
                                Modifier.weight(1f).fillMaxHeight().enter(p, if (which == "A") Entrance.LEFT else Entrance.RIGHT).clipCard(look).padding(12.dp),
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(which, color = look.cardFg.copy(alpha = 0.8f), fontSize = 11.sp, fontWeight = FontWeight.Black)
                                Zh(side.hanzi, ctx, TextStyle(fontFamily = look.zhFont, fontSize = 40.sp, fontWeight = FontWeight.Black, color = look.cardFg, textAlign = TextAlign.Center))
                                if (ctx.pinyin) Text(side.pinyin, color = look.cardFg.copy(alpha = 0.75f), fontSize = 14.sp)
                                En(side.english, ctx, 14.sp, color = look.cardFg.copy(alpha = 0.75f))
                                side.example?.let { ex ->
                                    Spacer(Modifier.height(4.dp))
                                    Zh(ex, ctx, TextStyle(fontFamily = look.zhFont, fontSize = 17.sp, color = look.cardFg, textAlign = TextAlign.Center))
                                    Py(ex, ctx, size = 13.sp, color = look.cardFg.copy(alpha = 0.75f))
                                }
                            }
                        }
                    }
                    val vs = entrance(ctx, 500)
                    Box(Modifier.align(Alignment.TopCenter).offset(y = (-22).dp).enter(vs, Entrance.POP).size(44.dp).background(look.accent, if (look.radius == 0.dp) RoundedCornerShape(0.dp) else CircleShape), contentAlignment = Alignment.Center) {
                        Text("VS", color = Color.White, fontWeight = FontWeight.Black, fontSize = 14.sp)
                    }
                }
                c.rule_en?.let { r -> val p = entrance(ctx, 1600); Box(Modifier.enter(p, Entrance.UP)) { Mixed("💡 $r", ctx, TextStyle(color = look.fg, fontSize = 17.sp, fontWeight = FontWeight.Bold, fontFamily = look.enFont, textAlign = TextAlign.Center)) } }
            }
            "quiz" -> scene.quiz?.let { q -> QuizView(spec, scene, play, ctx, onAnswer) }
            "story" -> scene.story?.let { st ->
                val cast = remember(st) { Clips.storyCast(st.lines.map { it.speaker }) }
                val shown = Clips.storyLinesShown(st.lines.size, scene.duration_ms.toDouble(), play.elapsedMs, spokenLine)
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    st.lines.take(shown).forEachIndexed { i, l ->
                        val side = cast.sides[i]
                        val p = entrance(ctx)
                        val align = when (side) { "left" -> Alignment.Start; "right" -> Alignment.End; else -> Alignment.CenterHorizontally }
                        Column(Modifier.fillMaxWidth().enter(p, Entrance.BUBBLE), horizontalAlignment = align) {
                            val speaker = l.speaker
                            if (!speaker.isNullOrBlank() && side != "center") Text(speaker, color = look.accent2, fontSize = 12.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(horizontal = 6.dp))
                            val right = side == "right"
                            val center = side == "center"
                            val fg = if (right) Color.White else look.cardFg
                            val bubble = when {
                                center -> Modifier
                                right -> Modifier.background(look.accent, RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp))
                                else -> Modifier.clipCard(look)
                            }
                            val ring = if (spokenLine == i) Modifier.border(3.dp, look.accent2, RoundedCornerShape(18.dp)) else Modifier
                            Column(Modifier.widthIn(max = 300.dp).then(ring).then(bubble).padding(horizontal = 14.dp, vertical = 10.dp), horizontalAlignment = if (center) Alignment.CenterHorizontally else if (right) Alignment.End else Alignment.Start) {
                                val c = if (center) look.fg else fg
                                Zh(l.hanzi, ctx, TextStyle(fontFamily = look.zhFont, fontSize = 21.sp, fontWeight = FontWeight.Bold, color = c, fontStyle = if (center) FontStyle.Italic else FontStyle.Normal))
                                Py(l.hanzi, ctx, l.pinyin, 13.sp, c.copy(alpha = 0.8f))
                                En(l.english, ctx, 13.sp, c.copy(alpha = 0.8f))
                            }
                        }
                    }
                }
            }
            "list" -> scene.list?.let { l ->
                l.title?.let { t -> Mixed(t, ctx, TextStyle(color = look.fg, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, fontFamily = look.enFont, textAlign = TextAlign.Center)) }
                l.items.forEachIndexed { i, it ->
                    val p = entrance(ctx, i * 300)
                    Row(Modifier.fillMaxWidth().enter(p, Entrance.RIGHT).clipCard(look).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("${i + 1}", color = look.accent, fontWeight = FontWeight.Black, fontSize = 18.sp)
                        Column {
                            Zh(it.hanzi, ctx, TextStyle(fontFamily = look.zhFont, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, color = look.cardFg))
                            if (ctx.pinyin) Text(it.pinyin, color = look.cardFg.copy(alpha = 0.75f), fontSize = 14.sp)
                            En(it.english, ctx, 14.sp, look.cardFg.copy(alpha = 0.75f))
                        }
                    }
                }
            }
            "fact" -> scene.fact?.let { f ->
                Text(if (scene.emoji == null) "💡 DID YOU KNOW?" else "DID YOU KNOW?", color = look.accent, fontSize = 13.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp)
                f.hanzi?.takeIf { it.isNotBlank() }?.let { h ->
                    val p = entrance(ctx, 200)
                    Zh(h, ctx, headStyle(look, 72.sp), Modifier.enter(p, Entrance.STAMP))
                    Py(h, ctx, f.pinyin)
                }
                val p = entrance(ctx, 500)
                Box(Modifier.enter(p, Entrance.UP)) { Mixed(f.text_en, ctx, TextStyle(color = look.fg, fontSize = 21.sp, fontWeight = FontWeight.Bold, fontFamily = look.enFont, textAlign = TextAlign.Center, lineHeight = 28.sp)) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuizView(spec: ClipSpec, scene: ClipScene, play: ClipPlayState, ctx: SceneCtx, onAnswer: (Int) -> Unit) {
    val q = scene.quiz ?: return
    val look = ctx.look
    val state = play.quiz
    val answered = state != null && (state.picked != null || state.timedOut)
    val right = Clips.quizRight(spec, play)
    val answer = q.options.getOrNull(q.answer_index).orEmpty()
    q.prompt_zh?.takeIf { it.isNotBlank() }?.let { prompt ->
        val parts = prompt.split(Regex("_{2,}|＿+"))
        val style = TextStyle(fontFamily = look.zhFont, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = look.fg, textAlign = TextAlign.Center)
        FlowRow(horizontalArrangement = Arrangement.Center, verticalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
            parts.forEachIndexed { i, part ->
                if (part.isNotEmpty()) Zh(part, ctx, style)
                if (i < parts.size - 1) {
                    Text(
                        if (answered) answer else " ? ",
                        style = style.copy(color = look.accent),
                        modifier = Modifier.padding(horizontal = 4.dp).drawBehind { drawRect(look.accent, topLeft = Offset(0f, size.height - 4.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width, 4.dp.toPx())) },
                    )
                }
            }
        }
        if (ctx.pinyin) Text(devicePinyinLine(prompt.replace(Regex("_{2,}|＿+"), if (answered) answer else " ___ ")), color = look.muted, fontSize = 14.sp, textAlign = TextAlign.Center)
    }
    q.prompt_en?.let { if (ctx.english || q.prompt_zh.isNullOrBlank()) Text(it, color = look.muted, fontSize = 16.sp, fontFamily = look.enFont, textAlign = TextAlign.Center) }
    if (!answered) {
        val left = 1f - (play.elapsedMs / scene.duration_ms).toFloat().coerceIn(0f, 1f)
        Box(Modifier.fillMaxWidth().height(6.dp).background(look.fg.copy(alpha = 0.15f), RoundedCornerShape(3.dp))) {
            Box(Modifier.fillMaxWidth(left).height(6.dp).background(look.accent2, RoundedCornerShape(3.dp)))
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        q.options.forEachIndexed { i, o ->
            val isAnswer = i == q.answer_index
            val picked = state?.picked == i
            val p = entrance(ctx, i * 90)
            val ok = answered && isAnswer
            val bad = picked && !isAnswer
            val bg = when { ok -> Color(0x4716A34A); bad -> Color(0x40DC2626); else -> look.cardBg }
            val border = when { ok -> Color(0xFF16A34A); bad -> Color(0xFFDC2626); else -> look.border }
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).enter(p, Entrance.UP)
                    .graphicsLayer { alpha = if (answered && !ok && !bad) 0.55f else 1f }
                    .background(bg, RoundedCornerShape(16.dp)).border(2.dp, border, RoundedCornerShape(16.dp))
                    .clickable(enabled = !answered, role = Role.Button) { onAnswer(i) }
                    .semantics { contentDescription = "Option $o" + (if (ok) ", the answer" else "") + (if (bad) ", wrong" else "") }
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
            ) {
                if (ok) Text("✓ ", color = look.cardFg, fontSize = 18.sp, fontWeight = FontWeight.Black)
                if (bad) Text("✗ ", color = look.cardFg, fontSize = 18.sp, fontWeight = FontWeight.Black)
                Text(o, color = look.cardFg, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, fontFamily = look.zhFont)
                if (ctx.pinyin && HAN.containsMatchIn(o)) Text("  " + devicePinyinLine(o), color = look.cardFg.copy(alpha = 0.8f), fontSize = 13.sp)
                if (ok) Text("  answer", color = look.cardFg.copy(alpha = 0.8f), fontSize = 13.sp)
            }
        }
    }
    if (answered) {
        val p = entrance(ctx)
        Text(
            when (right) { true -> "✓ Right!"; false -> "✗ Not quite"; null -> "⏱ Time’s up" },
            color = look.fg, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.enter(p, Entrance.POP).semantics { contentDescription = "quiz verdict" },
        )
        q.explain?.let { Mixed(it, ctx, TextStyle(color = look.muted, fontSize = 16.sp, fontFamily = look.enFont, textAlign = TextAlign.Center)) }
    }
}
