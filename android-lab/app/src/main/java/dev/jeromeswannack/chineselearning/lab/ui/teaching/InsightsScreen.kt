package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.GoingWellDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightsReportDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonLogEntryDto
import dev.jeromeswannack.chineselearning.lab.data.api.StrugglingDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.LocalDate

/** The range chips (web: RangeControl). */
enum class InsightsPreset(val label: String) { LESSON("Since last lesson"), D7("7d"), D14("14d"), D30("30d"), CUSTOM("Custom") }

data class InsightsRange(val preset: InsightsPreset = InsightsPreset.LESSON, val from: String? = null, val to: String? = null) {
    /** The query for this range (web: presetToQuery); "since last lesson" = no range, the server anchors it. */
    fun query(today: LocalDate = LocalDate.now()): Pair<String?, String?> = when (preset) {
        InsightsPreset.LESSON -> null to null
        InsightsPreset.D7 -> TutorPageFormat.daysAgo(7, today) to null
        InsightsPreset.D14 -> TutorPageFormat.daysAgo(14, today) to null
        InsightsPreset.D30 -> TutorPageFormat.daysAgo(30, today) to null
        InsightsPreset.CUSTOM -> (from ?: TutorPageFormat.daysAgo(14, today)) to (to ?: today.toString())
    }
}

data class InsightsUi(
    val relId: String,
    val studentName: String,
    val range: InsightsRange = InsightsRange(),
    val report: Loadable<InsightsReportDto> = Loadable(loading = true),
    val lessonLog: Loadable<List<LessonLogEntryDto>> = Loadable(loading = true),
    val summaries: List<StudentSummaryDto> = emptyList(),
    val latestSummary: StudentSummaryDto? = null,
    val writing: Boolean = false,
    val summaryError: String? = null,
    val lessonError: String? = null,
    val savingLesson: Boolean = false,
    val playingKey: String? = null,
)

data class InsightsActions(
    val back: () -> Unit = {},
    val open: (String) -> Unit = {},
    val setRange: (InsightsRange) -> Unit = {},
    val writeSummary: () -> Unit = {},
    val logLesson: (date: String, notes: String, done: () -> Unit) -> Unit = { _, _, d -> d() },
    val deleteLesson: (LessonLogEntryDto) -> Unit = {},
    val play: (String) -> Unit = {},
    val refresh: () -> Unit = {},
)

/**
 * Student Insights (web: pages/tutor/StudentInsightsPage.tsx): the range, stat tiles, needs
 * attention with every attempt, going well, also this period, Claude's summary (EN / 中文),
 * and the lesson log that anchors "since last lesson".
 */
