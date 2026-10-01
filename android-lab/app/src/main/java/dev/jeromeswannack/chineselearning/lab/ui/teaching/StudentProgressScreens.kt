package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.CardDayDto
import dev.jeromeswannack.chineselearning.lab.data.api.DailyProgressDto
import dev.jeromeswannack.chineselearning.lab.data.api.DayCardsDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteProgressDto
import dev.jeromeswannack.chineselearning.lab.data.api.SharedDeckProgressDto
import dev.jeromeswannack.chineselearning.lab.data.api.TypeStatsDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import androidx.compose.foundation.lazy.LazyListScope

/** The progress pages' formatters (web: StudentProgressPage / DayDetailPage / CardReviewDetailPage). */
object ProgressFormat {
    /** "12 min", "1h 5m" — floor, as StudentProgressPage's formatTime. */
    fun time(ms: Long): String {
        val minutes = ms / 60000
        if (minutes < 60) return "$minutes min"
        val h = minutes / 60
        val m = minutes % 60
        return if (m > 0) "${h}h ${m}m" else "${h}h"
    }

    /** "8 sec", "1m 5s", "-" (CardReviewDetailPage formatDuration). */
    fun duration(ms: Long?): String {
        if (ms == null || ms == 0L) return "-"
        val s = Js.round(ms / 1000.0).toLong()
        return if (s < 60) "$s sec" else "${s / 60}m ${s % 60}s"
    }

    /** The day list's labels: ("Today" | "Yesterday" | "Tue", "Sep 15"). */
    fun dayLabels(date: String, today: LocalDate = LocalDate.now()): Pair<String, String> {
        val d = runCatching { LocalDate.parse(date) }.getOrNull() ?: return date to ""
        val full = DateTimeFormatter.ofPattern("MMM d", Locale.US).format(d)
        return when (d) {
            today -> "Today" to full
            today.minusDays(1) -> "Yesterday" to full
            else -> DateTimeFormatter.ofPattern("EEE", Locale.US).format(d) to full
        }
    }

    fun fullDate(date: String, weekday: Boolean = true): String = runCatching {
        DateTimeFormatter.ofPattern(if (weekday) "EEEE, MMMM d, yyyy" else "MMMM d, yyyy", Locale.US).format(LocalDate.parse(date))
    }.getOrDefault(date)

    fun pct(x: Double): String = "${Js.numberToString(x)}%"

    /** "Today" / "Yesterday" / "3 days ago" / "Sep 3" / "Never" (DeckProgress formatDate). */
    fun lastStudied(iso: String?, now: Instant = Instant.now()): String {
        if (iso == null) return "Never"
        val d = TeachingFormat.parse(iso) ?: return iso
        val days = Math.floorDiv(now.toEpochMilli() - d.toEpochMilli(), 86_400_000L)
        return when {
            days == 0L -> "Today"
            days == 1L -> "Yesterday"
            days < 7 -> "$days days ago"
            else -> DateTimeFormatter.ofPattern("MMM d", Locale.US).format(d.atZone(java.time.ZoneId.systemDefault()))
        }
    }

    /** DeckProgress formatTime: "< 1 min", "12 min", "1h 5m". */
    fun studyTime(ms: Long): String {
        if (ms <= 0) return "0 min"
        if (ms < 60000) return "< 1 min"
        val minutes = maxOf(1L, Js.round(ms / 60000.0).toLong())
        if (minutes < 60) return "$minutes min"
        val h = minutes / 60
        val m = minutes % 60
        return if (m > 0) "${h}h ${m}m" else "${h}h"
    }
}

private val RATING_COLORS = listOf(Palette.Again, Palette.Hard, Palette.Good, Palette.Easy)

@Composable
private fun StatGrid(tiles: List<Pair<String, String>>) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        tiles.forEach { (v, l) ->
            Column(Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(v, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink, maxLines = 1)
                Text(l, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            }
        }
    }
}

