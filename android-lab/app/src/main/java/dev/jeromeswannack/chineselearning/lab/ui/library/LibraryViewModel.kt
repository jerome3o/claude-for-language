package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonExport
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryAssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummary
import dev.jeromeswannack.chineselearning.lab.data.api.archiveLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.createLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.duplicateLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.generateLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.importLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.libraryAssignments
import dev.jeromeswannack.chineselearning.lab.data.api.libraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.libraryItems
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.pushLibraryUpdate
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.editor.ExportFile
import dev.jeromeswannack.chineselearning.lab.ui.editor.ExportFormat
import dev.jeromeswannack.chineselearning.lab.ui.editor.lessonExport
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.IOException
import java.io.InterruptedIOException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

// The tutor's Lesson Library (web: pages/editor/LessonLibraryPage.tsx, LibraryItemPage.tsx).
// Logic lives in plain "models" that take a CoroutineScope, so tests drive them against a fake
// server; the ViewModels only own them (viewModelScope survives rotation / folding).

/** Cache keys ("library/…", kind "library"). */
object LibraryKeys {
    const val KIND = "library"
    const val LIST = "library/list"
    fun item(id: String) = "library/item/$id"
    fun assignments(id: String) = "library/assignments/$id"
}

/** Haptics + sounds, as calls the models make (no-op in tests). */
interface LibraryFeel {
    fun tick() {}
    fun success() {}

    object None : LibraryFeel

    companion object {
        fun of(app: LabApp): LibraryFeel = object : LibraryFeel {
            override fun tick() = app.haptics.tick()
            override fun success() {
                app.haptics.correct()
                app.sounds.play(Sounds.Sfx.POP)
            }
        }
    }
}

/** What the library screens need from the app. */
class LibraryDeps(
    val api: Api,
    val cache: JsonCache,
    val online: () -> Boolean = { true },
    val feel: LibraryFeel = LibraryFeel.None,
    val today: () -> LocalDate = { LocalDate.now() },
    /** How long "Still drafting" waits before looking for the new lesson. */
    val draftRecheckMs: Long = 45_000,
    val noticeMs: Long = 3_000,
    /** Folders of the Library list (data/folders/); null = none (tests / previews). */
    val folderWrites: dev.jeromeswannack.chineselearning.lab.data.folders.FolderWrites? = null,
    val folderFeel: dev.jeromeswannack.chineselearning.lab.ui.folders.FolderFeel = dev.jeromeswannack.chineselearning.lab.ui.folders.FolderFeel.None,
) {
    companion object {
        fun from(app: LabApp) = LibraryDeps(
            app.repo.api, app.cache, { app.online.value }, LibraryFeel.of(app),
            folderWrites = dev.jeromeswannack.chineselearning.lab.ui.folders.FolderController.writes(app),
            folderFeel = dev.jeromeswannack.chineselearning.lab.ui.folders.FolderFeel.of(app),
        )
    }
}

/** One-shot things the screen does for the model (navigation, the share sheet, printing). */
sealed interface LibraryEffect {
    data class Open(val path: String) : LibraryEffect
    data class OpenInMainApp(val path: String) : LibraryEffect
    data class Export(val file: ExportFile, val save: Boolean) : LibraryEffect
    data class Print(val title: String, val markdown: String) : LibraryEffect
    /** Open the Anki export sheet (ui/kit/AnkiExportSheet.kt) for a lesson. */
    data class Anki(val target: dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportTarget) : LibraryEffect
}

/** A line at the top of the screen: success lines fade after a few seconds, errors stay. */
data class Notice(val text: String, val kind: NoticeKind, val id: Long = System.nanoTime())

/** The web's wording and dates. */
object LibraryText {
    private val monthDay = DateTimeFormatter.ofPattern("MMM d", Locale.ENGLISH)

    /** "2026-09-27 10:00:00" / ISO with or without 'Z' (UTC when there is no zone) → the local day. */
    fun parseDay(iso: String?, zone: ZoneId = ZoneId.systemDefault()): LocalDate? {
        if (iso.isNullOrBlank()) return null
        val s = iso.trim().replace(' ', 'T')
        return runCatching { Instant.parse(s).atZone(zone).toLocalDate() }.getOrNull()
            ?: runCatching { java.time.OffsetDateTime.parse(s).atZoneSameInstant(zone).toLocalDate() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(s).toInstant(ZoneOffset.UTC).atZone(zone).toLocalDate() }.getOrNull()
            ?: runCatching { LocalDate.parse(s.take(10)) }.getOrNull()
    }

