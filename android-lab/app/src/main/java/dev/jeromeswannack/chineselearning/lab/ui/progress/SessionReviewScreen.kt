package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.StudySessionDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class SessionReviewActions(
    val onBack: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val playWord: (key: String?, hanzi: String) -> Unit = { _, _ -> },
    val playRecording: (String) -> Unit = {},
)

/** `/study/review/:id` — one server study session: stats, rating breakdown, every card (web: SessionReviewPage). */
@Composable
fun SessionReviewScreen(state: Loadable<StudySessionDto>, actions: SessionReviewActions, zone: ZoneId = ZoneId.systemDefault()) {
    LabScreen(title = "Session Review", onBack = actions.onBack, subtitle = state.data?.let { started(it.started_at, zone) }) {
        item {
            LoadableContent(state, onRetry = actions.onRetry) { s ->
                val reviews = s.reviews
                val total = reviews.sumOf { it.time_spent_ms ?: 0 }
                val avg = if (reviews.isNotEmpty()) total.toDouble() / reviews.size else 0.0
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Tile("${reviews.size}", "Cards Reviewed", Modifier.weight(1f))
                        Tile("${Js.roundToLong(avg / 1000)}s", "Avg. Time per Card", Modifier.weight(1f))
                        Tile("${Js.roundToLong(total / 1000.0 / 60)}m", "Total Time", Modifier.weight(1f))
                    }
                    LabCard {
                        Column(Modifier.padding(16.dp)) {
                            Text("Rating Breakdown", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
                            Spacer(Modifier.height(12.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                (0..3).forEach { r ->
                                    val n = reviews.count { it.rating == r }
                                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                                        Box(Modifier.fillMaxWidth().height(60.dp).clip(RoundedCornerShape(8.dp)).background(ratingColor(r).copy(alpha = 0.13f)).padding(4.dp), contentAlignment = Alignment.BottomCenter) {
                                            if (n > 0) Box(Modifier.fillMaxWidth().fillMaxHeight(minOf(1f, n.toFloat() / reviews.size)).clip(RoundedCornerShape(4.dp)).background(ratingColor(r)))
                                        }
                                        Text("$n ${RATING_LABELS[r]}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, modifier = Modifier.padding(top = 4.dp))
                                    }
                                }
                            }
                        }
                    }
                    SectionHeader("Cards Reviewed")
                    reviews.forEach { rv ->
                        LabCard {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.width(4.dp).height(48.dp).clip(RoundedCornerShape(2.dp)).background(ratingColor(rv.rating)))
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(rv.card.note.hanzi, fontSize = 22.sp, color = Lab.colors.ink)
                                        Spacer(Modifier.width(8.dp))
                                        Text("🔊", fontSize = 16.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { actions.playWord(rv.card.note.audio_url, rv.card.note.hanzi) }.padding(6.dp))
                                    }
                                    Text("${rv.card.note.pinyin} - ${rv.card.note.english}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                                    Text(
                                        buildString {
                                            append(CARD_TYPE_LABELS[rv.card.card_type] ?: rv.card.card_type)
                                            if (!rv.user_answer.isNullOrEmpty()) append(" | Your answer: ${rv.user_answer}")
                                            rv.time_spent_ms?.takeIf { it > 0 }?.let { append(" | ${Js.roundToLong(it / 1000.0)}s") }
                                        },
                                        style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted,
                                    )
                                    rv.recording_url?.let { url -> SecondaryPill("▶ Play Recording", Modifier.padding(top = 6.dp)) { actions.playRecording(url) } }
                                }
                                Text(
                                    RATING_LABELS.getOrElse(rv.rating) { "?" },
                                    color = ratingColor(rv.rating), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium,
                                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(ratingColor(rv.rating).copy(alpha = 0.13f)).padding(horizontal = 8.dp, vertical = 4.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Tile(value: String, label: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
        Text(label, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, maxLines = 2)
    }
}

private fun started(iso: String, zone: ZoneId): String =
    runCatching { DateTimeFormatter.ofPattern("MMM d, yyyy 'at' h:mm a", Locale.US).format(Instant.ofEpochMilli(Js.parseDate(iso)).atZone(zone)) }.getOrDefault(iso)
