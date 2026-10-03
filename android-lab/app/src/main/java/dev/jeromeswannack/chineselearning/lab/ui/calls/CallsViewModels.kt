package dev.jeromeswannack.chineselearning.lab.ui.calls

import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.CallDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallListItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallReportWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.FlashcardsRequest
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionJobDto
import dev.jeromeswannack.chineselearning.lab.data.api.TranscriptSegmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.callBoardPages
import dev.jeromeswannack.chineselearning.lab.data.api.callHomework
import dev.jeromeswannack.chineselearning.lab.data.api.cancelSessionJob
import dev.jeromeswannack.chineselearning.lab.data.api.createCall
import dev.jeromeswannack.chineselearning.lab.data.api.deleteCall
import dev.jeromeswannack.chineselearning.lab.data.api.deleteSessionJob
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.getCall
import dev.jeromeswannack.chineselearning.lab.data.api.listCalls
import dev.jeromeswannack.chineselearning.lab.data.api.makeCallFlashcards
import dev.jeromeswannack.chineselearning.lab.data.api.makeCallHomework
import dev.jeromeswannack.chineselearning.lab.data.api.myRelationships
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.data.api.processCall
import dev.jeromeswannack.chineselearning.lab.data.api.relationship
import dev.jeromeswannack.chineselearning.lab.data.api.retrySessionJob
import dev.jeromeswannack.chineselearning.lab.data.api.tutor
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.calls.CallUploads
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.teaching.JOB_POLL_MS
import dev.jeromeswannack.chineselearning.lab.ui.teaching.attempt
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

object CallsKeys {
    const val KIND = "calls"
    const val LIST = "calls/list"
    fun detail(id: String) = "calls/detail/$id"
    fun homework(id: String) = "calls/homework/$id"
    fun boardPages(id: String) = "calls/board-pages-call/$id"
}

/** The people you can call: active tutors and students, never Claude (web: CallsListPage `people`). */
fun callPeople(rel: MyRelationshipsDto?, myId: String?): List<CallPerson> =
    (rel?.tutors.orEmpty() + rel?.students.orEmpty())
        .filter { it.status == "active" }
        .mapNotNull { r -> r.other(myId)?.takeIf { it.id != CLAUDE_USER_ID }?.let { CallPerson(r.id, it.name?.takeIf { n -> n.isNotBlank() } ?: it.email.orEmpty()) } }

class CallsListViewModel(private val app: LabApp) : ViewModel() {
    val calls: CachedResource<List<CallListItemDto>> = app.cachedResource(viewModelScope, CallsKeys.LIST, CallsKeys.KIND) { listCalls() }
    private val local = MutableStateFlow(CallsListUi())
    private val me = MutableStateFlow<String?>(null)

    val ui: StateFlow<CallsListUi> = combine(calls.state, local, app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS), me, app.online) { c, l, rel, m, online ->
        l.copy(calls = c, people = callPeople(rel, m), online = online)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, CallsListUi())

    init {
        viewModelScope.launch { me.value = Connections.myId(app.cache) }
        // The web refetches every 15 s (a live call ends, a transcript gets ready).
        viewModelScope.launch { while (isActive) { delay(15_000); if (app.online.value) calls.refresh() } }
    }

    fun refresh() = calls.refresh()

    fun start(relationshipId: String?, go: (String) -> Unit) {
        if (local.value.starting != null) return
        local.update { it.copy(starting = relationshipId ?: "solo", error = null) }
        viewModelScope.launch {
            attempt { app.repo.api.createCall(relationshipId) }
                .onSuccess { app.haptics.tick(); go(it.id); calls.refresh() }
                .onFailure { e -> local.update { it.copy(error = e.userMessage()) } }
            local.update { it.copy(starting = null) }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CallsListViewModel(app) as T
    }
}

class CallReviewViewModel(private val app: LabApp, private val callId: String) : ViewModel() {
    val detail: CachedResource<CallDetailDto> = app.cachedResource(viewModelScope, CallsKeys.detail(callId), CallsKeys.KIND) { getCall(callId) }
    /** The board pages this call wrote on (GET /api/calls/:id/board-pages); the review falls back to `board_text`. */
    private val boardPages: CachedResource<List<dev.jeromeswannack.chineselearning.lab.data.api.CallBoardPageDto>> =
        app.cachedResource(viewModelScope, CallsKeys.boardPages(callId), CallsKeys.KIND) { callBoardPages(callId) }
    private val uploads = CallUploads(app.outbox, app.cache)
    private val local = MutableStateFlow(CallReviewUi(callId))
    private var player: SegmentPlayer? = null
    private var homeworkPoll: Job? = null