    /** The web's `formatDate`: "Sep 27". */
    fun shortDate(iso: String?, zone: ZoneId = ZoneId.systemDefault()): String = parseDay(iso, zone)?.format(monthDay) ?: "—"

    private val weekday = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    private val month = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** shared/homework `shortDay`: "Mon 29 Sep". */
    fun shortDay(d: LocalDate): String = "${weekday[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${month[d.monthValue - 1]}"

    fun plural(n: Int, word: String, many: String = word + "s") = "$n ${if (n == 1) word else many}"

    fun meta(item: LibraryItemSummary): String =
        "${plural(item.exercise_count, "exercise")} · " +
            (if (item.assignment_count == 0) "not assigned" else "assigned to ${plural(item.assignment_count, "student")}") +
            " · updated ${shortDate(item.updated_at)}"

    fun exerciseCount(spec: JsonObject): Int =
        (spec["sections"] as? JsonArray).orEmpty().sumOf { s -> ((s as? JsonObject)?.get("exercises") as? JsonArray)?.size ?: 0 }

    val RATING_LABELS = mapOf(0 to "Again", 1 to "Hard", 2 to "Good", 3 to "Easy")

    const val CLAUDE_MISSING = "Claude is not configured on this server — start blank instead."
    const val STILL_DRAFTING = "Still drafting — it will appear in your library in a minute."
}

// ============================ New lesson ============================

val CONVERSATION_LEVELS = listOf("Beginner (HSK 1-2)", "Elementary (HSK 3)", "Intermediate (HSK 4)", "Upper intermediate (HSK 5+)")

/** The web's `conversationLessonPrompt` — the drafting prompt for a conversation lesson. */
fun conversationLessonPrompt(situation: String, level: String): String =
    "A conversation lesson for a $level learner. Situation: ${situation.trim()}. " +
        "Open with a short note of 2-3 key phrases, then a conversation exercise (two speakers, one female and one male voice, " +
        "6-12 natural lines at this level with pinyin and English, 3-4 comprehension questions in English about what happened), " +
        "and end with an oral_expression exercise where the learner plays one of the roles in the same situation."

/** "Start blank": exactly the web's blank spec. */
fun blankLessonSpec(): JsonObject = JsJson.obj(
    "title" to JsonPrimitive("New lesson"),
    "icon" to JsonPrimitive("🎓"),
    "sections" to JsonArray(listOf(JsJson.obj(
        "title" to JsonPrimitive("Warm-up"),
        "exercises" to JsonArray(listOf(JsJson.obj(
            "type" to JsonPrimitive("note"),
            "title" to JsonPrimitive("What this lesson covers"),
            "body" to JsonPrimitive("Write a short explanation here."),
        ))),
    ))),
)

enum class NewLessonBusy { DRAFT, CONVERSATION, BLANK }

data class NewLessonUi(
    val prompt: String = "",
    val situation: String = "",
    val level: String = CONVERSATION_LEVELS[0],
    val busy: NewLessonBusy? = null,
    val error: String? = null,
)

// ============================ Library list ============================

data class LibraryUi(
    val list: Loadable<List<LibraryItemSummary>> = Loadable(loading = true),
    val notice: Notice? = null,
    val newLesson: NewLessonUi? = null,
    val pageMenu: Boolean = false,
    /** The card whose ⋯ sheet is open. */
    val menuFor: LibraryItemSummary? = null,
    val confirmArchive: LibraryItemSummary? = null,
    val assign: AssignUi? = null,
    /** An item with a duplicate / export / archive in flight (its buttons dim). */
    val busyItemId: String? = null,
)

private data class LibraryLocal(
    val notice: Notice? = null,
    val newLesson: NewLessonUi? = null,
    val pageMenu: Boolean = false,
    val menuFor: LibraryItemSummary? = null,
    val confirmArchive: LibraryItemSummary? = null,
    val busyItemId: String? = null,
)

/** Shared by the list and the item page: notices that fade, effects, full-spec fetch. */
abstract class LibraryModelBase(protected val scope: CoroutineScope, protected val deps: LibraryDeps) {
    private val _effects = MutableSharedFlow<LibraryEffect>(extraBufferCapacity = 8)
    val effects: SharedFlow<LibraryEffect> = _effects.asSharedFlow()

    protected fun emit(effect: LibraryEffect) { _effects.tryEmit(effect) }

    protected abstract fun setNotice(notice: Notice?)
    protected abstract fun currentNotice(): Notice?

