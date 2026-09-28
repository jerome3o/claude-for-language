package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTextDoc
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

private val HAN = Regex("[\\u3400-\\u9fff\\uf900-\\ufaff]")

private fun parseColor(hex: String): Color = Color(0xFF000000 or hex.removePrefix("#").toLong(16))

/**
 * The call's shared text board (web: components/calls/TextBoard.tsx): both people type into one
 * document; the other person's caret and selection show in their colour with their name. While an
 * IME composition is open (pinyin) nothing is sent and incoming edits wait. Select Chinese text for
 * its pinyin, and (online) a word-by-word meaning.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TextBoardPanel(
    board: TextBoardUi,
    onChange: (text: String, start: Int, end: Int, composing: Boolean) -> Unit,
    onSelect: (start: Int, end: Int) -> Unit,
    onBlur: () -> Unit,
    modifier: Modifier = Modifier,
    explain: (suspend (String) -> String?)? = null,
    pinyinOf: (String) -> String = { dev.jeromeswannack.chineselearning.lab.ui.study.Pinyin.of(it) },
) {
    var value by remember { mutableStateOf(TextFieldValue(board.text)) }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val measurer = rememberTextMeasurer()
    // The other person's edit (or a rejoin) rewrites the field, my caret moved along with it.
    LaunchedEffect(board.version) {
        if ((board.lastChange == "remote" || board.lastChange == "load") && value.composition == null && value.text != board.text) {
            val (s, e) = board.mySelection
            value = TextFieldValue(board.text, TextRange(s.coerceIn(0, board.text.length), e.coerceIn(0, board.text.length)))
        }
    }
    val selected = value.text.substring(value.selection.min.coerceAtMost(value.text.length), value.selection.max.coerceAtMost(value.text.length))
    val showHelper = selected.isNotEmpty() && selected.length <= 60 && HAN.containsMatchIn(selected)

    Column(modifier.background(Color.White)) {
        Box(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())) {
            BasicTextField(
                value = value,
                onValueChange = { v ->
                    val wasComposing = value.composition != null
                    val textChanged = v.text != value.text
                    val selChanged = v.selection != value.selection
                    value = v
                    when {
                        textChanged || v.composition != null || wasComposing -> onChange(v.text, v.selection.min, v.selection.max, v.composition != null)
                        selChanged -> onSelect(v.selection.min, v.selection.max)
                    }
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 320.dp).onFocusChanged { if (!it.isFocused) onBlur() },
                textStyle = TextStyle(fontSize = 19.sp, lineHeight = 30.sp, color = Lab.colors.ink),
                cursorBrush = SolidColor(Lab.colors.ink),
                onTextLayout = { layout = it },
                decorationBox = { inner ->
                    Box(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp).drawBehind {
                            val l = layout ?: return@drawBehind
                            val text = value.text
                            for (c in board.remote) {
                                val color = parseColor(c.color)
                                val start = CallTextDoc.charToCodeUnitIndex(text, c.start).coerceIn(0, text.length)
                                val end = CallTextDoc.charToCodeUnitIndex(text, c.end).coerceIn(0, text.length)
                                if (end > start) drawPath(l.getPathForRange(start, end), color.copy(alpha = 0.22f))
                                val head = CallTextDoc.charToCodeUnitIndex(text, c.head).coerceIn(0, text.length)
                                val r = l.getCursorRect(head)
                                drawLine(color, Offset(r.left, r.top), Offset(r.left, r.bottom), strokeWidth = 2.dp.toPx())
                                val label = measurer.measure(c.name, TextStyle(fontSize = 11.sp, color = Color.White, fontWeight = FontWeight.SemiBold))
                                val padX = 4.dp.toPx()
                                val top = r.top - label.size.height - 1.dp.toPx()
                                drawRoundRect(color, Offset(r.left - 1.dp.toPx(), top), Size(label.size.width + padX * 2, label.size.height.toFloat()), androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()))
                                translate(r.left - 1.dp.toPx() + padX, top) { drawText(label) }
                            }
                        },
                    ) {
                        if (value.text.isEmpty()) Text("Type here — you both see it as you write. Pinyin input works.", color = Lab.colors.muted, fontSize = 17.sp)
                        inner()
                    }
                },
            )
        }
        if (showHelper) SelectionHelper(selected, pinyinOf, explain)
        if (board.remote.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            board.remote.forEach { c ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(c.color)))
                    Text("${c.name} is here", color = Lab.colors.muted, fontSize = 13.sp)
                }
            }
        }
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
        Modifier.fillMaxWidth().background(Lab.colors.card).padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(text, color = Lab.colors.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        if (py.isNotBlank()) Text(py, color = Lab.colors.accent, fontSize = 16.sp, modifier = Modifier.align(Alignment.CenterVertically))
        val m = meaning
        if (m != null) Text(m, color = Lab.colors.ink, fontSize = 14.sp, modifier = Modifier.align(Alignment.CenterVertically))
        else if (explain != null) Text(
            if (busy) "…" else "Meaning", color = Lab.colors.ink, fontSize = 14.sp,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color.White).bouncyClickable(enabled = !busy) {
                busy = true
                scope.launch { meaning = runCatching { explain(text) }.getOrNull() ?: "Couldn't look it up"; busy = false }
            }.padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}
