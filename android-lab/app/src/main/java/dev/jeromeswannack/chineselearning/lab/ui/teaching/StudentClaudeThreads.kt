package dev.jeromeswannack.chineselearning.lab.ui.teaching

import android.net.Uri
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.TutorVisibility
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorClaudeThreadDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorClaudeThreadsDto
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadActions
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadScreen
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadUi
import dev.jeromeswannack.chineselearning.lab.ui.claude.TutorThreadView
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatThreadActions
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant
import kotlinx.coroutines.launch

/*
 * The tutor's view of her student's chats with Claude (docs/CHAT.md "Claude threads" → "What your tutor
 * sees"; web components/tutor/StudentClaudeThreads.tsx, ClaudeChatsSection.tsx, pages/tutor/
 * StudentClaudeThreadPage.tsx): only the chats he lets her read (core claude.TutorVisibility — card
 * questions by default, plus any he shared), each with its context chip, opened READ-ONLY.
 */

/** `/connections/{relId}/claude/{id}` (web: the same path). */
fun Routes.studentClaudeThread(relId: String, id: String, from: String = "student_page") =
    "/connections/${Uri.encode(relId)}/claude/${Uri.encode(id)}?from=$from"

object StudentClaudeTags {
    const val ROW = "student-claude-thread"
    const val CHIP = "student-claude-chip"
    const val EMPTY = "student-claude-empty"
    const val TODAY = "td-claude-today"
}

/** Claude's colour (the Chats tab's orange), for the chips and "✦ Asked Claude 3× today". */
@Composable
fun claudeAccent(): Color = if (dev.jeromeswannack.chineselearning.lab.ui.chat.chatColors().dark) Color(0xFFF0B08F) else Color(0xFFA8482A)

/** One chat: title, last line, when · N messages; its context chip (📇 → her card hub view of the note). */
@Composable
fun StudentClaudeThreadRow(relId: String, t: TutorClaudeThreadDto, open: (String) -> Unit, from: String, now: Instant = Instant.now()) {
    TeachCard(Modifier.testTag(StudentClaudeTags.ROW)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(pressedScale = 0.98f) { open(Routes.studentClaudeThread(relId, t.id, from)) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(t.title, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                t.preview?.takeIf { it != t.title }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                MutedLine(
                    "${TeachingFormat.relativeDay(t.last_message_at ?: t.created_at, now)} · ${TeachingFormat.plural(t.message_count, "message")}" +
                        if (t.shared) " · 👁 shared with you" else "",
                )
            }
            Text("›", color = Lab.colors.muted, fontSize = 20.sp)
        }
        t.badge?.let { b ->
            val noteId = t.context.note_id?.takeIf { t.context.kind == ClaudeChats.CARD }
            val accent = claudeAccent()
            Text(
                "${b.icon} ${b.text}",
                color = if (noteId != null) accent else Lab.colors.ink, fontSize = 13.sp,
                modifier = Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(999.dp)).border(1.dp, if (noteId != null) accent else Lab.colors.cardBorder, RoundedCornerShape(999.dp))
                    .let { m -> if (noteId != null) m.bouncyClickable(pressedScale = 0.97f) { open(Routes.studentCardHub(relId, noteId)) } else m }
                    .padding(horizontal = 10.dp, vertical = 6.dp).testTag(StudentClaudeTags.CHIP),
            )
        }
    }
}

/** "✦ Asked Claude" on the student page: the four newest chats he lets her read + a link to all. */
@Composable
fun AskedClaudeSection(relId: String, data: TutorClaudeThreadsDto?, studentName: String?, open: (String) -> Unit, now: Instant = Instant.now()) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val total = data?.total ?: 0
        TeachSectionTitle("✦ Asked Claude" + if (total > 0) " (${TeachingFormat.plural(total, "chat")})" else "")
        when {
            data == null -> MutedLine("Loading…")
            data.threads.isEmpty() -> TeachCard { MutedLine(TutorVisibility.tutorEmptyText(studentName, data.visibility), Modifier.testTag(StudentClaudeTags.EMPTY)) }
            else -> {
                data.threads.take(4).forEach { StudentClaudeThreadRow(relId, it, open, "student_page", now) }
                if (total > 4) InlineButton("All chats ($total) ›") { open(Routes.studentClaudeChats(relId)) }
            }
        }
    }
}

