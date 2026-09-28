package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.CallBoard
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTranscript
import dev.jeromeswannack.chineselearning.lab.data.api.CallDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallReportWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionJobDto
import dev.jeromeswannack.chineselearning.lab.data.api.TranscriptSegmentDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.teaching.JobActions
import dev.jeromeswannack.chineselearning.lab.ui.teaching.SessionJobCard
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** A deck the words can go into. */
data class DeckChoice(val id: String, val name: String)

data class CardsResult(val deckId: String, val created: Int, val failed: Int)

/** The tutor's "Make homework from this lesson" section (web: CallHomeworkSection). */
data class CallHomeworkUi(
    val relId: String,
    val studentName: String,
    val jobs: List<SessionJobDto> = emptyList(),
    val starting: Boolean = false,
    val error: String? = null,
)

data class CallReviewUi(
    val callId: String,
    val detail: Loadable<CallDetailDto> = Loadable(loading = true),
    val myId: String? = null,
    /** This phone's recording parts still waiting to upload. */
    val pendingLocal: Int = 0,
    val decks: List<DeckChoice> = emptyList(),
    val homework: CallHomeworkUi? = null,
    val playingId: String? = null,
    val busy: Boolean = false,
    val notice: String? = null,
    val cardsBusy: Boolean = false,
    val cardsResult: CardsResult? = null,
    val cardsError: String? = null,
    val online: Boolean = true,
)

data class CallReviewActions(
    val onBack: () -> Unit = {},
    val onJoin: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onPlay: (TranscriptSegmentDto) -> Unit = {},
    val onMakeCards: (words: List<CallReportWordDto>, deckId: String?, deckName: String) -> Unit = { _, _, _ -> },
    val onOpenDeck: (String) -> Unit = {},
    val onReprocess: () -> Unit = {},
    val onDelete: () -> Unit = {},
    val onMakeHomework: () -> Unit = {},
    val jobs: JobActions = JobActions(),
    val onAllSessionNotes: (String) -> Unit = {},
)

