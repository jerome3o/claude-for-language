package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.MarkBody
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.clearRecordingMark
import dev.jeromeswannack.chineselearning.lab.data.api.markRecording
import dev.jeromeswannack.chineselearning.lab.data.api.recordingQueue
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** JsonCache key of one view × range of the queue (every range is a preset, so all are cached). */
fun recordingQueueKey(relId: String, view: String, range: String) = "teaching/recording-queue/$relId/$view/$range"

/** The `from` of a recordings range preset; "lesson" = none (the server anchors it at the last lesson). */
fun recordingRangeFrom(range: String): String? = if (range == "lesson") null else TutorPageFormat.daysAgo(range.removeSuffix("d").toInt())

/**
 * "Needs your ear" / All recordings (web: RecordingsInboxPage.tsx). Cache-first per view and
 * range (opens offline from the last visit); refreshes every 10 s while recordings are still
 * being checked (capped); a mark is optimistic — the card springs out of the queue at once.
 */
class RecordingQueueViewModel(private val app: LabApp, private val relId: String) : ViewModel() {
    data class Transient(
        val view: String = RecordingQueueRules.QUEUE,
        val range: String = "30d",
        val saving: Set<String> = emptySet(),
        val markError: String? = null,
    )

    private val _t = MutableStateFlow(Transient())
    val transient: StateFlow<Transient> = _t.asStateFlow()

    private val _state = MutableStateFlow(Loadable<RecordingQueueDto>(loading = true))
    val state: StateFlow<Loadable<RecordingQueueDto>> = _state.asStateFlow()

    private var resource: CachedResource<RecordingQueueDto>? = null
    private var collectJob: Job? = null
    private var pollJob: Job? = null
    private var polls = 0
    private var trackedKey: String? = null

    init { load() }

    fun setView(view: String) {
        if (view == _t.value.view) return
        app.haptics.tick()
        _t.update { it.copy(view = view, markError = null) }
        load()
    }

    fun setRange(range: String) {
        _t.update { it.copy(range = range, markError = null) }
        load()
    }

    fun retry() { resource?.refresh() }

    private fun load() {
        val (view, range) = _t.value.let { it.view to it.range }
        val key = recordingQueueKey(relId, view, range)
        collectJob?.cancel()
        pollJob?.cancel()
        polls = 0
        _state.value = Loadable(loading = true)
        val r = app.cachedResource(viewModelScope, key, TeachingKeys.KIND) { recordingQueue(relId, view, recordingRangeFrom(range)) }
        resource = r
        collectJob = viewModelScope.launch {
            r.state.collect { s ->
                _state.value = s
                val data = s.data
                if (data != null && !s.loading && s.error == null) {
                    if (trackedKey != key) {
                        trackedKey = key
                        app.analytics.track("tutor.recording_queue_open", mapOf("view" to view, "items" to data.items.size, "scoring" to data.scoring))
                    }
                    if (data.counts.checking > 0) pollWhileChecking(r)
                }
            }
        }
    }

    private fun pollWhileChecking(r: CachedResource<RecordingQueueDto>) {
        if (pollJob?.isActive == true || polls >= RecordingQueueRules.CHECKING_MAX_POLLS) return
        pollJob = viewModelScope.launch {
            delay(RecordingQueueRules.CHECKING_POLL_MS)
            polls++
            if (app.online.value) r.refresh()
        }
    }

    /** Listened / Needs work (tap again to clear) and the note. */
    fun mark(item: RecordingQueueItemDto, status: String?, comment: String?) = viewModelScope.launch {
        val r = resource ?: return@launch
        val view = _t.value.view
        _t.update { it.copy(saving = it.saving + item.event_id, markError = null) }
        if (status != null) {
            // Optimistic: out of the queue now (the server mark carries updated_at once it answers).
            val optimistic = dev.jeromeswannack.chineselearning.lab.data.api.RecordingMarkDto(item.event_id, status, comment)
            r.update { d -> d?.let { RecordingQueueRules.afterMark(it, item.event_id, optimistic) } ?: RecordingQueueDto() }
            if (status == "listened") app.haptics.correct() else app.haptics.tick()
        }
        attempt {
            if (status == null) { app.repo.api.clearRecordingMark(relId, item.event_id); null }
            else app.repo.api.markRecording(relId, item.event_id, MarkBody(status, comment))
        }.onSuccess { mark ->
            if (status != null) app.analytics.track("tutor.recording_mark", mapOf("status" to status, "source" to view))
            r.update { d -> d?.let { RecordingQueueRules.afterMark(it, item.event_id, mark) } ?: RecordingQueueDto() }
            // A cleared mark may put it back in the queue: the server decides.
            if (status == null) { app.haptics.tick(); r.refresh() }
        }.onFailure {
            _t.update { it.copy(markError = "Could not save the mark. Try again.") }
            r.refresh()
        }
        _t.update { it.copy(saving = it.saving - item.event_id) }
    }

    fun trackReferencePlay() = app.analytics.track("tutor.recording_reference_play", mapOf("source" to _t.value.view))

    class Factory(private val app: LabApp, private val relId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = RecordingQueueViewModel(app, relId) as T
    }
}
