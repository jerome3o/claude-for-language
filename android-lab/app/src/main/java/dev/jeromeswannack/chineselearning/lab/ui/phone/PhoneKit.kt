package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.ui.layout.layout
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitLongPressOrCancellation
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords

/*
 * Building blocks of the simulated apps (web frontend/src/phone/ui.tsx + phone.css): the top
 * bar, list cells, buttons, sheets, dialogs, steppers, tabs, text fields with the 🎤 the real apps
 * have, stars. The phone is always "light mode", like the real apps; every string inside it is
 * Chinese. Every piece of text goes through [PText] so a long press opens the explorer.
 */

/** The phone's own palette (phone.css). */
object PC {
    val bg = Color(0xFFF5F6F8)
    val ink = Color(0xFF1F2329)
    val dark = Color(0xFF222222)
    val muted = Color(0xFF8A8F99)
    val line = Color(0xFFECEEF1)
    val cellLine = Color(0xFFF0F1F3)
    val ph = Color(0xFFB3B8C0)
    val value = Color(0xFF666666)
    val arrow = Color(0xFFC2C6CC)
    val red = Color(0xFFF53D3D)
    val orange = Color(0xFFF26B1D)
    val blue = Color(0xFF2F7DE1)
    val green = Color(0xFF19A356)
    val noteTopBg = Color(0xFFFFF8E6)
    val noteTopInk = Color(0xFF8A6200)
    val tagBg = Color(0xFFEEF4FF)
    val chipBorder = Color(0xFFE2E5E9)
    val chipBg = Color(0xFFF6F7F9)
    val scrim = Color(0x73000000)

    fun hex(s: String?, fallback: Color = Color(0xFF9AA5B1)): Color {
        val h = s?.removePrefix("#") ?: return fallback
        return runCatching {
            when (h.length) {
                6 -> Color(0xFF000000 or h.toLong(16))
                3 -> Color(0xFF000000 or h.map { "$it$it" }.joinToString("").toLong(16))
                else -> fallback
            }
        }.getOrDefault(fallback)
    }

    fun of(argb: Long) = Color(argb)
}

private val HAN = Regex("[㐀-鿿]")

/** Port of longPress.ts `itemAt`: the explorer item for the word at [offset] of [text]. */
fun phoneItemAt(text: String, offset: Int): ExplorerItem? {
    fun han(i: Int) = i in text.indices && HAN.matches(text[i].toString())
    val at = if (han(offset)) offset else if (han(offset - 1)) offset - 1 else return null
    val sentence = if (text.length <= 80) text else null
    DeviceWords.of(text)?.let { segs ->
        var pos = 0
        for (s in segs) {
            val end = pos + s.text.length
            if (at in pos until end) return ExplorerStack.itemForText(s.text, s.pinyin.ifEmpty { null }, s.gloss.ifEmpty { null }, sentence)
            pos = end
        }
    }
    return ExplorerStack.itemForText(text[at].toString(), sentence = sentence)
}

/** Phone text: a long press opens the language explorer on the word under the finger. */
@Composable
fun PText(
    text: String,
    modifier: Modifier = Modifier,
    size: TextUnit = 14.sp,
    color: Color = PC.ink,
    weight: FontWeight? = null,
    align: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
    lineHeight: TextUnit = TextUnit.Unspecified,
    decoration: TextDecoration? = null,
) {
    val onWord = LocalPhoneWord.current
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val press = if (onWord != null && PhoneJs.hasHan(text)) {
        Modifier.pointerInput(text) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                val long = awaitLongPressOrCancellation(down.id) ?: return@awaitEachGesture
                val l = layout ?: return@awaitEachGesture
                phoneItemAt(text, l.getOffsetForPosition(long.position))?.let(onWord)
                long.consume()
                // The click after a long press is swallowed.
                while (true) {
                    val e = awaitPointerEvent()
                    e.changes.forEach { it.consume() }
                    if (e.changes.none { it.pressed }) break
                }
            }
        }
    } else Modifier
    Text(
        text,
        modifier.then(press),
        color = color,
        fontSize = size,
        fontWeight = weight,
        textAlign = align,
        maxLines = maxLines,
        overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis,
        lineHeight = if (lineHeight == TextUnit.Unspecified) (size.value * 1.4f).sp else lineHeight,
        textDecoration = decoration,
        onTextLayout = { layout = it },
    )
}

