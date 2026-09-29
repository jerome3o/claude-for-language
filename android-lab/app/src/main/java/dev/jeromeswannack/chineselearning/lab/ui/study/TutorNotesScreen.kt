package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.TutorNoteRow
import dev.jeromeswannack.chineselearning.lab.core.TutorNotesRules
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingNoteDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * `/tutor-notes` — "Notes from your tutor" (web pages/TutorNotesPage.tsx) and
 * `/tutor-notes/practice?cards=&notes=` — those cards in the normal study card, a focused mini
 * session where a rating counts as a review only when the card is due (StudyViewModel practice
 * mode, core TutorNotesRules.practiceRatingCounts).
 */
fun NavGraphBuilder.tutorNotesGraph(nav: LabNav) {
    composable(Routes.route(Routes.tutorNotes())) {
        val vm: TutorNotesViewModel = viewModel(factory = TutorNotesViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val playing by nav.app.audio.playingKey.collectAsStateWithLifecycle()
        TutorNotesScreen(
            ui,
            playing,
            TutorNotesActions(
                onBack = nav::back,
                onPractice = { notes -> vm.practice(notes) { cards, ids -> nav.open(Routes.tutorNotesPractice(cards, ids)) } },
                onOpenCard = { nav.open(Routes.cardHub(it)) },
                onPlay = { key -> nav.app.audio.play(key, "", nav.app.online.value) },
            ),
        )
    }
    composable(
        Routes.route("/tutor-notes/practice?cards={cards}&notes={notes}"),
        arguments = listOf(
            navArgument("cards") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("notes") { type = NavType.StringType; nullable = true; defaultValue = null },
        ),
    ) { entry ->
        val cards = entry.arguments?.getString("cards").orEmpty().split(',').filter { it.isNotBlank() }
        val notes = entry.arguments?.getString("notes").orEmpty().split(',').filter { it.isNotBlank() }
        StudyRoute(
            app = nav.app,
            deckId = null,
            practice = PracticeSpec(cards, notes),
            onExit = {
                nav.back()
                nav.app.scope.launch { nav.app.repo.sync() }
            },
            onOpen = { path -> nav.open(path) },
        )
    }
}

data class TutorNotesUi(
    val loaded: Boolean = false,
    val fresh: List<TutorNoteRow> = emptyList(),
    val earlier: List<TutorNoteRow> = emptyList(),
)

class TutorNotesActions(
    val onBack: () -> Unit = {},
    val onPractice: (List<TutorNoteRow>) -> Unit = {},
    val onOpenCard: (String) -> Unit = {},
    val onPlay: (String) -> Unit = {},
)

class TutorNotesViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(TutorNotesUi())
    val ui: StateFlow<TutorNotesUi> = _ui
    /** What was new when the page opened — stays "New" while the page is open (web newIds). */
    private var newIds: Set<String>? = null

    init {
        viewModelScope.launch {
            combine(
                app.cache.observe<List<RecordingNoteDto>>(TutorNotes.NOTES_KEY),
                app.cache.observe<Set<String>>(TutorNotes.SEEN_KEY),
                app.cache.observeEntry(TutorNotes.ALL_KEY),
            ) { _, _, _ -> Unit }.collect { refresh() }
        }
    }

    private suspend fun refresh() {
        val list = withContext(Dispatchers.IO) {
            TutorNotes.list(app.cache) { id -> app.repo.dao.note(id)?.let { it.pinyin to it.english } }
        }
        val first = newIds == null
        if (first) newIds = list.fresh.mapTo(HashSet()) { it.id }
        val all = list.fresh + list.earlier
        val isNew = newIds.orEmpty()
        _ui.update { TutorNotesUi(true, all.filter { it.id in isNew }, all.filter { it.id !in isNew }) }
        // Viewing marks the new ones seen (the card back won't repeat them), after a beat on screen.
        if (first && list.fresh.isNotEmpty()) {
            viewModelScope.launch {
                delay(SEEN_AFTER_MS)
                TutorNotes.markSeen(app.cache, app.outbox, list.fresh.map { it.id })
                if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } }
            }
        }
    }

    /** "Practice this card" / "Practice all": pick one card per note, then open the practice. */
    fun practice(notes: List<TutorNoteRow>, open: (List<String>, List<String>) -> Unit) {
        viewModelScope.launch {
            val ids = withContext(Dispatchers.IO) {
                val noteIds = notes.mapTo(HashSet()) { it.note_id }
                val byNote = app.repo.dao.cards().filter { it.noteId in noteIds }.groupBy({ it.noteId }, { it.id to it.cardType })
                TutorNotesRules.practiceCardIds(notes.map { it.card_id to it.note_id }, byNote)
            }
            if (ids.isNotEmpty()) open(ids, notes.map { it.id })
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TutorNotesViewModel(app) as T
    }

    companion object {
        const val SEEN_AFTER_MS = 1_500L
    }
}

