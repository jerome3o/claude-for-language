package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeQuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteHubDto
import dev.jeromeswannack.chineselearning.lab.data.api.TeachFlagDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant

/** "New" / "Learning" / "Review" (web: CardHubPage queueLabel). */
fun queueLabel(c: HubCardDto): String = when (c.queue) { 0 -> "New"; 2 -> "Review"; else -> "Learning" }

/** "not started" / "due now" / "due tomorrow" / "due in N days" (web: CardHubPage nextReview). */
fun nextReview(c: HubCardDto, nowMs: Long): String {
    if (c.queue == 0 || c.next_review_at == null) return "not started"
    val t = TeachingFormat.parse(c.next_review_at)?.toEpochMilli() ?: return "not started"
    val days = Js.round((t - nowMs) / 86_400_000.0).toLong()
    return when {
        days <= 0 -> "due now"
        days == 1L -> "due tomorrow"
        else -> "due in $days days"
    }
}

/** The hub's flags / questions in the tutor list shapes (they carry the card's words). */
fun hubFlags(hub: NoteHubDto): List<TeachFlagDto> = hub.flags.map { f ->
    TeachFlagDto(f.id, f.note_id, f.message, f.status, f.tutor_reply, f.replied_at, f.created_at, hub.note.hanzi, hub.note.pinyin, hub.note.english, hub.deck.name, f.student_name, f.tutor_name)
}

fun hubQuestions(hub: NoteHubDto): List<ClaudeQuestionDto> = hub.questions.map { q ->
    ClaudeQuestionDto(q.id, q.note_id, q.question, q.answer, q.asked_at, hub.note.hanzi, hub.note.pinyin, hub.note.english, hub.deck.name)
}

data class StudentHubUi(val relId: String, val studentName: String, val hub: Loadable<NoteHubDto> = Loadable(loading = true), val playingKey: String? = null)

data class StudentHubActions(
    val back: () -> Unit = {},
    val open: (String) -> Unit = {},
    val play: (url: String, text: String) -> Unit = { _, _ -> },
    val flags: FlagActions = FlagActions(),
    val retry: () -> Unit = {},
)

/**
 * The tutor's view of one of the student's cards (web: CardHubPage at
 * `/connections/:relId/cards/:noteId`): the note, how each card is going, the flags with the
 * reply box, every Ask-Claude conversation about it and the recent reviews. No editing.
 */
