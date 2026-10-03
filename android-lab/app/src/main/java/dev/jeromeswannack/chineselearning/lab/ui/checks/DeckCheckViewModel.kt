package dev.jeromeswannack.chineselearning.lab.ui.checks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.core.CardCheck
import dev.jeromeswannack.chineselearning.lab.core.CheckEstimate
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.DeckCheckJobDto
import dev.jeromeswannack.chineselearning.lab.data.api.DeckCheckScope
import dev.jeromeswannack.chineselearning.lab.data.api.applyDeckCheck
import dev.jeromeswannack.chineselearning.lab.data.api.deckCheckInfo
import dev.jeromeswannack.chineselearning.lab.data.api.deckCheckJob
import dev.jeromeswannack.chineselearning.lab.data.api.startDeckCheck
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class DeckCheckStage { LOADING, INTRO, RUNNING, RESULTS }

/** The "Check for errors" sheet (web: DeckCheckSheet), from GET …/check and the job. */
data class DeckCheckUi(
    val stage: DeckCheckStage = DeckCheckStage.LOADING,
    val deckName: String? = null,
    val estimate: CheckEstimate? = null,
    val canFixSource: Boolean = false,
    val job: DeckCheckJobDto? = null,
    /** Proposal ids ticked for "Apply selected" (every open one by default). */
    val selected: Set<String> = emptySet(),
    /** "Also fix my source deck" (tutor checking a student's copy; on by default). */
    val alsoSource: Boolean = true,
    val starting: Boolean = false,
    val applying: Boolean = false,
    val online: Boolean = true,
    val error: String? = null,
    /** "Couldn't fix 一样: …" per failed proposal of the last apply. */
    val failures: List<String> = emptyList(),
    /** "Fixed 3 words" — floats up after an apply. */
    val toast: String? = null,
) {
    val open get() = job?.proposals.orEmpty().filter { !it.applied }
    val summary get() = job?.let { CardCheck.deckCheckSummary(it.status, it.total, it.checked, it.proposals) }
    val selectedCount get() = open.count { it.id in selected }
}

/**
 * Drives the sheet: intro (estimate + "Check N words"), running (polls the job every 2 s),
 * results (tick proposals, "Apply selected (N)", "Also fix my source deck"). Opens straight on
 * the results when the latest run is done and still has unapplied proposals.
 */
class DeckCheckViewModel(
    private val api: Api,
    private val scope: DeckCheckScope,
    online: StateFlow<Boolean>,
    /** After fixes landed: sync so the notes on this phone refresh. */
    private val onApplied: () -> Unit,
    private val pollMs: Long = 2_000,
) : ViewModel() {
    private val _ui = MutableStateFlow(DeckCheckUi())
    val ui: StateFlow<DeckCheckUi> = _ui
    private var poll: Job? = null

    init {
        viewModelScope.launch { online.collect { on -> _ui.update { it.copy(online = on) } } }
        load()
    }

    fun load() {
        _ui.update { it.copy(stage = DeckCheckStage.LOADING, error = null) }
        viewModelScope.launch {
            try {
                val info = api.deckCheckInfo(scope)
                val job = info.job
                val stage = when {
                    job == null -> DeckCheckStage.INTRO
                    job.status == "queued" || job.status == "running" -> DeckCheckStage.RUNNING
                    job.status == "done" && job.proposals.any { !it.applied } -> DeckCheckStage.RESULTS
                    else -> DeckCheckStage.INTRO
                }
                _ui.update {
                    it.copy(
                        stage = stage, deckName = info.deck_name ?: job?.deck_name, estimate = info.estimate, canFixSource = info.can_fix_source,
                        job = job, selected = job?.proposals.orEmpty().filter { p -> !p.applied }.map { p -> p.id }.toSet(),
                    )
                }
                if (stage == DeckCheckStage.RUNNING && job != null) startPolling(job.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(stage = DeckCheckStage.INTRO, error = e.userMessage()) }
            }
        }
    }

    /** "Check again" from the results. */
    fun checkAgain() = _ui.update { it.copy(stage = DeckCheckStage.INTRO, failures = emptyList(), error = null) }

    fun start() {
        val s = _ui.value
        if (s.starting) return
        _ui.update { it.copy(starting = true, error = null, failures = emptyList()) }
        viewModelScope.launch {
            try {
                val job = api.startDeckCheck(scope).job
                Analytics.track("deck.check_started", mapOf("words" to (s.estimate?.words ?: job.total), "scope" to scope.wire))
                _ui.update { it.copy(starting = false, stage = DeckCheckStage.RUNNING, job = job, selected = emptySet()) }
                startPolling(job.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(starting = false, error = e.userMessage()) }
            }
        }
    }

    private fun startPolling(jobId: String) {
        poll?.cancel()
        poll = viewModelScope.launch {
            while (true) {
                delay(pollMs)
                val job = try {
                    api.deckCheckJob(jobId).job
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    continue // a dropped poll: try again on the next tick
                }
                if (job.status == "done" || job.status == "failed") {
                    _ui.update {
                        it.copy(
                            stage = DeckCheckStage.RESULTS, job = job,
                            selected = job.proposals.filter { p -> !p.applied }.map { p -> p.id }.toSet(),
                            error = if (job.status == "failed") job.error ?: "The check stopped early" else null,
                        )
                    }
                    return@launch
                }
                _ui.update { it.copy(job = job) }
            }
        }
    }

    fun toggle(proposalId: String) = _ui.update { s ->
        s.copy(selected = if (proposalId in s.selected) s.selected - proposalId else s.selected + proposalId)
    }

    fun setAlsoSource(on: Boolean) = _ui.update { it.copy(alsoSource = on) }

    fun apply() {
        val s = _ui.value
        val job = s.job ?: return
        val ids = s.open.filter { it.id in s.selected }.map { it.id }
        if (ids.isEmpty() || s.applying) return
        val alsoSource = s.canFixSource && s.alsoSource
        _ui.update { it.copy(applying = true, error = null, failures = emptyList()) }
        viewModelScope.launch {
            try {
                val r = api.applyDeckCheck(job.id, ids, alsoSource)
                val next = r.job ?: job.copy(proposals = job.proposals.map { p -> if (p.id in r.applied) p.copy(applied = true) else p })
                val hanziOf = job.proposals.associate { it.id to it.hanzi }
                val n = r.applied.size
                if (n > 0) Analytics.track("deck.check_applied", mapOf("count" to n, "source" to (alsoSource && r.source_applied.isNotEmpty()), "scope" to scope.wire))
                _ui.update {
                    it.copy(
                        applying = false, job = next,
                        selected = next.proposals.filter { p -> !p.applied && p.id in it.selected }.map { p -> p.id }.toSet(),
                        failures = r.failed.map { f -> "${hanziOf[f.id] ?: "A word"}: ${f.error.ifBlank { "couldn't be fixed" }}" },
                        toast = if (n > 0) "Fixed $n word${if (n == 1) "" else "s"}" else null,
                    )
                }
                if (n > 0) {
                    onApplied()
                    delay(3_000)
                    _ui.update { it.copy(toast = null) }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(applying = false, error = e.userMessage()) }
            }
        }
    }

    override fun onCleared() {
        poll?.cancel()
    }

    @Suppress("UNCHECKED_CAST")
    class Factory(
        private val api: Api,
        private val scope: DeckCheckScope,
        private val online: StateFlow<Boolean>,
        private val onApplied: () -> Unit,
    ) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T = DeckCheckViewModel(api, scope, online, onApplied) as T
    }
}