    val ui: StateFlow<CallReviewUi> = combine(detail.state, local, uploads.pending(callId), app.online, boardPages.state) { d, l, pending, online, pages ->
        l.copy(detail = d, pendingLocal = pending, online = online, boardPages = pages.data)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, CallReviewUi(callId))

    init {
        viewModelScope.launch {
            val me = Connections.myId(app.cache)
            val decks = app.repo.dao.decks().sortedBy { it.name.lowercase() }.map { DeckChoice(it.id, it.name) }
            local.update { it.copy(myId = me, decks = decks) }
        }
        // Poll while the call is being processed (web: refetchInterval 5 s while isBusy).
        viewModelScope.launch {
            while (isActive) {
                delay(5_000)
                if (app.online.value && CallsFormat.isBusy(detail.state.value.data)) detail.refresh()
            }
        }
        // Keep pushing this phone's leftover recording while the page is open.
        viewModelScope.launch {
            while (isActive) {
                if (ui.value.pendingLocal > 0 && app.online.value) runCatching { uploads.drain() }
                delay(5_000)
            }
        }
        viewModelScope.launch {
            detail.state.collect { s -> s.data?.call?.relationship_id?.let { rel -> if (local.value.homework == null) loadHomework(rel, s.data) } }
        }
    }

    /** Only the tutor of the call's relationship sees "Make homework from this lesson". */
    private suspend fun loadHomework(relId: String, d: CallDetailDto) {
        val me = local.value.myId ?: Connections.myId(app.cache) ?: return
        val key = "calls/rel/$relId"
        val rel = app.cache.get<RelationshipDto>(key) ?: attempt { app.repo.api.relationship(relId) }.getOrNull()?.also { app.cache.put(key, CallsKeys.KIND, it) } ?: return
        if (rel.tutor()?.id != me || local.value.homework != null) return
        val student = d.participants.firstOrNull { it.id != me }?.displayName ?: rel.other(me).displayName("the student")
        local.update { it.copy(homework = CallHomeworkUi(relId, student, jobs = app.cache.get<List<SessionJobDto>>(CallsKeys.homework(callId)).orEmpty())) }
        refreshHomework()
    }

    private fun refreshHomework() {
        homeworkPoll?.cancel()
        homeworkPoll = viewModelScope.launch {
            while (isActive) {
                if (app.online.value) attempt { app.repo.api.callHomework(callId) }.onSuccess { jobs ->
                    app.cache.put(CallsKeys.homework(callId), CallsKeys.KIND, jobs)
                    local.update { it.copy(homework = it.homework?.copy(jobs = jobs)) }
                }
                if (local.value.homework?.jobs?.any { it.active } != true) break
                delay(JOB_POLL_MS)
            }
        }
    }

    fun refresh() { detail.refresh(); boardPages.refresh() }

    fun play(seg: TranscriptSegmentDto) {
        val d = detail.state.value.data ?: return
        val piece = d.pieces.firstOrNull { it.id == seg.piece_id } ?: return
        val url = piece.audio_url ?: return
        if (local.value.playingId == seg.id) { player?.stop(); return }
        val p = player ?: SegmentPlayer { local.update { it.copy(playingId = null) } }.also { player = it }
        val offset = maxOf(0L, seg.start_ms - piece.started_at - 300)
        val until = seg.end_ms - piece.started_at + 400
        local.update { it.copy(playingId = seg.id) }
        p.play(app.repo.api.baseUrl + url, offset, until)
    }

    fun makeCards(words: List<CallReportWordDto>, deckId: String?, deckName: String) {
        local.update { it.copy(cardsBusy = true, cardsError = null) }
        viewModelScope.launch {
            attempt { app.repo.api.makeCallFlashcards(callId, FlashcardsRequest(deck_id = deckId, deck_name = if (deckId == null) deckName else null, words = words)) }
                .onSuccess { r ->
                    app.haptics.celebrate(); app.sounds.play(Sfx.FANFARE)
                    local.update { it.copy(cardsResult = CardsResult(r.deck_id, r.created, r.failed.size)) }
                    app.scope.launch { runCatching { app.repo.sync() } } // the new cards come down for study
                }
                .onFailure { e -> local.update { it.copy(cardsError = e.userMessage()) } }
            local.update { it.copy(cardsBusy = false) }
        }
    }

    fun reprocess() = busy { app.repo.api.processCall(callId); detail.refresh() }

    fun delete(done: () -> Unit) = busy {
        app.repo.api.deleteCall(callId)
        app.cache.delete(CallsKeys.detail(callId))
        app.cache.delete(CallsKeys.LIST)
        done()
    }

