package dev.jeromeswannack.chineselearning.lab.ui.cards

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.api.CardFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.QuestionDto
import dev.jeromeswannack.chineselearning.lab.ui.decks.DeckStats
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

data class CardHubActions(
    val onBack: () -> Unit = {},
    val onPlay: () -> Unit = {},
    val onEdit: () -> Unit = {},
    val onOpenDeck: (String) -> Unit = {},
    val onRetry: () -> Unit = {},
    val onSendFlag: (HubTutor, String, onSent: () -> Unit) -> Unit = { _, _, _ -> },
    val onFlagAction: (CardFlagDto, CardHubViewModel.FlagAction) -> Unit = { _, _ -> },
    val onPlayRecording: (String) -> Unit = {},
    val onAllChats: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
)

/** The card hub (web: CardHubPage.tsx, the student's own card). */
@Composable
fun CardHubScreen(ui: CardHubUi, actions: CardHubActions, nowMs: Long = System.currentTimeMillis()) {
    val note = ui.note
    LabScreen(
        title = note?.hanzi ?: "Card",
        subtitle = note?.deckName?.let { "‹ $it" },
        onBack = actions.onBack,
        actions = { if (note != null) Text("✎ Edit", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = actions.onEdit).padding(12.dp)) },
    ) {
        if (!ui.loaded) {
            item { LoadingState() }
            return@LabScreen
        }
        if (note == null) {
            item {
                if (ui.loadable.offline) EmptyState("📴", "You're offline", body = "This card isn't on this phone yet.", actionLabel = "Try again", onAction = actions.onRetry)
                else EmptyState("😕", "Card not found", body = ui.loadable.error ?: "It may have been deleted.", actionLabel = "Back", onAction = actions.onBack)
            }
            return@LabScreen
        }
        ui.notice?.let { n -> item { InlineNotice(n, kind = if (ui.noticeIsError) NoticeKind.Error else NoticeKind.Success, actionLabel = "OK", onAction = actions.onDismissNotice) } }
        if (!ui.fromServer && ui.loadable.offline) item { OfflineNotice() }
        else if (!ui.fromServer && ui.loadable.error != null) item { InlineNotice(ui.loadable.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRetry) }
        else if (ui.loadable.offline) item { OfflineNotice(updatedAt = ui.loadable.updatedAt, nowMs = nowMs) }

        item { NoteBox(note, actions) }

        item { SectionHeader("Your cards") }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (c in ui.cards) CardStateTile(c, nowMs, Modifier.weight(1f))
            }
        }

        item { SectionHeader("🚩 Flags" + if (ui.flags.isNotEmpty()) " (${ui.flags.size})" else "") }
        if (!ui.fromServer) {
            item { Muted("Flags load when you're online.") }
        } else if (ui.flags.isEmpty()) {
            item { Muted("You have not flagged this card for your tutor.") }
        } else {
            for (f in ui.flags) item(key = "flag-${f.id}") { FlagRow(f, nowMs, actions) }
        }
        if (ui.tutors.isNotEmpty()) item { FlagForm(ui, actions) }

        item { SectionHeader("💬 Asked Claude" + ui.threads.sumOf { it.size }.let { if (it > 0) " (${plural(it, "question")})" else "" }) }
        if (!ui.fromServer) {
            item { Muted("Conversations load when you're online.") }
        } else if (ui.threads.isEmpty()) {
            item { Muted("You have not asked Claude about this card yet. Use Ask Claude on the card during study.") }
        } else {
            for ((i, t) in ui.threads.withIndex()) item(key = "thread-$i") { ThreadCard(t, nowMs) }
        }
        item {
            Text("All conversations with Claude ›", color = Lab.colors.accent, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = actions.onAllChats).padding(vertical = 10.dp, horizontal = 4.dp))
        }

        item { SectionHeader("Recent reviews" + if (ui.reviewCount > 0) " (${ui.reviewCount})" else "") }
        if (ui.reviews.isEmpty()) {
            item { Muted("Not reviewed yet.") }
        } else {
            item {
                LabCard {
                    for (r in ui.reviews) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            RatingChip(r.rating)
                            Spacer(Modifier.width(8.dp))
                            Text(DeckStats.SHORT[r.card_type] ?: r.card_type, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                            Spacer(Modifier.width(8.dp))
                            val answer = r.user_answer
                            Text(
                                if (!answer.isNullOrEmpty() && r.card_type != CardTypes.HANZI_TO_MEANING) answer else "",
                                color = if (answer == note.hanzi) Palette.Good else Lab.colors.ink,
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                            )
                            r.recording_url?.let { key -> Text("🎤▶", color = Lab.colors.accent, modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { actions.onPlayRecording(key) }.padding(8.dp)) }
                            Text(relativeDay(r.reviewed_at, nowMs), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                        }
                    }
                }
            }
            if (ui.reviewCount > ui.reviews.size) item { Muted("Showing the last ${ui.reviews.size} of ${ui.reviewCount}.") }
        }
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)

