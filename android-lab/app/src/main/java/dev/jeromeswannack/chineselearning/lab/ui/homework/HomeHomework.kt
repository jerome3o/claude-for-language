package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.HomeHomework
import dev.jeromeswannack.chineselearning.lab.core.HomeHomeworkCard
import dev.jeromeswannack.chineselearning.lab.core.HomeHomeworkRow
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HwDeckSource
import dev.jeromeswannack.chineselearning.lab.core.HwItem
import dev.jeromeswannack.chineselearning.lab.core.HwLessonSource
import dev.jeromeswannack.chineselearning.lab.core.HwMessage
import dev.jeromeswannack.chineselearning.lab.core.HwPick
import dev.jeromeswannack.chineselearning.lab.core.HwTutor
import dev.jeromeswannack.chineselearning.lab.core.LongTermHomework
import dev.jeromeswannack.chineselearning.lab.core.TutorHomework
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.NotificationDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.tutor
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkStore
import dev.jeromeswannack.chineselearning.lab.data.homework.TutorCardSources
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import dev.jeromeswannack.chineselearning.lab.ui.connections.isUnreadChat
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.study.TutorNotes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.withContext

/**
 * What Home shows about the tutor, under the Study button (web HomePage: TutorNotesHomeRow +
 * HomeworkHomeCard): the "🗒 3 new notes from 明慧老师" row, and ONE compact homework card —
 * one slim row per active item from the shared rules (core `HomeHomework`, parity-tested).
 */
data class HomeHomeworkUi(
    val card: HomeHomeworkCard = HomeHomeworkCard(emptyList(), 0, "Homework"),
    /** The newest unread tutor message (a small line in the card). */
    val unread: HwMessage? = null,
    val unreadRelId: String? = null,
    val unreadFrom: String? = null,
    /** "3 new notes from 明慧老师" while a tutor note is unseen. */
    val notesLine: String? = null,
)

class HomeHomeworkActions(
    /** A row's web path (the pass, /lessons). */
    val onOpen: (String) -> Unit = {},
    val onAll: () -> Unit = {},
    val onMessage: (HomeHomeworkUi) -> Unit = {},
    val onNotes: () -> Unit = {},
)

@Composable
fun HomeHomeworkSection(ui: HomeHomeworkUi, actions: HomeHomeworkActions) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ui.notesLine?.let { TutorNotesRow(it, actions.onNotes) }
        if (ui.card.rows.isNotEmpty() || ui.unread != null) CompactHomeworkCard(ui, actions)
    }
}

/** "🗒 3 new notes from 明慧老师 ›" (web TutorNotesHomeRow). */
@Composable
fun TutorNotesRow(line: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(16.dp)).background(Lab.colors.card)
            .bouncyClickable(onClick = onClick).testTag("home-tutor-notes"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(NOTES_AMBER))
        Row(Modifier.weight(1f).heightIn(min = 48.dp).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("🗒", fontSize = 17.sp)
            Spacer(Modifier.width(10.dp))
            Text(line, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            Text("›", fontSize = 22.sp, color = Lab.colors.muted)
        }
    }
}

