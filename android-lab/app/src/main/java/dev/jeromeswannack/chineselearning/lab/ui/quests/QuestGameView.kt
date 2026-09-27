package dev.jeromeswannack.chineselearning.lab.ui.quests

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateIntOffsetAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.QuestDirection
import dev.jeromeswannack.chineselearning.lab.core.QuestEngine
import dev.jeromeswannack.chineselearning.lab.core.QuestPlayerAction
import dev.jeromeswannack.chineselearning.lab.core.QuestState
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlin.math.floor

/**
 * The playable quest — the native twin of QuestGame (QuestPlayPage.tsx): HUD, the Chinese
 * instruction (🔊 / 💡, pinyin and English behind toggles), the tile map with a springy
 * character, and the dock (what you're holding, arrows, verb buttons). Owns the whole
 * screen, never scrolls; the map takes whatever is left.
 */
@Composable
fun QuestGameView(
    c: QuestGameController,
    reveal: QuestReveal,
    onReveal: (QuestReveal) -> Unit,
    onExit: () -> Unit,
    menuOpenInitially: Boolean = false,
) {
    var menuOpen by remember { mutableStateOf(menuOpenInitially) }
    val s = c.state
    val goal = c.goal
    Box(Modifier.fillMaxSize().background(Lab.colors.background).windowInsetsPadding(WindowInsets.safeDrawing)) {
        Column(Modifier.fillMaxSize().widthIn(max = 720.dp).align(Alignment.TopCenter)) {
            // HUD
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                HudButton("✕", onExit)
                Text(s.world.title.hanzi, Modifier.weight(1f).padding(horizontal = 8.dp), fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Lab.colors.ink, maxLines = 1)
                Text("${s.moves} 步", color = Lab.colors.muted, fontSize = 15.sp)
                HudButton("☰") { menuOpen = true }
            }
            if (goal != null && !s.finished) InstructionCard(c, s, reveal)
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                val fit = minOf(maxWidth.value / s.world.width, maxHeight.value / s.world.height)
                val tile = floor(fit).coerceIn(18f, 76f).dp
                val highlighted = if (c.showHint && goal != null) QuestEngine.conditionObjectIds(goal.condition).toSet() else emptySet()
                QuestMap(s, tile, highlighted, c.bumps, c.lastDirection)
                ToastLayer(c)
            }
            if (!s.finished) Dock(c, s, reveal)
        }
        if (s.finished) FinishOverlay(s, onReplay = c::replay, onExit = onExit)
        if (menuOpen) QuestMenu(s, reveal, onReveal, onClose = { menuOpen = false }, onRestart = { menuOpen = false; c.replay() }, onExit = onExit)
    }
}

@Composable
private fun HudButton(label: String, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(label, fontSize = 20.sp, color = Lab.colors.ink)
    }
}

@Composable
private fun InstructionCard(c: QuestGameController, s: QuestState, reveal: QuestReveal) {
    val goal = c.goal ?: return
    val progress = QuestEngine.activeGoalProgress(s)
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(18.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val step = if (progress != null && progress.second > 1) " · 第 ${minOf(progress.first + 1, progress.second)} 步/${progress.second}" else ""
            Text("${s.activeGoalIndex + 1}/${s.world.goals.size}$step", fontSize = 13.sp, color = Lab.colors.muted, modifier = Modifier.weight(1f))
            s.world.goals.forEachIndexed { i, _ ->
                val color = when {
                    i < s.activeGoalIndex -> Palette.Good
                    i == s.activeGoalIndex -> Lab.colors.accent
                    else -> Lab.colors.faint
                }
                Box(Modifier.padding(start = 4.dp).size(if (i == s.activeGoalIndex) 10.dp else 8.dp).clip(CircleShape).background(color))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(goal.instruction.hanzi, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f).padding(vertical = 4.dp))
            HudButton("🔊") { c.speakInstruction() }
            if (goal.hint != null) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(if (c.showHint) Palette.Gold.copy(alpha = 0.25f) else Color.Transparent).clickable { c.showHint = !c.showHint }, contentAlignment = Alignment.Center) {
                    Text("💡", fontSize = 20.sp)
                }
            }
        }
        if (reveal.pinyin) Text(goal.instruction.pinyin, fontSize = 15.sp, color = Lab.colors.muted)
        if (reveal.english) Text(goal.instruction.english, fontSize = 15.sp, color = Lab.colors.muted)
        AnimatedVisibility(c.showHint && goal.hint != null) {
            val h = goal.hint ?: return@AnimatedVisibility
            Column(Modifier.padding(top = 6.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.Gold.copy(alpha = 0.14f)).padding(10.dp)) {
                Text("💡 ${h.hanzi}", fontSize = 16.sp, color = Lab.colors.ink)
                if (reveal.pinyin) Text(h.pinyin, fontSize = 13.sp, color = Lab.colors.muted)
                if (reveal.english) Text(h.english, fontSize = 13.sp, color = Lab.colors.muted)
            }
        }
    }
}

