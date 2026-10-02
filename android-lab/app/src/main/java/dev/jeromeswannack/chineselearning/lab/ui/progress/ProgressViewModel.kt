package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.DayCards
import dev.jeromeswannack.chineselearning.lab.core.KnownProgress
import dev.jeromeswannack.chineselearning.lab.core.Progress
import dev.jeromeswannack.chineselearning.lab.data.progress.CardDay
import dev.jeromeswannack.chineselearning.lab.data.progress.ProgressSnapshot
import dev.jeromeswannack.chineselearning.lab.data.progress.ProgressStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

data class ProgressUi(
    val loaded: Boolean = false,
    val snapshot: ProgressSnapshot? = null,
    /** The local date (labels: Today / Yesterday). */
    val today: LocalDate = LocalDate.now(),
    /** The chart's days: the last 30 UTC dates (the days the numbers are grouped by), oldest first. */
    val bars: List<BarDay> = emptyList(),
    /** Characters & words known (null until the replay of every event is done). */
    val known: KnownProgress? = null,
)

/** Builds the chart's 30 bars from the daily rows; days without reviews are empty bars. */
fun barsFor(snapshot: ProgressSnapshot, nowMs: Long): List<BarDay> {
    val byDate = snapshot.daily.days.associateBy { it.date }
    val end = LocalDate.ofInstant(java.time.Instant.ofEpochMilli(nowMs), ZoneOffset.UTC)
    return (29 downTo 0).map { i ->
        val date = end.minusDays(i.toLong()).toString()
        val d = byDate[date]
        // The rows carry a rounded accuracy; the split only colours the bar.
        val correct = if (d == null) 0 else Math.round(d.reviewsCount * d.accuracy / 100.0).toInt().coerceIn(0, d.reviewsCount)
        BarDay(date, d?.reviewsCount ?: 0, correct, date.substring(8).trimStart('0'))
    }
}

/** The Progress tab — recomputed from the phone's review events whenever local data changes. */
class ProgressViewModel(private val app: LabApp) : ViewModel() {
    private val store = ProgressStore(app.repo.db)
    private val _ui = MutableStateFlow(ProgressUi())
    val ui: StateFlow<ProgressUi> = _ui

    init {
        viewModelScope.launch { app.repo.dataVersion.collect { refresh() } }
    }

    private var job: Job? = null

    fun refresh() {
        job?.cancel()
        job = viewModelScope.launch {
            val zone = ZoneId.systemDefault()
            val now = System.currentTimeMillis()
            val snap = app.safely("progress") { store.snapshot(now, zone) } ?: return@launch
            // Keep the last known counts on screen while they are recomputed.
            _ui.value = ProgressUi(true, snap, LocalDate.now(zone), barsFor(snap, now), known = _ui.value.known)
            val known = app.safely("known counts") { store.known(now) } ?: return@launch
            _ui.value = _ui.value.copy(known = known)
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ProgressViewModel(app) as T
    }
}

/** `/progress/day/:date` and `/progress/day/:date/card/:cardId`. */
class ProgressDayViewModel(private val app: LabApp, private val date: String, private val cardId: String?) : ViewModel() {
    private val store = ProgressStore(app.repo.db)
    private val _day = MutableStateFlow<DayCards?>(null)
    val day: StateFlow<DayCards?> = _day
    private val _card = MutableStateFlow<CardDayState>(CardDayState.Loading)
    val card: StateFlow<CardDayState> = _card

    init {
        viewModelScope.launch {
            app.repo.dataVersion.collect {
                if (cardId == null) _day.value = store.day(date)
                else _card.value = store.cardDay(date, cardId)?.let { CardDayState.Loaded(it) } ?: CardDayState.Missing
            }
        }
    }

    class Factory(private val app: LabApp, private val date: String, private val cardId: String?) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ProgressDayViewModel(app, date, cardId) as T
    }
}

sealed interface CardDayState {
    data object Loading : CardDayState
    data object Missing : CardDayState
    data class Loaded(val day: CardDay) : CardDayState
}

/** "Today" / "Yesterday" / "Tue" + "(Sep 23)" — the web's formatDate on the Progress page. */
fun dayLabel(date: String, today: LocalDate): Pair<String, String> {
    val d = runCatching { LocalDate.parse(date) }.getOrNull() ?: return date to ""
    val full = d.format(java.time.format.DateTimeFormatter.ofPattern("MMM d", java.util.Locale.US))
    val day = when (d) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> d.format(java.time.format.DateTimeFormatter.ofPattern("EEE", java.util.Locale.US))
    }
    return day to full
}

/** "Saturday, September 27, 2026" (the day page's heading). */
fun fullDate(date: String): String =
    runCatching { LocalDate.parse(date).format(java.time.format.DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy", java.util.Locale.US)) }.getOrDefault(date)

/** Study-time text for tiles (shared/progress formatStudyTime). */
fun studyTime(ms: Long): String = Progress.formatStudyTime(ms)
