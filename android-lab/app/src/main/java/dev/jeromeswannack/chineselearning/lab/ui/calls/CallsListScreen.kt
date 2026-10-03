package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.padding
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
import dev.jeromeswannack.chineselearning.lab.data.api.CallListItemDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Someone you can call: an active tutor / student (never Claude). */
data class CallPerson(val relationshipId: String, val name: String)

data class CallsListUi(
    val calls: Loadable<List<CallListItemDto>> = Loadable(),
    val people: List<CallPerson> = emptyList(),
    /** relationship id, or "solo", while a call is being created. */
    val starting: String? = null,
    val error: String? = null,
    val online: Boolean = true,
)

data class CallsListActions(
    val onBack: (() -> Unit)? = null,
    /** null = a solo test call. */
    val onStart: (String?) -> Unit = {},
    val onOpen: (CallListItemDto) -> Unit = {},
    val onRefresh: () -> Unit = {},
)

/** `/calls` — start a call (per relationship, or a solo test call) and every past call (web: CallsListPage). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CallsListScreen(ui: CallsListUi, actions: CallsListActions) {
    LabScreen("Video calls", onBack = actions.onBack, actions = { BetaBadge(Modifier.padding(end = 12.dp)) }) {
        item {
            Text(
                "Live lessons with video, a shared whiteboard and chat. Each person’s microphone is recorded, so afterwards you get a Chinese + English transcript, lesson notes and flashcards.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
            )
        }
        item { SectionHeader("Start a call") }
        item {
            LabCard {
                ui.people.forEachIndexed { i, p ->
                    if (i > 0) RowDivider()
                    NavRow(
                        "📹", p.name,
                        desc = if (ui.starting == p.relationshipId) "Starting…" else "They get a Join link in your chat",
                        enabled = ui.starting == null && ui.online,
                        onClick = { actions.onStart(p.relationshipId) },
                    )
                }
                if (ui.people.isNotEmpty()) RowDivider()
                NavRow(
                    "🧪", "Test call on your own",
                    desc = if (ui.starting == "solo") "Starting…" else "Try the camera, whiteboard and a transcript",
                    enabled = ui.starting == null && ui.online,
                    onClick = { actions.onStart(null) },
                )
            }
        }
        if (!ui.online) item { InlineNotice("You're offline — starting a call needs a connection.", kind = NoticeKind.Offline) }
        ui.error?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }
        item { SectionHeader("Past calls") }
        val q = ui.calls
        val list = q.data
        if (q.offline && q.hasData) item { OfflineNotice(updatedAt = q.updatedAt) }
        else if (q.error != null && q.hasData) item { InlineNotice(q.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
        when {
            list == null && q.loading -> item { LoadingState(text = "Loading…") }
            list == null -> item { InlineNotice(q.error ?: "Couldn't load your calls.", kind = if (q.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
            list.isEmpty() -> item { EmptyState("📼", "No calls yet") }
            else -> item {
                // One entry per lesson (calls within two hours of each other, LESSON_GAP_MS), its calls listed small underneath.
                val lessons = CallsFormat.groupByLesson(list)
                LabCard {
                    lessons.forEachIndexed { i, lesson ->
                        if (i > 0) RowDivider()
                        val group = lesson.calls
                        val head = CallsFormat.lessonHead(group)
                        Column(Modifier.fillMaxWidth().testTag("calls-lesson")) {
                            NavRow(
                                CallsFormat.lessonIcon(group), CallsFormat.lessonTitle(group),
                                desc = CallsFormat.lessonMeta(group),
                                trailing = if (head.status == "live") ({ LivePill() }) else null,
                                onClick = { actions.onOpen(head) },
                            )
                            if (group.size > 1) FlowRow(
                                Modifier.fillMaxWidth().padding(start = 60.dp, end = 16.dp, bottom = 10.dp).semantics { contentDescription = "Calls in this lesson" },
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                CallsFormat.lessonCallLines(group).forEach { line ->
                                    Text(line, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun BetaBadge(modifier: Modifier = Modifier) {
    Text(
        "BETA", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Lab.colors.accent,
        modifier = modifier.clip(RoundedCornerShape(8.dp)).background(Lab.colors.accent.copy(alpha = 0.12f)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
fun LivePill() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "LIVE", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Palette.Again).padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}