@Composable
fun StudentCardHubScreen(ui: StudentHubUi, actions: StudentHubActions, now: Instant = Instant.now()) {
    val hub = ui.hub.data
    LabScreen(hub?.note?.hanzi ?: "Card", onBack = actions.back, subtitle = "‹ ${ui.studentName}") {
        when {
            hub == null && ui.hub.loading -> item { LoadingState() }
            hub == null -> item { InlineNotice(ui.hub.error ?: "This card hasn't been downloaded to this phone yet.", kind = if (ui.hub.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.retry) }
            else -> {
                if (ui.hub.offline) item { OfflineNotice(updatedAt = ui.hub.updatedAt) }
                val n = hub.note
                item {
                    TeachCard {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(n.hanzi, fontSize = 44.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
                            Text(n.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
                            Text(n.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, textAlign = TextAlign.Center)
                        }
                        n.sentence_clue?.let { s ->
                            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.background).padding(10.dp)) {
                                Text(s, fontSize = 18.sp, color = Lab.colors.ink)
                                n.sentence_clue_pinyin?.let { MutedLine(it) }
                                n.sentence_clue_translation?.let { MutedLine(it) }
                            }
                        }
                        n.fun_facts?.let { MarkdownText(it, style = MaterialTheme.typography.bodyMedium) }
                        if (n.audio_url != null) {
                            SecondaryPill(if (ui.playingKey == n.audio_url) "⏹ Stop" else "▶ Play", Modifier.fillMaxWidth()) { actions.play(n.audio_url, n.hanzi) }
                        }
                        MutedLine("Deck: ${hub.deck.name}${hub.owner.name?.let { " · $it's copy" } ?: ""}")
                    }
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        TeachSectionTitle("How the cards are going")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            hub.cards.forEach { c ->
                                Column(Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(TutorPageFormat.CARD_TYPE_SHORT[c.card_type] ?: c.card_type, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                                    Text(queueLabel(c), fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                                    Text(nextReview(c, now.toEpochMilli()), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                                }
                            }
                        }
                    }
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        TeachSectionTitle("🚩 Flags" + if (hub.flags.isNotEmpty()) " (${hub.flags.size})" else "")
                        val flags = hubFlags(hub)
                        if (flags.isEmpty()) TeachCard { MutedLine("${ui.studentName} has not flagged this card.") }
                        flags.forEach { FlagRow(it, actions.flags, now, showCard = false) }
                    }
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        TeachSectionTitle("💬 Asked Claude" + if (hub.questions.isNotEmpty()) " (${TeachingFormat.plural(hub.questions.size, "question")})" else "")
                        val threads = groupQuestionThreads(hubQuestions(hub))
                        if (threads.isEmpty()) TeachCard { MutedLine("${ui.studentName} has not asked Claude about this card.") }
                        threads.forEach { ClaudeThreadRow(it, {}, now, initiallyOpen = true, showCard = false) }
                        InlineButton("All conversations with Claude ›") { actions.open(Routes.studentClaudeChats(ui.relId)) }
                    }
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        TeachSectionTitle("Recent reviews" + if (hub.review_count > 0) " (${hub.review_count})" else "")
                        if (hub.recent_reviews.isEmpty()) TeachCard { MutedLine("Not reviewed yet.") }
                        hub.recent_reviews.forEach { r ->
                            AttemptLine(r.reviewed_at, r.card_type, r.rating, r.user_answer?.takeIf { r.card_type != "hanzi_to_meaning" }, n.hanzi, r.time_spent_ms, r.recording_url, ui.playingKey, { actions.play(it, "") }, now)
                        }
                        if (hub.review_count > hub.recent_reviews.size) MutedLine("Showing the last ${hub.recent_reviews.size} of ${hub.review_count}.")
                    }
                }
            }
        }
    }
}

data class StudentChatsUi(
    val relId: String,
    val studentName: String,
    val questions: List<ClaudeQuestionDto>? = null,
    val total: Int = 0,
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
)

/** Every Ask-Claude conversation of the student, grouped per card (web: ClaudeChatsPage, tutor view). */
@Composable
fun StudentClaudeChatsScreen(ui: StudentChatsUi, back: () -> Unit, open: (String) -> Unit, loadMore: () -> Unit, now: Instant = Instant.now()) {
    val threads = groupQuestionThreads(ui.questions.orEmpty())
    LabScreen(
        "${ui.studentName} asked Claude", onBack = back,
        subtitle = if (ui.questions == null) null else "${TeachingFormat.plural(ui.total, "question")} · ${TeachingFormat.plural(threads.size, "conversation")}${if (ui.hasMore) " so far" else ""}",
    ) {
        when {
            ui.questions == null && ui.error != null -> item { InlineNotice(ui.error, kind = NoticeKind.Error) }
            ui.questions == null -> item { LoadingState() }
            threads.isEmpty() -> item { TeachCard { MutedLine("${ui.studentName} has not asked Claude about any card yet.") } }
            else -> threads.forEach { t -> item(key = t.id) { ClaudeThreadRow(t, { noteId -> open(Routes.studentCardHub(ui.relId, noteId)) }, now) } }
        }
        if (ui.hasMore) item { SecondaryPill(if (ui.loadingMore) "Loading…" else "Load older", Modifier.fillMaxWidth(), enabled = !ui.loadingMore, onClick = loadMore) }
    }
}
