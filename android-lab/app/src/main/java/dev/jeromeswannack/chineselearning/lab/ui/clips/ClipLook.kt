package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/**
 * 🎬 The eight clip themes (web components/clips/clips.css): palette, type, texture and card shape
 * — each clearly different, every state also carried by a shape or a label (never colour alone).
 */
data class ClipLook(
    val name: String,
    val bg: Brush,
    val fg: Color,
    val muted: Color,
    val accent: Color,
    val accent2: Color,
    val cardBg: Color,
    val cardFg: Color,
    val border: Color,
    val radius: Dp,
    val borderWidth: Dp = 1.dp,
    val dashed: Boolean = false,
    /** A hard offset shadow (comic) / pixel frame (retro). */
    val hardShadow: Boolean = false,
    val zhFont: FontFamily = FontFamily.SansSerif,
    val enFont: FontFamily = FontFamily.SansSerif,
    val headWeight: FontWeight = FontWeight.Black,
    /** Headline glow (neon) / outline (comic) / offset (retro). */
    val headEffect: String = "none",
    val uppercase: Boolean = false,
    /** A light page: dark rail and meta text. */
    val light: Boolean = false,
    val hookOutlined: Boolean = false,
    val texture: DrawScope.() -> Unit = {},
)

private fun hex(v: Long) = Color(v)

