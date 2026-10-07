package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTimeline
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
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
import java.text.NumberFormat
import java.util.Locale

/** The night palette of audio lessons (AudioLessonsPage.css: the indigo card, the dark player). */
object AlColors {
    val cardTop = Color(0xFF312E81)
    val cardBottom = Color(0xFF0F172A)
    val periwinkle = Color(0xFFA5B4FC)
    val lavender = Color(0xFFC7D2FE)
    val onPeriwinkle = Color(0xFF1E1B4B)
    val player = Color(0xFF0F172A)
    val playerSleep = Color(0xFF020617)
    val text = Color(0xFFE2E8F0)
    val bright = Color(0xFFF8FAFC)
    val muted = Color(0xFF94A3B8)
    val glass = Color(0x14FFFFFF)
    val glassBorder = Color(0x4DFFFFFF)
}

/** One tap instead of thinking a situation up (the web's SITUATIONS: the chip shows the Chinese, the tap fills the English). */
val AUDIO_LESSON_SITUATIONS = listOf(
    "兰州拉面" to "Ordering at a Lanzhou beef noodle shop",
    "打车" to "Taking a taxi and giving directions",
    "看医生" to "Seeing a doctor about a cold",
    "租房子" to "Asking about renting a flat",
    "买火车票" to "Buying a high-speed train ticket",
    "寄快递" to "Sending a parcel at the courier counter",
)

private data class FormatChoice(val id: String, val icon: String, val label: String, val blurb: String)

private val FORMATS = listOf(
    FormatChoice("dialogue", "🎙️", "Dialogue", "An English host, a short Chinese dialogue played three times, then the new words explained."),
    FormatChoice("sleep", "🌙", "Sleep", "All Chinese, very slow and calm: the new words from a text, each said three times with simple sentences."),
)

data class AudioLessonsUi(
    val lessons: Loadable<List<AudioLessonDto>> = Loadable(),
    /** Lessons with their file on this phone. */
    val saved: Set<String> = emptySet(),
    /** Downloads in flight: id → fraction. */
    val downloading: Map<String, Double> = emptyMap(),
    val format: String = "dialogue",
    val description: String = "",
    val dialogue: String = "",
    val showDialogue: Boolean = false,
    val text: String = "",
    val minutes: Int = AudioLessonTimeline.Limits.defaultMinutes("dialogue"),
    val busy: Boolean = false,
    val error: String? = null,
    val online: Boolean = true,
    val busyId: String? = null,
) {
    private val filled: Boolean get() = if (format == "dialogue") description.isNotBlank() || dialogue.isNotBlank() else text.isNotBlank()
    val canStart: Boolean get() = online && !busy && filled
}

data class AudioLessonsActions(
    val onBack: (() -> Unit)? = null,
    val onFormat: (String) -> Unit = {},
    val onDescription: (String) -> Unit = {},
    val onDialogue: (String) -> Unit = {},
    val onShowDialogue: () -> Unit = {},
    val onText: (String) -> Unit = {},
    val onMinutes: (Int) -> Unit = {},
    val onStart: () -> Unit = {},
    val onOpen: (String) -> Unit = {},
    val onRetry: (String) -> Unit = {},
    val onDelete: (String) -> Unit = {},
    val onRefresh: () -> Unit = {},
)

