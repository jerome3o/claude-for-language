package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPoint
import dev.jeromeswannack.chineselearning.lab.core.calls.CallBoard
import dev.jeromeswannack.chineselearning.lab.core.calls.LiveStroke

/** "#dc2626" → Color (board colours are always #rrggbb; anything else draws in ink). */
fun boardColor(hex: String): Color = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(BoardPaper.Ink)

/**
 * Draws the call whiteboard (port of services/calls/boardRender.ts): white paper, strokes
 * smoothed through midpoints, text at its virtual size — scaled from the 1600 × 1000 board.
 */
fun DrawScope.drawBoard(items: List<BoardItem>, live: List<LiveStroke>, measurer: TextMeasurer, density: Float) {
    val w = size.width
    val h = size.height
    val scale = w / CallBoard.BOARD_WIDTH
    drawRect(BoardPaper.Paper)
    for (item in items) when (item) {
        is BoardItem.Stroke -> drawBoardStroke(item.points, boardColor(item.color), item.width, scale)
        is BoardItem.Text -> {
            val px = maxOf(8.0, item.size * scale).toFloat()
            item.text.split('\n').forEachIndexed { i, line ->
                drawText(
                    measurer, line,
                    topLeft = Offset((item.x * w).toFloat(), (item.y * h).toFloat() + i * (item.size * scale * 1.25).toFloat()),
                    style = TextStyle(color = boardColor(item.color), fontSize = TextUnit(px / density, androidx.compose.ui.unit.TextUnitType.Sp)),
                )
            }
        }
    }
    for (s in live) drawBoardStroke(s.points, boardColor(s.color), s.width, scale)
}

fun DrawScope.drawBoardStroke(points: List<BoardPoint>, color: Color, width: Double, scale: Float) {
    if (points.isEmpty()) return
    val w = size.width
    val h = size.height
    val lw = maxOf(1f, (width * scale).toFloat())
    if (points.size == 1) {
        drawCircle(color, lw / 2, Offset((points[0].x * w).toFloat(), (points[0].y * h).toFloat()))
        return
    }
    val path = Path()
    path.moveTo((points[0].x * w).toFloat(), (points[0].y * h).toFloat())
    // Quadratic smoothing through midpoints — finger strokes look like ink, not polylines.
    for (i in 1 until points.size - 1) {
        val mx = ((points[i].x + points[i + 1].x) / 2 * w).toFloat()
        val my = ((points[i].y + points[i + 1].y) / 2 * h).toFloat()
        path.quadraticTo((points[i].x * w).toFloat(), (points[i].y * h).toFloat(), mx, my)
    }
    val last = points.last()
    path.lineTo((last.x * w).toFloat(), (last.y * h).toFloat())
    drawPath(path, color, style = Stroke(width = lw, cap = StrokeCap.Round, join = StrokeJoin.Round))
}

/** The board as a read-only picture (review page; web: BoardSnapshot). */
@Composable
fun BoardSnapshot(items: List<BoardItem>, modifier: Modifier = Modifier) {
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(modifier.fillMaxWidth()) {
        Canvas(
            Modifier.fillMaxWidth().aspectRatio(CallBoard.BOARD_WIDTH.toFloat() / CallBoard.BOARD_HEIGHT).clip(RoundedCornerShape(12.dp)).background(BoardPaper.Paper),
        ) { drawBoard(items, emptyList(), measurer, density) }
    }
}