/** A screen of an app: overlays (sheets, dialogs) go after the content in this box. */
@Composable
fun PScreen(tag: String, bg: Color = PC.bg, content: @Composable BoxScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(bg).testTag(tag), content = content)
}

@Composable
fun PColumn(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) = Column(modifier.fillMaxSize(), content = content)

/** The scrolling body between the bar and the footer. */
@Composable
fun ColumnScope.PBody(modifier: Modifier = Modifier, bg: Color = Color.Transparent, tag: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.weight(1f).fillMaxWidth().background(bg).verticalScroll(rememberScrollState()).then(if (tag != null) Modifier.testTag(tag) else Modifier).then(modifier),
        content = content,
    )
}

fun Modifier.tap(enabled: Boolean = true, onClick: () -> Unit): Modifier =
    if (!enabled) this else clickable(onClick = onClick)

fun Modifier.hairline(color: Color = PC.cellLine, top: Boolean = false): Modifier = drawBehind {
    val y = if (top) 0f else size.height - 1f
    drawLine(color, Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
}

@Composable
fun PBar(
    title: String,
    onBack: (() -> Unit)? = null,
    accent: Color? = null,
    tag: String? = null,
    subtitle: String? = null,
    right: (@Composable RowScope.() -> Unit)? = null,
) {
    val ink = if (accent != null) Color.White else PC.ink
    Row(
        Modifier.fillMaxWidth().height(46.dp).background(accent ?: Color.White).then(if (accent == null) Modifier.hairline(PC.line) else Modifier).then(if (tag != null) Modifier.testTag(tag) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(64.dp)) {
            if (onBack != null) {
                Box(Modifier.size(48.dp, 44.dp).tap(onClick = onBack).testTag("phone-bar-back"), contentAlignment = Alignment.Center) {
                    Text("‹", color = ink, fontSize = 30.sp)
                }
            }
        }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            PText(title, size = 17.sp, weight = FontWeight.SemiBold, color = ink, maxLines = 1, align = TextAlign.Center)
            if (subtitle != null) PText(subtitle, size = 11.sp, color = PC.muted, maxLines = 1)
        }
        Row(Modifier.width(64.dp).padding(end = 8.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) { right?.invoke(this) }
    }
}

/** A bar icon / text button (☆, ⋯, 完成). */
@Composable
fun PBarButton(label: String, color: Color = PC.ink, size: TextUnit = 18.sp, tag: String? = null, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = 40.dp).widthIn(min = 40.dp).tap(onClick = onClick).then(if (tag != null) Modifier.testTag(tag) else Modifier), contentAlignment = Alignment.Center) {
        PText(label, color = color, size = size, weight = if (size < 17.sp) FontWeight.SemiBold else null)
    }
}

enum class BtnKind { PRIMARY, LINE, GHOST, GREY }

@Composable
fun PBtn(
    text: String,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.PRIMARY,
    accent: Color = PC.blue,
    textColor: Color? = null,
    enabled: Boolean = true,
    small: Boolean = false,
    tag: String? = null,
    shape: Shape? = null,
    onClick: () -> Unit,
) {
    val bg = when (kind) {
        BtnKind.PRIMARY -> accent
        BtnKind.LINE -> Color.White
        BtnKind.GHOST -> Color.Transparent
        BtnKind.GREY -> Color(0xFFE5E7EB)
    }
    val fg = textColor ?: when (kind) {
        BtnKind.PRIMARY -> Color.White
        BtnKind.LINE -> if (accent == PC.blue) Color(0xFF333333) else accent
        BtnKind.GHOST -> accent
        BtnKind.GREY -> Color(0xFF999999)
    }
    val corner = shape ?: RoundedCornerShape(if (small) 17.dp else 22.dp)
    Box(
        modifier
            .heightIn(min = if (small) 34.dp else 44.dp)
            .clip(corner)
            .background(bg)
            .then(if (kind == BtnKind.LINE) Modifier.border(1.dp, if (accent == PC.blue) Color(0xFFD0D4DA) else accent, corner) else Modifier)
            .alpha(if (enabled) 1f else 0.45f)
            .tap(enabled, onClick)
            .then(if (tag != null) Modifier.testTag(tag) else Modifier)
            .padding(horizontal = if (small) 14.dp else 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        PText(text, size = if (small) 14.sp else 16.sp, weight = FontWeight.SemiBold, color = fg, maxLines = 1)
    }
}

@Composable
fun PCell(
    label: String,
    value: String? = null,
    sub: String? = null,
    icon: String? = null,
    valueColor: Color = PC.value,
    labelColor: Color = PC.ink,
    arrow: Boolean? = null,
    tag: String? = null,
    iconContent: (@Composable () -> Unit)? = null,
    valueContent: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().background(Color.White).heightIn(min = 48.dp)
            .then(if (onClick != null) Modifier.tap(onClick = onClick) else Modifier)
            .hairline()
            .then(if (tag != null) Modifier.testTag(tag) else Modifier)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (iconContent != null) iconContent() else if (icon != null) Text(icon, fontSize = 18.sp)
        Column(Modifier.weight(1f)) {
            PText(label, size = 15.sp, color = labelColor)
            if (sub != null) PText(sub, size = 12.sp, color = PC.muted)
        }
        if (valueContent != null) valueContent() else if (value != null) PText(value, size = 14.sp, color = valueColor, align = TextAlign.End, modifier = Modifier.widthIn(max = 220.dp))
        if (arrow ?: (onClick != null)) Text("›", color = PC.arrow, fontSize = 20.sp)
    }
}

