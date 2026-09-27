package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** What the last tap on the counts did (the web's QueueCountsHeader `copyState`). */
enum class CountsCopy { COPIED, FAILED }

/**
 * The study top bar's `new + secondary + learning + review` (QueueCountsHeader.tsx): the
 * bucket the card on screen belongs to is pill-backed and underlined, the others step
 * back; tapping copies an image of the counts ([QueueCountsShare]) and reports it.
 */
@Composable
fun QueueCountsBar(counts: QueueCounts, active: CountBucket?, modifier: Modifier = Modifier, onCopied: (CountsCopy) -> Unit = {}) {
    val context = LocalContext.current
    Box(modifier, contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .clip(RoundedCornerShape(14.dp))
                .bouncyClickable(pressedScale = 0.94f) { onCopied(if (QueueCountsShare.copy(context, counts)) CountsCopy.COPIED else CountsCopy.FAILED) }
                .semantics { contentDescription = "Copy progress as image" }
                .padding(horizontal = 2.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CountNumber(counts.new, Palette.New, active, CountBucket.NEW)
            Plus()
            CountNumber(counts.secondaryNew, Palette.Secondary, active, CountBucket.SECONDARY)
            Plus()
            CountNumber(counts.learning, Palette.Learning, active, CountBucket.LEARNING)
            Plus()
            CountNumber(counts.review, Palette.Review, active, CountBucket.REVIEW)
        }
    }
}

@Composable
private fun Plus() = Text("+", color = Lab.colors.muted.copy(alpha = 0.6f), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 1.dp))

@Composable
private fun CountNumber(value: Int, color: Color, active: CountBucket?, bucket: CountBucket) {
    val isActive = active == bucket
    val shown by animateIntAsState(value, tween(300), label = "count")
    val alpha by animateFloatAsState(
        when {
            isActive -> 1f
            value == 0 -> 0.3f
            active != null -> 0.55f
            else -> 1f
        },
        tween(220), label = "countAlpha",
    )
    val bg by animateColorAsState(if (isActive) color.copy(alpha = 0.15f) else Color.Transparent, tween(220), label = "countBg")
    val scale by animateFloatAsState(if (isActive) 1.1f else 1f, spring(dampingRatio = 0.5f, stiffness = 500f), label = "countScale")
    val bar by animateDpAsState(if (isActive) 16.dp else 0.dp, spring(dampingRatio = 0.6f, stiffness = 500f), label = "countBar")
    Column(
        Modifier.scale(scale).clip(RoundedCornerShape(10.dp)).background(bg).padding(horizontal = 7.dp, vertical = 1.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("$shown", color = color.copy(alpha = alpha), fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Box(Modifier.width(bar).height(2.5.dp).clip(CircleShape).background(color))
    }
}

/** "Copied" under the counts, with Share for apps that don't paste images. */
@Composable
fun CountsCopiedChip(state: CountsCopy, onShare: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.clip(CircleShape).background(Color(0xE6111827)).padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(if (state == CountsCopy.COPIED) "📋 Copied as an image" else "Couldn't copy the image", color = Color.White, fontSize = 13.sp)
        Text(
            "Share",
            color = Color(0xFF93C5FD),
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            modifier = Modifier.clip(CircleShape).clickable(onClick = onShare).padding(horizontal = 10.dp, vertical = 8.dp),
        )
    }
}
