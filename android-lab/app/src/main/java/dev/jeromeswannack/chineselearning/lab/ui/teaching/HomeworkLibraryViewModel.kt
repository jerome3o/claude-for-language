package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkLibrary
import dev.jeromeswannack.chineselearning.lab.core.HomeworkRemoval
import dev.jeromeswannack.chineselearning.lab.core.LibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentPatchBody
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLibraryDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLinkUpdateBody
import dev.jeromeswannack.chineselearning.lab.data.api.TutorHomeworkLibraryDto
import dev.jeromeswannack.chineselearning.lab.data.api.relationshipHomeworkLibrary
import dev.jeromeswannack.chineselearning.lab.data.api.tutorHomeworkLibrary
import dev.jeromeswannack.chineselearning.lab.data.api.updateHomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.data.api.updateHomeworkLink
import dev.jeromeswannack.chineselearning.lab.data.api.updateStudentCopies
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** JsonCache keys of the homework library (kind [TeachingKeys.KIND]). */
object HomeworkLibraryKeys {
    /** GET /api/tutor/homework-library (every student). */
    const val ALL = "teaching/homework-library/all"
    /** GET /api/relationships/:relId/homework-library. */
    fun student(relId: String) = "teaching/homework-library/rel/$relId"
    const val MAX_AGE = 10 * 60_000L
}

/**
 * Keeps the library ready offline (registered in TeachingSync): the all-students library after
 * each sync (at most every 10 min), and each student's slice of it as that student's library,
 * so the student page's "Most recent homework" and `/connections/:relId/homework` open at once.
 */
internal suspend fun syncHomeworkLibrary(ctx: SyncContext) {
    if (!ctx.full && ctx.cache.isFresh(HomeworkLibraryKeys.ALL, HomeworkLibraryKeys.MAX_AGE)) return
    val all = ctx.api.tutorHomeworkLibrary()
    ctx.cache.put(HomeworkLibraryKeys.ALL, TeachingKeys.KIND, all)
    for (s in all.students) {
        val items = all.items.filter { it.relationship_id == s.relationship_id }
        ctx.cache.put(HomeworkLibraryKeys.student(s.relationship_id), TeachingKeys.KIND, HomeworkLibraryDto(items, HomeworkLibrary.libraryCounts(items), all.today))
    }
}

/** The library of one student (`relId`) or of every student (null) as a cache-first resource of rows. */
class HomeworkLibrarySource(app: LabApp, scope: CoroutineScope, val relId: String?) {
    private val one: CachedResource<HomeworkLibraryDto>? = relId?.let { id ->
        app.cachedResource(scope, HomeworkLibraryKeys.student(id), TeachingKeys.KIND) { relationshipHomeworkLibrary(id) }
    }
    private val all: CachedResource<TutorHomeworkLibraryDto>? = if (relId == null) {
        app.cachedResource(scope, HomeworkLibraryKeys.ALL, TeachingKeys.KIND) { tutorHomeworkLibrary() }
    } else null

    val state: StateFlow<Loadable<List<LibraryItem>>> = (one?.state?.let { s -> s.mapLoadable { it.items } } ?: all!!.state.mapLoadable { it.items })
        .stateIn(scope, SharingStarted.Eagerly, Loadable(loading = true))

    fun refresh() { one?.refresh(); all?.refresh() }

    /** Optimistic change to one row (a new due date, a cancelled link). */
    suspend fun patch(key: String, transform: (LibraryItem) -> LibraryItem?) {
        val apply = { items: List<LibraryItem> -> items.mapNotNull { if (it.key == key) transform(it) else it } }
        one?.let { r -> if (r.state.value.data != null) r.update { d -> d!!.copy(items = apply(d.items)) } }
        all?.let { r -> if (r.state.value.data != null) r.update { d -> d!!.copy(items = apply(d.items)) } }
    }
}

private fun <A, B> StateFlow<Loadable<A>>.mapLoadable(f: (A) -> B) = kotlinx.coroutines.flow.flow {
    collect { l -> emit(Loadable(l.data?.let(f), l.loading, l.error, l.offline, l.updatedAt)) }
}