    fun showSuccess(text: String) {
        val n = Notice(text, NoticeKind.Success)
        setNotice(n)
        scope.launch {
            delay(deps.noticeMs)
            if (currentNotice()?.id == n.id) setNotice(null)
        }
    }

    fun showError(text: String) = setNotice(Notice(text, NoticeKind.Error))
    fun showInfo(text: String) = setNotice(Notice(text, NoticeKind.Info))
    fun dismissNotice() = setNotice(null)

    /** The item with its spec: fresh when online, else the copy on the phone. */
    protected suspend fun fullItem(id: String): LibraryItemDto {
        val key = LibraryKeys.item(id)
        return try {
            deps.api.libraryItem(id).also { deps.cache.put(key, LibraryKeys.KIND, it, LibraryItemDto.serializer()) }
        } catch (e: IOException) {
            if (e is HttpException) throw e
            deps.cache.get(key, LibraryItemDto.serializer()) ?: throw e
        }
    }

    protected fun exportEffect(spec: JsonObject, format: ExportFormat, save: Boolean) = emit(LibraryEffect.Export(lessonExport(spec, format), save))
    protected fun printEffect(title: String, spec: JsonObject) = emit(LibraryEffect.Print(title, LessonExport.toMarkdown(spec)))
}

class LibraryModel(scope: CoroutineScope, deps: LibraryDeps) : LibraryModelBase(scope, deps) {
    val list: CachedResource<List<LibraryItemSummary>> = CachedResource(
        scope, deps.cache, LibraryKeys.LIST, LibraryKeys.KIND, ListSerializer(LibraryItemSummary.serializer()), online = deps.online,
    ) { deps.api.libraryItems() }

    private val local = MutableStateFlow(LibraryLocal())
    val assign = AssignController(scope, deps) { message ->
        showSuccess(message)
        list.refresh()
    }

    /** Folders of the Library (shared with Decks and Readers: ui/folders/). */
    val folders: dev.jeromeswannack.chineselearning.lab.ui.folders.FolderController? = deps.folderWrites?.let { w ->
        dev.jeromeswannack.chineselearning.lab.ui.folders.FolderController(
            scope, dev.jeromeswannack.chineselearning.lab.core.Folders.LESSON, deps.cache, w, deps.folderFeel,
            currentFolderOf = { id -> list.state.value.data?.firstOrNull { it.id == id }?.folder_id },
        )
    }

    /** ⋯ → Move to folder…. */
    fun moveToFolder(item: LibraryItemSummary) {
        local.update { it.copy(menuFor = null) }
        folders?.openMove(listOf(item.id))
    }

    val ui: StateFlow<LibraryUi> = combine(list.state, local, assign.state) { l, s, a ->
        LibraryUi(l, s.notice, s.newLesson, s.pageMenu, s.menuFor, s.confirmArchive, a, s.busyItemId)
    }.stateIn(scope, SharingStarted.Eagerly, LibraryUi())

    override fun setNotice(notice: Notice?) = local.update { it.copy(notice = notice) }
    override fun currentNotice(): Notice? = local.value.notice

    fun refresh() = list.refresh()

    // ---- page ⋯ ----
    fun openPageMenu() { deps.feel.tick(); local.update { it.copy(pageMenu = true) } }
    fun closePageMenu() = local.update { it.copy(pageMenu = false) }

