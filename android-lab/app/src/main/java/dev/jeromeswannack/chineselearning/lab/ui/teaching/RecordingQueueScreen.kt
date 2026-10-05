package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import dev.jeromeswannack.chineselearning.lab.data.api.MixUpDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueCountsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.WeakCharDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant

// ---------------- pure rules (unit-tested in RecordingQueueLogicTest) ----------------

/**
 * "Needs your ear" (web: pages/tutor/RecordingsInboxPage.tsx; membership + labels come from the
 * server, shared/recordings/queue.ts). What is left here is presentation: the Expected / Heard
 * character marks, the copy, and the optimistic list change after a mark.
 */
object RecordingQueueRules {
    const val QUEUE = "queue"
    const val ALL = "all"

    /** Refresh every 10 s while recordings are still being checked, at most this many times. */
    const val CHECKING_POLL_MS = 10_000L
    const val CHECKING_MAX_POLLS = 30

    /**
     * The card's hanzi, each character with the kind it sounded off as (tone | sound | missing),
     * null when fine. Weak characters are matched in order, each used once; inserted extras
     * aren't in the reference, so they never mark it.
     */
    fun expectedMarks(hanzi: String, weak: List<WeakCharDto>): List<Pair<String, String?>> {
        val pending = weak.filter { it.kind != "extra" }.toMutableList()
        return LessonAnswers.chars(hanzi).map { ch ->
            val i = pending.indexOfFirst { it.char == ch }
            if (i < 0) ch to null else ch to pending.removeAt(i).kind
        }
    }

    /** What was heard, each character marked `true` when it matches the card (LCS, like diffHanzi). */
    fun heardMarks(hanzi: String, heard: String): List<Pair<String, Boolean>> =
        LessonAnswers.diffHanzi(heard, hanzi).typed.map { it.ch to it.hit }

    /** The Expected / Heard lines are worth showing: something was heard differently, or a character sounded off. */
    fun showExpected(item: RecordingQueueItemDto): Boolean {
        val c = item.check ?: return false
        return c.weak_chars.any { it.kind != "extra" } || showHeard(item)
    }

    fun showHeard(item: RecordingQueueItemDto): Boolean {
        val c = item.check ?: return false
        return c.transcript_match == false && !c.transcript.isNullOrBlank()
    }

    fun tabLabel(view: String, counts: RecordingQueueCountsDto?): String = when (view) {
        QUEUE -> "Needs your ear" + (counts?.let { " (${it.queue})" } ?: "")
        else -> "All recordings" + (counts?.let { " (${it.all})" } ?: "")
    }

    /** The empty state of the current view. */
    fun emptyText(view: String, counts: RecordingQueueCountsDto): String = when {
        counts.all == 0 -> "No recordings in this period. Recordings are made on the \"Hanzi → meaning\" card when the student taps the microphone."
        view == QUEUE -> "Nothing needs your ear 🎧 — ${TeachingFormat.plural(counts.all, "recording")} in this range sound${if (counts.all == 1) "s" else ""} fine."
        else -> "No recordings in this period."
    }

    fun checkingText(n: Int): String = "${TeachingFormat.plural(n, "recording")} still being checked…"

    const val NO_SCORING = "Pronunciation scoring isn't set up, so the queue goes by what was heard, the student's own rating and flags."

    /** Tone of a reason's label chip. */
    fun reasonTone(reason: String?): PillTone = when (reason) {
        "flagged" -> PillTone.Flags
        "rated_again", "rated_hard" -> PillTone.Muted
        else -> PillTone.Struggling
    }

    /** "买 ↔ 卖" */
    fun mixUpPair(m: MixUpDto): String = "${m.a} ↔ ${m.b}"

    /** "买东西 → 卖东西 · 买菜 → 卖菜" */
    fun mixUpWords(m: MixUpDto): String = m.examples.joinToString(" · ") { "${it.expected} → ${it.answer}" }