/**
 * `/connections/:relId/homework` and `/homework-library` (web: HomeworkLibraryPage): the rows,
 * the filters, and the row actions — Update their copy (POST /api/student-copies/update), Change
 * due date (PATCH the row's due_assignment_id), Remove (the take-back flow; a link = cancel its
 * assignment), Edit link (PUT /api/homework-links/:id). Writes are online-only like the web.
 */
class HomeworkLibraryViewModel(private val app: LabApp, relId: String?, private val studentName: String?) : ViewModel() {
    val source = HomeworkLibrarySource(app, viewModelScope, relId)

    private data class Local(
        val filter: LibraryFilter = LibraryFilter(),
        val selected: LibraryItem? = null,
        val dueFor: LibraryItem? = null,
        val editLink: LibraryItem? = null,
        val cancelLink: LibraryItem? = null,
        val busyKey: String? = null,
        val notice: String? = null,
        val noticeIsError: Boolean = false,
    )

    private val local = MutableStateFlow(Local())
    /** The relationship the take-back sheet is about (the all-students page knows it per row). */
    @Volatile private var removalRel: String? = relId

    val removal = HomeworkRemovalController(app, viewModelScope, { removalRel }) { _, _ ->
        source.refresh()
        app.scope.launch { invalidate(removalRel) }
    }