object ClipLooks {
    private val neon = ClipLook(
        name = "neon",
        bg = Brush.verticalGradient(listOf(hex(0xFF07060F), hex(0xFF0B0B18))),
        fg = Color.White, muted = Color.White.copy(alpha = 0.72f), accent = hex(0xFFFF3B6B), accent2 = hex(0xFF22E4FF),
        cardBg = hex(0xFF140A28).copy(alpha = 0.78f), cardFg = Color.White, border = hex(0xFFFF3B6B).copy(alpha = 0.65f), radius = 18.dp,
        headEffect = "glow",
        texture = {
            drawCircle(Brush.radialGradient(listOf(hex(0x59FF3B6B), Color.Transparent), center = Offset(size.width * 0.15f, size.height * 0.2f), radius = size.width * 0.7f))
            drawCircle(Brush.radialGradient(listOf(hex(0x4D22E4FF), Color.Transparent), center = Offset(size.width * 0.85f, size.height * 0.75f), radius = size.width * 0.75f))
            val step = 42.dp.toPx()
            var x = 0f
            while (x < size.width) { drawLine(Color.White.copy(alpha = 0.03f), Offset(x, 0f), Offset(x, size.height)); x += step }
            var y = 0f
            while (y < size.height) { drawLine(Color.White.copy(alpha = 0.03f), Offset(0f, y), Offset(size.width, y)); y += step }
        },
    )
    private val paper = ClipLook(
        name = "paper", bg = Brush.verticalGradient(listOf(hex(0xFFF6F0E1), hex(0xFFF3ECDB))),
        fg = hex(0xFF2B2A26), muted = hex(0xFF5B574D), accent = hex(0xFFD9480F), accent2 = hex(0xFF1C64A8),
        cardBg = hex(0xFFFFFDF6), cardFg = hex(0xFF2B2A26), border = hex(0xFFD8CFB8), radius = 4.dp,
        zhFont = FontFamily.Serif, enFont = FontFamily.Serif, headWeight = FontWeight.Bold, light = true, hookOutlined = true,
        texture = {
            val line = 32.dp.toPx()
            var y = line
            while (y < size.height) { drawLine(hex(0x2E1C64A8), Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx()); y += line }
            drawLine(hex(0x73D9480F), Offset(39.dp.toPx(), 0f), Offset(39.dp.toPx(), size.height), strokeWidth = 2.dp.toPx())
        },
    )
    private val chalk = ClipLook(
        name = "chalk", bg = Brush.verticalGradient(listOf(hex(0xFF20392B), hex(0xFF1B3125))),
        fg = hex(0xFFF4F1E8), muted = hex(0xBFF4F1E8), accent = hex(0xFFFFD166), accent2 = hex(0xFF9BE7FF),
        cardBg = Color.White.copy(alpha = 0.04f), cardFg = hex(0xFFF4F1E8), border = hex(0x8CF4F1E8), radius = 12.dp, borderWidth = 2.dp, dashed = true,
        zhFont = FontFamily.Serif, enFont = FontFamily.Cursive, headWeight = FontWeight.Bold, hookOutlined = true,
        texture = {
            drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.07f), Color.Transparent), center = Offset(size.width * 0.2f, size.height * 0.3f), radius = size.width * 0.6f))
            val dot = 5.dp.toPx()
            var y = 0f; var row = 0
            while (y < size.height) {
                var x = if (row % 2 == 0) 0f else dot / 2
                while (x < size.width) { drawCircle(Color.White.copy(alpha = 0.025f), radius = 0.8f, center = Offset(x, y)); x += dot * 1.7f }
                y += dot; row++
            }
            val frame = 14.dp.toPx()
            drawRect(hex(0xFF6B4423), style = Stroke(width = frame * 2))
            drawRect(hex(0xFF3D2614), topLeft = Offset(frame, frame), size = Size(size.width - 2 * frame, size.height - 2 * frame), style = Stroke(width = 2.dp.toPx()))
        },
    )
    private val comic = ClipLook(
        name = "comic", bg = Brush.verticalGradient(listOf(hex(0xFFFFD400), hex(0xFFFFC800))),
        fg = hex(0xFF111111), muted = hex(0xFF222222), accent = hex(0xFFE63946), accent2 = hex(0xFF1D4ED8),
        cardBg = Color.White, cardFg = hex(0xFF111111), border = hex(0xFF111111), radius = 10.dp, borderWidth = 3.dp, hardShadow = true,
        enFont = FontFamily.Cursive, headEffect = "outline", light = true,
        texture = {
            val c = Offset(size.width / 2, size.height * 0.45f)
            val r = size.height
            for (i in 0 until 18) {
                val a0 = Math.toRadians(i * 20.0); val a1 = Math.toRadians(i * 20.0 + 10)
                val path = androidx.compose.ui.graphics.Path().apply {
                    moveTo(c.x, c.y)
                    lineTo(c.x + (r * cos(a0)).toFloat(), c.y + (r * sin(a0)).toFloat())
                    lineTo(c.x + (r * cos(a1)).toFloat(), c.y + (r * sin(a1)).toFloat())
                    close()
                }
                drawPath(path, Color.White.copy(alpha = 0.45f))
            }
            val step = 14.dp.toPx()
            var y = 0f
            while (y < size.height) {
                var x = 0f
                while (x < size.width) { drawCircle(hex(0x59E63946), radius = 2.dp.toPx(), center = Offset(x, y)); x += step }
                y += step
            }
        },
    )
    private val sunset = ClipLook(
        name = "sunset", bg = Brush.verticalGradient(listOf(hex(0xFFFF7E5F), hex(0xFFFEB47B), hex(0xFFB55A9A), hex(0xFF4B2A6B))),
        fg = Color.White, muted = Color.White.copy(alpha = 0.86f), accent = hex(0xFFFF4D6D), accent2 = hex(0xFFFFF3B0),
        cardBg = Color.White.copy(alpha = 0.22f), cardFg = Color.White, border = Color.White.copy(alpha = 0.45f), radius = 26.dp,
        headWeight = FontWeight.Bold,
        texture = {
            drawCircle(hex(0xE6FFF3B0), radius = size.width * 0.36f, center = Offset(size.width / 2, size.height * 1.08f))
            drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.35f), Color.Transparent), center = Offset(size.width * 0.8f, size.height * 0.15f), radius = size.width * 0.4f))
        },
    )
    private val mono = ClipLook(
        name = "mono", bg = Brush.verticalGradient(listOf(hex(0xFFF2F2F0), hex(0xFFF2F2F0))),
        fg = hex(0xFF111111), muted = hex(0xFF444444), accent = hex(0xFF111111), accent2 = hex(0xFF111111),
        cardBg = Color.White, cardFg = hex(0xFF111111), border = hex(0xFF111111), radius = 0.dp,
        headWeight = FontWeight.Light, uppercase = true, light = true,
        texture = {
            drawLine(Color.Black.copy(alpha = 0.08f), Offset(size.width / 2, 0f), Offset(size.width / 2, size.height))
            val step = 80.dp.toPx()
            var y = step
            while (y < size.height) { drawLine(Color.Black.copy(alpha = 0.06f), Offset(0f, y), Offset(size.width, y)); y += step }
        },
    )
    private val ink = ClipLook(
        name = "ink", bg = Brush.verticalGradient(listOf(hex(0xFFF3ECDF), hex(0xFFEFE6D6))),
        fg = hex(0xFF1B1B1B), muted = hex(0xFF4A4540), accent = hex(0xFFB91C1C), accent2 = hex(0xFF4A4540),
        cardBg = Color.White.copy(alpha = 0.55f), cardFg = hex(0xFF1B1B1B), border = hex(0x591B1B1B), radius = 2.dp,
        zhFont = FontFamily.Serif, enFont = FontFamily.Serif, headWeight = FontWeight.Normal, light = true,
        texture = {
            drawOval(Brush.radialGradient(listOf(hex(0x381B1B1B), Color.Transparent), center = Offset(size.width * 0.2f, size.height * 0.85f), radius = size.width * 0.7f), topLeft = Offset(-size.width * 0.5f, size.height * 0.7f), size = Size(size.width * 1.4f, size.height * 0.3f))
            drawOval(Brush.radialGradient(listOf(hex(0x2E1B1B1B), Color.Transparent), center = Offset(size.width * 0.85f, size.height * 0.92f), radius = size.width * 0.5f), topLeft = Offset(size.width * 0.35f, size.height * 0.8f), size = Size(size.width, size.height * 0.25f))
        },
    )
    private val retro = ClipLook(
        name = "retro", bg = Brush.verticalGradient(listOf(hex(0xFF140C2B), hex(0xFF1A1040))),
        fg = hex(0xFFB6FFB0), muted = hex(0xBFB6FFB0), accent = hex(0xFFFF5EC4), accent2 = hex(0xFFFFE14D),
        cardBg = hex(0xFF24164A), cardFg = hex(0xFFB6FFB0), border = hex(0xFFB6FFB0), radius = 0.dp, borderWidth = 3.dp, hardShadow = true,
        enFont = FontFamily.Monospace, headEffect = "offset", uppercase = true,
        texture = {
            val step = 4.dp.toPx()
            var y = 0f
            while (y < size.height) { drawRect(Color.Black.copy(alpha = 0.32f), topLeft = Offset(0f, y), size = Size(size.width, step / 2)); y += step }
            drawRect(Brush.radialGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f)), center = Offset(size.width / 2, size.height / 2), radius = size.height * 0.75f))
        },
    )

    private val all = listOf(neon, paper, chalk, comic, sunset, mono, ink, retro).associateBy { it.name }

    /** The theme of a clip (unknown → neon), with the spec's accent when it gives one. */
    fun of(theme: String?, accent: String? = null): ClipLook {
        val look = all[theme] ?: neon
        val a = accent?.let(::parseHex) ?: return look
        return look.copy(accent = a)
    }

    fun parseHex(s: String): Color? {
        val h = s.trim().removePrefix("#")
        val full = when (h.length) {
            3 -> h.map { "$it$it" }.joinToString("")
            6 -> h
            else -> return null
        }
        return full.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
    }

    @Suppress("unused")
    private fun DrawScope.roundRect(color: Color, r: Float) = drawRoundRect(color, cornerRadius = CornerRadius(r, r))
}
