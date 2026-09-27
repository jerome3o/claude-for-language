package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.DeckProgressSummary
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkItemView
import dev.jeromeswannack.chineselearning.lab.core.HwDeckSource
import dev.jeromeswannack.chineselearning.lab.core.HwItem
import dev.jeromeswannack.chineselearning.lab.core.HwLessonSource
import dev.jeromeswannack.chineselearning.lab.core.HwMessage
import dev.jeromeswannack.chineselearning.lab.core.HwPick
import dev.jeromeswannack.chineselearning.lab.core.HwTutor
import dev.jeromeswannack.chineselearning.lab.core.TutorHomework
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.NotificationDto
import dev.jeromeswannack.chineselearning.lab.data.api.chatConversations
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.tutor
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkStore
import dev.jeromeswannack.chineselearning.lab.data.homework.TutorCardSources
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import dev.jeromeswannack.chineselearning.lab.ui.connections.isUnreadChat
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Home's "From <tutor>" card (web: HomeworkCard / useHomework). */
data class TutorCardUi(val pick: HwPick, val progress: DeckProgressSummary?, val wordCount: Int?)

data class HomeHomeworkUi(val todo: List<HomeworkItemView> = emptyList(), val tutorCard: TutorCardUi? = null)

class TutorCardActions(
    val onReply: (HwPick) -> Unit = {},
    val onOpenDeck: (String) -> Unit = {},
    val onOpenLessons: () -> Unit = {},
)

/**
 * Everything the study home shows about homework, below the Study button (web HomePage order):
 * the one-off Homework card, then the "From <tutor>" card. Works offline from the mirror.
 */
@Composable
fun HomeHomeworkSection(ui: HomeHomeworkUi, onOpen: (String) -> Unit, onAll: () -> Unit, cardActions: TutorCardActions) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        HomeworkDueCard(ui.todo, onOpen, onAll)
        ui.tutorCard?.let { TutorHomeworkCard(it, cardActions) }
    }
}

private fun truncate(text: String, max: Int): String {
    val clean = text.replace(Regex("\\s+"), " ").trim()
    return if (clean.length > max) clean.take(max - 1) + "…" else clean
}