/** CSS colours from the generated world (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, a few names). */
internal fun cssColor(css: String?): Color {
    val s = css?.trim()?.lowercase() ?: return Color(0xFFE5E7EB)
    runCatching {
        if (s.startsWith("#")) {
            val h = s.drop(1)
            val full = when (h.length) {
                3 -> h.map { "$it$it" }.joinToString("") + "ff"
                4 -> h.map { "$it$it" }.joinToString("")
                6 -> h + "ff"
                8 -> h
                else -> null
            } ?: return Color(0xFFE5E7EB)
            val v = full.toLong(16)
            return Color(((v shr 24) and 0xff).toInt(), ((v shr 16) and 0xff).toInt(), ((v shr 8) and 0xff).toInt(), (v and 0xff).toInt())
        }
        Regex("""rgba?\(([^)]*)\)""").matchEntire(s)?.let { m ->
            val p = m.groupValues[1].split(',', ' ', '/').filter { it.isNotBlank() }.map { it.trim() }
            val a = p.getOrNull(3)?.let { if (it.endsWith("%")) it.dropLast(1).toFloat() / 100 else it.toFloat() } ?: 1f
            return Color(p[0].toFloat().toInt(), p[1].toFloat().toInt(), p[2].toFloat().toInt(), (a * 255).toInt())
        }
    }
    return NAMED[s] ?: Color(0xFFE5E7EB)
}

private val NAMED = mapOf(
    "white" to Color.White, "black" to Color.Black, "green" to Color(0xFF008000), "lightgreen" to Color(0xFF90EE90), "forestgreen" to Color(0xFF228B22),
    "blue" to Color(0xFF0000FF), "lightblue" to Color(0xFFADD8E6), "skyblue" to Color(0xFF87CEEB), "brown" to Color(0xFFA52A2A), "tan" to Color(0xFFD2B48C),
    "gray" to Color(0xFF808080), "grey" to Color(0xFF808080), "lightgray" to Color(0xFFD3D3D3), "lightgrey" to Color(0xFFD3D3D3), "darkgray" to Color(0xFFA9A9A9),
    "beige" to Color(0xFFF5F5DC), "wheat" to Color(0xFFF5DEB3), "sandybrown" to Color(0xFFF4A460), "khaki" to Color(0xFFF0E68C), "wood" to Color(0xFFB5835A),
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestMap(s: QuestState, tile: Dp, highlighted: Set<String>, bumps: Int, lastDirection: QuestDirection) {
    val w = s.world
    val density = LocalDensity.current
    val tilePx = with(density) { tile.roundToPx() }
    val pulse by rememberInfiniteTransition(label = "target").animateFloat(1f, 1.18f, infiniteRepeatable(tween(650), RepeatMode.Reverse), label = "pulse")
    Box(Modifier.size(tile * w.width, tile * w.height).clip(RoundedCornerShape(10.dp))) {
        // Ground
        for (y in 0 until w.height) for (x in 0 until w.width) {
            val t = QuestEngine.terrainAt(w, x, y)
            Box(Modifier.offset { IntOffset(x * tilePx, y * tilePx) }.size(tile).background(cssColor(t?.color)).border(0.5.dp, Color.Black.copy(alpha = 0.07f)), contentAlignment = Alignment.Center) {
                if (!t?.emoji.isNullOrEmpty()) Text(t!!.emoji!!, fontSize = (tile.value * 0.42f).sp, modifier = Modifier.alpha(0.35f))
            }
        }
        // Objects (stacks share the tile)
        for (y in 0 until w.height) for (x in 0 until w.width) {
            val here = QuestEngine.objectsAt(s, x, y)
            if (here.isEmpty()) continue
            Box(Modifier.offset { IntOffset(x * tilePx, y * tilePx) }.size(tile), contentAlignment = Alignment.Center) {
                val size = if (here.size > 1) tile.value * 0.42f else tile.value * 0.66f
                FlowRow(horizontalArrangement = Arrangement.Center) {
                    here.forEach { o ->
                        val target = o.id in highlighted
                        Text(
                            QuestEngine.emojiFor(o, s.objects[o.id]),
                            fontSize = size.sp,
                            modifier = Modifier
                                .scale(if (target) pulse else 1f)
                                .then(if (target) Modifier.clip(CircleShape).background(Palette.Gold.copy(alpha = 0.45f)) else Modifier),
                        )
                    }
                }
            }
        }
        // The player: springs from tile to tile, bumps against what refused it.
        val pos by animateIntOffsetAsState(IntOffset(s.player.x * tilePx, s.player.y * tilePx), spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessMediumLow), label = "player")
        val bump = remember { Animatable(0f) }
        LaunchedEffect(bumps) {
            if (bumps == 0) return@LaunchedEffect
            bump.snapTo(0f)
            bump.animateTo(1f, tween(90))
            bump.animateTo(0f, spring(dampingRatio = 0.35f, stiffness = Spring.StiffnessMedium))
        }
        val bx = lastDirection.dx * bump.value * tilePx * 0.18f
        val by = lastDirection.dy * bump.value * tilePx * 0.18f
        Box(
            Modifier.offset { pos }.size(tile).graphicsLayer { translationX = bx; translationY = by },
            contentAlignment = Alignment.Center,
        ) {
            Text(w.player.emoji, fontSize = (tile.value * 0.7f).sp)
        }
    }
}

