package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.AssignItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentPatchBody
import dev.jeromeswannack.chineselearning.lab.data.api.TeachFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.PendingInviteDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentSharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.TeachingMeDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorDashboardDto
import dev.jeromeswannack.chineselearning.lab.data.api.assignHomework
import dev.jeromeswannack.chineselearning.lab.data.api.cardFlags
import dev.jeromeswannack.chineselearning.lab.data.api.conversations
import dev.jeromeswannack.chineselearning.lab.data.api.createDeckNamed
import dev.jeromeswannack.chineselearning.lab.data.api.createInvite
import dev.jeromeswannack.chineselearning.lab.data.api.createStarterDeck
import dev.jeromeswannack.chineselearning.lab.data.api.lessonLibrary
import dev.jeromeswannack.chineselearning.lab.data.api.lessonLog
import dev.jeromeswannack.chineselearning.lab.data.api.liveCalls
import dev.jeromeswannack.chineselearning.lab.data.api.moveSharedDeck
import dev.jeromeswannack.chineselearning.lab.data.api.openConversation
import dev.jeromeswannack.chineselearning.lab.data.api.relationshipHomework
import dev.jeromeswannack.chineselearning.lab.data.api.removeRelationship
import dev.jeromeswannack.chineselearning.lab.data.api.reopenCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.replyToCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.resolveCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.revokeInvite
import dev.jeromeswannack.chineselearning.lab.data.api.sendInstallHowTo
import dev.jeromeswannack.chineselearning.lab.data.api.startCall
import dev.jeromeswannack.chineselearning.lab.data.api.studentClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.studentLessons
import dev.jeromeswannack.chineselearning.lab.data.api.studentOverview
import dev.jeromeswannack.chineselearning.lab.data.api.studentSharedDecks
import dev.jeromeswannack.chineselearning.lab.data.api.teachingMe
import dev.jeromeswannack.chineselearning.lab.data.api.tutorDashboard
import dev.jeromeswannack.chineselearning.lab.data.api.updateHomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.data.api.updateSharedDeckCopy
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.core.HomeworkPlan
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** JsonCache keys of package F (kind [TeachingKeys.KIND]). */
object TeachingKeys {
    const val KIND = "teaching"
    const val DASHBOARD = "teaching/dashboard"
    const val ME = "teaching/me"
    const val LIBRARY = "teaching/library"
    fun overview(relId: String) = "teaching/overview/$relId"
    fun homework(relId: String) = "teaching/homework/$relId"
    fun flags(relId: String) = "teaching/flags/$relId"
    fun claude(relId: String) = "teaching/claude/$relId"
    fun conversations(relId: String) = "teaching/conversations/$relId"
    fun lessons(relId: String) = "teaching/lessons/$relId"
    fun lessonLog(relId: String) = "teaching/lesson-log/$relId"
}

/** Runs [block], turning a failure into a sentence (never throws except cancellation). */
internal suspend fun <T> attempt(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(e)
}

// ---------------- dashboard ----------------

class DashboardViewModel(private val app: LabApp) : ViewModel() {
    val dashboard: CachedResource<TutorDashboardDto> = app.cachedResource(viewModelScope, TeachingKeys.DASHBOARD, TeachingKeys.KIND) { tutorDashboard() }
    val me: CachedResource<TeachingMeDto> = app.cachedResource(viewModelScope, TeachingKeys.ME, TeachingKeys.KIND, maxAgeMs = 60 * 60_000L) { teachingMe() }
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    /** The Send-homework sheet opened from a student's card. */
    val send = SendHomeworkController(app, viewModelScope) { dashboard.refresh() }

    fun revoke(invite: PendingInviteDto) = viewModelScope.launch {
        attempt { app.repo.api.revokeInvite(invite.id) }
            .onSuccess {
                app.haptics.tick()
                dashboard.update { d -> d?.copy(invites = d.invites.filterNot { it.id == invite.id }) ?: TutorDashboardDto() }
                dashboard.refresh()
            }
            .onFailure { _notice.value = it.userMessage() }
    }

