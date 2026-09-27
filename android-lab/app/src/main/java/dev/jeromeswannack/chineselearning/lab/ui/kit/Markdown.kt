package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * Markdown the way the web shows Claude's answers and fun_facts (react-markdown + remark-gfm,
 * `.claude-response` in index.css): headings, paragraphs, **bold** / *italic* / ~~strike~~ /
 * `code`, links, bullet / numbered / task lists (nested), > quotes, --- rules, fenced code and
 * GFM tables — scrollable sideways when wider than the screen, header row shaded, CJK columns kept
 * whole. Every colour is a translucent [Lab.colors] ink / accent, so it reads on any surface (card,
 * faint bubble, accent-soft) in light and dark. Parsing ([MarkdownParser]) is remembered per [src]
 * and never throws, so a reply that is still streaming renders as it grows.
 */
@Composable
fun MarkdownText(
    src: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    color: Color = Lab.colors.ink,
) {
    val blocks = remember(src) { MarkdownParser.parse(src.trim('\n')) }
    val theme = rememberMdTheme(style, color)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(theme.blockGap)) {
        for (b in blocks) MdBlockView(b, theme, depth = 0)
    }
}

/** The inline Markdown of [src] as one AnnotatedString (block structure flattened: bullets, line breaks). */
fun markdownAnnotated(src: String, linkColor: Color = Color.Unspecified): AnnotatedString = buildAnnotatedString {
    val theme = MdInlineStyles(codeBackground = Color(0x14000000), linkColor = linkColor)
    fun blocks(list: List<MdBlock>, depth: Int) {
        for (b in list) {
            if (length > 0 && !toString().endsWith("\n")) append('\n')
            when (b) {
                is MdBlock.Heading -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { appendInlines(b.content, theme) }
                is MdBlock.Paragraph -> appendInlines(b.content, theme)
                is MdBlock.ListBlock -> b.items.forEachIndexed { i, item ->
                    if (i > 0) append('\n')
                    append("  ".repeat(depth))
                    append(if (b.ordered) "${b.start + i}. " else "•  ")
                    blocks(item.blocks, depth + 1)
                }
                is MdBlock.Quote -> blocks(b.blocks, depth)
                MdBlock.Rule -> append("—")
                is MdBlock.CodeBlock -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(b.code) }
                is MdBlock.Table -> (listOf(b.header) + b.rows).forEachIndexed { r, row ->
                    if (r > 0) append('\n')
                    row.forEachIndexed { c, cell -> if (c > 0) append("  ·  "); appendInlines(cell, theme) }
                }
            }
        }
    }
    blocks(MarkdownParser.parse(src.trim()), 0)
}

// ---------------------------------------------------------------- theme

private class MdInlineStyles(val codeBackground: Color, val linkColor: Color)

private class MdTheme(
    val style: TextStyle,
    val color: Color,
    val muted: Color,
    val accent: Color,
    val line: Color,
    val headerFill: Color,
    val stripeFill: Color,
    val codeFill: Color,
    val inline: MdInlineStyles,
    val blockGap: Dp,
    val fontSizeDp: Dp,
)

@Composable
private fun rememberMdTheme(style: TextStyle, color: Color): MdTheme {
    val colors = Lab.colors
    val density = LocalDensity.current
    val base = if (color.isSpecified()) color else colors.ink
    return remember(style, base, colors, density) {
        val fontSize = if (style.fontSize.isSpecified) style.fontSize else 16.sp
        val fontDp = with(density) { fontSize.toDp() }
        val ink = colors.ink
        MdTheme(
            style = style,
            color = base,
            muted = colors.muted,
            accent = colors.accent,
            line = ink.copy(alpha = 0.16f),
            headerFill = ink.copy(alpha = 0.07f),
            stripeFill = ink.copy(alpha = 0.03f),
            codeFill = ink.copy(alpha = 0.07f),
            inline = MdInlineStyles(codeBackground = ink.copy(alpha = 0.08f), linkColor = colors.accent),
            blockGap = fontDp * 0.6f,
            fontSizeDp = fontDp,
        )
    }
}

private fun Color.isSpecified(): Boolean = this != Color.Unspecified

private fun AnnotatedString.Builder.appendInlines(inlines: List<MdInline>, s: MdInlineStyles) {
    for (n in inlines) when (n) {
        is MdInline.Text -> append(n.text)
        is MdInline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { appendInlines(n.children, s) }
        is MdInline.Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInlines(n.children, s) }
        is MdInline.Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { appendInlines(n.children, s) }
        is MdInline.Code -> withStyle(SpanStyle(background = s.codeBackground)) {
            append(' ')
            withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 0.9.em)) { append(n.code) }
            append(' ')
        }
        is MdInline.Link -> {
            val linkStyle = SpanStyle(color = s.linkColor, textDecoration = TextDecoration.Underline)
            if (n.url.isBlank()) withStyle(linkStyle) { appendInlines(n.children, s) }
            else withLink(LinkAnnotation.Url(n.url, TextLinkStyles(linkStyle))) { appendInlines(n.children, s) }
        }
        MdInline.LineBreak -> append('\n')
    }
}