    /**
     * The list right after a mark, before the server answers: in the queue a marked recording
     * springs out; under All it keeps its place with the new mark. Either way it has left the
     * queue, so the queue count drops.
     */
    fun afterMark(dto: RecordingQueueDto, eventId: String, mark: dev.jeromeswannack.chineselearning.lab.data.api.RecordingMarkDto?): RecordingQueueDto {
        val item = dto.items.firstOrNull { it.event_id == eventId } ?: return dto
        val leaves = mark != null && item.in_queue
        val counts = if (leaves) dto.counts.copy(queue = (dto.counts.queue - 1).coerceAtLeast(0)) else dto.counts
        val items = if (dto.view == QUEUE && mark != null) dto.items.filterNot { it.event_id == eventId }
        else dto.items.map { if (it.event_id == eventId) it.copy(mark = mark, in_queue = if (mark != null) false else it.in_queue) else it }
        return dto.copy(items = items, counts = counts)
    }
}

// ---------------- the screen ----------------

data class RecordingQueueUi(
    val relId: String,
    val studentName: String,
    val view: String = RecordingQueueRules.QUEUE,
    val range: String = "30d",
    val data: RecordingQueueDto? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val offline: Boolean = false,
    val playingKey: String? = null,
    /** Event ids with a mark being saved. */
    val saving: Set<String> = emptySet(),
    val markError: String? = null,
)

data class RecordingQueueActions(
    val back: () -> Unit = {},
    val open: (String) -> Unit = {},
    val setView: (String) -> Unit = {},
    val setRange: (String) -> Unit = {},
    /** The student's take (R2 key). */
    val play: (String) -> Unit = {},
    /** The card's reference clip (R2 key, hanzi for the device-voice fallback). */
    val playReference: (String, String) -> Unit = { _, _ -> },
    /** status null = clear the mark. */
    val mark: (RecordingQueueItemDto, String?, String?) -> Unit = { _, _, _ -> },
    val retry: () -> Unit = {},
)

val RECORDING_RANGES = listOf("lesson" to "Since last lesson", "30d" to "Last 30 days", "90d" to "Last 90 days", "365d" to "Last year")

/** Recordings: "Needs your ear" (default) and "All recordings" (web: RecordingsInboxPage.tsx). */
@Composable
fun RecordingQueueScreen(ui: RecordingQueueUi, actions: RecordingQueueActions, now: Instant = Instant.now()) {
    var rangeSheet by remember { mutableStateOf(false) }
    val data = ui.data
    LabScreen("Recordings", onBack = actions.back, subtitle = ui.studentName, spacing = 10.dp) {
        item(key = "pages") { TutorPageTabs(ui.relId, "recordings", actions.open) }
        item(key = "views") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ViewTabs(ui.view, data?.counts, actions.setView)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MutedLine(data?.range?.takeIf { it.from.isNotEmpty() }?.let { "${TutorPageFormat.dateTime(it.from, now)} → ${TutorPageFormat.dateTime(it.to, now)}" } ?: "", Modifier.weight(1f))
                    LabChip(RECORDING_RANGES.first { it.first == ui.range }.second + " ▾") { rangeSheet = true }
                }
            }
        }
        if (data != null && data.counts.checking > 0) item(key = "checking") {
            Text("⏳ " + RecordingQueueRules.checkingText(data.counts.checking), style = MaterialTheme.typography.bodyMedium, color = Palette.Secondary, modifier = Modifier.testTag("recq-checking"))
        }
        if (data != null && !data.scoring) item(key = "noscoring") { MutedLine(RecordingQueueRules.NO_SCORING) }
        when {
            data == null && ui.loading -> item(key = "loading") { LoadingState(text = "Loading recordings...") }
            ui.error != null -> item(key = "error") { InlineNotice(ui.error, kind = if (ui.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.retry) }
            ui.offline && data != null -> item(key = "offline") { InlineNotice("You're offline — showing the recordings from your last visit.", kind = NoticeKind.Offline) }
        }
        ui.markError?.let { item(key = "markerror") { InlineNotice(it, kind = NoticeKind.Error) } }
        if (data != null && data.items.isEmpty()) item(key = "empty") {
            TeachCard(Modifier.testTag("recq-empty")) {
                Text(RecordingQueueRules.emptyText(ui.view, data.counts), style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                if (ui.view == RecordingQueueRules.QUEUE && data.counts.all > 0) {
                    Text("See all recordings →", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.heightIn(min = 44.dp).bouncyClickable { actions.setView(RecordingQueueRules.ALL) }.padding(vertical = 12.dp))
                }
            }
        }
        items(data?.items.orEmpty(), key = { it.event_id }) { r ->
            QueueCard(
                r, ui.view, ui.playingKey, r.event_id in ui.saving, actions, now,
                Modifier.animateItem(
                    fadeInSpec = null,
                    fadeOutSpec = tween(220),
                    placementSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow),
                ),
            )
        }
    }
    if (rangeSheet) {
        LabBottomSheet(onDismiss = { rangeSheet = false }, title = "Range") {
            RECORDING_RANGES.forEach { (k, label) -> NavRow(if (k == ui.range) "✓" else "", label, onClick = { rangeSheet = false; actions.setRange(k) }, trailing = {}) }
        }
    }
}

