package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Test tag of [DoneForGoodButton] (web: data-testid="done-for-good"). */
const val DONE_FOR_GOOD_TAG = "done-for-good"

/**
 * "✓ Done for good · don't bring it back" — under the four rating buttons of a finished mini
 * lesson or graded reader (the web's RatingButtons `onDoneForGood`): finished (counts as Good
 * for the record) and never scheduled again (shared/study/revisit.ts). A quiet full-width
 * outline, so it never competes with the ratings.
 */
@Composable
fun DoneForGoodButton(enabled: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .testTag(DONE_FOR_GOOD_TAG)
            .bouncyClickable(enabled, 0.97f, onClick = onClick)
            .clip(shape)
            .border(1.dp, Lab.colors.cardBorder, shape)
            .alpha(if (enabled) 1f else 0.5f)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)) { append("✓ Done for good") }
                withStyle(SpanStyle(color = Lab.colors.muted)) { append(" · don't bring it back") }
            },
            fontSize = 15.sp,
        )
    }
}