private fun inlineText(inlines: List<MdInline>, theme: MdTheme): AnnotatedString =
    buildAnnotatedString { appendInlines(inlines, theme.inline) }

// ---------------------------------------------------------------- blocks

@Composable
private fun MdBlockView(block: MdBlock, theme: MdTheme, depth: Int, color: Color = theme.color) {
    when (block) {
        is MdBlock.Paragraph -> Text(remember(block, theme) { inlineText(block.content, theme) }, style = theme.style, color = color)
        is MdBlock.Heading -> {
            val scale = when (block.level) { 1 -> 1.3f; 2 -> 1.15f; 3 -> 1.07f; else -> 1f }
            val size = if (theme.style.fontSize.isSpecified) theme.style.fontSize * scale else (16 * scale).sp
            Text(
                remember(block, theme) { inlineText(block.content, theme) },
                style = theme.style.copy(fontSize = size, lineHeight = size * 1.35f, fontWeight = FontWeight.SemiBold),
                color = color,
                modifier = Modifier.padding(top = if (depth == 0) theme.blockGap * 0.4f else 0.dp),
            )
        }
        is MdBlock.ListBlock -> MdList(block, theme, depth, color)
        is MdBlock.Quote -> Column(
            Modifier.fillMaxWidth()
                .drawBehind {
                    val w = 3.dp.toPx()
                    drawRoundRect(theme.accent.copy(alpha = 0.55f), size = Size(w, size.height), cornerRadius = androidx.compose.ui.geometry.CornerRadius(w / 2))
                }
                .padding(start = 13.dp),
            verticalArrangement = Arrangement.spacedBy(theme.blockGap * 0.6f),
        ) { for (b in block.blocks) MdBlockView(b, theme, depth + 1, theme.muted) }
        MdBlock.Rule -> Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).height(1.dp).background(theme.line))
        is MdBlock.CodeBlock -> Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(theme.codeFill)
                .horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Text(
                block.code,
                style = theme.style.copy(fontFamily = FontFamily.Monospace, fontSize = if (theme.style.fontSize.isSpecified) theme.style.fontSize * 0.9f else 14.sp),
                color = color,
                softWrap = false,
            )
        }
        is MdBlock.Table -> MdTable(block, theme)
    }
}

private val BULLETS = listOf("•", "◦", "▪")

@Composable
private fun MdList(block: MdBlock.ListBlock, theme: MdTheme, depth: Int, color: Color) {
    val digits = (block.start + block.items.size - 1).toString().length
    val markerWidth = if (block.ordered) theme.fontSizeDp * (0.62f * (digits + 1) + 0.3f) else theme.fontSizeDp * 1.15f
    Column(verticalArrangement = Arrangement.spacedBy(theme.blockGap * 0.45f)) {
        block.items.forEachIndexed { i, item ->
            Row(Modifier.fillMaxWidth()) {
                val (marker, markerColor) = when {
                    item.checked == true -> "☑" to theme.accent
                    item.checked == false -> "☐" to theme.muted
                    block.ordered -> "${block.start + i}." to color
                    else -> BULLETS[depth % BULLETS.size] to theme.muted
                }
                Text(marker, style = theme.style, color = markerColor, modifier = Modifier.widthIn(min = markerWidth))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(theme.blockGap * 0.45f)) {
                    for (b in item.blocks) MdBlockView(b, theme, depth + 1, color)
                }
            }
        }
    }
}

// ---------------------------------------------------------------- tables

/** Columns up to this wide never wrap (hanzi, pinyin, short glosses). */
private val TABLE_KEEP_WHOLE = 140.dp
/** When the table scrolls anyway, a long column is at most this wide (then it wraps). */
private val TABLE_MAX_COLUMN = 220.dp

/**
 * Column widths for a table: fits the [available] width when that doesn't squeeze any column
 * below [keepWhole] (or its own natural width), filling spare room like the web's `width: 100%`;
 * otherwise each column gets up to [maxColumn] and the table scrolls sideways.
 * [natural] = each column's widest cell on one line.
 */