@Composable
fun PGroup(title: String? = null, tag: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp).background(Color.White).then(if (tag != null) Modifier.testTag(tag) else Modifier)) {
        if (title != null) PText(title, size = 13.sp, color = PC.muted, modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 4.dp))
        content()
    }
}

@Composable
fun PSectionTitle(text: String) = PText(text, size = 13.sp, color = PC.muted, modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 6.dp))

@Composable
fun PNote(text: String, top: Boolean = false, modifier: Modifier = Modifier) {
    PText(
        text,
        size = 12.sp,
        color = if (top) PC.noteTopInk else PC.muted,
        lineHeight = 19.sp,
        modifier = modifier.fillMaxWidth().then(if (top) Modifier.background(PC.noteTopBg) else Modifier).padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@Composable
fun PTag(text: String, bg: Color = PC.tagBg, fg: Color = PC.blue) {
    Box(Modifier.padding(horizontal = 4.dp).clip(RoundedCornerShape(4.dp)).background(bg).padding(horizontal = 5.dp)) {
        PText(text, size = 11.sp, color = fg, weight = FontWeight.Medium)
    }
}

/** A red-bordered 满减 / tag ("满30减5"). */
@Composable
fun PLineTag(text: String, color: Color = PC.red, border: Color = Color(0xFFFBC4C4), bg: Color = Color.Transparent) {
    Box(Modifier.clip(RoundedCornerShape(3.dp)).background(bg).border(1.dp, border, RoundedCornerShape(3.dp)).padding(horizontal = 3.dp)) {
        PText(text, size = 11.sp, color = color)
    }
}

@Composable
fun PEmpty(text: String, icon: String = "📭") {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(icon, fontSize = 40.sp)
        Spacer(Modifier.height(8.dp))
        PText(text, color = Color(0xFF9AA0A8), align = TextAlign.Center)
    }
}

/** ¥73 / ¥49.5 / ¥18.5 (the decimals small, a trailing 0 dropped). */
@Composable
fun PPrice(value: Double, big: Boolean = false, color: Color = PC.dark, size: TextUnit? = null, modifier: Modifier = Modifier) {
    val v = Js.round(value * 100) / 100
    val fixed = Js.toFixed(v, 2)
    val int = fixed.substringBefore('.')
    val dec = fixed.substringAfter('.')
    val main = size ?: if (big) 20.sp else 14.sp
    Row(modifier, verticalAlignment = Alignment.Bottom) {
        Text("¥", color = color, fontSize = main * 0.75f, fontWeight = FontWeight.SemiBold)
        Text(int, color = color, fontSize = main, fontWeight = FontWeight.Bold)
        if (dec != "00") Text("." + dec.removeSuffix("0"), color = color, fontSize = main * 0.75f, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun PStars(value: Double, size: TextUnit = 14.sp) {
    val full = Js.round(value * 2) / 2
    Row {
        for (i in 1..5) {
            val c = if (i <= full) Color(0xFFFF9F1A) else if (i - 0.5 == full) Color(0xFFFFC266) else Color(0xFFDDDDDD)
            Text("★", color = c, fontSize = size)
        }
    }
}

@Composable
fun PChip(text: String, on: Boolean = false, accent: Color = PC.blue, enabled: Boolean = true, tag: String? = null, onClick: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        Modifier.heightIn(min = 34.dp).clip(shape)
            .background(if (on) accent.copy(alpha = 0.08f) else PC.chipBg)
            .border(1.dp, if (on) accent else PC.chipBorder, shape)
            .alpha(if (enabled) 1f else 0.4f)
            .then(if (onClick != null) Modifier.tap(enabled, onClick) else Modifier)
            .then(if (tag != null) Modifier.testTag(tag) else Modifier)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        PText(text, size = 13.sp, color = if (on) accent else PC.ink, weight = if (on) FontWeight.SemiBold else null, maxLines = 1)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PChips(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    FlowRow(modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}

/** The one-line, sideways-scrolling filter bar under a bar. */
@Composable
fun PChipsBar(content: @Composable RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Color.White).hairline(PC.line).horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
fun PTabs(items: List<Pair<String, String>>, value: String, accent: Color = PC.dark, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().background(Color.White).hairline(PC.line)) {
        for ((id, label) in items) {
            val on = id == value
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).tap { onChange(id) }.testTag("tab-$id")
                    .drawBehind { if (on) drawRect(accent, topLeft = Offset(0f, size.height - 2.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width, 2.dp.toPx())) },
                contentAlignment = Alignment.Center,
            ) {
                PText(label, size = 15.sp, color = if (on) (if (accent == PC.dark) PC.dark else accent) else PC.value, weight = if (on) FontWeight.SemiBold else null)
            }
        }
    }
}

/** An app's bottom tab bar (首页 · 订单 · 我的). */
@Composable
fun PTabBar(items: List<Triple<String, String, String>>, value: String, accent: Color, tagPrefix: String, bg: Color = Color.White, badge: (String) -> Int = { 0 }, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().height(54.dp).background(bg).hairline(PC.line, top = true)) {
        for ((id, label, icon) in items) {
            val on = id == value
            Column(
                Modifier.weight(1f).fillMaxSize().tap { onSelect(id) }.testTag("$tagPrefix-tab-$id"),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box {
                    Text(icon, fontSize = 19.sp)
                    val n = badge(id)
                    if (n > 0) Badge(n, Modifier.align(Alignment.TopEnd).padding(start = 18.dp))
                }
                PText(label, size = 11.sp, color = if (on) accent else PC.muted, weight = if (on) FontWeight.SemiBold else null)
            }
        }
    }
}

@Composable
fun Badge(n: Int, modifier: Modifier = Modifier) {
    Box(modifier.heightIn(min = 16.dp).widthIn(min = 16.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFFA5151)).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
        Text(if (n > 99) "99+" else n.toString(), color = Color.White, fontSize = 10.sp, lineHeight = 14.sp)
    }
}

/** The bar pinned under the body (总价 + 提交订单). */
@Composable
fun PFooter(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.fillMaxWidth().background(Color.White).hairline(PC.line, top = true).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@Composable
fun PStepper(value: Int, min: Int = 0, max: Int = 99, tag: String? = null, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = if (tag != null) Modifier.testTag(tag) else Modifier) {
        StepButton("−", value > min, "$tag-minus") { onChange(maxOf(min, value - 1)) }
        PText(value.toString(), weight = FontWeight.SemiBold, modifier = Modifier.widthIn(min = 18.dp), align = TextAlign.Center)
        StepButton("＋", value < max, "$tag-plus") { onChange(minOf(max, value + 1)) }
    }
}

@Composable
private fun StepButton(label: String, enabled: Boolean, tag: String, onClick: () -> Unit) {
    Box(
        Modifier.size(32.dp).clip(CircleShape).background(Color.White).border(1.dp, Color(0xFFD0D4DA), CircleShape).alpha(if (enabled) 1f else 0.35f).tap(enabled, onClick).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 16.sp, color = PC.ink) }
}