    val ui: StateFlow<HomeworkLibraryUi> = combine(source.state, local, removal.sheet, removal.toast, app.online) { state, l, sheet, toast, online ->
        HomeworkLibraryUi(
            studentName = studentName,
            state = state,
            today = Homework.localDate(),
            filter = l.filter,
            selected = l.selected,
            dueFor = l.dueFor,
            editLink = l.editLink,
            cancelLink = l.cancelLink,
            busyKey = l.busyKey,
            notice = l.notice,
            noticeIsError = l.noticeIsError,
            removal = sheet,
            toast = toast,
            online = online,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, HomeworkLibraryUi(studentName = studentName))

    fun setFilter(f: LibraryFilter) { app.haptics.tick(); local.update { it.copy(filter = f) } }
    fun select(item: LibraryItem?) = local.update { it.copy(selected = item) }
    fun askDue(item: LibraryItem?) = local.update { it.copy(dueFor = item) }
    fun askCancelLink(item: LibraryItem?) = local.update { it.copy(cancelLink = item) }
    fun editLink(item: LibraryItem?) = local.update { it.copy(editLink = item) }
    private fun say(text: String, error: Boolean = false) = local.update { it.copy(notice = text, noticeIsError = error) }

    /** The student page / dashboard / student-page library caches that show these rows. */
    private suspend fun invalidate(relId: String?) {
        app.cache.delete(TeachingKeys.DASHBOARD)
        app.cache.delete(HomeworkLibraryKeys.ALL)
        if (relId != null) {
            app.cache.delete(HomeworkLibraryKeys.student(relId))
            app.cache.delete(TeachingKeys.homework(relId))
            app.cache.delete(TeachingKeys.overview(relId))
        }
    }

    fun updateCopy(item: LibraryItem) {
        val source = item.source_id ?: return
        viewModelScope.launch {
            local.update { it.copy(busyKey = item.key, notice = null) }
            attempt { app.repo.api.updateStudentCopies(item.kind, source, listOf(item.relationship_id)) }
                .onSuccess { res ->
                    val r = res.results.firstOrNull()
                    if (r != null && !r.ok) {
                        app.haptics.wrong()
                        say(r.error ?: "Could not update ${HomeworkRemoval.studentFirstName(item.student_name)}'s copy", true)
                    } else {
                        app.haptics.correct(); app.sounds.play(Sounds.Sfx.POP)
                        say(r?.detail?.takeIf { it.isNotBlank() }?.let { "${HomeworkRemoval.studentFirstName(item.student_name)}'s copy: $it" } ?: "Updated ${HomeworkRemoval.studentFirstName(item.student_name)}'s copy of ${item.title}. Their progress is kept.")
                        invalidate(item.relationship_id)
                        this@HomeworkLibraryViewModel.source.refresh()
                    }
                }
                .onFailure { say(it.userMessage().ifBlank { "Could not update their copy" }, true) }
            local.update { it.copy(busyKey = null) }
        }
    }

    fun changeDue(item: LibraryItem, date: String) {
        val assignmentId = item.due_assignment_id ?: return
        local.update { it.copy(dueFor = null) }
        viewModelScope.launch {
            local.update { it.copy(busyKey = item.key, notice = null) }
            attempt { app.repo.api.updateHomeworkAssignment(item.relationship_id, assignmentId, AssignmentPatchBody(due_date = date)) }
                .onSuccess {
                    app.haptics.tick()
                    val today = Homework.localDate()
                    source.patch(item.key) { row ->
                        val complete = row.status == HomeworkLibrary.COMPLETED
                        row.copy(due_date = date, status = HomeworkLibrary.libraryStatus(complete, row.status == HomeworkLibrary.IN_PROGRESS || row.percent > 0, date, today))
                    }
                    say("${item.title} is now due ${Homework.shortDay(date)}.")
                    invalidate(item.relationship_id)
                    source.refresh()
                }
                .onFailure { say(it.userMessage().ifBlank { "Could not move the due date" }, true) }
            local.update { it.copy(busyKey = null) }
        }
    }

    /** Remove: the take-back sheet for a deck / lesson / reader (its own preview + confirm). */
    fun remove(item: LibraryItem) {
        removalRel = item.relationship_id
        val id = when (item.kind) {
            HomeworkRemoval.LESSON -> item.target_id
            else -> item.share_id ?: item.target_id
        }
        removal.start(RemovalTarget(item.kind, id, item.title), item.student_name)
    }

    /** A link has no copy: cancelling its assignment takes it off the student's homework. */
    fun cancelLink(item: LibraryItem) {
        local.update { it.copy(cancelLink = null) }
        viewModelScope.launch {
            local.update { it.copy(busyKey = item.key, notice = null) }
            val ids = item.assignment_ids.ifEmpty { listOfNotNull(item.due_assignment_id) }
            attempt { ids.forEach { app.repo.api.updateHomeworkAssignment(item.relationship_id, it, AssignmentPatchBody(status = "cancelled")) } }
                .onSuccess {
                    app.haptics.correct()
                    source.patch(item.key) { null }
                    say("Cancelled “${item.title}” for ${HomeworkRemoval.studentFirstName(item.student_name)}.")
                    invalidate(item.relationship_id)
                    source.refresh()
                }
                .onFailure { say(it.userMessage().ifBlank { "Could not cancel the link" }, true) }
            local.update { it.copy(busyKey = null) }
        }
    }

    /** Edit link: PUT /api/homework-links/:id, the student's copy updated too when ticked. */
    fun saveLink(item: LibraryItem, title: String, url: String, instructions: String, alsoCopy: Boolean, done: (String?) -> Unit) {
        val id = item.source_id ?: return done("Your original link is gone")
        viewModelScope.launch {
            attempt {
                app.repo.api.updateHomeworkLink(
                    id,
                    HomeworkLinkUpdateBody(title, url, instructions, update_student_copies = if (alsoCopy) listOf(item.relationship_id) else null),
                )
            }.onSuccess {
                app.haptics.correct(); app.sounds.play(Sounds.Sfx.POP)
                done(null)
                local.update { it.copy(editLink = null) }
                say(if (alsoCopy) "Saved — ${HomeworkRemoval.studentFirstName(item.student_name)}'s copy is updated." else "Saved your link. ${HomeworkRemoval.studentFirstName(item.student_name)}'s copy is unchanged.")
                invalidate(item.relationship_id)
                source.refresh()
            }.onFailure { done(it.userMessage().ifBlank { "Could not save the link" }) }
        }
    }

    class Factory(private val app: LabApp, private val relId: String?, private val studentName: String?) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = HomeworkLibraryViewModel(app, relId, studentName) as T
    }

    companion object {
        /** Open: the tutor's own master (deck / library lesson / reader); a link opens outside the app (route handles it). */
        fun openPath(item: LibraryItem): String? {
            val id = item.source_id ?: return null
            return when (item.kind) {
                "deck" -> Routes.deck(id)
                "lesson" -> Routes.libraryItem(id)
                "reader" -> Routes.reader(id)
                else -> null
            }
        }

        /** Edit: the deck page, the lesson editor, the reader editor; a link → the edit-link sheet (null). */
        fun editPath(item: LibraryItem): String? {
            val id = item.source_id ?: return null
            return when (item.kind) {
                "deck" -> Routes.deck(id)
                "lesson" -> Routes.libraryEdit(id)
                "reader" -> Routes.readerEdit(id)
                else -> null
            }
        }
    }
}
