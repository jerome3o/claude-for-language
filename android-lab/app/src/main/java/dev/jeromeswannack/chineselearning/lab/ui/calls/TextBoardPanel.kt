package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardField
import dev.jeromeswannack.chineselearning.lab.core.calls.CallGloss
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTextDoc
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private val HAN = Regex("[\\u3400-\\u9fff\\uf900-\\ufaff]")

private fun parseColor(hex: String): Color = Color(0xFF000000 or hex.removePrefix("#").toLong(16))

/** Pinyin + a short meaning for Chinese on the board (web: POST /api/calls/:id/gloss). */
data class BoardGloss(val pinyin: String, val english: String)

/** The offer shown after the caret: [segment] ends at character index [end]. */
data class GlossSuggestion(val segment: String, val end: Int, val gloss: BoardGloss) {
    val text: String get() = CallGloss.format(gloss.pinyin, gloss.english)
}

/** Glosses fetched this run of the app (a lesson repeats words): a repeat is instant and free. */
object BoardGlossCache {
    private val lru = object : LinkedHashMap<String, BoardGloss>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, BoardGloss>?) = size > 300
    }
    @Synchronized fun get(segment: String): BoardGloss? = lru[CallGloss.cacheKey(segment)]
    @Synchronized fun put(segment: String, g: BoardGloss) { lru[CallGloss.cacheKey(segment)] = g }
}

private fun checkAt(v: TextFieldValue): CallGloss.Check = CallGloss.findSegment(
    v.text,
    CallTextDoc.codeUnitToCharIndex(v.text, v.selection.min),
    CallTextDoc.codeUnitToCharIndex(v.text, v.selection.max),
    v.composition != null,
)