    /** Message: the known conversation, else the most recent one (created if none). */
    fun message(o: dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto, go: (String) -> Unit) {
        o.last_conversation_id?.let { go(it); return }
        viewModelScope.launch {
            attempt { app.repo.api.openConversation(o.relationship_id) }
                .onSuccess { go(it.conversation_id) }
                .onFailure { _notice.value = it.userMessage() }
        }
    }

    /** Create link: the Starter Chinese deck first when it is ticked, then the invite. */
    fun createInvite(req: InviteRequest, step: (String?) -> Unit, done: (dev.jeromeswannack.chineselearning.lab.data.api.InviteDto?, String?) -> Unit) = viewModelScope.launch {
        attempt {
            var body = req.body
            if (req.withStarter) {
                step("Creating your Starter Chinese deck…")
                val starter = app.repo.api.createStarterDeck()
                body = body.copy(share_deck_ids = listOf(starter.deck.id) + body.share_deck_ids)
                app.scope.launch { app.repo.sync() }
            }
            step("Creating the link…")
            app.repo.api.createInvite(body)
        }.onSuccess { inv ->
            app.haptics.celebrate()
            app.sounds.play(Sounds.Sfx.POP)
            done(inv, null)
            dashboard.refresh()
        }.onFailure { done(null, it.userMessage()) }
    }

    fun createDeck(name: String, then: (String) -> Unit) = viewModelScope.launch {
        attempt { app.repo.api.createDeckNamed(name) }
            .onSuccess { deck ->
                app.haptics.correct()
                app.scope.launch { app.repo.sync() } // the new deck reaches Room for the deck page
                then(deck.id)
            }
            .onFailure { _notice.value = it.userMessage() }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = DashboardViewModel(app) as T
    }
}

// ---------------- send homework (dashboard card or student page) ----------------

/**
 * The Send-homework sheet's data and writes for one student: the tutor's decks from the Room
 * mirror (so the list opens offline), the lesson library (cached), and the three writes.
 */
class SendHomeworkController(private val app: LabApp, private val scope: CoroutineScope, private val onChanged: () -> Unit) {
    private val _decks = MutableStateFlow<List<DeckOption>?>(null)
    val decks: StateFlow<List<DeckOption>?> = _decks.asStateFlow()
    private var libraryResource: CachedResource<List<LibraryItemSummaryDto>>? = null
    private val _library = MutableStateFlow(Loadable<List<LibraryItemSummaryDto>>())
    /** The lesson library, fetched the first time the Lessons tab opens (cached for 5 min). */
    val library: StateFlow<Loadable<List<LibraryItemSummaryDto>>> = _library.asStateFlow()

    private val _lessonDays = MutableStateFlow<List<String?>>(emptyList())
    /** The student's logged lesson days (web: the sheet's getLessonLog query) — the default due date reads them. */
    val lessonDays: StateFlow<List<String?>> = _lessonDays.asStateFlow()

    fun loadLessonLog(relId: String) = scope.launch {
        _lessonDays.value = emptyList()
        val days = withContext(Dispatchers.IO) { attempt { app.repo.api.lessonLog(relId) } }.getOrNull()?.map { HomeworkPlan.lessonDay(it.lesson_at) }
        if (days != null) _lessonDays.value = days
    }

    fun loadDecks() = scope.launch {
        _decks.value = withContext(Dispatchers.IO) {
            val counts = app.repo.dao.noteCounts().associate { it.deckId to it.count }
            app.repo.dao.decks()
                .sortedWith(compareByDescending<dev.jeromeswannack.chineselearning.lab.data.DeckEntity> { it.studyPriority }.thenByDescending { it.createdAt })
                .map { DeckOption(it.id, it.name, it.description, counts[it.id] ?: 0) }
        }
    }

    fun loadLibrary() {
        val existing = libraryResource
        if (existing != null) { existing.refresh(force = false); return }
        val r = app.cachedResource<List<LibraryItemSummaryDto>>(scope, TeachingKeys.LIBRARY, TeachingKeys.KIND, maxAgeMs = 5 * 60_000L) { lessonLibrary() }
        libraryResource = r
        scope.launch { r.state.collect { _library.value = it } }
    }

