package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** The little Markdown fun_facts use: **bold**, `- ` bullets, line breaks. */
fun markdownLite(src: String): AnnotatedString = buildAnnotatedString {
    val lines = src.trim().lines()
    lines.forEachIndexed { i, raw ->
        var line = raw.trimEnd()
        val bullet = Regex("^\\s*[-*•]\\s+").find(line)
        if (bullet != null) {
            append("•  ")
            line = line.substring(bullet.range.last + 1)
        }
        line = line.removePrefix("### ").removePrefix("## ").removePrefix("# ")
        var rest = line
        while (true) {
            val start = rest.indexOf("**")
            val end = if (start >= 0) rest.indexOf("**", start + 2) else -1
            if (start < 0 || end < 0) { append(rest); break }
            append(rest.substring(0, start))
            val boldStart = length
            append(rest.substring(start + 2, end))
            addStyle(SpanStyle(fontWeight = FontWeight.SemiBold), boldStart, length)
            rest = rest.substring(end + 2)
        }
        if (i < lines.size - 1) append('\n')
    }
}

/** [markdownLite] as a Text: fun facts, Claude answers, tutor notes. */
@Composable
fun MarkdownText(
    src: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    color: Color = Lab.colors.ink,
) {
    Text(markdownLite(src), modifier = modifier, style = style, color = color)
}
