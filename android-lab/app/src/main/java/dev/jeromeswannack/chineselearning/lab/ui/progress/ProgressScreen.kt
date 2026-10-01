package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Progress
import dev.jeromeswannack.chineselearning.lab.core.ProgressDay
import dev.jeromeswannack.chineselearning.lab.core.StudyStreak
import dev.jeromeswannack.chineselearning.lab.data.progress.DeckProgressRow
import dev.jeromeswannack.chineselearning.lab.data.progress.ProgressSnapshot
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

class ProgressActions(
    val openDay: (String) -> Unit = {},
    val openDeck: (String) -> Unit = {},
    val study: () -> Unit = {},
    /** A light tick when a bar is picked. */
    val onPick: () -> Unit = {},
)

/**
 * The Progress tab (web: pages/MyProgressPage.tsx + the Home streak card + the deck page's
 * mastery block), from the phone's own review events — so it works on the train. Jerome's
 * question it answers at a glance: am I making good progress? Characters & words known (with
 * their history), streak and the 30-day heatmap,
 * cards mastered, a reviews-a-day chart, % through each deck, then the web's 30-day summary
 * and daily list (tap a day → the cards of that day).
 */
@Composable
fun ProgressScreen(
    ui: ProgressUi,
    actions: ProgressActions,
    initialSelected: Int? = null,
    zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
    knownScrub: Int? = null,
    knownExplain: Boolean = false,
) {
    val snap = ui.snapshot
    LabScreen(title = "Progress") {
        when {
            !ui.loaded || snap == null -> item { LoadingState() }
            snap.totalReviews == 0 && snap.overall.counts.total == 0 -> item {
                EmptyState("📅", "No activity yet", body = "Start studying to see your progress here", actionLabel = "Study", onAction = actions.study)
            }
            else -> {
                item { KnownCard(ui.known, zone, actions.onPick, initialScrub = knownScrub, initialExplain = knownExplain) }
                item {
                    BoxWithConstraints {
                        if (maxWidth >= 600.dp) {
                            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                StreakCard(snap.streak, Modifier.weight(1f).fillMaxHeight())
                                MasteryCard(snap, Modifier.weight(1f).fillMaxHeight())
                            }
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                StreakCard(snap.streak)
                                MasteryCard(snap)
                            }
                        }
                    }
                }
                item { SummaryTiles(snap) }
                item { ReviewsCard(ui, actions, initialSelected) }
                if (snap.decks.isNotEmpty()) {
                    item { SectionHeader("Your decks") }
                    item { DecksCard(snap.decks, actions) }
                }
                item { SectionHeader("Daily Activity") }
                if (snap.daily.days.isEmpty()) {
                    item { EmptyState("📅", "No activity yet", body = "Start studying to see your progress here") }
                } else {
                    item {
                        LabCard {
                            snap.daily.days.forEachIndexed { i, d ->
                                if (i > 0) RowDivider()
                                DayRow(d, ui, actions)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StreakCard(streak: StudyStreak, modifier: Modifier = Modifier) {
    LabCard(modifier) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🔥", fontSize = 30.sp)
                Spacer(Modifier.width(8.dp))
                CountUpText(streak.streak, MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.Bold), Lab.colors.ink)
                Spacer(Modifier.width(6.dp))
                Text(if (streak.streak == 1) "day" else "days", style = MaterialTheme.typography.titleMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 10.dp))
                Spacer(Modifier.weight(1f))
                if (streak.today.reviews > 0) {
                    Column(horizontalAlignment = Alignment.End) {
                        Text("Today", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                        Text(
                            buildString {
                                append("${streak.today.reviews} reviews · ${streak.today.accuracy}%")
                                if (streak.today.timeMs > 0) append(" · ${Progress.formatStreakTime(streak.today.timeMs)}")
                            },
                            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                        )
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            StreakHeatmap(streak.heatmap, streak.maxCount)
            Spacer(Modifier.height(6.dp))
            Row {
                Text("30 days ago", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                Spacer(Modifier.weight(1f))
                Text("Today", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            }
        }
    }
}

@Composable
private fun MasteryCard(snap: ProgressSnapshot, modifier: Modifier = Modifier) {
    val c = snap.overall.completion
    val counts = snap.overall.counts
    LabCard(modifier) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            MasteryRing(counts) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CountUpText(counts.mastered, MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold), Lab.colors.ink)
                    Text("mastered", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                }
            }
            Spacer(Modifier.width(18.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${c.percentMastered}% mastered", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Text("${c.percentSeen}% seen · ${"%,d".format(c.totalCards)} cards", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                Spacer(Modifier.height(2.dp))
                LegendRow(MasteryColors.Mastered, "Mastered", counts.mastered)
                LegendRow(MasteryColors.Familiar, "Familiar", counts.familiar)
                LegendRow(MasteryColors.Learning, "Learning", counts.learning)
                LegendRow(MasteryColors.New, "New", counts.new)
            }
        }
    }
}

@Composable
private fun LegendRow(color: Color, label: String, n: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.weight(1f))
        Text("%,d".format(n), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
    }
}

@Composable
private fun SummaryTiles(snap: ProgressSnapshot) {
    val s = snap.daily.summary
    Column {
        SectionHeader("30-Day Summary")
        Spacer(Modifier.height(6.dp))
        BoxWithConstraints {
            val tiles: List<@Composable (Modifier) -> Unit> = listOf(
                { m -> StatTile("Reviews", m) { CountUpText(s.totalReviews30d, tileStyle(), Lab.colors.ink) } },
                { m -> StatTile("Days Active", m) { CountUpText(s.totalDaysActive, tileStyle(), Lab.colors.ink) } },
                { m -> StatTile("Accuracy", m) { CountUpText(s.averageAccuracy, tileStyle(), accuracyColor(s.averageAccuracy)) { "$it%" } } },
                { m -> StatTile("Study Time", m) { Text(Progress.formatStudyTime(s.totalTimeMs), style = tileStyle(), color = Lab.colors.ink, maxLines = 1) } },
            )
            if (maxWidth >= 560.dp) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { tiles.forEach { it(Modifier.weight(1f)) } }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { tiles[0](Modifier.weight(1f)); tiles[1](Modifier.weight(1f)) }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { tiles[2](Modifier.weight(1f)); tiles[3](Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun tileStyle() = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold)

private fun accuracyColor(pct: Int): Color = when {
    pct >= 85 -> Palette.Good
    pct >= 70 -> Palette.Hard
    else -> Palette.Again
}

@Composable
private fun StatTile(label: String, modifier: Modifier = Modifier, value: @Composable () -> Unit) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).padding(horizontal = 16.dp, vertical = 14.dp)) {
        value()
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
    }
}

@Composable
private fun ReviewsCard(ui: ProgressUi, actions: ProgressActions, initialSelected: Int?) {
    var selected by rememberSaveable { mutableStateOf(initialSelected) }
    val bars = ui.bars
    LabCard {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Reviews a day", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                Box(Modifier.size(8.dp).clip(CircleShape).background(Palette.Good))
                Text(" right  ", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                Box(Modifier.size(8.dp).clip(CircleShape).background(Palette.Again.copy(alpha = 0.75f)))
                Text(" again / hard", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            }
            Spacer(Modifier.height(12.dp))
            ReviewsBarChart(bars, selected, onSelect = { i -> selected = if (selected == i) null else i; actions.onPick() })
            Spacer(Modifier.height(6.dp))
            Row {
                bars.forEachIndexed { i, b ->
                    Text(
                        if (i % 7 == 2 || i == bars.lastIndex) b.label else "",
                        style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, maxLines = 1, softWrap = false,
                        modifier = Modifier.weight(1f).wrapContentWidth(Alignment.CenterHorizontally, unbounded = true),
                    )
                }
            }
            val pick = selected?.let { bars.getOrNull(it) }
            AnimatedContent(pick, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "pick") { b ->
                if (b == null) {
                    val week = bars.takeLast(7).sumOf { it.reviews }
                    Text(
                        "$week reviews in the last 7 days · tap a bar for the day",
                        style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 10.dp),
                    )
                } else {
                    val (day, full) = dayLabel(b.date, ui.today)
                    Row(
                        Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint)
                            .then(if (b.reviews > 0) Modifier.clickable { actions.openDay(b.date) } else Modifier)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("$day ($full)", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (b.reviews == 0) "no reviews" else "${b.reviews} reviews",
                            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.weight(1f),
                        )
                        if (b.reviews > 0) Text("›", color = Lab.colors.muted, fontSize = 20.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun DecksCard(decks: List<DeckProgressRow>, actions: ProgressActions) {
    LabCard {
        decks.forEachIndexed { i, d ->
            if (i > 0) RowDivider()
            Column(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable { actions.openDeck(d.id) }.padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(d.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Text("${d.completion.percentMastered}%", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = if (d.completion.percentMastered > 0) MasteryColors.Mastered else Lab.colors.muted)
                }
                MasteryBar(d.counts)
                Text(
                    "${d.completion.cardsMastered} mastered · ${d.completion.cardsSeen} seen · ${d.completion.totalCards} cards",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                )
            }
        }
    }
}

@Composable
private fun DayRow(d: ProgressDay, ui: ProgressUi, actions: ProgressActions) {
    val (day, full) = dayLabel(d.date, ui.today)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).bouncyClickable(pressedScale = 0.985f) { actions.openDay(d.date) }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(day, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Spacer(Modifier.width(6.dp))
                Text("($full)", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
            Text(
                "${d.reviewsCount} reviews • ${d.uniqueCards} cards • ${d.accuracy}% • ${Progress.formatStudyTime(d.timeSpentMs)}",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            )
        }
        AccuracyDot(d.accuracy)
        Spacer(Modifier.width(8.dp))
        Text("›", color = Lab.colors.muted, fontSize = 22.sp)
    }
}

@Composable
private fun AccuracyDot(pct: Int) {
    Box(Modifier.size(10.dp).clip(CircleShape).background(accuracyColor(pct)))
}