    fun sendDeck(relId: String, studentName: String, deck: DeckOption, o: SendOptions, done: (SendOutcome) -> Unit) = scope.launch {
        attempt {
            val res = app.repo.api.assignHomework(relId, listOf(AssignItemDto("deck", deck.id, o.mode.wire, if (o.mode.hasOneOff) o.dueDate else null, o.splitDays, o.priority, o.skipKnown)))
            if (res.assignments.isEmpty()) error(res.errors.firstOrNull()?.error ?: "Could not send the deck")
            res
        }.onSuccess { res ->
            val hanzi = res.skipped.flatMap { it.hanzi }
            val skipped = if (hanzi.isEmpty()) "" else " Left out ${TeachingFormat.plural(hanzi.size, "word")} they already have (${hanzi.take(6).joinToString("、")}${if (hanzi.size > 6) "…" else ""})."
            celebrate()
            done(SendOutcome(result = "Sent ${deck.name} to $studentName ${sendHow("deck", o)}.$skipped"))
            onChanged()
        }.onFailure { done(SendOutcome(error = it.userMessage())) }
    }

    fun updateCopy(relId: String, studentName: String, deck: DeckOption, share: HomeworkDeckDto, done: (SendOutcome) -> Unit) = scope.launch {
        attempt { app.repo.api.updateSharedDeckCopy(relId, share.shared_deck_id) }
            .onSuccess { res ->
                celebrate()
                done(
                    SendOutcome(
                        result = if (res.added == 0 && res.audio_filled == 0) "$studentName's copy of ${deck.name} is already up to date."
                        else "Added ${TeachingFormat.plural(res.added, "new word")} to $studentName's copy of ${deck.name}${if (res.audio_filled > 0) " (and audio for ${res.audio_filled})" else ""}. Their progress is kept.",
                    ),
                )
                onChanged()
            }.onFailure { done(SendOutcome(error = it.userMessage())) }
    }

    fun assignLesson(relId: String, studentName: String, item: LibraryItemSummaryDto, o: SendOptions, done: (SendOutcome) -> Unit) = scope.launch {
        attempt { app.repo.api.assignHomework(relId, listOf(AssignItemDto("lesson", item.id, o.mode.wire, if (o.mode.hasOneOff) o.dueDate else null))) }
            .onSuccess { res ->
                if (res.errors.isNotEmpty()) done(SendOutcome(error = res.errors.first().error))
                else {
                    celebrate()
                    done(SendOutcome(result = "Assigned ${item.title} to $studentName ${if (o.mode.hasOneOff) sendHow("lesson", o) else "— it will appear in their next study session"}."))
                }
                onChanged()
            }.onFailure { done(SendOutcome(error = it.userMessage())) }
    }

    private fun celebrate() {
        app.haptics.correct()
        app.sounds.play(Sounds.Sfx.POP)
    }
}

// ---------------- student page ----------------

class StudentPageViewModel(private val app: LabApp, val relId: String) : ViewModel() {
    val overview = app.cachedResource(viewModelScope, TeachingKeys.overview(relId), TeachingKeys.KIND) { studentOverview(relId) }
    val homework = app.cachedResource(viewModelScope, TeachingKeys.homework(relId), TeachingKeys.KIND) { relationshipHomework(relId) }
    val flags = app.cachedResource(viewModelScope, TeachingKeys.flags(relId), TeachingKeys.KIND) { cardFlags(relId, "all") }
    val claude = app.cachedResource(viewModelScope, TeachingKeys.claude(relId), TeachingKeys.KIND, maxAgeMs = 60_000L) { studentClaudeChats(relId, 40) }
    val conversations = app.cachedResource(viewModelScope, TeachingKeys.conversations(relId), TeachingKeys.KIND) { conversations(relId) }
    val lessons = app.cachedResource(viewModelScope, TeachingKeys.lessons(relId), TeachingKeys.KIND) { studentLessons(relId) }
    val lessonLog = app.cachedResource(viewModelScope, TeachingKeys.lessonLog(relId), TeachingKeys.KIND) { lessonLog(relId) }