@Composable
private fun ToastLayer(c: QuestGameController) {
    val t = c.toast
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(t != null, enter = fadeIn() + scaleIn(initialScale = 0.8f, animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy)), exit = fadeOut()) {
            val toast = t ?: return@AnimatedVisibility
            Column(
                Modifier.padding(top = 12.dp).clip(RoundedCornerShape(18.dp))
                    .background(if (toast.bad) Color(0xFF7F1D1D).copy(alpha = 0.92f) else Color(0xFF14532D).copy(alpha = 0.92f))
                    .clickable { c.dismissToast() }.padding(horizontal = 18.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(toast.hanzi, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                toast.sub?.let { Text(it, color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Dock(c: QuestGameController, s: QuestState, reveal: QuestReveal) {
    val carried = QuestEngine.heldObjects(s)
    val pickable = QuestEngine.objectsInReach(s).filter { it.portable && handsFree(s) }
    val verbs = QuestEngine.availableActions(s)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("✋ ", fontSize = 16.sp)
            if (carried.isEmpty()) {
                Text("手里是空的", color = Lab.colors.muted, fontSize = 15.sp)
            } else {
                carried.forEach { o ->
                    Text(
                        "${QuestEngine.emojiFor(o, s.objects[o.id])} ${o.hanzi}" + if (reveal.buttonPinyin) " ${o.pinyin}" else "",
                        fontSize = 15.sp, color = Lab.colors.ink,
                        modifier = Modifier.padding(end = 8.dp).clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            DPad { c.move(it) }
            Spacer(Modifier.width(12.dp))
            FlowRow(Modifier.weight(1f).heightIn(max = 172.dp).verticalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                pickable.forEach { o ->
                    VerbButton("拿起", "ná qǐ", QuestEngine.emojiFor(o, s.objects[o.id]), o.pinyin, reveal.buttonPinyin, carry = true) { c.act(QuestPlayerAction.PickUp(o.id)) }
                }
                carried.forEach { o ->
                    VerbButton("放下", "fàng xià", QuestEngine.emojiFor(o, s.objects[o.id]), o.pinyin, reveal.buttonPinyin, carry = true) { c.act(QuestPlayerAction.PutDown(o.id)) }
                }
                verbs.forEach { v ->
                    VerbButton(v.action.hanzi, v.action.pinyin, QuestEngine.emojiFor(v.obj, s.objects[v.obj.id]), v.obj.pinyin, reveal.buttonPinyin, carry = false) {
                        c.act(QuestPlayerAction.Interact(v.obj.id, v.action.id))
                    }
                }
                if (pickable.isEmpty() && carried.isEmpty() && verbs.isEmpty()) {
                    Text("走到东西旁边，动词按钮就会出现。", color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.padding(4.dp))
                }
            }
        }
    }
}

@Composable
private fun DPad(onMove: (QuestDirection) -> Unit) {
    val k = 52.dp
    Box(Modifier.size(k * 3)) {
        DPadKey("↑", Modifier.offset(k, 0.dp).size(k)) { onMove(QuestDirection.UP) }
        DPadKey("←", Modifier.offset(0.dp, k).size(k)) { onMove(QuestDirection.LEFT) }
        DPadKey("→", Modifier.offset(k * 2, k).size(k)) { onMove(QuestDirection.RIGHT) }
        DPadKey("↓", Modifier.offset(k, k * 2).size(k)) { onMove(QuestDirection.DOWN) }
    }
}

@Composable
private fun DPadKey(label: String, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.padding(2.dp).bouncyClickable(pressedScale = 0.86f, onClick = onClick).clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
    }
}

@Composable
private fun VerbButton(verbHanzi: String, verbPinyin: String, emoji: String, objectPinyin: String, showPinyin: Boolean, carry: Boolean, onClick: () -> Unit) {
    val bg = if (carry) Palette.Easy.copy(alpha = 0.14f) else Lab.colors.accentSoft
    val border = if (carry) Palette.Easy.copy(alpha = 0.5f) else Lab.colors.accent.copy(alpha = 0.45f)
    Column(
        Modifier.heightIn(min = 48.dp).bouncyClickable(pressedScale = 0.92f, onClick = onClick).clip(RoundedCornerShape(14.dp)).background(bg)
            .border(1.5.dp, border, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("$verbHanzi $emoji", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        if (showPinyin) Text("$verbPinyin $objectPinyin", fontSize = 11.sp, color = Lab.colors.muted)
    }
}

@Composable
private fun FinishOverlay(s: QuestState, onReplay: () -> Unit, onExit: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) {
        ConfettiRain(key = s.moves, colors = Palette.Confetti)
        var shown by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { shown = true }
        AnimatedVisibility(shown, enter = fadeIn() + slideInVertically(spring(dampingRatio = Spring.DampingRatioMediumBouncy)) { it / 3 }) {
            Column(
                Modifier.padding(24.dp).widthIn(max = 420.dp).clip(RoundedCornerShape(24.dp)).background(Lab.colors.card).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("🏆", fontSize = 56.sp)
                Text("完成了！", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                Text(
                    "All ${s.world.goals.size} instructions carried out in ${s.moves} moves.",
                    color = Lab.colors.muted, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecondaryPill("再玩一次 Play again", onClick = onReplay)
                }
                PrimaryPill("Back to quests", Modifier.fillMaxWidth().height(56.dp), onClick = onExit)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestMenu(s: QuestState, reveal: QuestReveal, onReveal: (QuestReveal) -> Unit, onClose: () -> Unit, onRestart: () -> Unit, onExit: () -> Unit) {
    LabBottomSheet(onDismiss = onClose, title = s.world.title.hanzi) {
        QuestMenuBody(s, reveal, onReveal, onRestart, onExit)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun QuestMenuBody(s: QuestState, reveal: QuestReveal, onReveal: (QuestReveal) -> Unit, onRestart: () -> Unit, onExit: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Label("显示 Show")
        ChipRow {
            LabChip("拼音 instruction", selected = reveal.pinyin) { onReveal(reveal.copy(pinyin = !reveal.pinyin)) }
            LabChip("English", selected = reveal.english) { onReveal(reveal.copy(english = !reveal.english)) }
            LabChip("拼音 buttons", selected = reveal.buttonPinyin) { onReveal(reveal.copy(buttonPinyin = !reveal.buttonPinyin)) }
        }
        Label("任务 Goals (${s.completedGoals.size}/${s.world.goals.size})")
        s.world.goals.forEachIndexed { i, g ->
            val done = i < s.activeGoalIndex
            val locked = i > s.activeGoalIndex
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (done) "✅" else if (locked) "🔒" else "▶️", fontSize = 16.sp)
                Spacer(Modifier.width(8.dp))
                Text(if (locked) "？？？" else g.instruction.hanzi, color = if (done) Lab.colors.muted else Lab.colors.ink, fontSize = 16.sp)
            }
        }
        Label("词汇 Glossary")
        Text(s.world.scenario.hanzi, color = Lab.colors.ink, fontSize = 15.sp)
        s.world.glossary.forEach { e ->
            Row(verticalAlignment = Alignment.Top) {
                Text(e.pos, fontSize = 11.sp, color = Color.White, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(posColor(e.pos)).padding(horizontal = 6.dp, vertical = 2.dp))
                Spacer(Modifier.width(8.dp))
                Column {
                    Text("${e.hanzi}  ${e.pinyin}  ${e.english}", fontSize = 15.sp, color = Lab.colors.ink)
                    e.note?.let { Text(it, fontSize = 12.sp, color = Lab.colors.muted) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryPill("重新开始 Restart", Modifier.weight(1f), onClick = onRestart)
            PrimaryPill("退出 Exit", Modifier.weight(1f), onClick = onExit)
        }
    }
}

private fun posColor(pos: String) = when (pos) {
    "verb" -> Palette.Hard
    "noun" -> Palette.Easy
    "phrase" -> Palette.Secondary
    else -> Color(0xFF6B7280)
}

@Composable
private fun Label(t: String) = Text(t, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
