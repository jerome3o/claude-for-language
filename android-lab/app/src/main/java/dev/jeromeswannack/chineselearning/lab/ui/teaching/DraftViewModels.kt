package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.AddLessonNotesBody
import dev.jeromeswannack.chineselearning.lab.data.api.DraftPlanDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftViewDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonNotesEntryDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionJobDto
import dev.jeromeswannack.chineselearning.lab.data.api.SubmitSessionNotesBody
import dev.jeromeswannack.chineselearning.lab.data.api.addLessonNotes
import dev.jeromeswannack.chineselearning.lab.data.api.assignHomeworkDraft
import dev.jeromeswannack.chineselearning.lab.data.api.cancelSessionJob
import dev.jeromeswannack.chineselearning.lab.data.api.deleteDraftWord
import dev.jeromeswannack.chineselearning.lab.data.api.deleteSessionJob
import dev.jeromeswannack.chineselearning.lab.data.api.draftFromLessonNotes
import dev.jeromeswannack.chineselearning.lab.data.api.homeworkDraft
import dev.jeromeswannack.chineselearning.lab.data.api.lessonNotes
import dev.jeromeswannack.chineselearning.lab.data.api.retrySessionJob
import dev.jeromeswannack.chineselearning.lab.data.api.saveDraftPlan
import dev.jeromeswannack.chineselearning.lab.data.api.sendDraftMessage
import dev.jeromeswannack.chineselearning.lab.data.api.sessionNotesJobs
import dev.jeromeswannack.chineselearning.lab.data.api.submitSessionNotes
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** How often a list refreshes while the assistant is working (web: SESSION_NOTES_POLL_MS). */
const val JOB_POLL_MS = 3_000L

/** The lesson-notes section of the student page (cached; polls while a draft is being written). */
class LessonNotesController(private val app: LabApp, private val vm: ViewModel, private val relId: String) {
    val entries: CachedResource<List<LessonNotesEntryDto>> = app.cachedResource(vm.viewModelScope, "teaching/lesson-notes/$relId", TeachingKeys.KIND) { lessonNotes(relId) }
    private val _drafting = MutableStateFlow<String?>(null)
    val drafting: StateFlow<String?> = _drafting.asStateFlow()

    init {
        vm.viewModelScope.launch {
            while (isActive) {
                delay(JOB_POLL_MS)
                if (entries.state.value.data?.any { it.job?.status == "queued" || it.job?.status == "running" } == true && app.online.value) entries.refresh().join()
            }
        }
    }

    fun draft(e: LessonNotesEntryDto, go: (String) -> Unit, fail: (String) -> Unit) = vm.viewModelScope.launch {
        _drafting.value = e.id
        attempt { app.repo.api.draftFromLessonNotes(relId, e.id) }
            .onSuccess { app.haptics.tick(); entries.refresh(); go(it.job.id) }
            .onFailure { fail(it.userMessage().ifBlank { "Could not start the draft" }) }
        _drafting.value = null
    }

    fun add(notes: String, title: String?, lessonAt: String, draft: Boolean, go: (String) -> Unit, done: (String?) -> Unit) = vm.viewModelScope.launch {
        attempt { app.repo.api.addLessonNotes(relId, AddLessonNotesBody(notes, title, lessonAt, draft)) }
            .onSuccess { r ->
                app.haptics.correct()
                done(null)
                entries.refresh()
                r.job?.let { go(it.id) }
            }
            .onFailure { done(it.userMessage().ifBlank { "Could not save the notes" }) }
    }
}

class DraftViewModel(private val app: LabApp, private val relId: String, private val jobId: String) : ViewModel() {
    private val _ui = MutableStateFlow(DraftUi(relId))
    val ui: StateFlow<DraftUi> = _ui.asStateFlow()
    private val key = "teaching/draft/$relId/$jobId"

    init {
        viewModelScope.launch { app.cache.get<DraftViewDto>(key)?.let { v -> if (_ui.value.view == null) _ui.update { it.copy(view = v) } } }
        viewModelScope.launch {
            load()
            while (isActive) {
                delay(JOB_POLL_MS)
                if (_ui.value.view?.working == true && app.online.value) load()
            }
        }
    }

    private fun show(v: DraftViewDto) {
        _ui.update { it.copy(view = v, loading = false, error = null) }
        app.scope.launch { app.cache.put(key, TeachingKeys.KIND, v) }
    }

    suspend fun load() {
        val wasWorking = _ui.value.view?.working == true
        attempt { app.repo.api.homeworkDraft(relId, jobId) }
            .onSuccess { v ->
                show(v)
                if (wasWorking && !v.working) { app.haptics.correct(); app.sounds.play(Sounds.Sfx.POP) } // the assistant finished
            }
            .onFailure { e -> _ui.update { it.copy(loading = false, error = if (it.view == null) e.userMessage() else null) } }
    }