internal fun tableColumnWidths(natural: List<Int>, available: Int, keepWhole: Int, maxColumn: Int): List<Int> {
    if (natural.isEmpty()) return natural
    val total = natural.sum()
    if (total <= available) {
        val extra = available - total
        val widths = natural.map { it + (if (total > 0) (extra.toLong() * it / total).toInt() else extra / natural.size) }
        return widths.toMutableList().also { it[it.lastIndex] += available - widths.sum() }
    }
    val floor = natural.map { minOf(it, keepWhole) }
    val floorSum = floor.sum()
    if (floorSum >= available) return natural.mapIndexed { i, n -> maxOf(floor[i], minOf(n, maxColumn)) }
    val room = available - floorSum
    val growable = total - floorSum
    val widths = natural.mapIndexed { i, n -> floor[i] + ((n - floor[i]).toLong() * room / growable).toInt() }
    return widths.toMutableList().also { it[it.lastIndex] += available - widths.sum() }
}

@Composable
private fun MdTable(table: MdBlock.Table, theme: MdTheme) {
    val cols = table.header.size
    val rows = listOf(table.header) + table.rows
    val texts = remember(table, theme) { rows.map { r -> r.map { inlineText(it, theme) } } }
    val scroll = rememberScrollState()
    val shape = RoundedCornerShape(10.dp)
    val density = LocalDensity.current
    val keepWhole = with(density) { TABLE_KEEP_WHOLE.roundToPx() }
    val maxColumn = with(density) { TABLE_MAX_COLUMN.roundToPx() }
    val fade = theme.color.copy(alpha = 0.16f) // "there's more →" edge while it can scroll
    // The scroll container hands its content an unbounded width, so the viewport is read here,
    // just outside it, during the same measure pass.
    val viewport = remember { IntArray(1) }
    Box(
        Modifier.fillMaxWidth()
            .layout { m, c ->
                viewport[0] = if (c.hasBoundedWidth) c.maxWidth else 0
                val p = m.measure(c)
                layout(p.width, p.height) { p.place(0, 0) }
            }
            .clip(shape).border(1.dp, theme.line, shape)
            .drawWithContent {
                drawContent()
                if (scroll.canScrollForward) {
                    val w = 20.dp.toPx()
                    drawRect(Brush.horizontalGradient(listOf(Color.Transparent, fade), startX = size.width - w, endX = size.width), topLeft = Offset(size.width - w, 0f), size = Size(w, size.height))
                }
            }
            .horizontalScroll(scroll),
    ) {
        Layout(
            content = {
                rows.forEachIndexed { r, row ->
                    for (c in 0 until cols) {
                        val fill = when {
                            r == 0 -> theme.headerFill
                            r % 2 == 0 -> theme.stripeFill
                            else -> Color.Transparent
                        }
                        val lastCol = c == cols - 1
                        val lastRow = r == rows.lastIndex
                        Box(
                            Modifier.background(fill)
                                .drawBehind {
                                    val px = 1.dp.toPx()
                                    if (!lastCol) drawRect(theme.line, topLeft = Offset(size.width - px, 0f), size = Size(px, size.height))
                                    if (!lastRow) drawRect(theme.line, topLeft = Offset(0f, size.height - px), size = Size(size.width, px))
                                }
                                .padding(horizontal = 10.dp, vertical = 7.dp),
                            contentAlignment = when (table.align.getOrElse(c) { MdAlign.Start }) {
                                MdAlign.Start -> Alignment.CenterStart
                                MdAlign.Center -> Alignment.Center
                                MdAlign.End -> Alignment.CenterEnd
                            },
                        ) {
                            Text(
                                texts[r].getOrElse(c) { AnnotatedString("") },
                                style = theme.style.copy(
                                    fontWeight = if (r == 0) FontWeight.SemiBold else theme.style.fontWeight,
                                    textAlign = when (table.align.getOrElse(c) { MdAlign.Start }) {
                                        MdAlign.Start -> TextAlign.Start
                                        MdAlign.Center -> TextAlign.Center
                                        MdAlign.End -> TextAlign.End
                                    },
                                ),
                                color = theme.color,
                            )
                        }
                    }
                }
            },
        ) { measurables, constraints ->
            val available = if (constraints.hasBoundedWidth) constraints.maxWidth else viewport[0]
            val natural = (0 until cols).map { c -> (rows.indices).maxOf { r -> measurables[r * cols + c].maxIntrinsicWidth(Constraints.Infinity) } }
            val widths = tableColumnWidths(natural, available, keepWhole, maxColumn)
            val heights = rows.indices.map { r -> (0 until cols).maxOf { c -> measurables[r * cols + c].minIntrinsicHeight(widths[c]) } }
            val placeables = measurables.mapIndexed { i, m -> m.measure(Constraints.fixed(widths[i % cols], heights[i / cols])) }
            val width = widths.sum()
            val height = heights.sum()
            layout(width, height) {
                var y = 0
                for (r in rows.indices) {
                    var x = 0
                    for (c in 0 until cols) {
                        placeables[r * cols + c].placeRelative(x, y)
                        x += widths[c]
                    }
                    y += heights[r]
                }
            }
        }
    }
}