/** "From <tutor>": the newest deck or lesson a tutor sent, progress in words, Reply and Open. */
@Composable
fun TutorHomeworkCard(ui: TutorCardUi, actions: TutorCardActions) {
    val pick = ui.pick
    LabCard(Modifier.testTag("tutor-homework-card")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("From ${pick.tutorName}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "Homework",
                    style = MaterialTheme.typography.labelMedium,
                    color = Lab.colors.accent,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Lab.colors.accentSoft).padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
            when (val item = pick.item) {
                is HwItem.Deck -> {
                    Text(
                        item.name + (ui.wordCount?.let { " · $it ${if (it == 1) "word" else "words"}" } ?: ""),
                        style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, fontWeight = FontWeight.Medium,
                    )
                    ui.progress?.let { p ->
                        ProgressBar(if (p.total > 0) p.started.toFloat() / p.total else 0f, Modifier.fillMaxWidth(), color = Lab.colors.accent)
                        Text(TutorHomework.describe(p), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    }
                }
                is HwItem.Lesson -> {
                    Text("${item.title} · mini lesson", style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                    Text("Comes up in your next study session.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
                null -> Text("No deck or lesson from ${pick.tutorName} yet.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
            pick.unreadMessage?.text?.let { Text("💬 “${truncate(it, 60)}”", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill(if (pick.unreadMessage != null) "Reply" else "Message", Modifier.weight(1f)) { actions.onReply(pick) }
                when (val item = pick.item) {
                    is HwItem.Deck -> SecondaryPill("Open deck", Modifier.weight(1f)) { actions.onOpenDeck(item.deckId) }
                    is HwItem.Lesson -> SecondaryPill("Open lesson", Modifier.weight(1f)) { actions.onOpenLessons() }
                    null -> {}
                }
            }
            Text("Decks and lessons your tutor sends you show up here.", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
        }
    }
}

class HomeHomeworkViewModel(private val app: LabApp) : ViewModel() {
    private val todo = HomeworkStore.observe(app.cache).map { data ->
        data?.let { Homework.sortHomeworkItems(Homework.toHomeworkItems(it.first, it.second, Homework.localDate())).todo } ?: emptyList()
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private val tutorCard = combine(
        app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS),
        app.cache.observe<TutorCardSources>(HomeworkKeys.TUTOR_CARD),
        app.cache.observe<List<NotificationDto>>(ConnectionsKeys.NOTIFICATIONS),
        app.repo.dataVersion,
    ) { rel, sources, notes, _ -> Triple(rel, sources, notes) }.mapLatest { (rel, sources, notes) ->
        withContext(Dispatchers.IO) { buildCard(rel, sources, notes) }
    }

    val ui: StateFlow<HomeHomeworkUi> = combine(todo, tutorCard) { t, c -> HomeHomeworkUi(t, c) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, HomeHomeworkUi())

    private suspend fun buildCard(rel: MyRelationshipsDto?, sources: TutorCardSources?, notes: List<NotificationDto>?): TutorCardUi? {
        if (rel == null || sources == null) return null
        val tutors = rel.tutors.mapNotNull { r ->
            val t = r.tutor() ?: return@mapNotNull null
            HwTutor(r.id, t.id, t.displayName("Your tutor"))
        }
        val dao = app.repo.dao
        val decks = dao.decks()
        val pick = TutorHomework.pick(
            tutors = tutors,
            sharedDecks = sources.sharedDecks.map { HwDeckSource(it.relationship_id, it.target_deck_id, it.shared_at) },
            lessons = sources.lessons.map { HwLessonSource(it.id, it.title, it.assigned_by, it.assigned_relationship_id, it.created_at, it.status) },
            unreadMessages = notes.orEmpty().filter { it.isUnreadChat() }.map { HwMessage(it.conversation_id!!, it.relationship_id, it.message, it.created_at) },
            localDecks = decks.associate { it.id to it.name },
        ) ?: return null
        if (pick.item == null && pick.unreadMessage == null) return null
        val deckId = (pick.item as? HwItem.Deck)?.deckId ?: return TutorCardUi(pick, null, null)
        val cards = dao.cards().filter { it.deckId == deckId }
        val deckNotes = dao.allNotes().filter { it.deckId == deckId }
        val events = cards.map { it.id }.chunked(500).flatMap { dao.replayEventsForCards(it) }
        val summary = TutorHomework.summarizeDeck(
            cards.map { TutorHomework.CardRow(it.id, it.noteId, it.queue) },
            deckNotes.map { TutorHomework.NoteRow(it.id, it.hanzi) },
            events.map { TutorHomework.EventRow(it.cardId, it.rating) },
        )
        return TutorCardUi(pick, summary, deckNotes.size)
    }

    /** Reply: the unread message's chat, else the latest (human) conversation, else the tutor page. */
    fun reply(nav: LabNav, pick: HwPick) {
        pick.unreadMessage?.let { nav.open(Routes.chat(pick.relationshipId, it.conversationId)); return }
        viewModelScope.launch {
            val latest = runCatching { app.repo.api.chatConversations(pick.relationshipId) }.getOrNull()
                ?.let { list -> list.firstOrNull { !it.is_ai_conversation } ?: list.firstOrNull() }
            nav.open(if (latest != null) Routes.chat(pick.relationshipId, latest.id) else Routes.connection(pick.relationshipId))
        }
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
        onOpen = { nav.open(Routes.homeworkPass(it)) },
        onAll = { nav.open(Routes.homework()) },
        cardActions = TutorCardActions(
            onReply = { vm.reply(nav, it) },
            onOpenDeck = { nav.open(Routes.deck(it)) },
            onOpenLessons = { nav.open(Routes.lessons()) },
        ),
    )
}