    fun makeHomework() {
        local.update { it.copy(homework = it.homework?.copy(starting = true, error = null)) }
        viewModelScope.launch {
            attempt { app.repo.api.makeCallHomework(callId) }
                .onSuccess { r ->
                    app.haptics.tick()
                    // The lesson's homework already exists (made from another of its calls): show those jobs.
                    val got = r.jobs?.takeIf { r.existing && it.isNotEmpty() } ?: listOf(r.job)
                    local.update { it.copy(homework = it.homework?.copy(jobs = got + it.homework.jobs.filter { j -> got.none { g -> g.id == j.id } })) }
                    refreshHomework()
                }
                .onFailure { e -> local.update { it.copy(homework = it.homework?.copy(error = e.userMessage())) } }
            local.update { it.copy(homework = it.homework?.copy(starting = false)) }
        }
    }

    /** "Undo — remove from <student>" on what the homework job sent (take homework back). */
    val removal = dev.jeromeswannack.chineselearning.lab.ui.teaching.HomeworkRemovalController(app, viewModelScope, { local.value.homework?.relId }) { _, _ ->
        refreshHomework()
        local.value.homework?.relId?.let { rel -> app.scope.launch { app.cache.delete("teaching/overview/$rel"); app.cache.delete("teaching/dashboard") } }
    }

    /** Create, then send: "Send to <student>" on what the homework job made (it stays in the tutor's account until then). */
    val sender = dev.jeromeswannack.chineselearning.lab.ui.teaching.HomeworkSendController(app, viewModelScope, { local.value.homework?.relId }) {
        refreshHomework()
        local.value.homework?.relId?.let { rel -> app.scope.launch { app.cache.delete("teaching/overview/$rel"); app.cache.delete("teaching/dashboard") } }
    }

    fun retryJob(job: SessionJobDto) = jobAction { rel -> app.repo.api.retrySessionJob(rel, job.id) }
    fun cancelJob(job: SessionJobDto) = jobAction { rel -> app.repo.api.cancelSessionJob(rel, job.id) }
    fun deleteJob(job: SessionJobDto) = jobAction { rel -> app.repo.api.deleteSessionJob(rel, job.id) }

    private fun jobAction(block: suspend (String) -> Any) {
        val rel = local.value.homework?.relId ?: return
        viewModelScope.launch {
            attempt { block(rel) }.onFailure { e -> local.update { it.copy(homework = it.homework?.copy(error = e.userMessage())) } }
            refreshHomework()
        }
    }

    private fun busy(block: suspend () -> Unit) {
        local.update { it.copy(busy = true, notice = null) }
        viewModelScope.launch {
            attempt { block() }.onFailure { e -> local.update { it.copy(notice = e.userMessage()) } }
            local.update { it.copy(busy = false) }
        }
    }

    override fun onCleared() {
        player?.release()
    }

    class Factory(private val app: LabApp, private val callId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CallReviewViewModel(app, callId) as T
    }
}

/** Plays one stretch of a recording piece (a transcript line), like the web's `<audio>` with currentTime + timeupdate. */
class SegmentPlayer(private val onStopped: () -> Unit) {
    private var mp: MediaPlayer? = null
    private var url: String? = null
    private var watcher: Job? = null
    private val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main + kotlinx.coroutines.SupervisorJob())

    fun play(src: String, fromMs: Long, untilMs: Long) {
        watcher?.cancel()
        val start = { p: MediaPlayer ->
            p.seekTo(fromMs.toInt())
            p.start()
            watcher = scope.launch {
                while (isActive) {
                    delay(100)
                    val pos = runCatching { p.currentPosition }.getOrDefault(Int.MAX_VALUE)
                    if (pos >= untilMs || runCatching { !p.isPlaying }.getOrDefault(true)) { stop(); break }
                }
            }
        }
        val existing = mp
        if (existing != null && url == src) { runCatching { start(existing) }.onFailure { stop() }; return }
        existing?.release()
        url = src
        mp = MediaPlayer().apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            setOnPreparedListener { start(it) }
            setOnErrorListener { _, _, _ -> stop(); true }
            runCatching { setDataSource(src); prepareAsync() }.onFailure { stop() }
        }
    }

    fun stop() {
        watcher?.cancel()
        runCatching { if (mp?.isPlaying == true) mp?.pause() }
        onStopped()
    }

    fun release() {
        stop()
        mp?.release()
        mp = null
        scope.coroutineContext[Job]?.cancel()
    }
}
