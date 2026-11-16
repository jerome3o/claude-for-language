package dev.jeromeswannack.chineselearning.lab.ui.home

import dev.jeromeswannack.chineselearning.lab.data.noteLongTerm
import dev.jeromeswannack.chineselearning.lab.data.noteHanzi
import dev.jeromeswannack.chineselearning.lab.data.noteFormality
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ComputedStamp
import dev.jeromeswannack.chineselearning.lab.core.HomeCounts
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.SessionCounts
import dev.jeromeswannack.chineselearning.lab.data.StudyDayClock
import dev.jeromeswannack.chineselearning.lab.data.study.SessionCountsBus
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

data class DeckSummary(val id: String, val name: String, val noteCount: Int, val due: QueueCounts)

data class HomeUi(
    val loaded: Boolean = false,
    val userName: String? = null,
    val due: QueueCounts = QueueCounts(0, 0, 0, 0),
    val decks: List<DeckSummary> = emptyList(),
    val reviewedToday: Int = 0,
    /** Lab "today split": flashcards, mini lessons and the graded reader side by side (null until loaded). */
    val today: dev.jeromeswannack.chineselearning.lab.ui.today.TodayHome? = null,
    /** "⚡ Study it today": bumped notes with cards still in today's pocket (core Bumps.bumpedLabel). */
    val bumped: Int = 0,
    /** "Up next": the list's size and its first words ("↑ 4 up next: 银行、学生…"; core UpNext.label). */
    val upNextCount: Int = 0,
    val upNextFirst: List<String> = emptyList(),
    /** "Pause new cards on heavy days" (core ReviewLoad): today's load against the limit; Home says why there are no new cards. */
    val reviewLoad: dev.jeromeswannack.chineselearning.lab.core.ReviewLoadState? = null,
)

/**
 * Home's numbers with a newer study session's on top (core HomeCounts — port of shared/study/homeCounts.ts):
 * the total, every deck row, the ⚡ line and today's "cards due".
 */
internal fun withSession(base: HomeUi, session: SessionCounts): HomeUi {
    val rows = base.decks.associate { it.id to it.due }
    val due = HomeCounts.totalAfterSession(base.due, rows, session)
    return base.copy(
        due = due,
        decks = base.decks.map { it.copy(due = HomeCounts.deckAfterSession(it.due, session, it.id)) },
        bumped = HomeCounts.bumpedAfterSession(base.bumped, session),
        today = base.today?.copy(cardsDue = due.total),
    )
}

class HomeViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(HomeUi())
    val ui: StateFlow<HomeUi> = _ui

    private val todayData = dev.jeromeswannack.chineselearning.lab.ui.today.TodayData(app)
    private var askedForStory = false

    /** Home's own last counts (before the session's numbers go on top) and when they were worked out. */
    private var computed: HomeUi? = null
    private var computedStamp: ComputedStamp? = null

    init {
        viewModelScope.launch { app.repo.dataVersion.collect { refresh() } }
        // Back from Study: the session's numbers at once while they are newer than Home's own
        // (0 after "All done"), never the counts from before the session (core HomeCounts).
        viewModelScope.launch { SessionCountsBus.latest.collect { present() } }
        // Today's lessons / story change when one is completed or a sync brings new ones.
        val runtime = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime.of(app)
        viewModelScope.launch {
            // Guarded: a failing cache read (e.g. a document too big for a CursorWindow) must never take Home down.
            app.safely("home lessons / readers watch") {
                kotlinx.coroutines.flow.merge(runtime.store.observe().map { }, runtime.readers.observe().map { }).drop(2).collect { refresh() }
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            // Never crash Home: on a failure the last numbers stay (logged + reported, CrashLog).
            val loaded = app.safely("home load") { withContext(Dispatchers.IO) { load(now) } } ?: return@launch
            val stamp = ComputedStamp(now, StudyDayClock.todayKey(now))
            // A load that read the data before the one shown never replaces it.
            if (computedStamp?.let { it.day == stamp.day && it.at > stamp.at } == true) return@launch
            computed = loaded
            computedStamp = stamp
            present()
        }
    }

    /**
     * Home is on screen again (back from Study). The session's numbers, when newer than Home's
     * own, are already shown — work the exact ones out now (today's reviews, the story, …).
     */
    fun onShown() {
        // No counts yet: the first load is already under way (init).
        if (computedStamp == null || !HomeCounts.sessionNewer(SessionCountsBus.latest.value, computedStamp, StudyDayClock.todayKey())) return
        // "Nothing due. N reviews today": today's count is one quick query — before the full recount.
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            val reviewed = app.safely("home reviews today") {
                withContext(Dispatchers.IO) {
                    app.repo.dao.reviewsSince(Js.toIsoString(StudyQueue.startOfDay(now, ZoneId.systemDefault(), StudyDayClock.rolloverHour)))
                }
            }
            val base = computed
            if (reviewed != null && base != null) {
                computed = base.copy(reviewedToday = reviewed, today = base.today?.copy(cardsReviewed = reviewed))
                present()
            }
        }
        refresh()
    }

    /** Home's own counts, or the session's on top of them while those are newer (core HomeCounts). */
    private fun present() {
        val base = computed ?: return
        val session = SessionCountsBus.latest.value
        _ui.value = if (session != null && HomeCounts.sessionNewer(session, computedStamp, StudyDayClock.todayKey())) {
            withSession(base, session)
        } else {
            base
        }
    }

    private suspend fun load(now: Long): HomeUi {
        val zone = ZoneId.systemDefault()
        val dao = app.repo.dao
        val decks = dao.decks()
        val cards = dao.cards().map { it.toQueueCard() }
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val dayStart = StudyQueue.startOfDay(now, zone, dev.jeromeswannack.chineselearning.lab.data.StudyDayClock.rolloverHour)
        val introduced = StudyQueue.introducedToday(cards, first, dayStart)
        val cutoff = StudyQueue.cutoff(now, zone, dev.jeromeswannack.chineselearning.lab.data.StudyDayClock.rolloverHour)
        val queueDecks = decks.map { it.toQueueDeck() }
        val today = dev.jeromeswannack.chineselearning.lab.data.StudyDayClock.todayKey(now, zone)
        val longTerm = dao.noteLongTerm()
        val bumps = dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.queueBumps(dao)
        val upNext = dev.jeromeswannack.chineselearning.lab.data.upnext.UpNextStore.queueList(dao)
        // "Pause new cards on heavy days": today's budget (0 + 0 over the limit) and the load Home explains.
        val todays = dev.jeromeswannack.chineselearning.lab.data.TodaysBudget.of(dao, app.prefs, cards, first, now, zone)
        val holds = dev.jeromeswannack.chineselearning.lab.data.holds.HoldStore.queueHolds(dao, app.prefs, now, zone)
        trackPaused(todays.reviewLoad, today)
        // The queue a session would get: the notes' hanzi + "Order new cards by" pick WHICH new words.
        val all = StudyQueue.build(queueDecks, cards, todays.budget, app.prefs.bonus("all", today), introduced, cutoff, null, dao.noteHanzi(), longTerm = longTerm, bumps = bumps, upNext = upNext, order = app.prefs.newCardOrder, frequency = dev.jeromeswannack.chineselearning.lab.core.WordFrequency.shipped, formality = dao.noteFormality(app.prefs.newCardOrder), holds = holds)
        val noteCounts = dao.noteCounts().associate { it.deckId to it.count }
        val summaries = decks.map { d ->
            val q = StudyQueue.build(queueDecks, cards, todays.budget, app.prefs.bonus(d.id, today), introduced, cutoff, d.id, longTerm = longTerm, bumps = bumps, upNext = upNext, holds = holds)
            DeckSummary(d.id, d.name, noteCounts[d.id] ?: 0, StudyQueue.counts(q.dueCards, q.reviewedNoteIds))
        }
        val snapshot = runCatching { todayData.snapshot(now, zone) }.getOrDefault(dev.jeromeswannack.chineselearning.lab.ui.today.TodaySnapshot.EMPTY)
        // No story yet today: ask for one (once a local day, like the session does).
        if (!askedForStory && snapshot.readerEntry == null && snapshot.reader == dev.jeromeswannack.chineselearning.lab.core.TodayPlan.Reader.None && app.online.value) {
            askedForStory = true
            val dueNotes = all.dueCards.map { it.noteId }.distinct()
            app.scope.launch { if (todayData.ensureDailyReader(dueNotes)) refresh() }
        }
        val reviewedToday = dao.reviewsSince(Js.toIsoString(dayStart))
        val due = StudyQueue.counts(all.dueCards, all.reviewedNoteIds)
        val ordered = dev.jeromeswannack.chineselearning.lab.core.Budget.sortForQueue(summaries, { s -> decks.first { it.id == s.id }.studyPriority }, { s -> decks.first { it.id == s.id }.createdAt })
        return HomeUi(
            loaded = true,
            userName = app.prefs.userName,
            due = due,
            decks = ordered,
            reviewedToday = reviewedToday,
            today = dev.jeromeswannack.chineselearning.lab.ui.today.TodayHome.from(snapshot, due.total, reviewedToday)
                .also { dev.jeromeswannack.chineselearning.lab.ui.today.TodayHomeLoader.last.value = it },
            bumped = all.bumpedNoteIds.size,
            upNextCount = upNext?.size ?: 0,
            upNextFirst = upNext.orEmpty().take(3).let { ids -> dao.notes(ids).associateBy { it.id }.let { m -> ids.mapNotNull { m[it]?.hanzi } } },
            reviewLoad = todays.reviewLoad,
        )
    }

    /** `study.new_cards_paused` once a local day while Home says "New cards paused" (the web's HomePage). */
    private fun trackPaused(state: dev.jeromeswannack.chineselearning.lab.core.ReviewLoadState, today: String) {
        if (!state.paused || app.prefs.newCardsPausedTrackedDay == today) return
        app.prefs.newCardsPausedTrackedDay = today
        app.analytics.track("study.new_cards_paused", mapOf("load" to state.load, "limit" to state.threshold))
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = HomeViewModel(app) as T
    }
}