@Composable
private fun NoteBox(n: HubNoteUi, actions: CardHubActions) {
    LabCard {
        Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(n.hanzi, fontSize = 44.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
            Text(n.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
            Text(n.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, textAlign = TextAlign.Center)
            if (!n.sentenceClue.isNullOrEmpty()) {
                Spacer(Modifier.height(8.dp))
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(12.dp)) {
                    Text(n.sentenceClue, fontSize = 18.sp, color = Lab.colors.ink)
                    n.sentenceCluePinyin?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.accent) }
                    n.sentenceClueTranslation?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
                }
            }
            if (!n.funFacts.isNullOrEmpty()) {
                Spacer(Modifier.height(8.dp))
                MarkdownText(n.funFacts, Modifier.fillMaxWidth())
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                PrimaryPill("▶ Play", Modifier.height(48.dp)) { actions.onPlay() }
                SecondaryPill("Open deck ›") { actions.onOpenDeck(n.deckId) }
            }
        }
    }
}

@Composable
private fun CardStateTile(c: HubCardDto, nowMs: Long, modifier: Modifier = Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(DeckStats.SHORT[c.card_type] ?: c.card_type, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        Text(queueLabel(c.queue), fontWeight = FontWeight.SemiBold, color = queueColor(c.queue))
        Text(nextReview(c, nowMs), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
        if (c.lapses > 0) Text("${c.lapses} lapse${if (c.lapses == 1) "" else "s"}", style = MaterialTheme.typography.labelSmall, color = Palette.Again)
    }
}

@Composable
private fun FlagRow(f: CardFlagDto, nowMs: Long, actions: CardHubActions) {
    LabCard {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(if (f.status == "open") "open" else "resolved", if (f.status == "open") Palette.Hard else Palette.Good)
                Spacer(Modifier.width(8.dp))
                Text(relativeDay(f.created_at, nowMs) + (f.tutor_name?.let { " · to $it" } ?: ""), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.weight(1f))
            }
            Text(f.message, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
            f.tutor_reply?.let { reply ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.accentSoft).padding(10.dp)) {
                    Text("${f.tutor_name ?: "Tutor"} replied", style = MaterialTheme.typography.labelSmall, color = Lab.colors.accent)
                    Text(reply, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LabChip(if (f.status == "open") "Mark resolved" else "Reopen") {
                    actions.onFlagAction(f, if (f.status == "open") CardHubViewModel.FlagAction.RESOLVE else CardHubViewModel.FlagAction.REOPEN)
                }
                LabChip("Delete") { actions.onFlagAction(f, CardHubViewModel.FlagAction.DELETE) }
            }
        }
    }
}