    data class Transient(
        val notice: String? = null,
        val noticeIsError: Boolean = false,
        val updatingShare: String? = null,
        val howTo: String? = null,
        val messageBusy: Boolean = false,
        val callBusy: Boolean = false,
        val removing: Boolean = false,
        val studentDecks: List<StudentSharedDeckDto>? = null,
        val liveCallId: String? = null,
    )

    private val _t = MutableStateFlow(Transient())
    val transient: StateFlow<Transient> = _t.asStateFlow()

    val send = SendHomeworkController(app, viewModelScope) { refreshAfterHomework() }
    val lessonNotes = LessonNotesController(app, this, relId)
    val profile = StudentProfileController(app, this, relId) { overview.refresh() }

    init {
        // Offline-first: the dashboard already holds this student's card — show it at once.
        viewModelScope.launch {
            if (app.cache.entry(TeachingKeys.overview(relId)) == null) {
                app.cache.get<TutorDashboardDto>(TeachingKeys.DASHBOARD)?.students?.firstOrNull { it.relationship_id == relId }?.let {
                    app.cache.put(TeachingKeys.overview(relId), TeachingKeys.KIND, it)
                }
            }
        }
        // A live call in this relationship shows a Join banner (web polls every 15 s).
        viewModelScope.launch {
            while (isActive) {
                if (app.online.value) attempt { app.repo.api.liveCalls(relId) }.onSuccess { r -> _t.update { it.copy(liveCallId = r.occupiedCallId()) } }
                delay(15_000)
            }
        }
    }

    fun refresh() {
        overview.refresh(); homework.refresh(); flags.refresh(); claude.refresh(); conversations.refresh(); lessons.refresh(); lessonLog.refresh(); lessonNotes.entries.refresh(); profile.resource.refresh()
    }

    private fun refreshAfterHomework() {
        overview.refresh(); homework.refresh(); lessons.refresh()
        app.scope.launch { app.cache.delete(TeachingKeys.DASHBOARD) }
    }

    fun say(text: String, error: Boolean = false) = _t.update { it.copy(notice = text, noticeIsError = error) }

    /** Message: the most recent conversation, created when there is none. */
    fun message(go: (String) -> Unit) {
        val known = overview.state.value.data?.last_conversation_id ?: conversations.state.value.data?.firstOrNull()?.id
        if (known != null) { go(known); return }
        viewModelScope.launch {
            _t.update { it.copy(messageBusy = true) }
            attempt { app.repo.api.openConversation(relId) }
                .onSuccess { conversations.refresh(); go(it.conversation_id) }
                .onFailure { say(it.userMessage(), true) }
            _t.update { it.copy(messageBusy = false) }
        }
    }

    fun videoCall(go: (String) -> Unit) {
        _t.value.liveCallId?.let { go(it); return }
        viewModelScope.launch {
            _t.update { it.copy(callBusy = true) }
            attempt { app.repo.api.startCall(relId) }
                .onSuccess { go(it.call.id) }
                .onFailure { say(it.userMessage(), true) }
            _t.update { it.copy(callBusy = false) }
        }
    }

    fun moveShare(d: HomeworkDeckDto, to: String) = viewModelScope.launch {
        _t.update { it.copy(notice = null) }
        attempt { app.repo.api.moveSharedDeck(relId, d.shared_deck_id, to) }
            .onSuccess { res ->
                app.haptics.tick()
                say(
                    if (res.queue_position == 1) "${d.source_deck_name} is now first in their queue — the next new words come from it."
                    else "${d.source_deck_name} is now #${res.queue_position} of ${res.queue_total} in their queue.",
                )
                overview.update { o -> o!!.copy(homework = o.homework.copy(decks = o.homework.decks.map { if (it.shared_deck_id == d.shared_deck_id) it.copy(queue_position = res.queue_position, queue_total = res.queue_total) else it })) }
                overview.refresh()
            }
            .onFailure { say(it.userMessage().ifBlank { "Could not move the deck" }, true) }
    }