/** A square check box (the forms' ☐ / ☑). */
@Composable
fun PCheck(checked: Boolean, accent: Color = PC.blue, size: Dp = 20.dp) {
    val shape = RoundedCornerShape(4.dp)
    Box(Modifier.size(size).clip(shape).background(if (checked) accent else Color.White).border(1.5.dp, if (checked) accent else Color(0xFF9AA0A8), shape), contentAlignment = Alignment.Center) {
        if (checked) Text("✓", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

/** A bottom sheet over the current screen; back closes it. Place it after the screen's content. */
@Composable
fun BoxScope.PSheet(open: Boolean, onClose: () -> Unit, title: String? = null, tag: String? = null, tall: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    PhoneBackHandler(open, onClose)
    if (!open) return
    // The sheet sits inside the scrim box (like PDialog).
    Box(Modifier.matchParentSize().background(PC.scrim).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose), contentAlignment = Alignment.BottomCenter) {
    Column(
        Modifier.fillMaxWidth().layoutMaxHeight(if (tall) 0.92f else 0.78f)
            .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).background(Color.White)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
            .then(if (tag != null) Modifier.testTag(tag) else Modifier),
    ) {
        if (title != null) {
            Box(Modifier.fillMaxWidth().hairline().padding(14.dp), contentAlignment = Alignment.Center) {
                PText(title, size = 16.sp, weight = FontWeight.SemiBold)
                Box(Modifier.align(Alignment.CenterEnd).size(44.dp).tap(onClick = onClose).testTag("phone-sheet-close"), contentAlignment = Alignment.Center) {
                    Text("✕", color = Color(0xFF999999), fontSize = 18.sp)
                }
            }
        }
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(bottom = 12.dp), content = content)
    }
    }
}

