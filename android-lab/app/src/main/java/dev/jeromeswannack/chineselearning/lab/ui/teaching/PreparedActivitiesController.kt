package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.calls.PreparedActivities
import dev.jeromeswannack.chineselearning.lab.core.calls.PreparedActivity
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageDto
import dev.jeromeswannack.chineselearning.lab.data.api.PreparedActivitiesDto
import dev.jeromeswannack.chineselearning.lab.data.api.dismissPreparedActivity
import dev.jeromeswannack.chineselearning.lab.data.api.prepareActivities
import dev.jeromeswannack.chineselearning.lab.data.api.preparedActivities
import dev.jeromeswannack.chineselearning.lab.data.api.restorePreparedActivity
import dev.jeromeswannack.chineselearning.lab.data.api.studentCoverage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * The activities prepared for one student's next lesson (web: hooks/usePreparedActivities.ts):
 * the list (cached, ordered by the shared rule), the latest run polled while it works,
 * Prepare / Make more, Dismiss (+ Undo) and "used" right after starting one in a call.
 * [source] = student_page | call (analytics).
 */
class PreparedActivitiesController(
    private val app: LabApp,
    private val scope: CoroutineScope,
    val relId: String,
    private val source: String,
    withCoverage: Boolean = false,
) {
    val resource: CachedResource<PreparedActivitiesDto> =
        app.cachedResource(scope, "teaching/prepared-activities/$relId", TeachingKeys.KIND) { preparedActivities(relId) }
    val coverage: CachedResource<CoverageDto>? =
        if (withCoverage) app.cachedResource(scope, "teaching/coverage/$relId", TeachingKeys.KIND) { studentCoverage(relId) } else null

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _undo = MutableStateFlow<PreparedActivity?>(null)
    /** The one just dismissed ("Dismissed “…” · Undo"). */
    val undo: StateFlow<PreparedActivity?> = _undo.asStateFlow()
    private val _starting = MutableStateFlow(false)
    val starting: StateFlow<Boolean> = _starting.asStateFlow()
    private var poll: Job? = null

    init {
        scope.launch { resource.state.collect { s -> if (PreparedActivities.jobActive(s.data?.job)) ensurePolling() } }
    }

    private fun ensurePolling() {
        if (poll?.isActive == true) return
        poll = scope.launch {
            while (isActive) {
                delay(3_000)
                resource.refresh().join()
                if (!PreparedActivities.jobActive(resource.state.value.data?.job)) break
            }
        }
    }

    fun prepare() = scope.launch {
        _error.value = null
        _starting.value = true
        val ready = resource.state.value.data?.activities?.count { it.status == "ready" } ?: 0
        attempt { app.repo.api.prepareActivities(relId) }
            .onSuccess { r ->
                resource.update { (it ?: PreparedActivitiesDto()).copy(job = r.job) }
                app.analytics.track("tutor.prepared_activities_prepare", mapOf("source" to source, "ready" to ready))
                app.haptics.tick()
                ensurePolling()
            }
            .onFailure { _error.value = it.userMessage().ifBlank { "Could not start" } }
        _starting.value = false
    }

    private suspend fun setStatus(id: String, status: String, usedAt: String? = null) = resource.update { d ->
        val cur = d ?: PreparedActivitiesDto()
        cur.copy(activities = cur.activities.map { if (it.id == id) it.copy(status = status, usedAt = usedAt ?: it.usedAt) else it })
    }

    fun dismiss(a: PreparedActivity) = scope.launch {
        setStatus(a.id, "dismissed")
        _undo.value = a
        app.analytics.track("tutor.prepared_activity_dismiss", mapOf("activity_kind" to a.spec.kind, "source" to source))
        attempt { app.repo.api.dismissPreparedActivity(a.id) }.onFailure {
            setStatus(a.id, a.status)
            _error.value = it.userMessage().ifBlank { "Could not dismiss it" }
        }
    }

    fun restore(a: PreparedActivity) = scope.launch {
        _undo.value = null
        setStatus(a.id, "ready")
        attempt { app.repo.api.restorePreparedActivity(a.id) }.onFailure { resource.refresh() }
    }

    fun previewed(a: PreparedActivity) = app.analytics.track("tutor.prepared_activity_preview", mapOf("activity_kind" to a.spec.kind, "source" to source))

    /** Started in the call: shown as used straight away (the room marks the row). */
    fun markUsed(a: PreparedActivity) = scope.launch {
        val order = PreparedActivities.order(resource.state.value.data?.activities.orEmpty())
        app.analytics.track("call.prepared_activity_start", mapOf("activity_kind" to a.spec.kind, "position" to order.indexOfFirst { it.id == a.id }))
        setStatus(a.id, "used", Instant.now().toString().replace('T', ' ').take(19))
    }
}