@Composable
fun TutorNotesScreen(ui: TutorNotesUi, playingKey: String?, actions: TutorNotesActions, nowMs: Long = System.currentTimeMillis()) {
    LabScreen("Notes from your tutor", onBack = actions.onBack) {
        item {
            Text(
                "Comments on your recordings and answers to cards you flagged. Each one also shows once on the back of its card.",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
        }
        when {
            !ui.loaded -> item { LoadingState() }
            ui.fresh.isEmpty() && ui.earlier.isEmpty() -> item {
                EmptyState("🗒", "No notes yet", body = "When your tutor comments on a recording or answers a card you flagged, it shows up here.", modifier = Modifier.testTag("tn-empty"))
            }
            else -> {
                val set = ui.fresh.ifEmpty { ui.earlier }
                val words = set.map { it.note_id }.distinct().size
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        PrimaryPill(
                            if (ui.fresh.isNotEmpty()) "Practice the new ones ($words)" else "Practice all ($words)",
                            Modifier.fillMaxWidth().testTag("tn-practice-all"),
                        ) { actions.onPractice(set) }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Practising only counts as a review for cards that are due today — the rest won’t change your schedule.",
                            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center,
                        )
                    }
                }
                if (ui.fresh.isNotEmpty()) {
                    item { SectionLabel("New") }
                    ui.fresh.forEach { n -> item(key = "new-${n.id}") { NoteCard(n, true, playingKey, actions, nowMs) } }
                }
                if (ui.earlier.isNotEmpty()) {
                    item { SectionLabel("Earlier") }
                    ui.earlier.forEach { n -> item(key = "old-${n.id}") { NoteCard(n, false, playingKey, actions, nowMs) } }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink, modifier = Modifier.padding(top = 6.dp))
}

private val AMBER = Color(0xFFF59E0B)

/** "today" / "yesterday" / "3 days ago" / "12 Sep" (web `when`). */
fun noteWhen(iso: String, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): String {
    val t = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val days = ChronoUnit.DAYS.between(t, Instant.ofEpochMilli(nowMs)).toInt()
    return when {
        days <= 0 -> "today"
        days == 1 -> "yesterday"
        days < 7 -> "$days days ago"
        else -> DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH).format(t.atZone(zone))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NoteCard(n: TutorNoteRow, isNew: Boolean, playingKey: String?, actions: TutorNotesActions, nowMs: Long) {
    LabCard(Modifier.testTag("tutor-note")) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(4.dp).fillMaxHeight().background(if (isNew) AMBER else Lab.colors.faint))
            Column(Modifier.weight(1f).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text((if (n.kind == "flag") "🚩 " else "🎤 ") + TutorNotesRules.label(n.kind), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.weight(1f))
                    if (isNew) Text("new · ", style = MaterialTheme.typography.bodySmall, color = Color(0xFFB45309), fontWeight = FontWeight.Bold)
                    Text(noteWhen(n.updated_at, nowMs), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(n.hanzi, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        if (n.pinyin.isNotEmpty()) Text(n.pinyin, style = MaterialTheme.typography.bodyLarge, color = Palette.Hard)
                        if (n.english.isNotEmpty()) Text(n.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                    }
                }
                n.student_message?.takeIf { it.isNotBlank() }?.let {
                    Text("You asked: “$it”", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Palette.Hard)) { append("${n.tutor_name?.takeIf { it.isNotBlank() } ?: "Your tutor"}: ") }
                        append(n.comment)
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = Lab.colors.ink,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.Hard.copy(alpha = 0.10f))
                        .border(1.dp, Palette.Hard.copy(alpha = 0.3f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 9.dp),
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    n.recording_url?.let { url ->
                        val playing = playingKey == url
                        Text(
                            (if (playing) "⏹" else "▶") + " Your recording",
                            color = if (playing) Color.White else Palette.Secondary,
                            fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                            modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(50)).bouncyClickable(pressedScale = 0.92f) { actions.onPlay(url) }
                                .background(if (playing) Palette.Secondary else Palette.Secondary.copy(alpha = 0.12f)).padding(horizontal = 14.dp, vertical = 12.dp),
                        )
                    }
                    SecondaryPill("Practice this card", Modifier.testTag("tn-practice")) { actions.onPractice(listOf(n)) }
                    Text(
                        "Open card ›", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).bouncyClickable { actions.onOpenCard(n.note_id) }.padding(horizontal = 6.dp, vertical = 12.dp),
                    )
                }
            }
        }
    }
}
