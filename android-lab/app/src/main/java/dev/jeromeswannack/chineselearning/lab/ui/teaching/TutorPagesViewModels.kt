package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.HistoryQuery
import dev.jeromeswannack.chineselearning.lab.data.api.InsightsReportDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonLogEntryDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.deleteLessonLogEntry
import dev.jeromeswannack.chineselearning.lab.data.api.lessonLog
import dev.jeromeswannack.chineselearning.lab.data.api.logLesson
import dev.jeromeswannack.chineselearning.lab.data.api.studentHistory
import dev.jeromeswannack.chineselearning.lab.data.api.studentInsights
import dev.jeromeswannack.chineselearning.lab.data.api.studentSummaries
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.api.writeStudentSummary
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Cache keys of the insight pages: the report per preset range (custom ranges aren't cached). */
object TutorPageKeys {
    fun insights(relId: String, preset: String) = "teaching/insights/$relId/$preset"
    fun history(relId: String) = "teaching/history/$relId"
    fun summaries(relId: String) = "teaching/summaries/$relId"
}

/** An insights report for a range, cache-first for the preset ranges (Insights and Recordings share them). */
private class ReportLoader(private val app: LabApp, private val vm: ViewModel, private val relId: String) {
    val state = MutableStateFlow(Loadable<InsightsReportDto>(loading = true))
    var resource: CachedResource<InsightsReportDto>? = null
    private var job: Job? = null

    fun load(presetKey: String, from: String?, to: String?) {
        job?.cancel()
        state.value = Loadable(loading = true)
        if (presetKey == "custom") {
            resource = null
            job = vm.viewModelScope.launch {
                attempt { app.repo.api.studentInsights(relId, from, to) }
                    .onSuccess { state.value = Loadable(it, updatedAt = System.currentTimeMillis()) }
                    .onFailure { state.value = Loadable(error = it.userMessage(), offline = it is java.io.IOException) }
            }
            return
        }
        val r = app.cachedResource(vm.viewModelScope, TutorPageKeys.insights(relId, presetKey), TeachingKeys.KIND) { studentInsights(relId, from, to) }
        resource = r
        job = vm.viewModelScope.launch { r.state.collect { state.value = it } }
    }

    fun refresh() { resource?.refresh() }
}

class InsightsViewModel(private val app: LabApp, private val relId: String) : ViewModel() {
    val lessonLog: CachedResource<List<LessonLogEntryDto>> = app.cachedResource(viewModelScope, TeachingKeys.lessonLog(relId), TeachingKeys.KIND) { lessonLog(relId) }
    val summaries: CachedResource<List<StudentSummaryDto>> = app.cachedResource(viewModelScope, TutorPageKeys.summaries(relId), TeachingKeys.KIND) { studentSummaries(relId) }
    private val loader = ReportLoader(app, this, relId)
    val report: StateFlow<Loadable<InsightsReportDto>> = loader.state

    data class Transient(val range: InsightsRange = InsightsRange(), val latest: StudentSummaryDto? = null, val writing: Boolean = false, val summaryError: String? = null, val savingLesson: Boolean = false, val lessonError: String? = null)
    private val _t = MutableStateFlow(Transient())
    val transient: StateFlow<Transient> = _t.asStateFlow()

    init { setRange(InsightsRange()) }

    fun setRange(r: InsightsRange) {
        _t.update { it.copy(range = r) }
        val (from, to) = r.query()
        loader.load(if (r.preset == InsightsPreset.CUSTOM) "custom" else r.preset.name.lowercase(), from, to)
    }

    fun refresh() { loader.refresh(); lessonLog.refresh(); summaries.refresh() }

    fun writeSummary() = viewModelScope.launch {
        val range = report.value.data?.range ?: return@launch
        _t.update { it.copy(writing = true, summaryError = null) }
        attempt { app.repo.api.writeStudentSummary(relId, range) }
            .onSuccess { s -> app.haptics.correct(); app.sounds.play(Sounds.Sfx.POP); _t.update { it.copy(latest = s) }; summaries.refresh() }
            .onFailure { e -> _t.update { it.copy(summaryError = e.userMessage().ifBlank { "Failed to write summary" }) } }
        _t.update { it.copy(writing = false) }
    }

    fun logLesson(date: String, notes: String, done: () -> Unit) = viewModelScope.launch {
        _t.update { it.copy(savingLesson = true, lessonError = null) }
        attempt { app.repo.api.logLesson(relId, date, notes.ifEmpty { null }) }
            .onSuccess { app.haptics.correct(); done(); lessonLog.refresh(); loader.refresh() }
            .onFailure { e -> _t.update { it.copy(lessonError = e.userMessage()) } }
        _t.update { it.copy(savingLesson = false) }
    }

    fun deleteLesson(e: LessonLogEntryDto) = viewModelScope.launch {
        attempt { app.repo.api.deleteLessonLogEntry(relId, e.id) }
            .onSuccess { app.haptics.tick(); lessonLog.update { l -> l.orEmpty().filterNot { it.id == e.id } }; lessonLog.refresh(); loader.refresh() }
            .onFailure { err -> _t.update { it.copy(lessonError = err.userMessage()) } }
    }

    class Factory(private val app: LabApp, private val relId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = InsightsViewModel(app, relId) as T
    }
}

class HistoryViewModel(private val app: LabApp, private val relId: String) : ViewModel() {
    private val _ui = MutableStateFlow(HistoryUi(relId, ""))
    val ui: StateFlow<HistoryUi> = _ui.asStateFlow()
    private var cursor: String? = null
    private var job: Job? = null

    init {
        // The default view (last 30 days, no filters) opens from the cache, then refreshes.
        viewModelScope.launch {
            app.cache.get<dev.jeromeswannack.chineselearning.lab.data.api.HistoryPageDto>(TutorPageKeys.history(relId))?.let { p ->
                if (_ui.value.events.isEmpty()) _ui.update { it.copy(events = p.events, decks = p.decks.orEmpty(), range = p.range, hasMore = p.next_cursor != null) }
            }
        }
        reload(0)
    }

    fun setFilters(f: HistoryFilters) {
        val qChanged = f.q != _ui.value.filters.q
        _ui.update { it.copy(filters = f) }
        reload(if (qChanged) 300 else 0)
    }

    fun setByWord(v: Boolean) = _ui.update { it.copy(byWord = v) }

    private fun query(f: HistoryFilters, cursor: String?) = HistoryQuery(f.from(), f.deckId, f.cardType, f.rating, f.q.trim().ifEmpty { null }, cursor)

    fun reload(debounceMs: Long = 0) {
        job?.cancel()
        job = viewModelScope.launch {
            if (debounceMs > 0) delay(debounceMs)
            val f = _ui.value.filters
            _ui.update { it.copy(loading = true, error = null) }
            attempt { app.repo.api.studentHistory(relId, query(f, null)) }
                .onSuccess { p ->
                    cursor = p.next_cursor
                    _ui.update { it.copy(events = p.events, decks = p.decks ?: it.decks, range = p.range, hasMore = p.next_cursor != null, loading = false) }
                    if (f == HistoryFilters()) app.cache.put(TutorPageKeys.history(relId), TeachingKeys.KIND, p)
                }
                .onFailure { e -> _ui.update { it.copy(loading = false, error = e.userMessage()) } }
        }
    }

    fun loadMore() {
        val c = cursor ?: return
        if (_ui.value.loadingMore) return
        _ui.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            attempt { app.repo.api.studentHistory(relId, query(_ui.value.filters, c)) }
                .onSuccess { p -> cursor = p.next_cursor; _ui.update { it.copy(events = it.events + p.events, hasMore = p.next_cursor != null, loadingMore = false) } }
                .onFailure { e -> _ui.update { it.copy(loadingMore = false, error = e.userMessage()) } }
        }
    }

    class Factory(private val app: LabApp, private val relId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = HistoryViewModel(app, relId) as T
    }
}
