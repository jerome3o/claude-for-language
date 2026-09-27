package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeChatsDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteHubDto
import dev.jeromeswannack.chineselearning.lab.data.api.TeachFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.reopenCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.replyToCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.resolveCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.studentClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.studentNoteHub
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class StudentHubViewModel(private val app: LabApp, private val relId: String, noteId: String) : ViewModel() {
    val hub: CachedResource<NoteHubDto> = app.cachedResource(viewModelScope, "teaching/hub/$relId/$noteId", TeachingKeys.KIND) { studentNoteHub(relId, noteId) }

    fun reply(f: TeachFlagDto, text: String, done: (String?) -> Unit) = viewModelScope.launch {
        attempt { app.repo.api.replyToCardFlag(f.id, text) }
            .onSuccess { app.haptics.correct(); app.sounds.play(Sounds.Sfx.POP); done(null); hub.refresh() }
            .onFailure { done(it.userMessage()) }
    }

    fun toggle(f: TeachFlagDto, done: (String?) -> Unit) = viewModelScope.launch {
        attempt { if (f.status == "open") app.repo.api.resolveCardFlag(f.id) else app.repo.api.reopenCardFlag(f.id) }
            .onSuccess { app.haptics.tick(); done(null); hub.refresh() }
            .onFailure { done(it.userMessage()) }
    }

    class Factory(private val app: LabApp, private val relId: String, private val noteId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = StudentHubViewModel(app, relId, noteId) as T
    }
}

/** The student's Ask-Claude history, 100 at a time, first page cached. */
class StudentChatsViewModel(private val app: LabApp, private val relId: String) : ViewModel() {
    private val first: CachedResource<ClaudeChatsDto> = app.cachedResource(viewModelScope, "teaching/claude-all/$relId", TeachingKeys.KIND) { studentClaudeChats(relId, 100) }
    private val _ui = MutableStateFlow(StudentChatsUi(relId, ""))
    val ui: StateFlow<StudentChatsUi> = _ui.asStateFlow()
    private var extra = emptyList<dev.jeromeswannack.chineselearning.lab.data.api.ClaudeQuestionDto>()
    private var cursor: String? = null
    private var paged = false

    init {
        viewModelScope.launch {
            first.state.collect { s ->
                val d = s.data
                if (!paged) cursor = d?.next_cursor
                _ui.update { it.copy(questions = d?.let { it.questions + extra }, total = d?.total ?: 0, hasMore = cursor != null, error = s.error) }
            }
        }
    }

    fun loadMore() {
        val c = cursor ?: return
        if (_ui.value.loadingMore) return
        _ui.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            attempt { app.repo.api.studentClaudeChats(relId, 100, before = c) }
                .onSuccess { p ->
                    paged = true
                    extra = extra + p.questions
                    cursor = p.next_cursor
                    _ui.update { it.copy(questions = it.questions.orEmpty() + p.questions, hasMore = cursor != null) }
                }
                .onFailure { e -> _ui.update { it.copy(error = e.userMessage()) } }
            _ui.update { it.copy(loadingMore = false) }
        }
    }

    class Factory(private val app: LabApp, private val relId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = StudentChatsViewModel(app, relId) as T
    }
}