@Composable
private fun ViewTabs(view: String, counts: RecordingQueueCountsDto?, setView: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf(RecordingQueueRules.QUEUE, RecordingQueueRules.ALL).forEach { v ->
            val active = v == view
            Text(
                RecordingQueueRules.tabLabel(v, counts),
                color = if (active) Lab.colors.ink else Lab.colors.muted,
                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
                maxLines = 1,
                modifier = Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(11.dp))
                    .background(if (active) Lab.colors.card else Color.Transparent)
                    .bouncyClickable(enabled = !active, pressedScale = 0.96f) { setView(v) }
                    .padding(vertical = 12.dp)
                    .testTag("recq-tab-$v"),
            )
        }
    }
}

private val Grey = Color(0xFF9CA3AF)

private fun kindColor(kind: String?): Color = when (kind) {
    "tone" -> Palette.Hard
    "sound" -> Palette.Again
    "missing" -> Grey
    else -> Color.Unspecified
}

/** Expected 银行 with the weak characters coloured by kind (tone = amber + a small "tone", sound = red, missing = grey struck). */
fun expectedText(hanzi: String, weak: List<WeakCharDto>): AnnotatedString = buildAnnotatedString {
    for ((ch, kind) in RecordingQueueRules.expectedMarks(hanzi, weak)) {
        when (kind) {
            null -> append(ch)
            "missing" -> withStyle(SpanStyle(color = Grey, textDecoration = TextDecoration.LineThrough)) { append(ch) }
            else -> {
                withStyle(SpanStyle(color = kindColor(kind), fontWeight = FontWeight.Bold, background = kindColor(kind).copy(alpha = 0.13f))) { append(ch) }
                if (kind == "tone") withStyle(SpanStyle(color = Palette.Hard, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, baselineShift = BaselineShift.Superscript)) { append("tone") }
            }
        }
    }
}

