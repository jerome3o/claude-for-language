package dev.jeromeswannack.chineselearning.lab.ui.checks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardCheck
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** The amber of a possible issue (the web's `.check-issue` warning tint). */
val CheckAmber = Color(0xFFB7791F)

/** "Tones: yin hang → yínháng" with the current value struck through. */
@Composable
fun CheckChangeLine(label: String?, current: String, proposed: String, modifier: Modifier = Modifier) {
    Text(
        buildAnnotatedString {
            if (label != null) withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)) { append("$label: ") }
            withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough, color = Lab.colors.muted)) { append(current.ifEmpty { "(empty)" }) }
            withStyle(SpanStyle(color = Lab.colors.muted)) { append("  →  ") }
            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)) { append(proposed) }
        },
        style = MaterialTheme.typography.bodyMedium,
        modifier = modifier,
    )
}

/**
 * "⚠ Possible issue" on a word (deck page row, Paste-a-list preview row): the kind, current →
 * proposed, the reason, Apply fix / Dismiss. Online only — [enabled] false greys the buttons.
 */
@Composable
fun CheckIssueBlock(
    kind: String,
    current: String,
    proposed: String,
    reason: String,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    enabled: Boolean = true,
    error: String? = null,
    onApply: () -> Unit,
    onDismiss: () -> Unit,
) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(CheckAmber.copy(alpha = 0.10f))
            .border(1.dp, CheckAmber.copy(alpha = 0.45f), shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("⚠ Possible issue", style = MaterialTheme.typography.labelLarge, color = CheckAmber, fontWeight = FontWeight.SemiBold)
        CheckChangeLine(CardCheck.checkKindLabel(kind), current, proposed)
        if (reason.isNotBlank()) Text(reason, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryPill(if (busy) "Applying…" else "Apply fix", Modifier.weight(1f).height(44.dp), enabled = enabled && !busy, color = CheckAmber) { onApply() }
            SecondaryPill("Dismiss", Modifier.weight(1f), enabled = enabled && !busy) { onDismiss() }
        }
    }
}