/** `/audio-lessons` — the web's AudioLessonsPage: the new-lesson card, then the lessons. */
@Composable
fun AudioLessonsScreen(ui: AudioLessonsUi, actions: AudioLessonsActions) {
    var confirmDelete by remember { mutableStateOf<AudioLessonDto?>(null) }
    val l = ui.lessons
    LabScreen("🎧 Audio lessons", onBack = actions.onBack) {
        item {
            Text(
                "Lessons to listen to — on the train, or to fall asleep to. Claude writes each one for you, checking it against your cards, and the app records it as one audio file you can keep offline.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
            )
        }
        item { NewLessonCard(ui, actions) }
        if (l.offline && l.hasData) item { OfflineNotice(updatedAt = l.updatedAt) }
        else if (l.error != null && l.hasData) item { InlineNotice(l.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
        val list = l.data
        when {
            list == null && l.loading -> item { LoadingState(text = "Loading…") }
            list == null -> item {
                InlineNotice(l.error ?: "Couldn't load your audio lessons.", kind = if (l.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh)
            }
            list.isEmpty() -> item { EmptyState("🎧", "No lessons yet", body = "Make your first one above. It takes a few minutes.") }
            else -> items(list.size, key = { list[it].id }) { i ->
                val lesson = list[i]
                LessonRow(lesson, lesson.id in ui.saved, ui.downloading[lesson.id], ui.online, ui.busyId == lesson.id, actions, onDelete = { confirmDelete = it })
            }
        }
    }
    confirmDelete?.let { lesson ->
        ConfirmDialog(
            title = "Delete “${lesson.title.ifBlank { "this lesson" }}”?",
            text = "The lesson and its audio are removed from your account and this phone.",
            confirmLabel = "Delete",
            danger = true,
            onConfirm = { confirmDelete = null; actions.onDelete(lesson.id) },
            onDismiss = { confirmDelete = null },
        )
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun NewLessonCard(ui: AudioLessonsUi, actions: AudioLessonsActions) {
    val shape = RoundedCornerShape(20.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(Brush.linearGradient(listOf(AlColors.cardTop, AlColors.cardBottom))).padding(16.dp).animateContentSize(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (f in FORMATS) {
                val on = ui.format == f.id
                val scale by animateFloatAsState(if (on) 1f else 0.97f, spring(dampingRatio = 0.55f), label = "fmt")
                Column(
                    Modifier.weight(1f).scale(scale).clip(RoundedCornerShape(12.dp))
                        .background(if (on) AlColors.periwinkle.copy(alpha = 0.2f) else Color.White.copy(alpha = 0.06f))
                        .border(1.5.dp, if (on) AlColors.periwinkle else Color.White.copy(alpha = 0.2f), RoundedCornerShape(12.dp))
                        .clickable { actions.onFormat(f.id) }
                        .heightIn(min = 44.dp).padding(horizontal = 11.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text("${f.icon} ${f.label}", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(f.blurb, color = AlColors.lavender, fontSize = 12.sp, lineHeight = 16.sp)
                }
            }
        }
        val fieldColors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Color.White.copy(alpha = 0.1f),
            unfocusedContainerColor = Color.White.copy(alpha = 0.1f),
            focusedBorderColor = AlColors.periwinkle,
            unfocusedBorderColor = Color.White.copy(alpha = 0.25f),
            focusedTextColor = Color.White,
            unfocusedTextColor = Color.White,
            cursorColor = AlColors.periwinkle,
            focusedPlaceholderColor = Color.White.copy(alpha = 0.5f),
            unfocusedPlaceholderColor = Color.White.copy(alpha = 0.5f),
        )
        val L = AudioLessonTimeline.Limits
        if (ui.format == "dialogue") {
            Label("What situation do you want to practise?")
            OutlinedTextField(
                value = ui.description,
                onValueChange = { actions.onDescription(it.take(L.DESCRIPTION)) },
                placeholder = { Text("e.g. Ordering at a Lanzhou noodle shop — thick or thin noodles, less chilli") },
                minLines = 2,
                shape = RoundedCornerShape(12.dp),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((zh, en) in AUDIO_LESSON_SITUATIONS) NightChip(zh, selected = ui.description == en) { actions.onDescription(en) }
            }
            if (ui.showDialogue) {
                Label("A dialogue to build it on (optional)")
                OutlinedTextField(
                    value = ui.dialogue,
                    onValueChange = { actions.onDialogue(it.take(L.DIALOGUE)) },
                    placeholder = { Text("A：你好，吃什么？\nB：我要一碗牛肉面。") },
                    minLines = 5,
                    shape = RoundedCornerShape(12.dp),
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                Text(
                    "+ Paste a dialogue",
                    color = AlColors.periwinkle,
                    fontSize = 15.sp,
                    modifier = Modifier.heightIn(min = 44.dp).clickable(onClick = actions.onShowDialogue).padding(vertical = 12.dp),
                )
            }
        } else {
            Label("Paste some Chinese — an article, a story, a chat")
            OutlinedTextField(
                value = ui.text,
                onValueChange = { actions.onText(it.take(L.TEXT)) },
                placeholder = { Text("Claude finds the words you don't know yet and teaches them slowly, all in Chinese.") },
                minLines = 7,
                maxLines = 12,
                shape = RoundedCornerShape(12.dp),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            val nf = NumberFormat.getIntegerInstance(Locale.US)
            Text("${nf.format(ui.text.length)} / ${nf.format(L.TEXT)} characters", color = AlColors.lavender, fontSize = 13.sp)
        }
        Label("Length: about ${ui.minutes} minutes")
        Slider(
            value = ui.minutes.toFloat(),
            onValueChange = { actions.onMinutes(Math.round(it)) },
            valueRange = L.MIN_MINUTES.toFloat()..L.MAX_MINUTES.toFloat(),
            steps = L.MAX_MINUTES - L.MIN_MINUTES - 1,
            colors = SliderDefaults.colors(
                thumbColor = AlColors.periwinkle,
                activeTrackColor = AlColors.periwinkle,
                inactiveTrackColor = Color.White.copy(alpha = 0.2f),
                activeTickColor = Color.Transparent,
                inactiveTickColor = Color.Transparent,
            ),
        )
        Box(
            Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(14.dp))
                .background(if (ui.canStart) AlColors.periwinkle else AlColors.periwinkle.copy(alpha = 0.4f))
                .bouncyClickable(ui.canStart, onClick = actions.onStart),
            contentAlignment = Alignment.Center,
        ) {
            Text(if (ui.busy) "Sending…" else "🎧 Make the lesson", color = AlColors.onPeriwinkle, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }
        if (!ui.online) InlineNotice("You're offline — making a lesson needs a connection. Saved lessons still play.", kind = NoticeKind.Offline)
        ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
    }
}

@Composable
private fun Label(text: String) = Text(text, color = AlColors.lavender, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))

/** The web's `.al-chip` on a dark surface. */
@Composable
fun NightChip(label: String, modifier: Modifier = Modifier, selected: Boolean = false, compact: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(999.dp))
            .background(if (selected) AlColors.periwinkle else AlColors.glass)
            .border(1.dp, if (selected) AlColors.periwinkle else AlColors.glassBorder, RoundedCornerShape(999.dp))
            .bouncyClickable(onClick = onClick)
            .padding(horizontal = if (compact) 11.dp else 14.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (selected) AlColors.onPeriwinkle else Color.White, fontSize = if (compact) 14.sp else 15.sp, maxLines = 1, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun LessonRow(l: AudioLessonDto, saved: Boolean, downloading: Double?, online: Boolean, busy: Boolean, actions: AudioLessonsActions, onDelete: (AudioLessonDto) -> Unit) {
    val ready = l.ready
    Row(
        Modifier.fillMaxWidth().animateContentSize().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp))
            .bouncyClickable(ready) { actions.onOpen(l.id) }.padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
            if (l.building) BuildingIcon(if (l.format == "sleep") "🌙" else "🎙️")
            else Text(if (l.format == "sleep") "🌙" else "🎙️", fontSize = 24.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(l.title.ifBlank { "Audio lesson" }, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val sub = buildString {
                append(l.statusLine)
                if (ready && saved) append(" · ✓ On this phone")
                else if (ready && downloading != null) append(" · Saving… ${Math.round(downloading * 100)}%")
            }
            Text(sub, fontSize = 13.sp, color = if (l.status == "failed") Palette.Again else Lab.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val total = l.progress_total
            AnimatedVisibility(l.status == "speaking" && total != null && total > 0) {
                ProgressBar(((l.progress_done ?: 0).toFloat() / (total ?: 1)).coerceIn(0f, 1f), Modifier.padding(top = 4.dp))
            }
        }
        Spacer(Modifier.width(6.dp))
        if (l.status == "failed") SecondaryPill(if (busy) "…" else "🔄 Retry", enabled = online && !busy) { actions.onRetry(l.id) }
        Box(
            Modifier.size(44.dp).clip(CircleShape).clickable(enabled = online) { onDelete(l) }.alpha(if (online) 1f else 0.4f),
            contentAlignment = Alignment.Center,
        ) { Text("🗑️", fontSize = 18.sp) }
    }
}

@Composable
fun ProgressBar(fraction: Float, modifier: Modifier = Modifier, track: Color = Lab.colors.faint, fill: Color = Color(0xFF6366F1)) {
    val f by animateFloatAsState(fraction, spring(stiffness = 300f), label = "progress")
    Box(modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(track)) {
        Box(Modifier.fillMaxWidth(f).fillMaxHeight().clip(RoundedCornerShape(3.dp)).background(fill))
    }
}

@Composable
private fun BuildingIcon(emoji: String) {
    val a by rememberInfiniteTransition(label = "building").animateFloat(0.4f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a")
    Text(emoji, fontSize = 24.sp, modifier = Modifier.alpha(a))
}