/** `heightIn(max = fraction of the parent)`: a sheet as tall as its content, at most [fraction]. */
private fun Modifier.layoutMaxHeight(fraction: Float): Modifier = this.layout { m, c ->
    val max = if (c.hasBoundedHeight) (c.maxHeight * fraction).toInt() else c.maxHeight
    val p = m.measure(c.copy(maxHeight = max, minHeight = 0))
    layout(p.width, p.height) { p.place(0, 0) }
}

data class DialogAction(val label: String, val primary: Boolean = false, val tag: String? = null, val onClick: () -> Unit)

@Composable
fun BoxScope.PDialog(open: Boolean, title: String? = null, onClose: () -> Unit = {}, tag: String? = null, actions: List<DialogAction>, body: (@Composable ColumnScope.() -> Unit)? = null) {
    PhoneBackHandler(open, onClose)
    if (!open) return
    Box(Modifier.matchParentSize().background(PC.scrim).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}, contentAlignment = Alignment.Center) {
        Column(Modifier.fillMaxWidth(0.82f).clip(RoundedCornerShape(14.dp)).background(Color.White).then(if (tag != null) Modifier.testTag(tag) else Modifier)) {
            if (title != null) PText(title, size = 17.sp, weight = FontWeight.SemiBold, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 6.dp))
            if (body != null) Column(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 16.dp), content = body)
            Row(Modifier.fillMaxWidth().hairline(top = true)) {
                actions.forEachIndexed { i, a ->
                    if (i > 0) Box(Modifier.width(1.dp).height(48.dp).background(PC.cellLine))
                    Box(Modifier.weight(1f).heightIn(min = 48.dp).tap(onClick = a.onClick).then(if (a.tag != null) Modifier.testTag(a.tag) else Modifier), contentAlignment = Alignment.Center) {
                        PText(a.label, size = 16.sp, color = if (a.primary) PC.blue else PC.value, weight = if (a.primary) FontWeight.SemiBold else null)
                    }
                }
            }
        }
    }
}

@Composable
fun PDialogText(text: String) = PText(text, size = 14.sp, color = Color(0xFF555555), lineHeight = 22.sp)

/** A plain phone text input (no Material chrome). */
@Composable
fun PInput(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    tag: String? = null,
    numeric: Boolean = false,
    size: TextUnit = 16.sp,
    singleLine: Boolean = true,
    autoFocus: Boolean = false,
    imeAction: ImeAction = ImeAction.Done,
    onSubmit: (() -> Unit)? = null,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(autoFocus) { if (autoFocus) runCatching { focus.requestFocus() } }
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = singleLine,
        textStyle = TextStyle(color = PC.dark, fontSize = size),
        cursorBrush = SolidColor(PC.blue),
        keyboardOptions = KeyboardOptions(keyboardType = if (numeric) KeyboardType.Number else KeyboardType.Text, imeAction = imeAction),
        keyboardActions = KeyboardActions(onDone = { onSubmit?.invoke() }, onSearch = { onSubmit?.invoke() }, onSend = { onSubmit?.invoke() }),
        modifier = modifier.focusRequester(focus).then(if (tag != null) Modifier.testTag(tag) else Modifier),
        decorationBox = { inner ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, color = PC.ph, fontSize = size, maxLines = 1, overflow = TextOverflow.Ellipsis)
                inner()
            }
        },
    )
}