    fun reload() = viewModelScope.launch { load() }

    fun updatePlan(plan: DraftPlanDto) {
        // Optimistic: the chips move at once, the server's view replaces it.
        _ui.update { it.copy(view = it.view?.copy(plan = plan)) }
        app.haptics.tick()
        viewModelScope.launch {
            attempt { app.repo.api.saveDraftPlan(relId, jobId, plan) }
                .onSuccess { show(it) }
                .onFailure { e -> _ui.update { it.copy(error = e.userMessage().ifBlank { "Could not save the plan" }) } }
        }
    }

    fun removeWord(w: DraftWordDto) = viewModelScope.launch {
        attempt { app.repo.api.deleteDraftWord(w.id) }
            .onSuccess { load() }
            .onFailure { e -> _ui.update { it.copy(error = e.userMessage().ifBlank { "Could not remove the word" }) } }
    }

    fun assign() = viewModelScope.launch {
        _ui.update { it.copy(assigning = true, error = null) }
        attempt { app.repo.api.assignHomeworkDraft(relId, jobId) }
            .onSuccess { r ->
                val skipped = r.skipped.sumOf { it.hanzi.size }
                app.haptics.celebrate()
                app.sounds.play(Sounds.Sfx.FANFARE)
                _ui.update {
                    it.copy(assignedNote = "Assigned ${TeachingFormat.plural(r.assignments.size, "item")}" +
                        (if (skipped > 0) " · left out ${TeachingFormat.plural(skipped, "word")} they already have" else "") +
                        (if (r.errors.isNotEmpty()) " · ${r.errors.size} failed: ${r.errors[0].error}" else "") + ".")
                }
                load()
            }
            .onFailure { e -> _ui.update { it.copy(error = e.userMessage().ifBlank { "Could not assign" }) } }
        _ui.update { it.copy(assigning = false) }
    }

    fun cancelJob() = viewModelScope.launch { attempt { app.repo.api.cancelSessionJob(relId, jobId) }; load() }
    fun retryJob() = viewModelScope.launch { attempt { app.repo.api.retrySessionJob(relId, jobId) }; load() }

    fun send(message: String, done: () -> Unit) = viewModelScope.launch {
        _ui.update { it.copy(sending = true, chatError = null) }
        attempt { app.repo.api.sendDraftMessage(relId, jobId, message) }
            .onSuccess { app.haptics.tick(); done(); load() }
            .onFailure { e -> _ui.update { it.copy(chatError = e.userMessage().ifBlank { "Could not send" }) } }
        _ui.update { it.copy(sending = false) }
    }

    class Factory(private val app: LabApp, private val relId: String, private val jobId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = DraftViewModel(app, relId, jobId) as T
    }
}

class SessionNotesViewModel(private val app: LabApp, private val relId: String) : ViewModel() {
    val jobs: CachedResource<List<SessionJobDto>> = app.cachedResource(viewModelScope, "teaching/session-notes/$relId", TeachingKeys.KIND) { sessionNotesJobs(relId) }

    /** "Undo — remove from Jerome" on what a job sent (take homework back); the job then shows "removed from Jerome". */
    val removal = HomeworkRemovalController(app, viewModelScope, relId) { _, _ ->
        jobs.refresh()
        app.scope.launch {
            app.cache.delete(TeachingKeys.DASHBOARD)
            app.cache.delete(TeachingKeys.overview(relId))
        }
    }

    init {
        viewModelScope.launch {
            while (isActive) {
                delay(JOB_POLL_MS)
                if (jobs.state.value.data?.any { it.active } == true && app.online.value) jobs.refresh().join()
            }
        }
    }

    private fun act(block: suspend () -> Unit) = viewModelScope.launch { attempt { block() }; app.haptics.tick(); jobs.refresh() }
    fun retry(j: SessionJobDto) = act { app.repo.api.retrySessionJob(relId, j.id) }
    fun cancel(j: SessionJobDto) = act { app.repo.api.cancelSessionJob(relId, j.id) }
    fun delete(j: SessionJobDto) = act { app.repo.api.deleteSessionJob(relId, j.id) }

    fun submit(body: SubmitSessionNotesBody, done: (String?) -> Unit) = viewModelScope.launch {
        attempt { app.repo.api.submitSessionNotes(relId, body) }
            .onSuccess { app.haptics.correct(); done(null); jobs.refresh() }
            .onFailure { done(it.userMessage()) }
    }

    class Factory(private val app: LabApp, private val relId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = SessionNotesViewModel(app, relId) as T
    }
}