/** `/calls/:id/review` — report, words → cards, homework (tutor), transcript, board, chat (web: CallReviewPage). */
@Composable
fun CallReviewScreen(ui: CallReviewUi, actions: CallReviewActions) {
    val q = ui.detail
    val d = q.data
    var showPinyin by rememberSaveable { mutableStateOf(true) }
    var showEnglish by rememberSaveable { mutableStateOf(true) }
    var confirmDelete by remember { mutableStateOf(false) }

    LabScreen(d?.let { CallsFormat.title(it, ui.myId) } ?: "Video call", onBack = actions.onBack) {
        if (d == null) {
            if (q.loading) item { LoadingState(text = "Loading…") }
            else item { InlineNotice(q.error ?: "Call not found.", kind = if (q.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
            return@LabScreen
        }
        val call = d.call
        val startMs = call.started_at ?: d.transcript.firstOrNull()?.start_ms ?: 0L
        val names = d.participants.associate { it.id to if (it.id == ui.myId) "You" else it.displayName }
        val busy = CallsFormat.isBusy(d)
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val dur = CallsFormat.durationText(d)
                Text(
                    CallsFormat.whenText(call.started_at ?: runCatching { dev.jeromeswannack.chineselearning.lab.core.Js.parseDate(call.created_at) }.getOrDefault(0L)) + if (dur.isNotEmpty()) " · $dur" else "",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                )
                Spacer(Modifier.width(8.dp))
                BetaBadge()
            }
        }
        if (q.offline) item { OfflineNotice(updatedAt = q.updatedAt) }
        else if (q.error != null) item { InlineNotice(q.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
        ui.notice?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }

        if (call.status == "live") item {
            Banner {
                Text("This call is live.", color = Lab.colors.ink, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                PrimaryPill("Join", Modifier.height(44.dp), onClick = actions.onJoin)
            }
        }
        if (ui.pendingLocal > 0) item {
            InlineNotice("Your recording is still uploading from this phone (${CallsFormat.plural(ui.pendingLocal, "part")} left).", kind = NoticeKind.Info)
        }
        if (call.status == "ended" && call.processing_status != "done") item {
            Banner(failed = call.processing_status == "failed") {
                if (busy) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent); Spacer(Modifier.width(10.dp)) }
                Column(Modifier.weight(1f)) {
                    Text(CallsFormat.STATUS_TEXT[call.processing_status] ?: call.processing_status, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                    call.processing_error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.Again) }
                }
            }
        }

        d.report?.let { report ->
            item { SectionHeader("Summary") }
            item {
                LabCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        MarkdownText(report.summary)
                        if (report.topics.isNotEmpty()) ChipRow { report.topics.forEach { LabChip(it) {} } }
                    }
                }
            }
            if (report.corrections.isNotEmpty()) {
                item { SectionHeader("Corrections") }
                item {
                    LabCard {
                        report.corrections.forEachIndexed { i, c ->
                            if (i > 0) RowDivider()
                            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(c.said, color = Lab.colors.muted, textDecoration = TextDecoration.LineThrough, fontSize = 17.sp)
                                Text("✓ ${c.better}", color = Palette.Good, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                                c.pinyin?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall) }
                                Text(c.explanation, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            }
            if (report.vocabulary.isNotEmpty()) {
                item { SectionHeader("Words from the lesson") }
                item { WordPicker(report.vocabulary, call.started_at, ui, actions) }
            }
            if (report.follow_ups.isNotEmpty()) {
                item { SectionHeader("Before next time") }
                item {
                    LabCard {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            report.follow_ups.forEach { f -> Row { Text("•  ", color = Lab.colors.accent); Text(f, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium) } }
                        }
                    }
                }
            }
        }

        ui.homework?.let { hw -> item { HomeworkSection(hw, ready = call.status == "ended" && !busy, online = ui.online, actions) } }

        item {
            SectionHeader("Transcript", trailing = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    LabChip("拼音", selected = showPinyin) { showPinyin = !showPinyin }
                    LabChip("EN", selected = showEnglish) { showEnglish = !showEnglish }
                }
            })
        }
        val turns = CallTranscript.groupTurns(d.transcript.map { SegmentRef(it) }).map { t -> t.map { it.seg } }
        if (turns.isEmpty()) item {
            Text(
                when { call.status == "live" -> "The transcript appears after the call."; busy -> "Working on it…"; else -> "No speech was transcribed for this call." },
                color = Lab.colors.muted, style = MaterialTheme.typography.bodyMedium,
            )
        } else {
            val pieces = d.pieces.associateBy { it.id }
            items(turns.size, key = { turns[it].first().id }) { i ->
                val turn = turns[i]
                val first = turn.first()
                val mine = first.user_id == ui.myId
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                        .background(if (mine) Lab.colors.accent.copy(alpha = 0.07f) else Lab.colors.card)
                        .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(names[first.user_id] ?: "Speaker", fontWeight = FontWeight.SemiBold, color = if (mine) Lab.colors.accent else Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.width(8.dp))
                        Text(CallTranscript.formatOffset(first.start_ms - startMs), color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
                    }
                    turn.forEach { seg ->
                        val py = if (showPinyin) CallsFormat.segPinyin(seg.text, seg.pinyin) else null
                        val canPlay = pieces[seg.piece_id]?.audio_url != null
                        Row(verticalAlignment = Alignment.Top) {
                            if (canPlay) {
                                val on = ui.playingId == seg.id
                                Text(
                                    if (on) "❚❚" else "▶",
                                    color = if (on) Lab.colors.card else Lab.colors.accent, fontSize = 13.sp,
                                    modifier = Modifier.size(34.dp).clip(CircleShape).background(if (on) Lab.colors.accent else Lab.colors.accent.copy(alpha = 0.1f))
                                        .bouncyClickable { actions.onPlay(seg) }.padding(top = 8.dp),
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                )
                                Spacer(Modifier.width(10.dp))
                            }
                            Column(Modifier.weight(1f)) {
                                Text(seg.text, color = Lab.colors.ink, fontSize = 18.sp)
                                py?.let { Text(it, color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall) }
                                if (showEnglish) seg.translation?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.ink.copy(alpha = 0.75f), style = MaterialTheme.typography.bodyMedium) }
                            }
                        }
                    }
                }
            }
        }
        val providers = d.pieces.mapNotNull { it.provider }.distinct()
        if (providers.isNotEmpty()) item {
            Text(
                "Transcribed with ${providers.joinToString(" + ") { CallsFormat.TRANSCRIBER_NAME[it] ?: it }} — speech recognition can mishear, especially mixed Chinese and English.",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            )
        }

        if (d.board_text.isNotBlank()) {
            item { SectionHeader("Board") }
            item {
                androidx.compose.material3.Text(
                    d.board_text.trim(), color = Lab.colors.ink, fontSize = 18.sp, lineHeight = 28.sp,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).padding(16.dp),
                )
            }
        }
        val board: List<BoardItem> = CallBoard.parseItems(d.board)
        if (board.isNotEmpty()) {
            item { SectionHeader("Drawing") }
            item { BoardSnapshot(board) }
        }
        if (d.chat.isNotEmpty()) {
            item { SectionHeader("Chat") }
            item {
                LabCard {
                    d.chat.forEachIndexed { i, m ->
                        if (i > 0) RowDivider()
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                            Row {
                                Text(names[m.user_id] ?: m.name, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, style = MaterialTheme.typography.bodySmall)
                                Spacer(Modifier.width(8.dp))
                                Text(CallTranscript.formatOffset(m.at - startMs), color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
                            }
                            Text(m.text, color = Lab.colors.ink, fontSize = 17.sp)
                        }
                    }
                }
            }
        }

        if (call.status == "ended") {
            val failed = d.pieces.filter { it.status == "failed" }
            if (failed.isNotEmpty()) item { InlineNotice("${CallsFormat.plural(failed.size, "part")} of the recording failed to transcribe: ${failed.first().error.orEmpty()}", kind = NoticeKind.Error) }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill(if (d.report != null) "Transcribe & summarise again" else "Process now", Modifier.fillMaxWidth().height(48.dp), enabled = !ui.busy && !busy && ui.online, onClick = actions.onReprocess)
                    if (call.created_by == ui.myId) SecondaryPill("Delete call", Modifier.fillMaxWidth().height(48.dp), enabled = !ui.busy && ui.online, danger = true) { confirmDelete = true }
                }
            }
        }
    }
    if (confirmDelete) ConfirmDialog(
        "Delete this call?", "Its recording and transcript are deleted too. This cannot be undone.", "Delete",
        onConfirm = { confirmDelete = false; actions.onDelete() }, onDismiss = { confirmDelete = false }, danger = true,
    )
}