@Composable
fun InsightsScreen(ui: InsightsUi, actions: InsightsActions, now: Instant = Instant.now()) {
    val hasLesson = !ui.lessonLog.data.isNullOrEmpty()
    // Before any lesson the server falls back to 14 days, so the chips say so.
    val effective = if (ui.range.preset == InsightsPreset.LESSON && ui.lessonLog.data != null && !hasLesson) ui.range.copy(preset = InsightsPreset.D14) else ui.range
    LabScreen("Insights", onBack = actions.back, subtitle = ui.studentName) {
        item { TutorPageTabs(ui.relId, "insights", actions.open) }
        item { RangeControl(effective, ui.lessonLog.data?.firstOrNull()?.lesson_at, ui.report.data?.range?.let { it.from to it.to }, actions.setRange, now) }
        val r = ui.report
        item {
            when {
                r.data != null && r.offline -> OfflineNotice(updatedAt = r.updatedAt)
                r.data != null && r.error != null -> InlineNotice(r.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.refresh)
                r.data == null && r.loading -> LoadingState(text = "Crunching the numbers...")
                r.data == null -> InlineNotice(r.error ?: "You're offline — these insights haven't been downloaded yet.", kind = if (r.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.refresh)
            }
        }
        r.data?.let { report ->
            item { StatTiles(report) }
            item { NeedsAttentionList(report.struggling, ui.playingKey, actions.play, now) }
            if (report.mix_ups.isNotEmpty()) item { MixUpsCard(report.mix_ups) }
            item { GoingWellList(report.going_well) }
            item { AlsoThisPeriod(report, now) }
            item { SummaryCard(ui, report.totals.reviews > 0, actions.writeSummary, now) }
        }
        item { LessonsCard(ui, actions, now) }
    }
}

@Composable
private fun RangeControl(sel: InsightsRange, latestLessonAt: String?, actual: Pair<String, String>?, onChange: (InsightsRange) -> Unit, now: Instant) {
    var picking by remember { mutableStateOf<String?>(null) }
    val today = LocalDate.now().toString()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ChipRow {
            InsightsPreset.entries.forEach { p ->
                val label = if (p == InsightsPreset.LESSON && latestLessonAt != null) "Since last lesson (${TutorPageFormat.day(latestLessonAt, now)})" else p.label
                LabChip(label, selected = sel.preset == p, enabled = p != InsightsPreset.LESSON || latestLessonAt != null) {
                    onChange(if (p == InsightsPreset.CUSTOM) InsightsRange(p, sel.from ?: TutorPageFormat.daysAgo(14), sel.to ?: today) else InsightsRange(p))
                }
            }
        }
        if (sel.preset == InsightsPreset.CUSTOM) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                InlineButton(sel.from?.let { dev.jeromeswannack.chineselearning.lab.core.HomeworkPlan.shortDay(it) } ?: "From") { picking = "from" }
                Text("to", color = Lab.colors.muted)
                InlineButton(sel.to?.let { dev.jeromeswannack.chineselearning.lab.core.HomeworkPlan.shortDay(it) } ?: "To") { picking = "to" }
            }
        }
        if (actual != null) MutedLine("Showing ${TutorPageFormat.dateTime(actual.first, now)} → ${TutorPageFormat.dateTime(actual.second, now)}")
    }
    when (picking) {
        "from" -> DatePickerSheet(sel.from ?: today, null, { picking = null; onChange(sel.copy(from = it)) }, { picking = null })
        "to" -> DatePickerSheet(sel.to ?: today, sel.from, { picking = null; onChange(sel.copy(to = minOf(it, today))) }, { picking = null })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StatTiles(report: InsightsReportDto) {
    val t = report.totals
    val from = TeachingFormat.parse(report.range.from)
    val to = TeachingFormat.parse(report.range.to)
    val days = if (from != null && to != null) maxOf(1L, dev.jeromeswannack.chineselearning.lab.core.Js.round((to.toEpochMilli() - from.toEpochMilli()) / 86_400_000.0).toLong()) else 1L
    val tiles = listOf(
        Triple("${t.reviews}", "Attempts", "${t.unique_notes} words"),
        Triple("${t.days_active}", "Days active", "of $days"),
        Triple(if (t.reviews > 0) "${Math.round(t.accuracy * 100)}%" else "–", "Accuracy", if (t.reviews > 0) "${Math.round(t.again_rate * 100)}% forgot" else ""),
        Triple(TutorPageFormat.duration(t.time_ms), "Study time", ""),
        Triple("${t.new_words_introduced}", "New words", "started"),
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 3) {
        tiles.forEach { (value, label, sub) ->
            Column(
                Modifier.weight(1f).widthIn(min = 96.dp).clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).padding(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(value, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.ink)
                if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NeedsAttentionList(items: List<StrugglingDto>, playing: String?, play: (String) -> Unit, now: Instant) {
    var open by remember { mutableStateOf<String?>(null) }
    var showAll by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Needs attention") { if (items.isNotEmpty()) MutedLine("${items.size} words") }
        if (items.isEmpty()) TeachCard { MutedLine("Nothing forgotten or mistyped in this period. 🎉") }
        (if (showAll) items else items.take(10)).forEach { s ->
            val isOpen = open == s.note.id
            TeachCard(Modifier.animateContentSize().bouncyClickable(pressedScale = 0.99f) { open = if (isOpen) null else s.note.id }) {
                WordHead(s.note.hanzi, s.note.pinyin, s.note.english) {
                    if (s.recordings_count > 0) TeachPill("🎤 ${s.recordings_count}", PillTone.Muted)
                    TeachPill(
                        when {
                            s.again_count > 0 -> "forgot ${s.again_count}/${s.attempts}"
                            s.hard_count > 0 -> "hard ${s.hard_count}/${s.attempts}"
                            else -> "${s.attempts} tries"
                        },
                        if (s.again_rate >= 0.5) PillTone.Flags else if (s.again_count > 0) PillTone.Struggling else PillTone.Muted,
                    )
                }
                if (s.wrong_answers.isNotEmpty() || s.forgot_count > 0) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        s.wrong_answers.forEach { a -> WrongChip(a) }
                        if (s.forgot_count > 0) Text("knew it, then forgot ×${s.forgot_count}", fontSize = 12.sp, color = Lab.colors.muted, modifier = Modifier.clip(RoundedCornerShape(50)).background(Lab.colors.faint).padding(horizontal = 8.dp, vertical = 3.dp))
                    }
                }
                if (isOpen) {
                    MutedLine((s.note.deck_name ?: "") + (s.avg_time_ms?.let { " · avg ${TutorPageFormat.seconds(it.toLong())} per attempt" } ?: ""))
                    s.events.forEach { ev -> AttemptLine(ev.reviewed_at, ev.card_type, ev.rating, ev.user_answer, s.note.hanzi, ev.time_spent_ms, ev.recording_url, playing, play, now) }
                }
            }
        }
        if (items.size > 10) SecondaryPill(if (showAll) "Show fewer" else "Show all ${items.size}", Modifier.fillMaxWidth()) { showAll = !showAll }
    }
}

@Composable
fun WrongChip(text: String) {
    Text(text, fontSize = 14.sp, color = Palette.Again, modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Again.copy(alpha = 0.1f)).padding(horizontal = 9.dp, vertical = 3.dp))
}

@Composable
fun WordHead(hanzi: String, pinyin: String, english: String, trailing: @Composable () -> Unit = {}) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(hanzi, fontSize = 24.sp, color = Lab.colors.ink)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(english, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) { trailing() }
    }
}

