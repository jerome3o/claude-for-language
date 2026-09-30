package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
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
 * document; the other person's caret and selection show in their colour with their name. While an
 * IME composition is open (pinyin) nothing is sent and incoming edits wait. Select Chinese text for
 * its pinyin, and (online) a word-by-word meaning.
 *
 * Tab-complete (web: useBoardGloss): after typing Chinese and pausing CallGloss.DEBOUNCE_MS with no
 * composition open, " - pīnyīn - meaning" shows grey after the caret with a "⇥ …" chip under it;
 * a tap on the chip (or Tab on a hardware keyboard) types it in like any edit, so the other person
 * gets it through the CRDT. Typing on moves past it; Esc dismisses. Only I see the offer.
 *
 * While I compose (pinyin IME), the composing text goes to the other person as a preview in my name
 * flag; theirs shows in their flag above their caret as "Name · 你hao" — drawn over the text, never
 * laid out in it, so nothing shifts. The board is always light paper ([BoardPaper]) in both themes.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TextBoardPanel(
    board: TextBoardUi,
    onChange: (text: String, start: Int, end: Int, composing: Boolean, compose: String?) -> Unit,
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
    var shownPage by remember { mutableStateOf(board.page) }
    // The other person's edit (or a rejoin) rewrites the field, my caret moved along with it.
    LaunchedEffect(board.version) {
        if (board.page != shownPage) {
            // Another board page: its text, from the top; a composition on the old page is dropped with it.
            shownPage = board.page
            suggestion = null
            value = TextFieldValue(board.text, TextRange(0))
            return@LaunchedEffect
        }
        if ((board.lastChange == "remote" || board.lastChange == "load") && value.composition == null && value.text != board.text) {
            val (s, e) = board.mySelection
            value = TextFieldValue(board.text, TextRange(s.coerceIn(0, board.text.length), e.coerceIn(0, board.text.length)))
        }
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
        onChange(v.text, v.selection.min, v.selection.max, false, null)
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }
    val selected = value.text.substring(value.selection.min.coerceAtMost(value.text.length), value.selection.max.coerceAtMost(value.text.length))
    val showHelper = selected.isNotEmpty() && selected.length <= 60 && HAN.containsMatchIn(selected)
    val padX = 16.dp
    val padY = 14.dp

    Column(modifier.background(BoardPaper.Paper)) {
        Box(Modifier.fillMaxWidth().weight(1f).verticalScroll(remember(board.page) { androidx.compose.foundation.ScrollState(0) }).onSizeChanged { fieldWidth = it.width }) {
            BasicTextField(
                value = value,
                onValueChange = { v ->
                    val wasComposing = value.composition != null
                    val textChanged = v.text != value.text
                    val selChanged = v.selection != value.selection
                    value = v
                    when {
                        textChanged || v.composition != null || wasComposing -> onChange(
                            v.text, v.selection.min, v.selection.max, v.composition != null,
                            v.composition?.let { c -> v.text.substring(c.min.coerceIn(0, v.text.length), c.max.coerceIn(0, v.text.length)) },
                        )
                        selChanged -> onSelect(v.selection.min, v.selection.max)
                    }
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 320.dp)
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
                            // Their selection under the text; their caret and name flag over it (the flag is opaque).
                            for (c in board.remote) {
                                val start = CallTextDoc.charToCodeUnitIndex(text, c.start).coerceIn(0, text.length)
                                val end = CallTextDoc.charToCodeUnitIndex(text, c.end).coerceIn(0, text.length)
                                if (end > start) drawPath(l.getPathForRange(start, end), parseColor(c.color).copy(alpha = 0.22f))
                            }
                            drawContent()
                            for (c in board.remote) {
                                val color = parseColor(c.color)
                                val head = CallTextDoc.charToCodeUnitIndex(text, c.head).coerceIn(0, text.length)
                                val r = l.getCursorRect(head)
                                drawLine(color, Offset(r.left, r.top), Offset(r.left, r.bottom), strokeWidth = 2.dp.toPx())
                                val label = measurer.measure(caretFlag(c.name, c.compose), TextStyle(fontSize = 11.sp, color = Color.White, fontWeight = FontWeight.SemiBold))
                                val px = 4.dp.toPx()
                                val top = r.top - label.size.height - 1.dp.toPx()
                                drawRoundRect(color, Offset(r.left - 1.dp.toPx(), top), Size(label.size.width + px * 2, label.size.height.toFloat()), androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()))
                                translate(r.left - 1.dp.toPx() + px, top) { drawText(label) }
                            }
                            // The offer, grey, right after my caret (the rest of the line is empty).
                            val s = suggestion
                            if (s != null) {
                                val at = CallTextDoc.charToCodeUnitIndex(text, s.end).coerceIn(0, text.length)
                                val r = l.getCursorRect(at)
                                val room = (size.width - r.left).toInt()
                                if (room > 24) {
                                    val ghost = measurer.measure(
                                        s.text, TextStyle(fontSize = 19.sp, lineHeight = 30.sp, color = BoardPaper.Ghost),
                                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                                        constraints = androidx.compose.ui.unit.Constraints(maxWidth = room),
                                    )
                                    translate(r.left, r.top + (r.height - ghost.size.height) / 2f) { drawText(ghost) }
                                }
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
                val y = r.bottom + with(density) { (padY + 6.dp).toPx() }
                Text(
                    CallGloss.chipLabel(s.gloss.pinyin, s.gloss.english),
                    color = BoardPaper.ChipText, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .offset { IntOffset(x.roundToInt(), y.roundToInt()) }
                        .widthIn(max = with(density) { (fieldWidth - 2 * margin).coerceAtLeast(0f).toDp() })
                        .onSizeChanged { chipWidth = it.width }
                        .clip(RoundedCornerShape(999.dp))
                        .background(BoardPaper.ChipBg)
                        .border(1.dp, BoardPaper.ChipBorder, RoundedCornerShape(999.dp))
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
            board.remote.forEach { c ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(c.color)))
                    Text("${c.name} is here", color = BoardPaper.Muted, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.weight(1f))
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

/** Their name flag: "Name", or "Name · 你hao" while they compose (the composing part underlined, a little faded). */
internal fun caretFlag(name: String, compose: String?): AnnotatedString = buildAnnotatedString {
    append(name)
    if (!compose.isNullOrEmpty()) {
        append(" · ")
        withStyle(SpanStyle(textDecoration = TextDecoration.Underline, color = Color.White.copy(alpha = 0.85f))) { append(compose) }
    }
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