private class SegmentRef(val seg: TranscriptSegmentDto) : CallTranscript.Segment {
    override val id get() = seg.id
    override val userId get() = seg.user_id
    override val startMs get() = seg.start_ms
    override val endMs get() = seg.end_ms
}

@Composable
private fun Banner(failed: Boolean = false, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
            .background(if (failed) Palette.Again.copy(alpha = 0.08f) else Lab.colors.accent.copy(alpha = 0.08f))
            .padding(horizontal = 16.dp, vertical = 12.dp).heightIn(min = 44.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Tick the words, pick a deck, "Add N cards" (web: WordPicker). */
@Composable
private fun WordPicker(words: List<CallReportWordDto>, startedAt: Long?, ui: CallReviewUi, actions: CallReviewActions) {
    val result = ui.cardsResult
    if (result != null) {
        Banner {
            Text(
                "✅ Added ${CallsFormat.plural(result.created, "word")}${if (result.failed > 0) " (${result.failed} skipped)" else ""}.",
                color = Lab.colors.ink, modifier = Modifier.weight(1f),
            )
            Text("Open the deck ›", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.bouncyClickable { actions.onOpenDeck(result.deckId) }.padding(8.dp))
        }
        return
    }
    var picked by rememberSaveable(words) { mutableStateOf(words.indices.toSet().toList()) }
    var deckId by rememberSaveable { mutableStateOf<String?>(null) }
    var chooseDeck by remember { mutableStateOf(false) }
    val defaultName = CallsFormat.defaultDeckName(startedAt)
    LabCard(Modifier.animateContentSize()) {
        words.forEachIndexed { i, w ->
            if (i > 0) RowDivider()
            val on = i in picked
            Row(
                Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.99f) { picked = if (on) picked - i else picked + i }.padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(on, onCheckedChange = { picked = if (on) picked - i else picked + i }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(w.hanzi, fontSize = 22.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.width(8.dp))
                        Text(w.pinyin, color = Lab.colors.muted, style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(w.english, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
                    w.from_call?.takeIf { it.isNotBlank() }?.let { Text("“$it”", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        RowDivider()
        NavRow("🗂️", ui.decks.firstOrNull { it.id == deckId }?.name ?: "New deck: $defaultName", desc = "Cards go to", onClick = { chooseDeck = true })
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryPill(
                if (ui.cardsBusy) "Adding…" else "Add ${CallsFormat.plural(picked.size, "card")}",
                Modifier.fillMaxWidth().height(52.dp),
                enabled = !ui.cardsBusy && picked.isNotEmpty() && ui.online,
            ) { actions.onMakeCards(words.filterIndexed { i, _ -> i in picked }, deckId, defaultName) }
            ui.cardsError?.let { InlineNotice(it, kind = NoticeKind.Error) }
        }
    }
    if (chooseDeck) LabBottomSheet(onDismiss = { chooseDeck = false }, title = "Cards go to") {
        NavRow("✨", "New deck: $defaultName", onClick = { deckId = null; chooseDeck = false })
        ui.decks.forEach { deck -> RowDivider(); NavRow("🗂️", deck.name, onClick = { deckId = deck.id; chooseDeck = false }) }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun HomeworkSection(hw: CallHomeworkUi, ready: Boolean, online: Boolean, actions: CallReviewActions) {
    val active = hw.jobs.any { it.active }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader("Homework")
        if (hw.jobs.isEmpty()) Text(
            "Turn this lesson into homework for ${hw.studentName}: the assistant reads the transcript, the whiteboard and the report, makes a deck of cards for what you taught (skipping words they already know) and a mini lesson when a grammar point was taught, and sends them to the student. Same as pasting notes on their page.",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
        )
        hw.jobs.forEach { SessionJobCard(it, actions.jobs) }
        hw.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        if (!active) {
            PrimaryPill(
                if (hw.starting) "Starting…" else if (hw.jobs.isNotEmpty()) "Make homework again" else "✨ Make homework from this lesson",
                Modifier.fillMaxWidth().height(52.dp),
                enabled = ready && !hw.starting && online,
                onClick = actions.onMakeHomework,
            )
            if (!ready) Text("Available once the call has ended and the recording is transcribed.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            if (hw.jobs.isNotEmpty()) Text("All session notes ›", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.bouncyClickable { actions.onAllSessionNotes(hw.relId) }.padding(vertical = 8.dp))
        }
    }
}