    /** Import JSON…: a bare spec or an export wrapper `{ spec }`. */
    fun importJson(text: String) {
        local.update { it.copy(pageMenu = false) }
        scope.launch {
            try {
                val parsed: JsonElement = try {
                    Json.parseToJsonElement(text)
                } catch (_: Exception) {
                    showError("Import failed: not a lesson JSON file")
                    return@launch
                }
                val spec = if (parsed is JsonObject && "spec" in parsed && "sections" !in parsed) parsed["spec"]!! else parsed
                val item = deps.api.importLibraryItem(spec)
                list.refresh()
                deps.feel.success()
                showSuccess("Imported “${item.title}”")
                emit(LibraryEffect.Open(Routes.libraryItem(item.id)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val problems = (e as? HttpException)?.problems().orEmpty()
                showError(if (problems.isNotEmpty()) "Import failed: ${problems.take(3).joinToString("; ")}" else "Import failed: ${e.userMessage()}")
            }
        }
    }

    // ---- New lesson ----
    fun openNewLesson() { deps.feel.tick(); local.update { it.copy(newLesson = it.newLesson ?: NewLessonUi()) } }

    /** Closing while a draft is running keeps the draft going; it opens the editor when done. */
    fun closeNewLesson() = local.update { it.copy(newLesson = null) }

    fun editNewLesson(transform: (NewLessonUi) -> NewLessonUi) = local.update { s -> s.copy(newLesson = s.newLesson?.let(transform)) }

    fun draft() = local.value.newLesson?.let { if (it.prompt.isNotBlank()) generate(it.prompt.trim(), NewLessonBusy.DRAFT) }

    fun draftConversation() = local.value.newLesson?.let {
        if (it.situation.isNotBlank()) generate(conversationLessonPrompt(it.situation, it.level).trim(), NewLessonBusy.CONVERSATION)
    }

    private fun generate(prompt: String, which: NewLessonBusy) {
        if (local.value.newLesson?.busy != null) return
        editNewLesson { it.copy(busy = which, error = null) }
        scope.launch {
            try {
                val item = deps.api.generateLibraryItem(prompt)
                created(item.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                when {
                    e is InterruptedIOException -> {
                        // OkHttp gave up at 60 s; the server keeps drafting and saves it to the library.
                        local.update { it.copy(newLesson = null) }
                        showInfo(LibraryText.STILL_DRAFTING)
                        scope.launch {
                            delay(deps.draftRecheckMs)
                            list.refresh()
                        }
                    }
                    else -> newLessonFailed(if (e is HttpException && e.code == 503) LibraryText.CLAUDE_MISSING else e.userMessage())
                }
            }
        }
    }

    fun startBlank() {
        if (local.value.newLesson?.busy != null) return
        editNewLesson { it.copy(busy = NewLessonBusy.BLANK, error = null) }
        scope.launch {
            try {
                created(deps.api.createLibraryItem(blankLessonSpec()).id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                newLessonFailed(e.userMessage())
            }
        }
    }

    private fun created(id: String) {
        local.update { it.copy(newLesson = null) }
        list.refresh()
        deps.feel.success()
        emit(LibraryEffect.Open(Routes.libraryEdit(id)))
    }

    private fun newLessonFailed(message: String) {
        if (local.value.newLesson == null) showError(message) // the sheet was closed meanwhile
        else editNewLesson { it.copy(busy = null, error = message) }
    }

    // ---- per-card actions ----
    fun openMenu(item: LibraryItemSummary) { deps.feel.tick(); local.update { it.copy(menuFor = item) } }
    fun closeMenu() = local.update { it.copy(menuFor = null) }

    fun edit(item: LibraryItemSummary) = emit(LibraryEffect.Open(Routes.libraryEdit(item.id)))
    fun openItem(item: LibraryItemSummary) = emit(LibraryEffect.Open(Routes.libraryItem(item.id)))
    fun assign(item: LibraryItemSummary) { deps.feel.tick(); assign.open(item.id, item.title) }
    fun anki(item: LibraryItemSummary) = withItem(item, "Export failed") {
        emit(LibraryEffect.Anki(dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportTarget.Lesson(fullItem(item.id).spec, item.id)))
    }

    fun duplicate(item: LibraryItemSummary) = withItem(item, "Could not duplicate") {
        val copy = deps.api.duplicateLibraryItem(item.id)
        list.refresh()
        emit(LibraryEffect.Open(Routes.libraryEdit(copy.id)))
    }

    fun export(item: LibraryItemSummary, format: ExportFormat, save: Boolean) = withItem(item, "Export failed") {
        exportEffect(fullItem(item.id).spec, format, save)
    }

    fun print(item: LibraryItemSummary) = withItem(item, "Export failed") {
        val full = fullItem(item.id)
        printEffect(full.title, full.spec)
    }

    fun askArchive(item: LibraryItemSummary) = local.update { it.copy(menuFor = null, confirmArchive = item) }
    fun cancelArchive() = local.update { it.copy(confirmArchive = null) }

    fun archive(item: LibraryItemSummary) {
        local.update { it.copy(confirmArchive = null) }
        withItem(item, "Could not archive") {
            deps.api.archiveLibraryItem(item.id)
            list.update { l -> l.orEmpty().filter { it.id != item.id } }
            list.refresh()
            showSuccess("Archived")
        }
    }

    private fun withItem(item: LibraryItemSummary, fallback: String, block: suspend () -> Unit) {
        local.update { it.copy(menuFor = null, busyItemId = item.id) }
        scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                showError(e.userMessage().ifBlank { fallback })
            } finally {
                local.update { if (it.busyItemId == item.id) it.copy(busyItemId = null) else it }
            }
        }
    }
}

class LibraryViewModel(deps: LibraryDeps) : ViewModel() {
    val model = LibraryModel(viewModelScope, deps)
}

// ============================ Library item ============================

data class LibraryItemUi(
    val item: Loadable<LibraryItemDto> = Loadable(loading = true),
    val assignments: Loadable<List<LibraryAssignmentDto>> = Loadable(loading = true),
    val notice: Notice? = null,
    val pushing: Boolean = false,
    val exportSheet: Boolean = false,
    val assign: AssignUi? = null,
)

private data class ItemLocal(val notice: Notice? = null, val pushing: Boolean = false, val exportSheet: Boolean = false)

class LibraryItemModel(scope: CoroutineScope, deps: LibraryDeps, val id: String) : LibraryModelBase(scope, deps) {
    val item: CachedResource<LibraryItemDto> = CachedResource(
        scope, deps.cache, LibraryKeys.item(id), LibraryKeys.KIND, LibraryItemDto.serializer(), online = deps.online,
    ) { deps.api.libraryItem(id) }

    val assignments: CachedResource<List<LibraryAssignmentDto>> = CachedResource(
        scope, deps.cache, LibraryKeys.assignments(id), LibraryKeys.KIND, ListSerializer(LibraryAssignmentDto.serializer()), online = deps.online,
    ) { deps.api.libraryAssignments(id) }

    private val local = MutableStateFlow(ItemLocal())
    val assign = AssignController(scope, deps) { message ->
        showSuccess(message)
        assignments.refresh()
        // The list's "assigned to N" changed: refresh it behind the scenes.
        scope.launch {
            runCatching { deps.cache.put(LibraryKeys.LIST, LibraryKeys.KIND, deps.api.libraryItems(), ListSerializer(LibraryItemSummary.serializer())) }
        }
    }

    val ui: StateFlow<LibraryItemUi> = combine(item.state, assignments.state, local, assign.state) { i, a, l, s ->
        LibraryItemUi(i, a, l.notice, l.pushing, l.exportSheet, s)
    }.stateIn(scope, SharingStarted.Eagerly, LibraryItemUi())

    override fun setNotice(notice: Notice?) = local.update { it.copy(notice = notice) }
    override fun currentNotice(): Notice? = local.value.notice

    fun refresh() {
        item.refresh()
        assignments.refresh()
    }

    fun edit() = emit(LibraryEffect.Open(Routes.libraryEdit(id)))
    fun tryIt() = emit(LibraryEffect.Open(Routes.libraryTry(id)))
    fun openCopy(row: LibraryAssignmentDto) = emit(LibraryEffect.Open(Routes.lessonEdit(row.lesson_id)))
    fun openAnswers(row: LibraryAssignmentDto) {
        val rel = row.relationship_id ?: return
        val attempt = row.last_attempt_id ?: return
        emit(LibraryEffect.Open(Routes.studentLessonAttempts(rel, attempt)))
    }

    fun openAssign() {
        val title = item.state.value.data?.title ?: return
        deps.feel.tick()
        assign.open(id, title)
    }

    fun print() {
        val it = item.state.value.data ?: return
        printEffect(it.title, it.spec)
    }

    fun openExport() { deps.feel.tick(); local.update { it.copy(exportSheet = true) } }
    fun closeExport() = local.update { it.copy(exportSheet = false) }

    fun export(format: ExportFormat, save: Boolean) {
        val it = item.state.value.data ?: return
        local.update { s -> s.copy(exportSheet = false) }
        exportEffect(it.spec, format, save)
    }

    fun anki() {
        local.update { it.copy(exportSheet = false) }
        val it = item.state.value.data ?: return
        emit(LibraryEffect.Anki(dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportTarget.Lesson(it.spec, id)))
    }

    fun push() {
        if (local.value.pushing) return
        local.update { it.copy(pushing = true) }
        scope.launch {
            try {
                val r = deps.api.pushLibraryUpdate(id)
                deps.feel.success()
                showSuccess("Updated ${r.updated} student cop${if (r.updated == 1) "y" else "ies"}${if (r.skipped > 0) ", ${r.skipped} already current" else ""}")
                assignments.refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                showError(e.userMessage())
            } finally {
                local.update { it.copy(pushing = false) }
            }
        }
    }
}

class LibraryItemViewModel(deps: LibraryDeps, id: String) : ViewModel() {
    val model = LibraryItemModel(viewModelScope, deps, id)
}