@Composable
private fun FlagForm(ui: CardHubUi, actions: CardHubActions) {
    var open by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var tutorIdx by remember { mutableStateOf(0) }
    val tutor = ui.tutors.getOrElse(tutorIdx) { ui.tutors.first() }
    if (!open) {
        SecondaryPill("🚩 Flag this card for ${if (ui.tutors.size > 1) "a tutor" else tutor.name}") { open = true }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Field("What's confusing about this card?", message, lines = 3) { message = it.take(2000) }
        if (ui.tutors.size > 1) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ui.tutors.forEachIndexed { i, t -> LabChip(t.name, selected = i == tutorIdx) { tutorIdx = i } }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryPill("Cancel", Modifier.weight(1f), enabled = !ui.flagBusy) { open = false }
            PrimaryPill(if (ui.flagBusy) "Sending…" else "Send to ${tutor.name}", Modifier.weight(1.4f).height(52.dp), enabled = !ui.flagBusy && message.isNotBlank()) {
                actions.onSendFlag(tutor, message) { message = ""; open = false }
            }
        }
    }
}

@Composable
private fun ThreadCard(thread: List<QuestionDto>, nowMs: Long) {
    var expanded by remember { mutableStateOf(true) }
    LabCard {
        Column(Modifier.clickable { expanded = !expanded }.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(relativeDay(thread.first().asked_at, nowMs) + " · " + plural(thread.size, "question"), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            if (!expanded) {
                Text(thread.first().question, color = Lab.colors.ink, maxLines = 1)
                return@Column
            }
            for (q in thread) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                    Text(q.question, color = androidx.compose.ui.graphics.Color.White, modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(Lab.colors.accent).padding(horizontal = 12.dp, vertical = 8.dp))
                }
                MarkdownText(q.answer, Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(12.dp))
            }
        }
    }
}

@Composable
private fun RatingChip(rating: Int) {
    val (label, color) = when (rating) {
        0 -> "Again" to Palette.Again
        1 -> "Hard" to Palette.Hard
        2 -> "Good" to Palette.Good
        else -> "Easy" to Palette.Easy
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(9.dp).clip(CircleShape).background(color))
        Text(" $label", style = MaterialTheme.typography.labelMedium, color = Lab.colors.ink, modifier = Modifier.width(44.dp))
    }
}

/** The hub's queue label (CardHubPage `queueLabel`). */
fun queueLabel(queue: Int): String = when (queue) {
    0 -> "New"
    2 -> "Review"
    else -> "Learning"
}

private fun queueColor(queue: Int) = when (queue) {
    0 -> Palette.New
    2 -> Palette.Good
    else -> Palette.Hard
}

/** CardHubPage `nextReview`: "not started" / "due now" / "due tomorrow" / "due in N days". */
fun nextReview(c: HubCardDto, nowMs: Long): String {
    val next = c.next_review_at
    if (c.queue == 0 || next == null) return "not started"
    val t = runCatching { Js.parseDate(next) }.getOrNull() ?: return "not started"
    val days = Js.round((t - nowMs) / 86_400_000.0).toLong()
    return when {
        days <= 0 -> "due now"
        days == 1L -> "due tomorrow"
        else -> "due in $days days"
    }
}

/** components/tutor/format.ts `relativeDay`: today / yesterday / N days ago / "Sep 12". */
fun relativeDay(iso: String?, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): String {
    if (iso.isNullOrEmpty()) return "never"
    val fixed = if (iso.endsWith("Z") || iso.contains('+')) iso else CardHubViewModel.sqliteToIso(iso)
    val t = runCatching { Js.parseDate(fixed) }.getOrNull() ?: return iso
    val then = Instant.ofEpochMilli(t).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
    val days = ChronoUnit.DAYS.between(then, today)
    return when {
        days <= 0 -> "today"
        days == 1L -> "yesterday"
        days < 14 -> "$days days ago"
        else -> then.format(DateTimeFormatter.ofPattern("MMM d", Locale.US))
    }
}

fun plural(n: Int, word: String, pluralWord: String = "${word}s") = "$n ${if (n == 1) word else pluralWord}"