/** Heard 音行 with the characters not in the card red. */
fun heardText(hanzi: String, heard: String): AnnotatedString = buildAnnotatedString {
    for ((ch, hit) in RecordingQueueRules.heardMarks(hanzi, heard)) {
        if (hit) append(ch) else withStyle(SpanStyle(color = Palette.Again, fontWeight = FontWeight.Bold, background = Palette.Again.copy(alpha = 0.12f))) { append(ch) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QueueCard(r: RecordingQueueItemDto, view: String, playingKey: String?, saving: Boolean, actions: RecordingQueueActions, now: Instant, modifier: Modifier) {
    var showComment by remember { mutableStateOf(false) }
    var comment by remember(r.mark?.comment) { mutableStateOf(r.mark?.comment ?: "") }
    val status = r.mark?.status
    val edge = when {
        view == RecordingQueueRules.QUEUE -> Color.Transparent
        status == null && r.in_queue -> Palette.Hard
        status == "needs_work" -> Palette.Hard
        else -> Color.Transparent
    }
    val c = r.check
    TeachCard(modifier.animateContentSize().border(2.dp, edge.copy(alpha = if (edge == Color.Transparent) 0f else 0.45f), RoundedCornerShape(20.dp)).testTag("recq-item-${r.event_id}")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(r.note.hanzi, fontSize = 32.sp, color = Lab.colors.ink, modifier = Modifier.widthIn(min = 56.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("${r.note.pinyin} · ${r.note.english}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                MutedLine(listOfNotNull(r.note.deck_name?.takeIf { it.isNotBlank() }, TutorPageFormat.dateTime(r.reviewed_at, now)).joinToString(" · "))
            }
            RatingDot(r.rating)
        }
        if (r.labels.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                r.labels.forEachIndexed { i, label -> TeachPill(label, RecordingQueueRules.reasonTone(r.reasons.getOrNull(i))) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AudioPill("Their recording", playingKey == r.recording_url, Palette.Secondary) { actions.play(r.recording_url) }
            r.note.audio_url?.let { ref -> AudioPill("Reference", playingKey == ref, Lab.colors.accent) { actions.playReference(ref, r.note.hanzi) } }
        }
        if (c != null && RecordingQueueRules.showExpected(r)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Expected", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.width(72.dp))
                    Text(expectedText(r.note.hanzi, c.weak_chars), fontSize = 22.sp, color = Lab.colors.ink)
                }
                if (RecordingQueueRules.showHeard(r)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Heard", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.width(72.dp))
                        Text(heardText(r.note.hanzi, c.transcript.orEmpty()), fontSize = 22.sp, color = Lab.colors.ink)
                    }
                }
            }
        }
        if (c?.score != null && "low_score" !in r.reasons) MutedLine("Pronunciation score ${Math.round(c.score)}")
        c?.score_note?.takeIf { it.isNotBlank() }?.let { MutedLine(it) }
        r.flag?.message?.takeIf { it.isNotBlank() }?.let { msg ->
            Text("🚩 “$msg”", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.Again.copy(alpha = 0.07f)).padding(10.dp))
        }
        if (!r.mark?.comment.isNullOrBlank() && !showComment) {
            Text(r.mark!!.comment!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.Hard.copy(alpha = 0.08f)).padding(10.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MarkButton("✓ Listened", status == "listened", Palette.Good, !saving, Modifier.weight(1f).testTag("recq-listened-${r.event_id}")) { actions.mark(r, if (status == "listened") null else "listened", r.mark?.comment) }
            MarkButton("⚠ Needs work", status == "needs_work", Palette.Hard, !saving, Modifier.weight(1.3f)) { actions.mark(r, if (status == "needs_work") null else "needs_work", r.mark?.comment) }
            MarkButton(if (!r.mark?.comment.isNullOrBlank()) "Edit note" else "+ Note", false, Lab.colors.accent, true, Modifier.weight(0.9f)) { showComment = !showComment }
        }
        if (showComment) {
            OutlinedTextField(comment, { comment = it }, Modifier.fillMaxWidth(), minLines = 2, placeholder = { Text("What to tell them — e.g. second tone sounds like fourth") })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TeachButton("Save note", Modifier.weight(1f), primary = true, enabled = !saving) { actions.mark(r, status ?: "needs_work", comment.trim().ifEmpty { null }); showComment = false }
                TeachButton("Cancel", Modifier.weight(1f)) { showComment = false }
            }
        }
    }
}

@Composable
private fun AudioPill(label: String, playing: Boolean, color: Color, onClick: () -> Unit) {
    Text(
        (if (playing) "⏹ " else "▶ ") + label,
        color = if (playing) Color.White else color,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        maxLines = 1,
        modifier = Modifier
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(50))
            .bouncyClickable(pressedScale = 0.9f, onClick = onClick)
            .background(if (playing) color else color.copy(alpha = 0.12f))
            .padding(horizontal = 14.dp, vertical = 12.dp),
    )
}

@Composable
private fun MarkButton(label: String, active: Boolean, color: Color, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Text(
        label, color = if (active) Color.White else color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1,
        textAlign = TextAlign.Center,
        modifier = modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).bouncyClickable(enabled, 0.94f, onClick = onClick)
            .background(if (active) color else color.copy(alpha = 0.1f)).padding(vertical = 12.dp, horizontal = 2.dp),
    )
}

// ---------------- Insights: mix-ups ----------------

/** "Mix-ups": character pairs the student confuses (web: InsightsPage MixUps). Hidden when empty. */
@Composable
fun MixUpsCard(mixUps: List<MixUpDto>) {
    if (mixUps.isEmpty()) return
    TeachCard(Modifier.testTag("insights-mixups")) {
        TeachSectionTitle("Mix-ups") { MutedLine("characters they confuse") }
        mixUps.forEach { m ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)) {
                Text(RecordingQueueRules.mixUpPair(m), fontSize = 24.sp, color = Lab.colors.ink)
                Spacer(Modifier.width(8.dp))
                TeachPill("×${m.count}", PillTone.Struggling)
                Spacer(Modifier.width(10.dp))
                Text(RecordingQueueRules.mixUpWords(m), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.weight(1f))
            }
        }
    }
}