/**
 * The call's shared text board (web: components/calls/TextBoard.tsx): both people type into one
 * document; the other person's selection shows in their colour and their caret as a thin line in
 * their colour with a small dot on top — nothing is ever drawn over the text (an opaque name flag
 * hid what the tutor had just typed). Their name sits in the people row under the board ("● Minghui
 * is here", or "● Minghui · 你hao" while they compose); a tap near their dot lights that chip up in
 * their colour for a few seconds.
 *
 * While an IME composition is open (pinyin) the field is never rewritten under it: the text outside
 * the composition goes out at once, the other person's edits wait in the document and come in when
 * the composition ends — or, since Gboard keeps a composing span on the last word, after
 * CallController.COMPOSE_IDLE_MS idle, rebuilt with my composition spliced back in (the controller
 * sends a `rewrite` whose field carries the composition range). Select Chinese text for its pinyin,
 * and (online) a word-by-word meaning.
 *
 * Tab-complete (web: useBoardGloss): after typing Chinese and pausing CallGloss.DEBOUNCE_MS with no
 * composition open, " - pīnyīn - meaning" shows grey after the caret with a "⇥ …" chip under it;
 * a tap on the chip (or Tab on a hardware keyboard) types it in like any edit, so the other person
 * gets it through the CRDT. Typing on moves past it; Esc dismisses. Only I see the offer.
 *
 * While I compose (pinyin IME), the composing text goes to the other person as a preview beside my
 * name in their people row; theirs shows beside their name in mine, and their caret's dot pulses.
 * The board is always light paper ([BoardPaper]) in both themes.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TextBoardPanel(
    board: TextBoardUi,
    onChange: (text: String, start: Int, end: Int, composition: TextRange?) -> Unit,
    onSelect: (start: Int, end: Int) -> Unit,
    onBlur: () -> Unit,
    modifier: Modifier = Modifier,
    explain: (suspend (String) -> String?)? = null,
    pinyinOf: (String) -> String = { dev.jeromeswannack.chineselearning.lab.ui.study.Pinyin.of(it) },
    /** The tab-complete lookup; null = the feature is off for this board. */
    gloss: (suspend (String) -> BoardGloss?)? = null,
    glossOn: Boolean = true,
    onGlossOn: (Boolean) -> Unit = {},
    /** Screenshots: an offer already on screen (caret at the end of the text). */
    previewSuggestion: GlossSuggestion? = null,
    /** Screenshots: this person's chip already lit up (as after a tap near their caret). */
    previewHighlight: String? = null,
) {
    var value by remember { mutableStateOf(TextFieldValue(board.text, TextRange(if (previewSuggestion != null) board.text.length else 0))) }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    var focused by remember { mutableStateOf(false) }
    var suggestion by remember { mutableStateOf(previewSuggestion) }
    var dismissed by remember { mutableStateOf<String?>(null) }
    var fieldWidth by remember { mutableStateOf(0) }
    var chipWidth by remember { mutableStateOf(0) }
    val measurer = rememberTextMeasurer()
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    val currentValue by rememberUpdatedState(value)
    // Their caret dot pulses while they compose (only then is the animation running).
    val pulse = if (board.remote.any { !it.compose.isNullOrEmpty() }) {
        rememberInfiniteTransition(label = "caret-pulse").animateFloat(
            1f, 1.5f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "caret-pulse-scale",
        ).value
    } else 1f
    var shownPage by remember { mutableStateOf(board.page) }
    var appliedRewrite by remember { mutableStateOf(board.rewrite) }
    // The person whose chip is lit up (a tap near their caret dot), for a few seconds.
    var highlighted by remember { mutableStateOf(previewHighlight) }
    LaunchedEffect(highlighted) {
        if (highlighted != null && previewHighlight == null) { delay(HIGHLIGHT_MS); highlighted = null }
    }
    val composeChars = remember(value.text, value.composition) {
        value.composition?.let { c -> CallTextDoc.splitChars(value.text.substring(c.min.coerceIn(0, value.text.length), c.max.coerceIn(0, value.text.length))).size } ?: 0
    }
    /** A character index in the board's text → in the field (my open composition sits in the field but not in the board's text). */
    fun fieldIndex(i: Int): Int {
        val at = board.compIndex
        return if (value.composition != null && at != null && i > at) i + composeChars else i
    }
    // The other person's edit (or a load / a catch-up) rewrites the field, my caret moved along with it —
    // never under an open composition unless the rewrite carries it (a catch-up splices it back in).
    LaunchedEffect(board.version, board.rewrite, value.composition == null) {
        if (board.page != shownPage) {
            // Another board page: its text, from the top; a composition on the old page is dropped with it.
            shownPage = board.page
            suggestion = null
            appliedRewrite = board.rewrite
            value = TextFieldValue(board.text, TextRange(0))
            return@LaunchedEffect
        }
        if (board.rewrite == appliedRewrite) return@LaunchedEffect
        val f = board.field ?: BoardField(board.text, board.mySelection.first, board.mySelection.second)
        if (value.composition != null && !f.composing) return@LaunchedEffect // after the composition
        appliedRewrite = board.rewrite
        if (f.text == value.text && !f.composing) return@LaunchedEffect
        val len = f.text.length
        value = TextFieldValue(
            f.text, TextRange(f.selStart.coerceIn(0, len), f.selEnd.coerceIn(0, len)),
            if (f.composing) TextRange(f.compStart, f.compEnd) else null,
        )
    }
    // Tab-complete: any change drops an offer that no longer fits; after a quiet pause, ask. The
    // effect restarts on every change, which cancels a wait or a request in flight.
    LaunchedEffect(value.text, value.selection, value.composition, focused, glossOn) {
        if (previewSuggestion != null) return@LaunchedEffect
        val c = checkAt(value)
        val cur = suggestion
        if (cur != null && c is CallGloss.Check.Ok && c.segment == cur.segment && c.end == cur.end && glossOn && focused) return@LaunchedEffect
        suggestion = null
        if (!glossOn || gloss == null || !focused || c !is CallGloss.Check.Ok) return@LaunchedEffect
        val key = "${c.segment}@${c.end}"
        if (dismissed != null && dismissed != key) dismissed = null
        if (dismissed == key) return@LaunchedEffect
        delay(CallGloss.DEBOUNCE_MS)
        val g = BoardGlossCache.get(c.segment) ?: runCatching { gloss(CallGloss.cacheKey(c.segment)) }.getOrNull()?.also { BoardGlossCache.put(c.segment, it) } ?: return@LaunchedEffect
        val now = checkAt(currentValue)
        if (now is CallGloss.Check.Ok && now.segment == c.segment && now.end == c.end) suggestion = GlossSuggestion(c.segment, c.end, g)
    }
    fun accept() {
        val s = suggestion ?: return
        val c = checkAt(value)
        suggestion = null
        if (c !is CallGloss.Check.Ok || c.segment != s.segment || c.end != s.end) return
        val ins = s.text
        val pos = CallTextDoc.charToCodeUnitIndex(value.text, s.end)
        val next = value.text.substring(0, pos) + ins + value.text.substring(pos)
        val v = TextFieldValue(next, TextRange(pos + ins.length))
        value = v
        onChange(v.text, v.selection.min, v.selection.max, null)
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }
    val padX = 16.dp
    val padY = 14.dp
    // The grey offer laid out here (not while drawing) so the chip can sit below all of it.
    val ghostStyle = TextStyle(fontSize = 19.sp, lineHeight = 30.sp, color = BoardPaper.Ghost)
    val ghost: GhostLayout? = run {
        val s = suggestion ?: return@run null
        val l = layout ?: return@run null
        val inner = fieldWidth - with(density) { (padX * 2).toPx() }.toInt()
        if (inner <= 0) return@run null
        val at = CallTextDoc.charToCodeUnitIndex(value.text, s.end).coerceIn(0, value.text.length)
        val r = l.getCursorRect(at)
        val (first, rest) = ghostSplit(s.text, (inner - r.left).toInt(), inner) { t, w ->
            measurer.measure(t, ghostStyle, maxLines = 1, softWrap = false).size.width <= w
        }
        GhostLayout(
            r,
            first.takeIf { it.isNotEmpty() }?.let { measurer.measure(it, ghostStyle, maxLines = 1, softWrap = false) },
            rest.takeIf { it.isNotEmpty() }?.let { measurer.measure(it, ghostStyle, constraints = androidx.compose.ui.unit.Constraints(maxWidth = inner)) },
        )
    }
    val selected = value.text.substring(value.selection.min.coerceAtMost(value.text.length), value.selection.max.coerceAtMost(value.text.length))
    val showHelper = selected.isNotEmpty() && selected.length <= 60 && HAN.containsMatchIn(selected)

    Column(modifier.background(BoardPaper.Paper)) {
        Box(Modifier.fillMaxWidth().weight(1f).verticalScroll(remember(board.page) { androidx.compose.foundation.ScrollState(0) }).onSizeChanged { fieldWidth = it.width }) {
            val tapSlop = with(density) { 16.dp.toPx() }
            BasicTextField(
                value = value,
                onValueChange = { v ->
                    val wasComposing = value.composition != null
                    val textChanged = v.text != value.text
                    val selChanged = v.selection != value.selection
                    value = v
                    when {
                        textChanged || v.composition != null || wasComposing -> onChange(v.text, v.selection.min, v.selection.max, v.composition)
                        selChanged -> onSelect(v.selection.min, v.selection.max)
                    }
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 320.dp)
                    // A tap near someone's caret dot lights their name up below (observed, never consumed: the tap still places my caret).
                    .pointerInput(board.remote) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                            val l = layout ?: return@awaitEachGesture
                            val text = currentValue.text
                            val pad = Offset(padX.toPx(), padY.toPx())
                            val hit = board.remote.minByOrNull { c ->
                                val r = l.getCursorRect(CallTextDoc.charToCodeUnitIndex(text, fieldIndex(c.head)).coerceIn(0, text.length))
                                (Offset(r.left, r.top) + pad - down.position).getDistance()
                            }?.takeIf { c ->
                                val r = l.getCursorRect(CallTextDoc.charToCodeUnitIndex(text, fieldIndex(c.head)).coerceIn(0, text.length))
                                (Offset(r.left, r.top) + pad - down.position).getDistance() <= tapSlop
                            }
                            if (hit != null) highlighted = hit.clientId
                        }
                    }
                    .onFocusChanged { focused = it.isFocused; if (!it.isFocused) onBlur() }
                    .onPreviewKeyEvent { e ->
                        if (e.type != KeyEventType.KeyDown || suggestion == null || value.composition != null) false
                        else when (e.key) {
                            Key.Tab -> { accept(); true }
                            Key.Escape -> { dismissed = suggestion?.let { "${it.segment}@${it.end}" }; suggestion = null; true }
                            else -> false
                        }
                    },
                textStyle = TextStyle(fontSize = 19.sp, lineHeight = 30.sp, color = BoardPaper.Ink),
                cursorBrush = SolidColor(BoardPaper.Caret),
                onTextLayout = { layout = it },
                decorationBox = { inner ->
                    Box(
                        Modifier.fillMaxWidth().padding(horizontal = padX, vertical = padY).drawWithContent {
                            val l = layout
                            if (l == null) { drawContent(); return@drawWithContent }
                            val text = value.text
                            // Their selection under the text; their caret a thin line with a small dot on top —
                            // nothing over the text (the name is in the people row below).
                            for (c in board.remote) {
                                val start = CallTextDoc.charToCodeUnitIndex(text, fieldIndex(c.start)).coerceIn(0, text.length)
                                val end = CallTextDoc.charToCodeUnitIndex(text, fieldIndex(c.end)).coerceIn(0, text.length)
                                if (end > start) drawPath(l.getPathForRange(start, end), parseColor(c.color).copy(alpha = 0.22f))
                            }
                            drawContent()
                            for (c in board.remote) {
                                val color = parseColor(c.color)
                                val head = CallTextDoc.charToCodeUnitIndex(text, fieldIndex(c.head)).coerceIn(0, text.length)
                                val r = l.getCursorRect(head)
                                drawLine(color, Offset(r.left, r.top), Offset(r.left, r.bottom), strokeWidth = 2.dp.toPx())
                                // The dot gently pulses while they compose; it grows a little while their chip is lit.
                                val radius = 3.dp.toPx() * (if (!c.compose.isNullOrEmpty()) pulse else 1f) * (if (highlighted == c.clientId) 1.35f else 1f)
                                drawCircle(color, radius, Offset(r.left, r.top))
                            }
                            // The offer, grey, right after my caret (the rest of the line is empty): what fits there
                            // on the caret's line, the rest wrapped below it across the field — never cut off.
                            val g = ghost
                            if (g != null) {
                                g.first?.let { first -> translate(g.caret.left, g.caret.top + (g.caret.height - first.size.height) / 2f) { drawText(first) } }
                                g.rest?.let { rest -> translate(0f, g.caret.bottom) { drawText(rest) } }
                            }
                        },
                    ) {
                        if (value.text.isEmpty()) Text("Type here — you both see it as you write. Pinyin input works.", color = BoardPaper.Muted, fontSize = 17.sp)
                        inner()
                    }
                },
            )
            // The chip under the caret's line: a tap types the offer in (the keyboard stays up).
            val s = suggestion
            val l = layout
            if (s != null && l != null) {
                val at = CallTextDoc.charToCodeUnitIndex(value.text, s.end).coerceIn(0, value.text.length)
                val r = l.getCursorRect(at)
                val margin = with(density) { 8.dp.toPx() }
                val x = (r.left + with(density) { padX.toPx() }).coerceAtMost(fieldWidth - chipWidth - margin).coerceAtLeast(margin)
                val y = r.bottom + (ghost?.rest?.size?.height ?: 0) + with(density) { (padY + 6.dp).toPx() }
                Text(
                    CallGloss.chipLabel(s.gloss.pinyin, s.gloss.english),
                    color = BoardPaper.ChipText, fontSize = 16.sp, lineHeight = 21.sp, maxLines = 4, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .offset { IntOffset(x.roundToInt(), y.roundToInt()) }
                        .widthIn(max = with(density) { (fieldWidth - 2 * margin).coerceAtLeast(0f).toDp() })
                        .onSizeChanged { chipWidth = it.width }
                        .clip(RoundedCornerShape(22.dp))
                        .background(BoardPaper.ChipBg)
                        .border(1.dp, BoardPaper.ChipBorder, RoundedCornerShape(22.dp))
                        .bouncyClickable { accept() }
                        .heightIn(min = 44.dp)
                        .padding(horizontal = 16.dp, vertical = 11.dp),
                )
            }
        }
        if (showHelper) SelectionHelper(selected, pinyinOf, explain)
        if (board.remote.isNotEmpty() || gloss != null) Row(
            Modifier.fillMaxWidth().drawBehind { drawLine(BoardPaper.Border, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }.padding(start = 12.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            // The people (their chips share the room left of the hints switch; a long compose preview ellipsizes).
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                board.remote.forEach { c ->
                    val lit = highlighted == c.clientId
                    val color = parseColor(c.color)
                    Row(
                        Modifier.weight(1f, fill = false).clip(RoundedCornerShape(999.dp)).background(if (lit) color else Color.Transparent)
                            .bouncyClickable { highlighted = if (lit) null else c.clientId }
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(if (lit) Color.White else color))
                        Text(
                            personChip(c.name, c.compose, lit), color = if (lit) Color.White else BoardPaper.Muted, fontSize = 13.sp,
                            fontWeight = if (lit) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            if (gloss != null) Row(
                Modifier.clip(RoundedCornerShape(12.dp)).bouncyClickable { onGlossOn(!glossOn) }.padding(start = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("⇥ Pinyin hints", color = BoardPaper.Muted, fontSize = 13.sp)
                Switch(
                    checked = glossOn, onCheckedChange = onGlossOn,
                    colors = BoardPaper.switchColors(),
                    modifier = Modifier.scale(0.75f),
                )
            }
        }
    }
}

/** The grey offer: [first] on the caret's line after [caret], [rest] wrapped across the field below it. */
private class GhostLayout(val caret: androidx.compose.ui.geometry.Rect, val first: TextLayoutResult?, val rest: TextLayoutResult?)

/** A tap near a caret dot lights that person's chip up for this long (web: while hovered). */
private const val HIGHLIGHT_MS = 3_000L

/** Their chip under the board: "Name is here", or "Name · 你hao" while they compose (the composing part underlined). */
internal fun personChip(name: String, compose: String?, lit: Boolean = false): AnnotatedString = buildAnnotatedString {
    append(name)
    if (!compose.isNullOrEmpty()) {
        append(" · ")
        withStyle(SpanStyle(textDecoration = TextDecoration.Underline, color = if (lit) Color.White else BoardPaper.Ink)) { append(compose) }
    } else append(" is here")
}

/**
 * The grey tab-complete offer after the caret: the words that fit in [firstRoom] px (the rest of the
 * caret's line), then the remainder, which wraps across the field ([fullWidth]) below. Splits at a
 * space (a whole word never splits unless one alone is wider than a line). [fits] measures.
 */
internal fun ghostSplit(text: String, firstRoom: Int, fullWidth: Int, fits: (String, Int) -> Boolean): Pair<String, String> {
    if (firstRoom <= 24) return "" to text.trimStart()
    if (fits(text, firstRoom)) return text to ""
    var cut = 0
    var i = text.indexOf(' ', 1)
    while (i > 0 && fits(text.substring(0, i), firstRoom)) { cut = i; i = text.indexOf(' ', i + 1) }
    if (cut == 0) {
        // Not even the first word fits beside the caret: everything goes below (unless no line could hold it).
        return if (fullWidth > firstRoom) "" to text.trimStart() else text to ""
    }
    return text.substring(0, cut) to text.substring(cut).trimStart()
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SelectionHelper(text: String, pinyinOf: (String) -> String, explain: (suspend (String) -> String?)?) {
    val scope = rememberCoroutineScope()
    var meaning by remember(text) { mutableStateOf<String?>(null) }
    var busy by remember(text) { mutableStateOf(false) }
    val py = remember(text) { runCatching { pinyinOf(text) }.getOrDefault("") }
    FlowRow(
        Modifier.fillMaxWidth().background(BoardPaper.HelperBg).drawBehind { drawLine(BoardPaper.Border, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }.padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(text, color = BoardPaper.HelperText, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        if (py.isNotBlank()) Text(py, color = BoardPaper.HelperPinyin, fontSize = 16.sp, modifier = Modifier.align(Alignment.CenterVertically))
        val m = meaning
        if (m != null) Text(m, color = BoardPaper.HelperMeaning, fontSize = 14.sp, modifier = Modifier.align(Alignment.CenterVertically))
        else if (explain != null) Text(
            if (busy) "…" else "Meaning", color = BoardPaper.HelperText, fontSize = 14.sp,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(BoardPaper.Paper).border(1.dp, BoardPaper.Border, RoundedCornerShape(999.dp)).bouncyClickable(enabled = !busy) {
                busy = true
                scope.launch { meaning = runCatching { explain(text) }.getOrNull() ?: "Couldn't look it up"; busy = false }
            }.padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}