/** One attempt: when · card type · rating · typed-answer diff · seconds · ▶. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AttemptLine(at: String, cardType: String, rating: Int, answer: String?, hanzi: String, timeMs: Long?, recording: String?, playing: String?, play: (String) -> Unit, now: Instant) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.background).padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(TutorPageFormat.dateTime(at, now), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                CardTypeChip(cardType)
                RatingDot(rating, withLabel = true)
                val secs = TutorPageFormat.seconds(timeMs)
                if (secs.isNotEmpty()) Text(secs, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
            // A spoken attempt has no typed answer: the ▶ sits on the first line.
            if (answer.isNullOrBlank() && recording != null) RecordingButton(recording, playing == recording, play, compact = true)
        }
        if (!answer.isNullOrBlank()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { if (!answer.isNullOrBlank()) AnswerDiff(answer, hanzi) }
                if (recording != null) RecordingButton(recording, playing == recording, play, compact = true)
            }
        }
    }
}

@Composable
private fun GoingWellList(items: List<GoingWellDto>) {
    var showAll by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Going well") { if (items.isNotEmpty()) MutedLine("${items.size} words") }
        TeachCard {
            if (items.isEmpty()) MutedLine("No word has two or more correct attempts yet in this period.")
            (if (showAll) items else items.take(8)).forEach { g ->
                WordHead(g.note.hanzi, g.note.pinyin, g.note.english) {
                    TeachPill(if (g.reason == "consistent") "${g.attempts}/${g.attempts} right" else "due in ${g.max_interval_days}d", PillTone.Ok)
                }
            }
            if (items.size > 8) InlineButton(if (showAll) "Show fewer" else "Show all ${items.size}") { showAll = !showAll }
        }
    }
}

@Composable
private fun AlsoThisPeriod(report: InsightsReportDto, now: Instant) {
    val a = report.activity
    val recordings = report.recordings.size
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Also this period")
        TeachCard {
            if (a.lessons.isEmpty() && a.readers.isEmpty() && a.quests.isEmpty() && recordings == 0) MutedLine("No mini lessons, readers or quests completed.")
            if (recordings > 0) Text("🎤 $recordings pronunciation recording${if (recordings == 1) "" else "s"}", color = Lab.colors.ink)
            a.lessons.forEach { l -> ActivityRow("📘 Mini lesson: ${l.title}", l.rating, TutorPageFormat.day(l.completed_at, now)) }
            a.readers.forEach { r -> ActivityRow("📖 Reader: ${r.title_chinese} ${r.title_english}", r.rating, TutorPageFormat.day(r.reviewed_at, now)) }
            a.quests.forEach { q -> ActivityRow("🗺️ Quest: ${q.title}${q.best_moves?.let { " ($it moves)" } ?: ""}", null, TutorPageFormat.day(q.completed_at, now)) }
        }
    }
}

@Composable
private fun ActivityRow(text: String, rating: Int?, date: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(text, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        if (rating != null) RatingDot(rating, withLabel = true)
        Spacer(Modifier.width(8.dp))
        MutedLine(date)
    }
}

@Composable
private fun SummaryCard(ui: InsightsUi, hasActivity: Boolean, write: () -> Unit, now: Instant) {
    var zh by remember { mutableStateOf(false) }
    var showPrevious by remember { mutableStateOf(false) }
    val shown = ui.latestSummary ?: ui.summaries.firstOrNull()
    val previous = ui.summaries.filter { it.id != shown?.id }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Summary") { MutedLine("written by Claude from the numbers above") }
        TeachCard(Modifier.animateContentSize()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryPill(if (ui.writing) "Writing…" else if (shown != null) "Write a new summary" else "Write summary", Modifier.height(48.dp), enabled = !ui.writing && hasActivity, onClick = write)
                Spacer(Modifier.weight(1f))
                if (shown != null) {
                    LabChip("EN", selected = !zh) { zh = false }
                    LabChip("中文", selected = zh) { zh = true }
                }
            }
            if (ui.writing) MutedLine("Reading the period and writing notes — about ten seconds…")
            ui.summaryError?.let { InlineNotice(it, kind = NoticeKind.Error) }
            if (shown != null) {
                MarkdownText(if (zh) shown.narrative_zh else shown.narrative_en, style = MaterialTheme.typography.bodyLarge)
                MutedLine("Covers ${TutorPageFormat.day(shown.range_from, now)} → ${TutorPageFormat.day(shown.range_to, now)} · written ${TutorPageFormat.dateTime(shown.created_at, now)}")
            } else if (!ui.writing) {
                MutedLine("No summary yet. Tap Write summary for a short narrative in English and 中文 covering the selected period.")
            }
            if (previous.isNotEmpty()) {
                InlineButton("${if (showPrevious) "▾" else "▸"} Previous summaries (${previous.size})") { showPrevious = !showPrevious }
                if (showPrevious) previous.forEach { s ->
                    MutedLine("${TutorPageFormat.day(s.range_from, now)} → ${TutorPageFormat.day(s.range_to, now)} · ${TutorPageFormat.dateTime(s.created_at, now)}")
                    MarkdownText(if (zh) s.narrative_zh else s.narrative_en, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun LessonsCard(ui: InsightsUi, actions: InsightsActions, now: Instant) {
    var showForm by remember { mutableStateOf(false) }
    val today = LocalDate.now().toString()
    var date by remember { mutableStateOf(today) }
    var notes by remember { mutableStateOf("") }
    var picking by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<LessonLogEntryDto?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Lessons") { MutedLine("sets the \"since last lesson\" range") }
        TeachCard(Modifier.animateContentSize()) {
            if (!showForm) SecondaryPill("+ Log a lesson", Modifier.fillMaxWidth()) { showForm = true }
            else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Date", color = Lab.colors.muted)
                    Spacer(Modifier.width(10.dp))
                    InlineButton(TutorPageFormat.day(date, now)) { picking = true }
                }
                OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), minLines = 3, placeholder = {
                    Text("Notes for ${ui.studentName} (optional) — vocab covered, homework, things to practise. They appear in the student's Lesson Notes and feed the daily reader.")
                })
                ui.lessonError?.let { InlineNotice(it, kind = NoticeKind.Error) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TeachButton(if (ui.savingLesson) "Saving…" else "Save lesson", Modifier.weight(1f), primary = true, enabled = !ui.savingLesson) {
                        actions.logLesson(date, notes.trim()) { notes = ""; date = today; showForm = false }
                    }
                    TeachButton("Cancel", Modifier.weight(1f)) { showForm = false }
                }
            }
            val entries = ui.lessonLog.data
            when {
                entries == null -> MutedLine("Loading lessons...")
                entries.isEmpty() -> MutedLine("No lessons logged yet. Log one after each lesson so Insights defaults to \"since last lesson\".")
                else -> entries.forEach { e ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(TutorPageFormat.day(e.lesson_at, now), fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.widthIn(min = 72.dp))
                        Text(e.notes?.takeIf { it.isNotBlank() } ?: "No notes", style = MaterialTheme.typography.bodyMedium, color = if (e.notes.isNullOrBlank()) Lab.colors.muted else Lab.colors.ink, modifier = Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text("✕", color = Lab.colors.muted, modifier = Modifier.heightIn(min = 44.dp).bouncyClickable { confirmDelete = e }.padding(12.dp))
                    }
                }
            }
        }
    }
    if (picking) DatePickerSheet(date, null, { picking = false; date = minOf(it, today) }, { picking = false })
    confirmDelete?.let { e ->
        ConfirmDialog("Delete the lesson on ${TutorPageFormat.day(e.lesson_at, now)}?", "It stops anchoring \"since last lesson\".", "Delete", onConfirm = { actions.deleteLesson(e) }, onDismiss = { confirmDelete = null }, danger = true)
    }
}