private fun <T> LazyListScope.loadable(state: Loadable<T>, retry: () -> Unit, body: LazyListScope.(T) -> Unit) {
    val d = state.data
    when {
        d != null -> {
            if (state.offline) item { OfflineNotice(updatedAt = state.updatedAt) }
            else if (state.error != null) item { InlineNotice(state.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = retry) }
            body(d)
        }
        state.loading -> item { LoadingState() }
        else -> item { InlineNotice(state.error ?: "This hasn't been downloaded to this phone yet.", kind = if (state.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = retry) }
    }
}

/** `/connections/:relId/progress` — 30-day summary + one row per active day (web: StudentProgressPage). */
@Composable
fun StudentProgressScreen(name: String, state: Loadable<DailyProgressDto>, back: () -> Unit, openDay: (String) -> Unit, retry: () -> Unit = {}, today: LocalDate = LocalDate.now()) {
    LabScreen("$name's Progress", onBack = back, subtitle = state.data?.student?.email) {
        loadable(state, retry) { p ->
            p.known?.let { k ->
                item {
                    val c = { d: dev.jeromeswannack.chineselearning.lab.data.api.KnownCountsDto -> dev.jeromeswannack.chineselearning.lab.core.KnownCounts(d.known, d.learning) }
                    dev.jeromeswannack.chineselearning.lab.ui.progress.KnownCard(
                        dev.jeromeswannack.chineselearning.lab.core.KnownProgress(c(k.characters), c(k.words), c(k.sentences), emptyList(), emptyList()),
                        java.time.ZoneId.systemDefault(),
                        subject = "they",
                    )
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TeachSectionTitle("30-Day Summary")
                    StatGrid(
                        listOf(
                            "${p.summary.total_reviews_30d}" to "Reviews",
                            "${p.summary.total_days_active}" to "Days Active",
                            ProgressFormat.pct(p.summary.average_accuracy) to "Accuracy",
                            ProgressFormat.time(p.summary.total_time_ms) to "Study Time",
                        ),
                    )
                }
            }
            item { TeachSectionTitle("Daily Activity") }
            if (p.days.isEmpty()) item { EmptyState("📅", "No activity yet", body = "Your student hasn't studied in the last 30 days") }
            p.days.forEach { day ->
                item(key = day.date) {
                    val (label, full) = ProgressFormat.dayLabels(day.date, today)
                    TeachCard(Modifier.bouncyClickable(pressedScale = 0.98f) { openDay(day.date) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(label, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                            Spacer(Modifier.width(6.dp))
                            MutedLine("($full)", Modifier.weight(1f))
                            Text("›", color = Lab.colors.muted, fontSize = 22.sp)
                        }
                        MutedLine("${day.reviews_count} reviews • ${day.unique_cards} cards • ${ProgressFormat.pct(day.accuracy)} • ${ProgressFormat.time(day.time_spent_ms)}")
                    }
                }
            }
        }
    }
}

@Composable
private fun Dots(ratings: List<Int>, colorFor: (Int) -> Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        ratings.forEach { r -> Box(Modifier.size(9.dp).clip(CircleShape).background(colorFor(r))) }
    }
}

/** `/connections/:relId/progress/day/:date` — cards reviewed that day, hardest first (web: DayDetailPage). */
@Composable
fun StudentDayScreen(date: String, state: Loadable<DayCardsDto>, back: () -> Unit, openCard: (String) -> Unit, retry: () -> Unit = {}) {
    val short = runCatching { DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US).format(LocalDate.parse(date)) }.getOrDefault(date)
    LabScreen(short, onBack = back, subtitle = ProgressFormat.fullDate(date)) {
        loadable(state, retry) { d ->
            item { MutedLine("${d.summary.total_reviews} reviews • ${d.summary.unique_cards} cards • ${ProgressFormat.pct(d.summary.accuracy)} • ${ProgressFormat.time(d.summary.time_spent_ms)}") }
            item { TeachSectionTitle("Cards Reviewed (most difficult first)") }
            if (d.cards.isEmpty()) item { EmptyState("📚", "No cards", body = "No cards were reviewed on this day") }
            d.cards.forEach { c ->
                item(key = c.card_id) {
                    TeachCard(Modifier.bouncyClickable(pressedScale = 0.98f) { openCard(c.card_id) }) {
                        WordHead(c.note.hanzi, c.note.pinyin, c.note.english) { Text("›", color = Lab.colors.muted, fontSize = 22.sp) }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CardTypeChip(c.card_type)
                            MutedLine("${c.review_count} review${if (c.review_count != 1) "s" else ""}")
                            Dots(c.ratings.takeLast(5)) { if (it >= 2) Palette.Good else Palette.Again }
                            if (c.has_answers) Text("📝", fontSize = 13.sp)
                            if (c.has_recordings) Text("🎤", fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}

/** `/connections/:relId/progress/day/:date/card/:cardId` — every review of one card that day (web: CardReviewDetailPage). */
@Composable
fun StudentCardDayScreen(date: String, state: Loadable<CardDayDto>, playing: String?, play: (String, String) -> Unit, back: () -> Unit, retry: () -> Unit = {}, now: Instant = Instant.now()) {
    LabScreen(state.data?.card?.note?.hanzi ?: "Card", onBack = back, subtitle = ProgressFormat.fullDate(date, weekday = false)) {
        loadable(state, retry) { d ->
            val n = d.card.note
            item {
                TeachCard {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(n.hanzi, fontSize = 40.sp, color = Lab.colors.ink)
                        Text(n.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
                        Text(n.english, color = Lab.colors.ink)
                        Spacer(Modifier.height(6.dp))
                        CardTypeChip(d.card.card_type)
                    }
                    if (n.audio_url != null) SecondaryPill(if (playing == n.audio_url) "⏹ Stop" else "▶ Play Audio", Modifier.fillMaxWidth()) { play(n.audio_url, n.hanzi) }
                }
            }
            item { TeachSectionTitle("Reviews on this day (${d.reviews.size})") }
            d.reviews.forEach { r ->
                item(key = r.id) {
                    TeachCard {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MutedLine(TeachingFormat.time(r.reviewed_at))
                            Text(
                                listOf("Again", "Hard", "Good", "Easy").getOrNull(r.rating) ?: "Rating ${r.rating}",
                                color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.clip(RoundedCornerShape(50)).background(RATING_COLORS.getOrElse(r.rating) { Color.Gray }).padding(horizontal = 9.dp, vertical = 3.dp),
                            )
                            MutedLine(ProgressFormat.duration(r.time_spent_ms))
                        }
                        r.user_answer?.let { a ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                MutedLine("Answer: ")
                                Text(a, fontSize = 18.sp, color = Lab.colors.ink)
                                Spacer(Modifier.width(6.dp))
                                Text(if (a == n.hanzi) "✓" else "✗", color = if (a == n.hanzi) Palette.Good else Palette.Again, fontWeight = FontWeight.Bold)
                            }
                        }
                        r.recording_url?.let { url -> RecordingButton(url, playing == url, { play(it, "") }) }
                    }
                }
            }
        }
    }
}

private val TYPE_ZH = listOf("hanzi_to_meaning" to "字→义", "meaning_to_hanzi" to "义→字", "audio_to_hanzi" to "听→字")
private val TYPE_EN = listOf("hanzi_to_meaning" to "Hanzi → Meaning", "meaning_to_hanzi" to "Meaning → Hanzi", "audio_to_hanzi" to "Audio → Hanzi")

/** A deck's progress in the student's account (web: SharedDeckProgressPage + components/DeckProgress). */
@Composable
fun SharedDeckProgressScreen(state: Loadable<SharedDeckProgressDto>, back: () -> Unit, retry: () -> Unit = {}, now: Instant = Instant.now()) {
    val p = state.data
    LabScreen(p?.deck_name ?: "Deck progress", onBack = back, subtitle = p?.student?.let { it.name ?: it.email }) {
        loadable(state, retry) { d ->
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TeachSectionTitle("Completion")
                    TeachCard {
                        val c = d.completion
                        val track = Lab.colors.faint
                        Canvas(Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(50))) {
                            drawRect(track)
                            drawRect(Palette.Good.copy(alpha = 0.35f), size = Size(size.width * c.percent_seen / 100f, size.height))
                            drawRect(Palette.Good, size = Size(size.width * c.percent_mastered / 100f, size.height))
                        }
                        StatGrid(listOf("${c.cards_seen}" to "Seen (${c.percent_seen}%)", "${c.cards_mastered}" to "Mastered (${c.percent_mastered}%)", "${c.total_cards}" to "Total Cards"))
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TeachSectionTitle("Progress by Card Type")
                    TeachCard {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            listOf("Mastered" to Palette.Good, "Familiar" to Palette.Easy, "Learning" to Palette.Hard, "New" to Lab.colors.faint).forEach { (l, col) ->
                                Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(10.dp).clip(CircleShape).background(col)); Text(" $l", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted) }
                            }
                        }
                        val b = d.card_type_breakdown
                        TYPE_EN.forEach { (k, label) ->
                            val s = when (k) { "hanzi_to_meaning" -> b.hanzi_to_meaning; "meaning_to_hanzi" -> b.meaning_to_hanzi; else -> b.audio_to_hanzi }
                            if (s.total > 0) TypeBar(label, s)
                        }
                    }
                }
            }
            item { TeachSectionTitle("All Words") }
            if (d.notes.isEmpty()) item { EmptyState("📚", "No words yet", body = "Add some vocabulary to get started.") }
            else item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    MutedLine("Reviews:")
                    listOf("Again", "Hard", "Good", "Easy").forEachIndexed { i, l -> Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(9.dp).clip(CircleShape).background(RATING_COLORS[i])); Text(" $l", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted) } }
                }
            }
            d.notes.forEach { n -> item(key = "n-${n.hanzi}") { NoteProgressRow(n) } }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TeachSectionTitle("Recent Activity")
                    TeachCard {
                        ActivityLine("Last Studied", ProgressFormat.lastStudied(d.activity.last_studied_at, now))
                        ActivityLine("Total Study Time", ProgressFormat.studyTime(d.activity.total_study_time_ms))
                        ActivityLine("Reviews (Last 7 Days)", "${d.activity.reviews_last_7_days}")
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityLine(label: String, value: String) {
    Row { Text(label, color = Lab.colors.muted, modifier = Modifier.weight(1f)); Text(value, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun TypeBar(label: String, s: TypeStatsDto) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink)
        val newColor = Lab.colors.faint
        Canvas(Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(50))) {
            var x = 0f
            listOf(s.mastered to Palette.Good, s.familiar to Palette.Easy, s.learning to Palette.Hard, s.new to newColor).forEach { (n, col) ->
                val w = size.width * n / s.total
                drawRect(col, topLeft = Offset(x, 0f), size = Size(w, size.height))
                x += w
            }
        }
        MutedLine("${s.mastered} · ${s.familiar} · ${s.learning} · ${s.new}")
    }
}

@Composable
private fun NoteProgressRow(n: NoteProgressDto) {
    TeachCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(n.hanzi, fontSize = 20.sp, color = Lab.colors.ink)
                    Spacer(Modifier.width(8.dp))
                    Text(n.pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(n.english, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            val r = n.recent_ratings
            if (r.hanzi_to_meaning.isEmpty() && r.meaning_to_hanzi.isEmpty() && r.audio_to_hanzi.isEmpty()) MutedLine("—")
            else Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.widthIn(min = 110.dp)) {
                TYPE_ZH.forEach { (k, zh) ->
                    val list = when (k) { "hanzi_to_meaning" -> r.hanzi_to_meaning; "meaning_to_hanzi" -> r.meaning_to_hanzi; else -> r.audio_to_hanzi }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(zh, fontSize = 11.sp, color = Lab.colors.muted, modifier = Modifier.width(38.dp))
                        Dots(list.reversed()) { RATING_COLORS.getOrElse(it) { Color.Gray } } // oldest left, newest right
                    }
                }
            }
            Spacer(Modifier.width(10.dp))
            Text("${n.mastery_percent}%", fontWeight = FontWeight.Bold, color = Lab.colors.ink, modifier = Modifier.heightIn(min = 24.dp))
        }
    }
}
