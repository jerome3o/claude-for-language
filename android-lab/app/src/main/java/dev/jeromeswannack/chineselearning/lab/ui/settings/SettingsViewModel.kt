package dev.jeromeswannack.chineselearning.lab.ui.settings

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.AudioQualityDto
import dev.jeromeswannack.chineselearning.lab.data.api.FeatureRequestDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.FeatureRequestDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetDto
import dev.jeromeswannack.chineselearning.lab.data.api.audioQuality
import dev.jeromeswannack.chineselearning.lab.data.api.classifyAudio
import dev.jeromeswannack.chineselearning.lab.data.api.commentOnFeatureRequest
import dev.jeromeswannack.chineselearning.lab.data.api.createFeatureRequest
import dev.jeromeswannack.chineselearning.lab.data.api.exportBackup
import dev.jeromeswannack.chineselearning.lab.data.api.featureRequest
import dev.jeromeswannack.chineselearning.lab.data.api.featureRequests
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.regenerateFallbackAudio
import dev.jeromeswannack.chineselearning.lab.data.api.saveLandingPage
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.settings.SettingsStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** One busy/status pair for a section (the web's per-section `saving` + message). */
data class Busy(val busy: Boolean = false, val status: String? = null, val error: String? = null)

data class SettingsUi(
    /** The saved account budget (Prefs.budget, mirrored from /api/auth/me). */
    val budget: StudyBudget = StudyBudget.DEFAULT,
    /** What the steppers show. */
    val budgetDraft: StudyBudget = StudyBudget.DEFAULT,
    val budgetBusy: Busy = Busy(),
    val budgetSavedFlash: Boolean = false,
    /** study | students | decks, null = automatic. */
    val landing: String? = null,
    val landingBusy: Busy = Busy(),
    val exportBusy: Busy = Busy(),
    val lastExportAt: Long = 0,
    val lastExportSize: Long = 0,
    val audioQuality: AudioQualityDto? = null,
    val audioQualityError: String? = null,
    val audioBusy: Busy = Busy(),
    val requests: List<FeatureRequestDto>? = null,
    val requestsError: String? = null,
    val openRequest: FeatureRequestDetailDto? = null,
    val requestBusy: Busy = Busy(),
    val feedbackBusy: Busy = Busy(),
)

/**
 * Settings (web: pages/SettingsPage.tsx). Account settings go to the same endpoints as the
 * web and update the local mirror the rest of the app reads (Prefs.budget feeds the study
 * queue; Prefs.landingPage the shell) — one source of truth, refreshed from /api/auth/me on
 * every sync. Writes need a connection, like the web; failures say why inline.
 */
class SettingsViewModel(private val app: LabApp) : ViewModel() {
    private val store = SettingsStore.get(app)
    private val _ui = MutableStateFlow(
        SettingsUi(
            budget = app.prefs.budget,
            budgetDraft = app.prefs.budget,
            landing = app.prefs.landingPage,
            lastExportAt = store.lastExportAt,
            lastExportSize = store.lastExportSize,
        ),
    )
    val ui: StateFlow<SettingsUi> = _ui

    /** The backup waiting for the "Save as" answer. */
    private var pendingExport: File? = null

    init {
        // After a sync the account budget / landing page may have changed elsewhere.
        viewModelScope.launch {
            app.repo.dataVersion.collect {
                val saved = app.prefs.budget
                _ui.update { u ->
                    u.copy(
                        budget = saved,
                        budgetDraft = if (u.budgetDraft == u.budget) saved else u.budgetDraft,
                        landing = if (u.landingBusy.busy) u.landing else app.prefs.landingPage,
                    )
                }
            }
        }
    }

    private suspend fun <T> call(block: suspend () -> T): T = withContext(Dispatchers.IO) { block() }


    // ---------------- budget ----------------

    fun setBudgetDraft(b: StudyBudget) {
        val clamped = StudyBudget(b.newCardsPerDay.coerceIn(0, StudyBudget.MAX), b.secondaryCardsPerDay.coerceIn(0, StudyBudget.MAX))
        if (clamped != _ui.value.budgetDraft) app.haptics.tick()
        _ui.update { it.copy(budgetDraft = clamped, budgetBusy = Busy()) }
    }

    fun saveBudget() = viewModelScope.launch {
        val draft = _ui.value.budgetDraft
        _ui.update { it.copy(budgetBusy = Busy(busy = true)) }
        try {
            val saved = call { app.repo.api.saveStudyBudget(StudyBudgetDto(draft.newCardsPerDay, draft.secondaryCardsPerDay)) }
            val b = StudyBudget(saved.new_cards_per_day, saved.secondary_cards_per_day)
            app.prefs.budget = b // the study queue reads this (one source of truth, refreshed on sync)
            _ui.update { it.copy(budget = b, budgetDraft = b, budgetBusy = Busy(), budgetSavedFlash = true) }
            app.haptics.correct()
            delay(2500)
            _ui.update { it.copy(budgetSavedFlash = false) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val msg = (e as? HttpException)?.problems()?.takeIf { it.isNotEmpty() }?.joinToString("; ") ?: e.userMessage()
            _ui.update { it.copy(budgetBusy = Busy(error = msg)) }
        }
    }

    // ---------------- start on ----------------

    fun chooseLanding(page: String?) = viewModelScope.launch {
        val prev = _ui.value.landing
        if (prev == page) return@launch
        app.haptics.tick()
        _ui.update { it.copy(landing = page, landingBusy = Busy(busy = true)) }
        try {
            val saved = call { app.repo.api.saveLandingPage(page) }
            app.prefs.landingPage = saved
            _ui.update { it.copy(landing = saved, landingBusy = Busy()) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(landing = prev, landingBusy = Busy(error = e.userMessage())) }
        }
    }

    // ---------------- backup ----------------

    /** Downloads the backup; the screen then asks where to save it ([finishExport]). */
    fun startExport(onReady: (fileName: String) -> Unit) = viewModelScope.launch {
        _ui.update { it.copy(exportBusy = Busy(busy = true, status = "Preparing backup…")) }
        try {
            val file = call {
                val json = app.repo.api.exportBackup()
                File(app.cacheDir, "backup.json").apply { writeText(json) }
            }
            pendingExport = file
            _ui.update { it.copy(exportBusy = Busy(busy = true, status = "Choose where to save it…")) }
            onReady("chinese-learning-backup-${java.time.LocalDate.now(java.time.ZoneOffset.UTC)}.json")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(exportBusy = Busy(error = (e as? HttpException)?.let { h -> "Export failed (${h.code})" } ?: e.userMessage())) }
        }
    }

    fun finishExport(uri: Uri?) = viewModelScope.launch {
        val file = pendingExport
        pendingExport = null
        if (file == null || uri == null) {
            file?.delete()
            _ui.update { it.copy(exportBusy = Busy()) }
            return@launch
        }
        try {
            call { app.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } ?: error("Couldn't open that file") }
            store.lastExportAt = System.currentTimeMillis()
            store.lastExportSize = file.length()
            _ui.update { it.copy(exportBusy = Busy(status = "Backup saved ✓"), lastExportAt = store.lastExportAt, lastExportSize = store.lastExportSize) }
            app.haptics.correct()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(exportBusy = Busy(error = e.message ?: "Couldn't save the backup")) }
        } finally {
            file.delete()
        }
    }

    // ---------------- audio quality ----------------

    fun loadAudioQuality() = viewModelScope.launch {
        try {
            val q = call { app.repo.api.audioQuality() }
            _ui.update { it.copy(audioQuality = q, audioQualityError = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(audioQuality = null, audioQualityError = e.userMessage()) }
        }
    }

    /** The web's "Check N Unchecked Clips": bounded batches until the server says nothing is left. */
    fun classifyAudio() = viewModelScope.launch {
        _ui.update { it.copy(audioBusy = Busy(busy = true, status = "Checking clips…")) }
        var checked = 0
        var found = 0
        try {
            for (round in 0 until 200) {
                val r = call { app.repo.api.classifyAudio(300) }
                checked += r.classified
                found += r.found_fallback
                _ui.update { it.copy(audioBusy = Busy(busy = true, status = "Checked $checked clips, $found are fallback audio…")) }
                if (!r.remaining || r.classified == 0) break
            }
            _ui.update { it.copy(audioBusy = Busy(status = "Checked $checked clips — $found are low-quality fallback audio.")) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(audioBusy = Busy(error = e.userMessage())) }
        }
        loadAudioQuality()
    }

    fun regenerateAudio() = viewModelScope.launch {
        _ui.update { it.copy(audioBusy = Busy(busy = true, status = "Queueing…")) }
        var queued = 0
        try {
            for (round in 0 until 50) {
                val r = call { app.repo.api.regenerateFallbackAudio(250) }
                queued += r.queued
                _ui.update { it.copy(audioBusy = Busy(busy = true, status = "Queued $queued clips for regeneration…")) }
                if (r.queued == 0 || r.remaining <= queued) break
            }
            _ui.update {
                it.copy(audioBusy = Busy(status = "Queued $queued clips. They regenerate in the background over the next while; new audio arrives on the next sync and downloads automatically."))
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(audioBusy = Busy(error = e.userMessage())) }
        }
        loadAudioQuality()
    }

    // ---------------- feature requests ----------------

    fun loadRequests() = viewModelScope.launch {
        try {
            val list = call { app.repo.api.featureRequests() }
            _ui.update { it.copy(requests = list, requestsError = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(requestsError = e.userMessage()) }
        }
    }

    fun openRequest(id: String) = viewModelScope.launch {
        try {
            val d = call { app.repo.api.featureRequest(id) }
            _ui.update { it.copy(openRequest = d, requestBusy = Busy()) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(requestsError = e.userMessage()) }
        }
    }

    fun closeRequest() {
        _ui.update { it.copy(openRequest = null, requestBusy = Busy()) }
        loadRequests()
    }

    fun comment(text: String, onDone: () -> Unit) = viewModelScope.launch {
        val id = _ui.value.openRequest?.request?.id ?: return@launch
        if (text.isBlank()) return@launch
        _ui.update { it.copy(requestBusy = Busy(busy = true)) }
        try {
            call { app.repo.api.commentOnFeatureRequest(id, text.trim()) }
            val d = call { app.repo.api.featureRequest(id) }
            _ui.update { it.copy(openRequest = d, requestBusy = Busy()) }
            onDone()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(requestBusy = Busy(error = e.userMessage())) }
        }
    }

    /** The web's 💬 feedback button: a new feature request from the Lab app. */
    fun sendFeedback(text: String, onDone: () -> Unit) = viewModelScope.launch {
        if (text.isBlank()) return@launch
        _ui.update { it.copy(feedbackBusy = Busy(busy = true)) }
        try {
            call { app.repo.api.createFeatureRequest(text.trim(), "Lab app (Android) · Settings") }
            _ui.update { it.copy(feedbackBusy = Busy(status = "Sent — thank you!")) }
            app.haptics.correct()
            onDone()
            loadRequests()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(feedbackBusy = Busy(error = e.userMessage())) }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = SettingsViewModel(app) as T
    }
}
