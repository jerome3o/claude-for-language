package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.DayCard
import dev.jeromeswannack.chineselearning.lab.core.DayCards
import dev.jeromeswannack.chineselearning.lab.core.Progress
import dev.jeromeswannack.chineselearning.lab.data.progress.CardDay
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

val CARD_TYPE_LABELS = mapOf(
    "hanzi_to_meaning" to "Hanzi → Meaning",
    "meaning_to_hanzi" to "Meaning → Hanzi",
    "audio_to_hanzi" to "Audio → Hanzi",
)

val RATING_LABELS = listOf("Again", "Hard", "Good", "Easy")

fun ratingColor(r: Int): Color = when (r) {
    0 -> Palette.Again
    1 -> Palette.Hard
    2 -> Palette.Good
    else -> Palette.Easy
}

/** `/progress/day/:date` — the cards reviewed that day, most difficult first (web: MyDayDetailPage). */
@Composable
fun DayScreen(date: String, day: DayCards?, onBack: () -> Unit, openCard: (String) -> Unit) {
    LabScreen(title = shortDate(date), onBack = onBack, subtitle = day?.summary?.let {
        "${it.totalReviews} reviews • ${it.uniqueCards} cards • ${it.accuracy}% • ${Progress.formatStudyTime(it.timeSpentMs)}"
    }) {
        when {
            day == null -> item { LoadingState() }
            day.cards.isEmpty() -> item { EmptyState("📚", "No cards", body = "No cards were reviewed on this day") }
            else -> {
                item { SectionHeader("Cards reviewed · most difficult first") }
                item {
                    LabCard {
                        day.cards.forEachIndexed { i, c ->
                            if (i > 0) RowDivider()
                            DayCardRow(c) { openCard(c.card.cardId) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCardRow(c: DayCard, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).bouncyClickable(pressedScale = 0.985f, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(c.card.hanzi, fontSize = 24.sp, color = Lab.colors.ink)
            Text(c.card.pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.accent)
            Text(c.card.english, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1)
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            StatusPill(CARD_TYPE_LABELS[c.card.cardType] ?: c.card.cardType, Lab.colors.muted)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${c.reviewCount} review${if (c.reviewCount != 1) "s" else ""}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                Spacer(Modifier.width(6.dp))
                // The last five ratings: green for Good / Easy, red for Again / Hard.
                c.ratings.takeLast(5).forEach { r -> Text("●", color = if (r >= 2) Palette.Good else Palette.Again, fontSize = 12.sp) }
            }
            if (c.hasAnswers) Text("📝", fontSize = 13.sp)
        }
        Spacer(Modifier.width(8.dp))
        Text("›", color = Lab.colors.muted, fontSize = 22.sp)
    }
}

class CardDayActions(
    val onBack: () -> Unit = {},
    val playWord: () -> Unit = {},
    val playRecording: (String) -> Unit = {},
)

/** `/progress/day/:date/card/:cardId` — each review of one card that day (web: MyCardReviewDetailPage). */
@Composable
fun CardDayScreen(
    date: String,
    state: CardDayState,
    /** Recording per review id, from the server when online (the phone keeps none). */
    recordings: Map<String, String>,
    playing: String?,
    actions: CardDayActions,
    zone: ZoneId = ZoneId.systemDefault(),
) {
    LabScreen(title = "Card", subtitle = fullDate(date).substringAfter(", "), onBack = actions.onBack) {
        when (state) {
            CardDayState.Loading -> item { LoadingState() }
            CardDayState.Missing -> item { EmptyState("🗑️", "This card isn't on this phone", body = "It may have been deleted.") }
            is CardDayState.Loaded -> {
                val d = state.day
                item { CardInfo(d, playing != null && playing == (d.audioUrl ?: "tts:${d.card.hanzi}"), actions) }
                item { SectionHeader("Reviews on this day (${d.reviews.size})") }
                items(d.reviews.size) { i ->
                    val r = d.reviews[i]
                    LabCard {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(timeOfDay(r.reviewedAt, zone), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    RATING_LABELS.getOrElse(r.rating) { "Rating ${r.rating}" },
                                    color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.clip(RoundedCornerShape(50)).background(ratingColor(r.rating)).padding(horizontal = 10.dp, vertical = 3.dp),
                                )
                                Spacer(Modifier.weight(1f))
                                Text(duration(r.timeSpentMs), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                            }
                            if (!r.userAnswer.isNullOrEmpty()) {
                                val right = r.userAnswer == d.card.hanzi
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Answer: ", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                                    Text(r.userAnswer, fontSize = 20.sp, color = Lab.colors.ink)
                                    Spacer(Modifier.width(8.dp))
                                    Text(if (right) "✓" else "✗", color = if (right) Palette.Good else Palette.Again, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                                }
                            }
                            recordings[r.id]?.let { url ->
                                SecondaryPill(if (playing == url) "⏹ Stop" else "▶ Play recording") { actions.playRecording(url) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CardInfo(d: CardDay, playing: Boolean, actions: CardDayActions) {
    LabCard {
        Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(d.card.hanzi, fontSize = 44.sp, color = Lab.colors.ink)
            Text(d.card.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
            Text(d.card.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted)
            Spacer(Modifier.width(0.dp).heightIn(min = 8.dp))
            SecondaryPill(if (playing) "⏹ Stop" else "▶ Play audio", onClick = actions.playWord)
            Text("Card type: ${CARD_TYPE_LABELS[d.card.cardType] ?: d.card.cardType}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

/** "3:05 PM" in the phone's time zone. */
fun timeOfDay(iso: String, zone: ZoneId): String =
    runCatching { DateTimeFormatter.ofPattern("h:mm a", Locale.US).format(Instant.ofEpochMilli(dev.jeromeswannack.chineselearning.lab.core.Js.parseDate(iso)).atZone(zone)) }.getOrDefault(iso)

/** The web's formatDuration: "-", "12 sec", "1m 5s". */
fun duration(ms: Long?): String {
    if (ms == null || ms == 0L) return "-"
    val seconds = dev.jeromeswannack.chineselearning.lab.core.Js.roundToLong(ms / 1000.0)
    if (seconds < 60) return "$seconds sec"
    return "${seconds / 60}m ${seconds % 60}s"
}

/** "Sunday, Sep 20" — fits the title row on a folded phone (the year is rarely in doubt here). */
fun shortDate(date: String): String =
    runCatching { java.time.LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.US)) }.getOrDefault(date)
