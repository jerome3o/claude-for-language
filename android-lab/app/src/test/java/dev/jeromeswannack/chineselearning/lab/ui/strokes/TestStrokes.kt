package dev.jeromeswannack.chineselearning.lab.ui.strokes

import dev.jeromeswannack.chineselearning.lab.core.CharStrokeData
import dev.jeromeswannack.chineselearning.lab.core.StrokeData
import dev.jeromeswannack.chineselearning.lab.core.StrokeGeometry
import dev.jeromeswannack.chineselearning.lab.core.StrokePoint
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad
import kotlinx.serialization.json.Json
import kotlin.math.cos
import kotlin.math.sin

/**
 * Real stroke data for tests (src/test/resources/strokes: 你 好 十 三 口 人 永 from
 * hanzi-writer-data, Arphic Public License) and synthetic "hand-drawn" strokes.
 */
object TestStrokes {
    fun json(char: String): String? =
        TestStrokes::class.java.getResourceAsStream("/strokes/${StrokeData.file(char)}")?.bufferedReader()?.readText()

    fun data(char: String): CharStrokeData = StrokeData.parse(Json.parseToJsonElement(json(char) ?: error("no test data for $char")))!!

    /** Loader for WritingExercise: the resources, Missing for anything else. */
    val loader: suspend (String) -> StrokeLoad = { c -> json(c)?.let { StrokeLoad.Ok(data(c)) } ?: StrokeLoad.Missing }

    /** A drawing of [median]: resampled, shifted and wobbled like a finger would. */
    fun draw(median: List<StrokePoint>, dx: Double = 12.0, dy: Double = -9.0, wobble: Double = 5.0, n: Int = 30, reverse: Boolean = false): List<StrokePoint> {
        val pts = StrokeGeometry.resample(median, n).mapIndexed { i, p -> StrokePoint(p.x + dx + wobble * sin(i * 1.7), p.y + dy + wobble * cos(i * 2.3)) }
        return if (reverse) pts.reversed() else pts
    }
}