/** The compact homework card (web HomeworkHomeCard): heading, slim rows, a small unread line. */
@Composable
fun CompactHomeworkCard(ui: HomeHomeworkUi, actions: HomeHomeworkActions) {
    LabCard(Modifier.testTag("homework-home-card")) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(ui.card.heading, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(
                if (ui.card.more > 0) "+${ui.card.more} more ›" else "All ›",
                color = Lab.colors.accent,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).bouncyClickable(onClick = actions.onAll).padding(horizontal = 10.dp, vertical = 10.dp),
            )
        }
        ui.card.rows.forEachIndexed { i, row ->
            if (i > 0) HorizontalDivider(Modifier.padding(start = 46.dp, end = 16.dp), color = Lab.colors.faint)
            SlimRow(row) { actions.onOpen(row.route) }
        }
        ui.unread?.let { msg ->
            HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = Lab.colors.faint)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).bouncyClickable { actions.onMessage(ui) }.padding(horizontal = 16.dp, vertical = 8.dp).testTag("home-hw-message"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("💬", fontSize = 15.sp)
                Spacer(Modifier.width(8.dp))
                Text(
                    msg.text?.let { "“${truncate(it, 48)}”" } ?: "New message from ${ui.unreadFrom ?: "your tutor"}",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                Box(Modifier.size(8.dp).clip(CircleShape).background(Lab.colors.accent))
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun SlimRow(row: HomeHomeworkRow, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 7.dp).testTag("home-hw-row"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(row.icon, fontSize = 16.sp, modifier = Modifier.width(22.dp), textAlign = TextAlign.Center)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                if (row.progress.isNotEmpty()) Text(row.progress, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
            row.fraction?.let { ProgressBar(it.toFloat(), Modifier.fillMaxWidth(), color = HOMEWORK_PURPLE, height = 3.dp) }
        }
        if (row.due.isNotEmpty()) {
            Spacer(Modifier.width(10.dp))
            Text(
                row.due,
                color = if (row.tone == "none") Lab.colors.muted else dueColor(row.tone),
                fontWeight = if (row.tone == "none") FontWeight.Normal else FontWeight.Bold,
                style = MaterialTheme.typography.labelMedium,
                textAlign = TextAlign.End,
                modifier = Modifier.widthIn(min = 76.dp).testTag("hw-due"),
            )
        }
    }
}

private val NOTES_AMBER = Color(0xFFF59E0B)
private val HOMEWORK_PURPLE = Color(0xFF8B5CF6)

private fun truncate(text: String, max: Int): String {
    val clean = text.replace(Regex("\\s+"), " ").trim()
    return if (clean.length > max) clean.take(max - 1) + "…" else clean
}

class HomeHomeworkViewModel(private val app: LabApp) : ViewModel() {
    private val notesLine = combine(
        app.cache.observe<List<RecordingNoteDto>>(TutorNotes.NOTES_KEY),
        app.cache.observe<Set<String>>(TutorNotes.SEEN_KEY),
    ) { _, _ -> TutorNotes.homeLine(app.cache) }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private val card = combine(
        HomeworkStore.observe(app.cache),
        app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS),
        app.cache.observe<TutorCardSources>(HomeworkKeys.TUTOR_CARD),
        app.cache.observe<List<NotificationDto>>(ConnectionsKeys.NOTIFICATIONS),
        app.repo.dataVersion,
    ) { hw, rel, sources, notes, _ -> Inputs(hw, rel, sources, notes) }.mapLatest { withContext(Dispatchers.IO) { build(it) } }

    private data class Inputs(
        val homework: Pair<List<HomeworkAssignment>, List<dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent>>?,
        val rel: MyRelationshipsDto?,
        val sources: TutorCardSources?,
        val notifications: List<NotificationDto>?,
    )

    val ui: StateFlow<HomeHomeworkUi> = combine(card, notesLine) { c, line -> c.copy(notesLine = line) }
        // Never crash Home over the homework card: a failure leaves it empty (logged + reported).
        .catch { e ->
            android.util.Log.e("HomeHomework", "homework card failed", e)
            dev.jeromeswannack.chineselearning.lab.data.CrashLog.recordNonFatal(app, "home", e)
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, HomeHomeworkUi())

    /** The legacy "From <tutor>" pick (newest shared deck / lesson + unread message), web useHomework. */
    private suspend fun pick(rel: MyRelationshipsDto?, sources: TutorCardSources?, notes: List<NotificationDto>?): HwPick? {
        if (rel == null) return null
        val tutors = rel.tutors.mapNotNull { r ->
            val t = r.tutor() ?: return@mapNotNull null
            HwTutor(r.id, t.id, t.displayName("Your tutor"))
        }
        return TutorHomework.pick(
            tutors = tutors,
            sharedDecks = sources?.sharedDecks.orEmpty().map { HwDeckSource(it.relationship_id, it.target_deck_id, it.shared_at) },
            lessons = sources?.lessons.orEmpty().map { HwLessonSource(it.id, it.title, it.assigned_by, it.assigned_relationship_id, it.created_at, it.status) },
            unreadMessages = notes.orEmpty().filter { it.isUnreadChat() }.map { HwMessage(it.conversation_id!!, it.relationship_id, it.message, it.created_at) },
            localDecks = app.repo.dao.decks().associate { it.id to it.name },
        )
    }

    private suspend fun build(input: Inputs): HomeHomeworkUi {
        val (assignments, events) = input.homework ?: (emptyList<HomeworkAssignment>() to emptyList())
        val todo = Homework.sortHomeworkItems(Homework.toHomeworkItems(assignments, events, Homework.localDate())).todo
        val p = pick(input.rel, input.sources, input.notifications)
        // Lessons sent for long-term review (fsrs, or before assignments existed). Long-term DECKS are
        // not homework rows any more (docs/HOMEWORK.md §11): they are decks in the queue ("Next up",
        // the Decks tab) — web HomeworkHomeCard's useLongTerm.
        val longTerm = ArrayList<LongTermHomework>()
        assignments.filter { it.mode == "fsrs" && it.status == "active" && it.kind == "lesson" }
            .forEach { longTerm += LongTermHomework("lesson", it.target_id, it.title, it.tutor_name, it.created_at, null, null) }
        val item = p?.item
        if (item is HwItem.Lesson && assignments.none { it.target_id == item.lessonId }) {
            longTerm += LongTermHomework("lesson", item.lessonId, item.title, p?.tutorName, item.sentAt, null, null)
        }
        val unread = p?.unreadMessage
        return HomeHomeworkUi(
            card = HomeHomework.build(todo, longTerm, unreadFrom = if (unread != null) p.tutorName else null),
            unread = unread,
            unreadRelId = p?.relationshipId,
            unreadFrom = p?.tutorName,
        )
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = HomeHomeworkViewModel(app) as T
    }
}

/** The Home slot (HomeNav passes it to HomeScreen): wires the section to its ViewModel and the nav. */
@Composable
fun HomeHomeworkSlot(nav: LabNav) {
    val vm: HomeHomeworkViewModel = viewModel(factory = HomeHomeworkViewModel.Factory(nav.app))
    val ui by vm.ui.collectAsStateWithLifecycle()
    HomeHomeworkSection(
        ui,
        HomeHomeworkActions(
            onOpen = { nav.open(it) },
            onAll = { nav.open(Routes.homework()) },
            onMessage = { u -> val m = u.unread; val rel = u.unreadRelId; if (m != null && rel != null) nav.open(Routes.chat(rel, m.conversationId)) },
            onNotes = { nav.open(Routes.tutorNotes()) },
        ),
    )
}
