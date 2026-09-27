package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonValidator
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.archiveLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.deleteCustomLesson
import dev.jeromeswannack.chineselearning.lab.data.api.duplicateLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.editableLesson
import dev.jeromeswannack.chineselearning.lab.data.api.libraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.saveEditableLesson
import dev.jeromeswannack.chineselearning.lab.data.api.updateLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** A loaded editor target as cached on the phone (so the editor opens offline). */
@Serializable
data class CachedLessonTarget(val spec: JsonObject, val isOwner: Boolean = true, val assigned: Boolean = false)

data class LessonEditorUi(
    val loading: Boolean = true,
    val loadError: String? = null,
    val spec: JsonObject? = null,
    val savedCanonical: String = "",
    val errors: List<String> = emptyList(),
    val saving: Boolean = false,
    val isOwner: Boolean = true,
    val assigned: Boolean = false,
    /** A short line under the header (the web's toast): "Saved", "Not saved: …". */
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    /** Unsaved edits from an earlier visit were put back. */
    val restoredDraft: Boolean = false,
    val view: EditorView = EditorView.EDIT,
) {
    val dirty: Boolean get() = spec != null && JsJson.canonical(spec) != savedCanonical
}

/**
 * The lesson editor (web: pages/editor/LessonEditorPage.tsx) for a tutor's library item
 * (target "library", `/library/:id/edit`) or a lesson (target "lesson", `/lessons/:id/edit`):
 * loads the spec (cached copy first), validates live, saves, and keeps unsaved edits on the
 * phone (JsonCache "editor/draft/…") so a closed app or a train tunnel never loses them.
 */
class LessonEditorViewModel(private val deps: EditorDeps, val target: String, val id: String) : ViewModel() {
    private val _ui = MutableStateFlow(LessonEditorUi())
    val ui: StateFlow<LessonEditorUi> = _ui

    private val targetKey = "editor/lesson/$target/$id"
    private val draftKey = "editor/draft/$target/$id"
    private var draftJob: Job? = null

    val chat = EditorChatModel(deps, viewModelScope, target, id) { proposed ->
        setSpec(proposed)
        notify("Proposal applied — press Save to keep it")
    }

    init { load() }

    fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, loadError = null) }
            val cached = deps.cache.get(targetKey, CachedLessonTarget.serializer())
            val fresh = try {
                if (!deps.online() && cached != null) null else fetch().also { deps.cache.put(targetKey, "editor", it, CachedLessonTarget.serializer()) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (cached == null) {
                    _ui.update { it.copy(loading = false, loadError = e.userMessage()) }
                    return@launch
                }
                null
            }
            val loaded = fresh ?: cached!!
            val draft = deps.cache.get(draftKey, JsonObject.serializer())
            val saved = JsJson.canonical(loaded.spec)!!
            val useDraft = draft != null && JsJson.canonical(draft) != saved
            val spec = if (useDraft) draft!! else loaded.spec
            _ui.update {
                it.copy(
                    loading = false,
                    spec = spec,
                    savedCanonical = saved,
                    errors = LessonValidator.validate(spec),
                    isOwner = loaded.isOwner,
                    assigned = loaded.assigned,
                    restoredDraft = useDraft,
                    notice = if (fresh == null) "You're offline — editing the copy on this phone. Save when you're back online." else null,
                    noticeIsError = false,
                )
            }
        }
    }

    private suspend fun fetch(): CachedLessonTarget = if (target == "library") {
        CachedLessonTarget(deps.api.libraryItem(id).spec, isOwner = true, assigned = false)
    } else {
        val lesson = deps.api.editableLesson(id)
        CachedLessonTarget(lesson.spec, isOwner = lesson.is_owner, assigned = lesson.library_item_id != null)
    }

    fun setSpec(spec: JsonObject) {
        _ui.update { it.copy(spec = spec, errors = LessonValidator.validate(spec)) }
        persistDraft(spec)
    }

    private fun persistDraft(spec: JsonObject) {
        draftJob?.cancel()
        draftJob = viewModelScope.launch {
            delay(400)
            if (JsJson.canonical(spec) == _ui.value.savedCanonical) deps.cache.delete(draftKey)
            else deps.cache.put(draftKey, "editor-drafts", spec, JsonObject.serializer())
        }
    }

    /** Throws away the restored draft: back to the last saved spec. */
    fun discardDraft() {
        viewModelScope.launch {
            deps.cache.delete(draftKey)
            val cached = deps.cache.get(targetKey, CachedLessonTarget.serializer()) ?: return@launch
            _ui.update { it.copy(spec = cached.spec, errors = LessonValidator.validate(cached.spec), restoredDraft = false) }
        }
    }

    fun setView(view: EditorView) = _ui.update { it.copy(view = view) }

    fun notify(message: String, error: Boolean = false) {
        _ui.update { it.copy(notice = message, noticeIsError = error) }
        val shown = message
        viewModelScope.launch {
            delay(3_500)
            _ui.update { if (it.notice == shown) it.copy(notice = null) else it }
        }
    }

    fun save() {
        val state = _ui.value
        val spec = state.spec ?: return
        if (state.errors.isNotEmpty() || state.saving || !state.dirty) return
        _ui.update { it.copy(saving = true) }
        viewModelScope.launch {
            try {
                val savedSpec = if (target == "library") deps.api.updateLibraryItem(id, spec).spec else deps.api.saveEditableLesson(id, spec).spec
                deps.cache.put(targetKey, "editor", CachedLessonTarget(savedSpec, state.isOwner, state.assigned), CachedLessonTarget.serializer())
                deps.cache.delete(draftKey)
                draftJob?.cancel()
                _ui.update { it.copy(saving = false, spec = savedSpec, savedCanonical = JsJson.canonical(savedSpec)!!, errors = LessonValidator.validate(savedSpec), restoredDraft = false) }
                deps.feedback.success()
                notify("Saved")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(saving = false) }
                deps.feedback.error()
                val problems = (e as? HttpException)?.problems().orEmpty()
                val reason = if (problems.isNotEmpty()) problems.joinToString("; ") else e.userMessage()
                notify("Not saved: $reason", error = true)
            }
        }
    }

    /** Library only: a copy "Copy of …"; returns its id for the caller to open. */
    fun duplicate(onDone: (String) -> Unit) {
        viewModelScope.launch {
            try {
                onDone(deps.api.duplicateLibraryItem(id).id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notify(e.userMessage(), error = true)
            }
        }
    }

    /** Archive (library) or delete (a lesson); [onDone] navigates away. */
    fun archiveOrDelete(onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                if (target == "library") deps.api.archiveLibraryItem(id) else deps.api.deleteCustomLesson(id)
                deps.cache.delete(draftKey)
                deps.cache.delete(targetKey)
                _ui.update { it.copy(savedCanonical = JsJson.canonical(it.spec) ?: "") }
                onDone()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notify(e.userMessage(), error = true)
            }
        }
    }

    /** Raw JSON → the form: parse errors or the validator's problems, else applied (unsaved). */
    fun applyRawJson(text: String): List<String> {
        val parsed = try {
            kotlinx.serialization.json.Json.parseToJsonElement(text)
        } catch (e: Exception) {
            return listOf("Not valid JSON: ${e.message}")
        }
        val problems = LessonValidator.validate(parsed)
        if (problems.isNotEmpty()) return problems
        setSpec(parsed as JsonObject)
        return emptyList()
    }

    val subtitle: String
        get() {
            val u = _ui.value
            return when {
                target == "library" -> "Library master copy"
                !u.isOwner -> "Student's lesson (you assigned it)"
                u.assigned -> "Assigned by your tutor — your copy"
                else -> "Your lesson"
            }
        }

    class Factory(private val deps: EditorDeps, private val target: String, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = LessonEditorViewModel(deps, target, id) as T
    }
}