@Composable
fun PSearchBox(value: String, onChange: (String) -> Unit, placeholder: String, tag: String? = null, autoFocus: Boolean = false, mic: Boolean = false, onSubmit: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).background(Color(0xFFF1F3F5)).padding(start = 12.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("🔍", fontSize = 14.sp)
        PInput(value, onChange, placeholder, Modifier.weight(1f), tag = tag, autoFocus = autoFocus, imeAction = ImeAction.Search, onSubmit = onSubmit)
        if (value.isNotEmpty()) Box(Modifier.size(32.dp, 36.dp).tap { onChange("") }, contentAlignment = Alignment.Center) { Text("⊗", color = PC.ph, fontSize = 18.sp) }
        if (mic) PhoneMic(tag = tag?.let { "$it-mic" }) { t -> onChange(t.replace(Regex("[。，！？.!?]$"), "")) }
    }
}

@Composable
fun PField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    placeholder: String = ZH.inputPlaceholder,
    numeric: Boolean = false,
    tag: String? = null,
    mic: Boolean = false,
    right: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 50.dp).background(Color.White).hairline().padding(horizontal = 14.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        PText(label, size = 15.sp, color = Color(0xFF333333), modifier = Modifier.width(72.dp))
        PInput(value, onChange, placeholder, Modifier.weight(1f).heightIn(min = 40.dp).padding(vertical = 10.dp), tag = tag, numeric = numeric)
        if (mic) PhoneMic { t -> onChange(value + t) }
        right?.invoke()
    }
}

/** A field row with no input (the 先生 / 女士 chips under a name). */
@Composable
fun PFieldRow(label: String = "", content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 50.dp).background(Color.White).hairline().padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        PText(label, size = 15.sp, color = Color(0xFF333333), modifier = Modifier.width(82.dp))
        content()
    }
}

/** An app icon (fictional glyph + gradient), with an unread badge. */
@Composable
fun AppIcon(app: String, small: Boolean = false, badge: Int = 0, size: Dp? = null) {
    val meta = dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.app(app)
    val s = size ?: if (small) 26.dp else 54.dp
    Box {
        Box(
            Modifier.size(s).clip(RoundedCornerShape(if (small) 8.dp else 15.dp)).background(Brush.linearGradient(listOf(PC.of(meta.colors.first), PC.of(meta.colors.second)))),
            contentAlignment = Alignment.Center,
        ) {
            Text(meta.glyph, color = Color.White, fontSize = if (small) 13.sp else (s.value * 0.44f).sp, fontWeight = FontWeight.Bold)
        }
        if (badge > 0) {
            Box(Modifier.align(Alignment.TopEnd).padding(start = 0.dp).offsetBadge().heightIn(min = 18.dp).widthIn(min = 18.dp).clip(RoundedCornerShape(9.dp)).background(Color(0xFFF43F3F)).padding(horizontal = 5.dp), contentAlignment = Alignment.Center) {
                Text(if (badge > 99) "99+" else badge.toString(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

private fun Modifier.offsetBadge() = this.layout { m, c ->
    val p = m.measure(c)
    layout(p.width, p.height) { p.place(5.dp.roundToPx(), -5.dp.roundToPx()) }
}

/** A rounded white card with margins (the apps' list rows). */
@Composable
fun PCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, tag: String? = null, radius: Dp = 12.dp, padding: Dp = 12.dp, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp).clip(RoundedCornerShape(radius)).background(Color.White)
            .then(if (onClick != null) Modifier.tap(onClick = onClick) else Modifier)
            .then(if (tag != null) Modifier.testTag(tag) else Modifier)
            .padding(padding),
        content = content,
    )
}

@Composable
fun Hr(color: Color = PC.cellLine) = Box(Modifier.fillMaxWidth().height(1.dp).background(color))

@Composable
fun Gap(h: Dp) = Spacer(Modifier.height(h))

/** Slide-down entrance for banners. */
@Composable
fun DropIn(visible: Boolean, content: @Composable () -> Unit) {
    AnimatedVisibility(visible, enter = slideInVertically(tween(250)) { -it / 3 } + fadeIn(tween(250))) { content() }
}
