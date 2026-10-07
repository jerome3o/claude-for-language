package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.TextUnit
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorableSegments
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSegmentInput
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * `<ExplorableText>` (docs/LANGUAGE_EXPLORER.md "Explorable text"): Chinese where every word —
 * or, without word [segments] that line up with the text, every character — can be tapped to
 * explore it (core ExplorableSegments, parity-tested). Inside the explorer a tap pushes another
 * view; elsewhere it opens a fresh stack from [source] (with [context], e.g. the card's hanzi).
 * With no explorer in reach (previews) it is plain text. [sentenceOf] gives a word the sentence
 * it sits in (UTF-16 offsets into [text]); by default the whole text.
 */
@Composable
fun ExplorableText(
    text: String,
    source: String,
    modifier: Modifier = Modifier,
    segments: List<WordSegmentInput>? = null,
    sentenceOf: ((start: Int, end: Int) -> String)? = { _, _ -> text },
    context: String? = null,
    style: TextStyle = LocalTextStyle.current,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontWeight: FontWeight? = null,
    color: Color = Lab.colors.ink,
    textAlign: TextAlign? = null,
    lineHeight: TextUnit = TextUnit.Unspecified,
    /** The tapped pieces are tinted (the word view's own lines); off on the card, where the text is the answer. */
    tint: Boolean = false,
    /** Highlight every occurrence of this word (the explored word in its context sentences). */
    highlight: String? = null,
) {
    val tap = rememberExplorerTap(source, context)
    val pieces = remember(text, segments) { ExplorableSegments.explorableSegments(text, segments, sentenceOf) }
    val linkColor = if (tint) Lab.colors.accent else color
    val highlightColor = Lab.colors.accent
    val annotated = remember(pieces, tap, linkColor, highlight) {
        buildAnnotatedString {
            for (p in pieces) {
                val item = p.item
                if (item == null || tap == null) append(p.text)
                else withLink(
                    LinkAnnotation.Clickable(
                        tag = explorerTag(item),
                        styles = if (tint && highlight.isNullOrEmpty()) TextLinkStyles(style = SpanStyle(color = linkColor)) else null,
                        linkInteractionListener = { tap(item) },
                    ),
                ) { append(p.text) }
            }
            // Every occurrence of the explored word, by position in the text (web ExplorableText `highlight`).
            if (!highlight.isNullOrEmpty()) {
                var at = text.indexOf(highlight)
                while (at >= 0) {
                    addStyle(SpanStyle(color = highlightColor, fontWeight = FontWeight.SemiBold), at, at + highlight.length)
                    at = text.indexOf(highlight, at + highlight.length)
                }
            }
        }
    }
    Text(
        annotated,
        modifier = modifier,
        style = style,
        fontSize = fontSize,
        fontWeight = fontWeight,
        color = color,
        textAlign = textAlign,
        lineHeight = lineHeight,
    )
}

private fun explorerTag(item: ExplorerItem) = when (item) {
    is ExplorerItem.Char -> "c:${item.char}"
    is ExplorerItem.Word -> "w:${item.hanzi}"
}