/** "✦ Asked Claude 3× today" under a student's status (the dashboard card, the Chats tab's Students rows). */
@Composable
fun AskedClaudeTodayLine(relId: String, count: Int, open: (String) -> Unit, modifier: Modifier = Modifier) {
    val label = TutorVisibility.askedClaudeTodayLabel(count)
    if (label.isEmpty()) return
    Text(
        label, color = claudeAccent(), fontSize = 13.sp, fontWeight = FontWeight.Medium,
        modifier = modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(8.dp)).bouncyClickable(pressedScale = 0.97f) { open(Routes.studentClaudeChats(relId)) }
            .padding(vertical = 6.dp).testTag(StudentClaudeTags.TODAY),
    )
}

/** The tutor's copy of a chat as the thread screen's state (read-only: [TutorThreadView]). */
fun tutorThreadUi(relId: String, studentName: String?, d: TutorClaudeThreadDetailDto, online: Boolean = true): ClaudeThreadUi = ClaudeThreadUi(
    threadId = d.thread.id,
    title = d.thread.title,
    context = d.thread.context,
    threadReadOnly = true,
    hasThread = true,
    messages = d.messages.map { m ->
        ClaudeMessageDto(
            id = m.id, thread_id = d.thread.id, role = m.role, content_type = m.content_type, content = m.content,
            answer_lang = m.answer_lang, translation = m.translation, tool_results = m.tool_results, created_at = m.created_at,
        )
    },
    online = online,
    tutorView = TutorThreadView(relId, studentName),
)

/**
 * `/connections/{relId}/claude/{id}`: one of the student's chats, read-only — the learner's own thread
 * screen ([ClaudeThreadScreen]) without composer, chips, 🎧 / 中文 | EN or ⋯; ▶ reads Claude's lines,
 * EN shows the stored translation; the card chip opens her card hub view.
 */
@Composable
fun StudentClaudeThreadScreen(
    relId: String,
    studentName: String?,
    detail: TutorClaudeThreadDetailDto,
    open: (String) -> Unit,
    back: () -> Unit,
    play: (String) -> Unit = {},
    onWord: ((dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto, String) -> Unit)? = null,
    online: Boolean = true,
) {
    val ui = tutorThreadUi(relId, studentName, detail, online)
    ClaudeThreadScreen(
        ui,
        ClaudeThreadActions(
            onBack = back,
            onContext = { link -> if (link.kind == ClaudeChats.CARD && link.noteId != null) open(Routes.studentCardHub(relId, link.noteId!!)) },
            thread = ClaudeChatThreadActions(
                onWord = { w, sentence, _ -> onWord?.invoke(w, sentence) },
                translate = { id -> detail.messages.firstOrNull { it.id == id }?.translation },
                play = { m -> play(m.text) },
                language = AskClaude.ZH,
                online = online,
            ),
        ),
    )
}

@Composable
internal fun rememberTutorPlayer(app: dev.jeromeswannack.chineselearning.lab.LabApp): (String) -> Unit {
    val scope = rememberCoroutineScope()
    return { text ->
        scope.launch {
            app.safely("tutor claude play") {
                val audio = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime.of(app).audio
                if (audio.playing.value == text) audio.stop() else audio.playClip(text, AskClaude.VOICE, AskClaude.SPEED)
            }
        }
    }
}

/** The read-only chat as the route draws it: the thread, "Loading…", or why it can't be shown. */
@Composable
fun StudentClaudeThreadContent(
    relId: String,
    studentName: String?,
    state: dev.jeromeswannack.chineselearning.lab.data.platform.Loadable<TutorClaudeThreadDetailDto>,
    open: (String) -> Unit,
    back: () -> Unit,
    play: (String) -> Unit = {},
    onWord: ((dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto, String) -> Unit)? = null,
    online: Boolean = true,
) {
    val d = state.data
    if (d != null) {
        StudentClaudeThreadScreen(relId, studentName, d, open, back, play, onWord, online)
        return
    }
    dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen("Chat with Claude", onBack = back) {
        item {
            if (state.error != null) {
                TeachCard { MutedLine(if (online) "This chat isn’t shared with you (or it was deleted)." else "You're offline and this chat isn't on this phone yet.") }
            } else {
                MutedLine("Loading…")
            }
        }
    }
}
