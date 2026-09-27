package dev.jeromeswannack.chineselearning.lab.ui.analyze

import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.analyzeSentence
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.quests.QuestSpeech
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** `/analyze` — Sentence Breakdown (package H). */
fun NavGraphBuilder.analyzeGraph(nav: LabNav) {
    composable(Routes.route(Routes.analyze())) {
        val vm: AnalyzeViewModel = viewModel(factory = AnalyzeViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        AnalyzeScreen(
            ui,
            AnalyzeActions(
                onBack = nav::back,
                onDraft = vm::setDraft,
                onAnalyze = vm::analyze,
                onClear = vm::clear,
                onAnother = vm::another,
                onChunk = vm::goTo,
                onPlayChunk = vm::playChunk,
                onPlayAll = vm::playAll,
                onStop = vm::stop,
            ),
        )
    }
}

class AnalyzeViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(AnalyzeUi())
    val ui: StateFlow<AnalyzeUi> = _ui
    private val speech = QuestSpeech(app)
    private var playAllOn = false

    fun setDraft(s: String) = _ui.update { it.copy(draft = s, error = null) }

    fun analyze() {
        val s = _ui.value.draft.trim()
        if (s.isEmpty() || _ui.value.analyzing) return
        _ui.update { it.copy(analyzing = true, error = null) }
        viewModelScope.launch {
            try {
                val b = app.repo.api.analyzeSentence(s)
                app.haptics.tick()
                _ui.update { it.copy(analyzing = false, breakdown = b.takeIf { it.chunks.isNotEmpty() }, chunk = 0, error = if (b.chunks.isEmpty()) "Couldn't break that sentence down. Please try again." else null) }
            } catch (e: Exception) {
                _ui.update { it.copy(analyzing = false, error = "Failed to analyze sentence. ${e.userMessage()}") }
            }
        }
    }

    fun clear() { stop(); _ui.value = AnalyzeUi() }

    fun another() { stop(); _ui.update { it.copy(breakdown = null, chunk = 0, error = null) } }

    fun goTo(i: Int) {
        val n = _ui.value.breakdown?.chunks?.size ?: return
        if (i !in 0 until n) return
        app.haptics.tick()
        _ui.update { it.copy(chunk = i) }
    }

    fun playChunk() {
        val b = _ui.value.breakdown ?: return
        _ui.update { it.copy(playing = true) }
        speech.speak(b.chunks[_ui.value.chunk].hanzi) { _ui.update { it.copy(playing = false) } }
    }

    fun playAll() {
        val b = _ui.value.breakdown ?: return
        playAllOn = true
        _ui.update { it.copy(playingAll = true, chunk = 0) }
        fun at(i: Int) {
            if (!playAllOn || i >= b.chunks.size) {
                playAllOn = false
                _ui.update { it.copy(playingAll = false) }
                return
            }
            _ui.update { it.copy(chunk = i) }
            speech.speak(b.chunks[i].hanzi) { viewModelScope.launch { delay(300); at(i + 1) } }
        }
        at(0)
    }

    fun stop() {
        playAllOn = false
        speech.release()
        _ui.update { it.copy(playing = false, playingAll = false) }
    }

    override fun onCleared() = speech.release()

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AnalyzeViewModel(app) as T
    }
}
