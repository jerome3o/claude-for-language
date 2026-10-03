package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.ReaderValidator
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.deleteReader
import dev.jeromeswannack.chineselearning.lab.data.api.generateReaderPageImage
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.readerAssist
import dev.jeromeswannack.chineselearning.lab.data.api.readerSpec
import dev.jeromeswannack.chineselearning.lab.data.api.saveReaderSpec
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

@Serializable
data class CachedReaderTarget(val spec: JsonObject, val isPublished: Int = 1)

data class ReaderEditorUi(
    val loading: Boolean = true,
    val loadError: String? = null,
    val spec: JsonObject? = null,
    /** The last saved spec (a page can only be illustrated once its prompt is saved). */
    val savedSpec: JsonObject? = null,
    val errors: List<String> = emptyList(),
    val saving: Boolean = false,
    val isPublished: Int = 1,
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    val restoredDraft: Boolean = false,
    val view: EditorView = EditorView.EDIT,
    /** Page index → "english" | "image_prompt" | "illustrate" while Claude / the image job runs. */
    val busy: Map<Int, String> = emptyMap(),
    /** Page index → a failure line under that page. */
    val pageNotes: Map<Int, String> = emptyMap(),
    val online: Boolean = true,
    /** Successful saves in this visit — the route asks "Also update their copies?" after each (docs/HOMEWORK.md §10). */
    val savedCount: Int = 0,
) {
    val dirty: Boolean get() = spec != null && JsJson.canonical(spec) != JsJson.canonical(savedSpec)
}

/**
 * The graded-reader editor (web: pages/editor/ReaderEditorPage.tsx): the whole reader as one
 * spec, saved with one `PUT /api/readers/:id/spec`; after a save that queued illustrations it
 * polls for them (every 5 s, ~2 min) and merges the image keys in without touching edits.
 * Unsaved edits live in the JsonCache like the lesson editor's.
 */
class ReaderEditorViewModel(private val deps: EditorDeps, val id: String, private val pollMs: Long = 5_000) : ViewModel() {
    private val _ui = MutableStateFlow(ReaderEditorUi())
    val ui: StateFlow<ReaderEditorUi> = _ui
    private val targetKey = "editor/reader/$id"
    private val draftKey = "editor/draft/reader/$id"
    private var draftJob: Job? = null
    private var pollJob: Job? = null

    val chat = EditorChatModel(deps, viewModelScope, "reader", id) { proposed ->
        setSpec(proposed)
        notify("Proposal applied — press Save to keep it")
    }

    init { load() }

    fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, loadError = null, online = deps.online()) }
            val cached = deps.cache.get(targetKey, CachedReaderTarget.serializer())
            val fresh = try {
                if (!deps.online() && cached != null) null
                else deps.api.readerSpec(id).let { CachedReaderTarget(it.spec, it.is_published) }.also { deps.cache.put(targetKey, "editor", it, CachedReaderTarget.serializer()) }
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
            val useDraft = draft != null && JsJson.canonical(draft) != JsJson.canonical(loaded.spec)
            val spec = if (useDraft) draft!! else loaded.spec
            _ui.update {
                it.copy(
                    loading = false, spec = spec, savedSpec = loaded.spec, errors = ReaderValidator.validate(spec),
                    isPublished = loaded.isPublished, restoredDraft = useDraft,
                    notice = if (fresh == null) "You're offline — editing the copy on this phone. Save when you're back online." else null,
                )
            }
        }
    }

    fun setSpec(spec: JsonObject) {
        _ui.update { it.copy(spec = spec, errors = ReaderValidator.validate(spec)) }
        draftJob?.cancel()
        draftJob = viewModelScope.launch {
            delay(400)
            if (JsJson.canonical(spec) == JsJson.canonical(_ui.value.savedSpec)) deps.cache.delete(draftKey)
            else deps.cache.put(draftKey, "editor-drafts", spec, JsonObject.serializer())
        }
    }

    fun discardDraft() {
        viewModelScope.launch {
            deps.cache.delete(draftKey)
            val saved = _ui.value.savedSpec ?: return@launch
            _ui.update { it.copy(spec = saved, errors = ReaderValidator.validate(saved), restoredDraft = false) }
        }
    }

    fun setView(view: EditorView) = _ui.update { it.copy(view = view) }

    fun notify(message: String, error: Boolean = false) {
        _ui.update { it.copy(notice = message, noticeIsError = error) }
        viewModelScope.launch {
            delay(3_500)
            _ui.update { if (it.notice == message) it.copy(notice = null) else it }
        }
    }

    fun save() {
        val state = _ui.value
        val spec = state.spec ?: return
        if (state.errors.isNotEmpty() || state.saving || !state.dirty) return
        _ui.update { it.copy(saving = true) }
        viewModelScope.launch {
            try {
                val result = deps.api.saveReaderSpec(id, spec)
                deps.cache.put(targetKey, "editor", CachedReaderTarget(result.spec, result.is_published), CachedReaderTarget.serializer())
                deps.cache.delete(draftKey)
                draftJob?.cancel()
                _ui.update { it.copy(saving = false, spec = result.spec, savedSpec = result.spec, errors = ReaderValidator.validate(result.spec), restoredDraft = false, savedCount = it.savedCount + 1) }
                deps.feedback.success()
                val jobs = result.image_jobs ?: 0
                if (jobs > 0) {
                    notify("Saved — $jobs illustration${if (jobs == 1) "" else "s"} drawing in the background")
                    pollImages()
                } else notify("Saved")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(saving = false) }
                deps.feedback.error()
                val problems = (e as? HttpException)?.problems().orEmpty()
                notify("Not saved: ${if (problems.isNotEmpty()) problems.joinToString("; ") else e.userMessage()}", error = true)
            }
        }
    }

    /** After a save that queued illustrations, poll for them for a couple of minutes (every [pollMs], 24 ticks). */
    private fun pollImages() {
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            repeat(24) {
                delay(pollMs)
                val fresh = runCatching { deps.api.readerSpec(id).spec }.getOrNull() ?: return@repeat
                adoptImages(fresh)
                val pending = fresh.objs("pages").count { JsJson.truthy(it["image_prompt"]) && !JsJson.truthy(it["image_url"]) }
                if (pending == 0) return@launch
            }
        }
    }

    /** Merge server image keys into the working and saved copies without touching edits (adoptImages). */
    fun adoptImages(server: JsonObject) {
        val serverPages = server.objs("pages")
        val keys = serverPages.filter { JsJson.truthy(it["id"]) && JsJson.truthy(it["image_url"]) }.associate { it.str("id")!! to it.str("image_url")!! }
        fun patch(s: JsonObject?): JsonObject? {
            if (s == null) return null
            var changed = false
            val pages = s.objs("pages").map { p ->
                val pid = p.str("id")
                val key = pid?.let { keys[it] }
                val serverPrompt = serverPages.firstOrNull { it.str("id") == pid }?.text("image_prompt") ?: ""
                if (key != null && p.str("image_url") != key && p.text("image_prompt") == serverPrompt) { changed = true; p.with("image_url", key) } else p
            }
            return if (changed) s.withObjs("pages", pages) else s
        }
        _ui.update { it.copy(spec = patch(it.spec), savedSpec = patch(it.savedSpec)) }
    }

    /** Translate the page / draft its illustration prompt with Claude (works for unsaved text). */
    fun assist(index: Int, field: String) {
        val page = _ui.value.spec?.objs("pages")?.getOrNull(index) ?: return
        val chinese = page.text("content_chinese")
        if (JsJson.trim(chinese).isEmpty() || _ui.value.busy.isNotEmpty()) return
        _ui.update { it.copy(busy = it.busy + (index to field), pageNotes = it.pageNotes - index) }
        deps.feedback.tick()
        viewModelScope.launch {
            try {
                val text = deps.api.readerAssist(id, field, chinese, page.str("content_english"))
                updatePage(index) { it.with(if (field == "english") "content_english" else "image_prompt", text) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(pageNotes = it.pageNotes + (index to (if (e is HttpException && e.code == 503) "Claude is unavailable" else e.userMessage()))) }
            } finally {
                _ui.update { it.copy(busy = it.busy - index) }
            }
        }
    }

    /** Generate the illustration for a saved page now. */
    fun illustrate(index: Int) {
        val page = _ui.value.spec?.objs("pages")?.getOrNull(index) ?: return
        val pageId = page.str("id") ?: return
        _ui.update { it.copy(busy = it.busy + (index to "illustrate"), pageNotes = it.pageNotes - index) }
        deps.feedback.tick()
        viewModelScope.launch {
            try {
                val key = deps.api.generateReaderPageImage(id, pageId).image_url
                if (key != null) {
                    updatePage(index) { it.with("image_url", key) }
                    _ui.update { u -> u.copy(savedSpec = u.savedSpec?.let { s -> s.withObjs("pages", s.objs("pages").map { p -> if (p.str("id") == pageId) p.with("image_url", key) else p }) }) }
                    deps.feedback.success()
                } else {
                    _ui.update { it.copy(pageNotes = it.pageNotes + (index to "No image came back — try again in a moment.")) }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(pageNotes = it.pageNotes + (index to e.userMessage())) }
            } finally {
                _ui.update { it.copy(busy = it.busy - index) }
            }
        }
    }

    private fun updatePage(index: Int, f: (JsonObject) -> JsonObject) {
        val spec = _ui.value.spec ?: return
        val pages = spec.objs("pages")
        if (index !in pages.indices) return
        setSpec(spec.withObjs("pages", pages.replaceAt(index, f(pages[index]))))
    }

    fun delete(onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                deps.api.deleteReader(id)
                deps.cache.delete(draftKey)
                deps.cache.delete(targetKey)
                _ui.update { it.copy(savedSpec = it.spec) }
                onDone()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notify(e.userMessage(), error = true)
            }
        }
    }

    fun applyRawJson(text: String): List<String> {
        val parsed = try {
            kotlinx.serialization.json.Json.parseToJsonElement(text)
        } catch (e: Exception) {
            return listOf("Not valid JSON: ${e.message}")
        }
        val problems = ReaderValidator.validate(parsed)
        if (problems.isNotEmpty()) return problems
        setSpec(parsed as JsonObject)
        return emptyList()
    }

    class Factory(private val deps: EditorDeps, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ReaderEditorViewModel(deps, id) as T
    }
}
