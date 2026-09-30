package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardOp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPoint
import dev.jeromeswannack.chineselearning.lab.core.calls.CallBoard
import dev.jeromeswannack.chineselearning.lab.core.calls.LiveStroke
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import java.util.UUID

private const val PEN_WIDTH = 10.0
private const val TEXT_SIZE = 80.0

enum class BoardTool { PEN, TEXT }

/**
 * The shared whiteboard (web: components/calls/Whiteboard.tsx): draw with a finger or pen, the
 * text tool types at a tap (the Chinese keyboard works), undo your last item, clear for everyone.
 * Committed items go to the room; a stroke in progress is streamed every 60 ms so the other side
 * sees the ink appear as you write.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Whiteboard(
    items: List<BoardItem>,
    live: List<LiveStroke>,
    myUserId: String,
    onCommit: (BoardOp) -> Unit,
    onLive: (LiveStroke?) -> Unit,
    modifier: Modifier = Modifier,
    initialTool: BoardTool = BoardTool.PEN,
) {
    var tool by remember { mutableStateOf(initialTool) }
    var color by remember { mutableStateOf(CallBoard.BOARD_COLORS[0]) }
    var drawing by remember { mutableStateOf<LiveStroke?>(null) }
    var draft by remember { mutableStateOf<Pair<BoardPoint, String>?>(null) }
    var confirmClear by remember { mutableStateOf(false) }
    var lastLive by remember { mutableLongStateOf(0L) }
    val measurer = rememberTextMeasurer()
    val commit by rememberUpdatedState(onCommit)
    val sendLive by rememberUpdatedState(onLive)

    fun commitDraft() {
        val d = draft ?: return
        val text = d.second.trim()
        if (text.isNotEmpty()) commit(BoardItem.Text(newId(), myUserId, color, d.first.x, d.first.y, TEXT_SIZE, text))
        draft = null
    }

    Column(modifier.background(BoardPaper.Surround)) {
        FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ToolButton("✏️", tool == BoardTool.PEN) { commitDraft(); tool = BoardTool.PEN }
            ToolButton("T", tool == BoardTool.TEXT) { tool = BoardTool.TEXT }
            Spacer(Modifier.width(4.dp))
            CallBoard.BOARD_COLORS.forEach { c ->
                Box(
                    Modifier.align(Alignment.CenterVertically).size(32.dp).clip(CircleShape).background(boardColor(c))
                        .border(if (color == c) 3.dp else 1.dp, if (color == c) BoardPaper.Accent else BoardPaper.Border, CircleShape)
                        .bouncyClickable { color = c },
                )
            }
            Spacer(Modifier.width(4.dp))
            ToolButton("↶", false) { CallBoard.lastItemBy(items, myUserId)?.let { commit(BoardOp.Delete(it, myUserId)) } }
            ToolButton("🗑", false) { if (items.isEmpty()) commit(BoardOp.Clear(myUserId)) else confirmClear = true }
        }
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f).padding(8.dp), contentAlignment = Alignment.Center) {
            val ratio = CallBoard.BOARD_WIDTH.toFloat() / CallBoard.BOARD_HEIGHT
            val w = if (maxWidth / maxHeight > ratio) maxHeight * ratio else maxWidth
            val h = w / ratio
            Box(Modifier.size(w, h).clip(RoundedCornerShape(10.dp)).background(BoardPaper.Paper).border(1.dp, BoardPaper.Border, RoundedCornerShape(10.dp))) {
                Canvas(
                    Modifier.fillMaxSize()
                        .pointerInput(tool, color) {
                            if (tool == BoardTool.TEXT) {
                                detectTapGestures { p ->
                                    commitDraft()
                                    draft = BoardPoint((p.x / size.width).toDouble(), (p.y / size.height).toDouble()) to ""
                                }
                            } else {
                                fun pt(x: Float, y: Float) = BoardPoint((x / size.width).toDouble().coerceIn(0.0, 1.0), (y / size.height).toDouble().coerceIn(0.0, 1.0))
                                detectDragGestures(
                                    onDragStart = { o -> drawing = LiveStroke(newId(), color, PEN_WIDTH, listOf(pt(o.x, o.y))) },
                                    onDrag = { change, _ ->
                                        val s = drawing ?: return@detectDragGestures
                                        val next = s.copy(points = s.points + pt(change.position.x, change.position.y))
                                        drawing = next
                                        val now = System.currentTimeMillis()
                                        if (now - lastLive > 60) { lastLive = now; sendLive(next) }
                                    },
                                    onDragEnd = {
                                        drawing?.let { s ->
                                            sendLive(null)
                                            commit(BoardItem.Stroke(s.id, myUserId, s.color, s.width, s.points))
                                        }
                                        drawing = null
                                    },
                                    onDragCancel = { drawing = null; sendLive(null) },
                                )
                            }
                        },
                ) { drawBoard(items, live + listOfNotNull(drawing), measurer, density) }
                draft?.let { (p, text) ->
                    val fieldW = 220.dp
                    Box(Modifier.padding(start = (w - fieldW).coerceAtLeast(0.dp).coerceAtMost(w * p.x.toFloat()), top = (h - 64.dp).coerceAtLeast(0.dp).coerceAtMost(h * p.y.toFloat()))) {
                        OutlinedTextField(
                            value = text,
                            onValueChange = { draft = p to it.take(CallBoard.MAX_TEXT_LENGTH) },
                            placeholder = { Text("Type…", color = BoardPaper.Muted) },
                            singleLine = true,
                            textStyle = androidx.compose.ui.text.TextStyle(color = boardColor(color), fontSize = 20.sp),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { commitDraft() }),
                            colors = BoardPaper.fieldColors(boardColor(color)),
                            modifier = Modifier.width(fieldW),
                        )
                    }
                }
            }
        }
    }
    if (confirmClear) ConfirmDialog(
        "Clear the whiteboard for everyone?", "Everything on it is removed for both of you.", "Clear",
        onConfirm = { confirmClear = false; commit(BoardOp.Clear(myUserId)) }, onDismiss = { confirmClear = false }, danger = true,
    )
}

@Composable
private fun ToolButton(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(RoundedCornerShape(12.dp))
            .background(if (active) BoardPaper.AccentSoft else BoardPaper.Paper)
            .border(1.dp, if (active) BoardPaper.Accent else BoardPaper.Border, RoundedCornerShape(12.dp))
            .bouncyClickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = BoardPaper.Ink) }
}

private fun newId(): String = UUID.randomUUID().toString().take(18)