    fun updateShare(d: HomeworkDeckDto) = viewModelScope.launch {
        _t.update { it.copy(updatingShare = d.shared_deck_id, notice = null) }
        attempt { app.repo.api.updateSharedDeckCopy(relId, d.shared_deck_id) }
            .onSuccess { res ->
                val parts = listOfNotNull(
                    if (res.added > 0) "added ${TeachingFormat.plural(res.added, "new word")}" else null,
                    if (res.updated > 0) "updated ${TeachingFormat.plural(res.updated, "word")}" else null,
                )
                say(
                    if (parts.isEmpty() && res.audio_filled == 0) "${d.source_deck_name} is already up to date."
                    else "${if (parts.isNotEmpty()) parts.joinToString(" and ") else "Filled in audio"} in their copy of ${d.source_deck_name}. Their progress is kept.".replaceFirstChar { it.uppercase() },
                )
                app.haptics.correct()
                overview.refresh()
            }
            .onFailure { say(it.userMessage(), true) }
        _t.update { it.copy(updatingShare = null) }
    }

    fun patchAssignment(a: AssignmentDto, body: AssignmentPatchBody) = viewModelScope.launch {
        attempt { app.repo.api.updateHomeworkAssignment(relId, a.id, body) }
            .onSuccess {
                app.haptics.tick()
                homework.update { h -> h!!.copy(assignments = h.assignments.map { if (it.id == a.id) it.copy(due_date = body.due_date ?: it.due_date, status = body.status ?: it.status) else it }) }
                homework.refresh()
            }
            .onFailure { say(it.userMessage(), true) }
    }

    fun replyFlag(flag: TeachFlagDto, text: String, done: (String?) -> Unit) = viewModelScope.launch {
        attempt { app.repo.api.replyToCardFlag(flag.id, text) }
            .onSuccess { app.haptics.correct(); app.sounds.play(Sounds.Sfx.POP); done(null); flags.refresh(); overview.refresh() }
            .onFailure { done(it.userMessage()) }
    }

    fun toggleFlag(flag: TeachFlagDto, done: (String?) -> Unit) = viewModelScope.launch {
        attempt { if (flag.status == "open") app.repo.api.resolveCardFlag(flag.id) else app.repo.api.reopenCardFlag(flag.id) }
            .onSuccess { app.haptics.tick(); done(null); flags.refresh(); overview.refresh() }
            .onFailure { done(it.userMessage()) }
    }

    fun sendHowTo() = viewModelScope.launch {
        _t.update { it.copy(howTo = "Sending…") }
        attempt { app.repo.api.sendInstallHowTo(relId) }
            .onSuccess { app.haptics.correct(); _t.update { it.copy(howTo = "How-to sent ✓") } }
            .onFailure { e -> _t.update { it.copy(howTo = null) }; say(e.userMessage().ifBlank { "Could not send the how-to" }, true) }
    }

    fun loadStudentDecks() = viewModelScope.launch {
        attempt { app.repo.api.studentSharedDecks(relId) }
            .onSuccess { d -> _t.update { it.copy(studentDecks = d) } }
            .onFailure { e -> _t.update { it.copy(studentDecks = emptyList()) }; say(e.userMessage(), true) }
    }

    fun remove(then: () -> Unit) = viewModelScope.launch {
        _t.update { it.copy(removing = true) }
        attempt { app.repo.api.removeRelationship(relId) }
            .onSuccess {
                app.cache.delete(TeachingKeys.DASHBOARD)
                app.scope.launch { app.repo.sync() } // the tab set follows the relationships
                then()
            }
            .onFailure { say(it.userMessage(), true) }
        _t.update { it.copy(removing = false) }
    }

    class Factory(private val app: LabApp, private val relId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = StudentPageViewModel(app, relId) as T
    }
}
