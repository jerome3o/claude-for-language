package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.CoachAsk
import dev.jeromeswannack.chineselearning.lab.core.CoachMistakeLesson
import dev.jeromeswannack.chineselearning.lab.core.FlashcardReview
import dev.jeromeswannack.chineselearning.lab.core.PickerDecks
import dev.jeromeswannack.chineselearning.lab.core.ProposedCard
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudePractice
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeSendBody
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeTurnEvent
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.addNotesBatch
import dev.jeromeswannack.chineselearning.lab.data.api.createDeck
import dev.jeromeswannack.chineselearning.lab.data.api.proposeCoachFlashcards
import dev.jeromeswannack.chineselearning.lab.data.api.requestCoachMistakeLesson
import dev.jeromeswannack.chineselearning.lab.data.api.saveCoachMistakeLesson
import dev.jeromeswannack.chineselearning.lab.data.api.setAskClaudeLanguage
import dev.jeromeswannack.chineselearning.lab.data.api.setAskClaudeListening
import dev.jeromeswannack.chineselearning.lab.data.api.translateCoachMessage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.chat.conversation
import dev.jeromeswannack.chineselearning.lab.data.claude.CachedClaudeThread
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.data.claudechat.ClaudeChatRecap
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import dev.jeromeswannack.chineselearning.lab.data.readers.WordRecapStore
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatViewModel
import dev.jeromeswannack.chineselearning.lab.ui.chat.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewUi
import dev.jeromeswannack.chineselearning.lab.ui.coach.coachLesson
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.study.AskListening
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * One Claude thread (port of the web's components/claude/ClaudeThreadView.tsx state +
 * hooks/useClaudeThread.ts; docs/CHAT.md "Claude thread view"): the cached thread ([ClaudeThreads],
 * read offline), fetched on open (whole the first time, then `?since=`), the reply being written
 * streamed from the live socket's `claude_turn` frames, and — while a reply is pending — the
 * `?since=` poll on the shared rule ([ClaudeChats.replyPollMs]: 400 ms for 10 s, then 1.5 s; only a
 * slow safety net while live frames arrive). Messages written offline wait in the outbox. Analytics
 * `claude.thread_open` / `claude.message_send` / `claude.reply_shown`.
 *
 * [routeId] = a thread id, the client id of one started offline, or [NEW] (a fresh thread in
 * [newContext]).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClaudeThreadViewModel(
    private val app: LabApp,
    private val routeId: String,
    private val newContext: ClaudeContextDto?,
    private val source: String,
    private val hasSentence: Boolean,
    private val now: () -> Long = System::currentTimeMillis,
    /** A card thread (the study card's sheet): the card's type (analytics `study.ask_claude`). */
    private val cardType: String? = null,
) : ViewModel() {
    /**
     * A card thread: the answer typed on this showing of the card, sent with each question
     * ([ClaudeSendBody.typed]: an object, or JsonNull = none). Set by the sheet as the card changes.
     */
    var typed: JsonElement? = null

    /** A reply this screen saw being written has finished (the study card applies Claude's card tools). */
    private val finished = MutableSharedFlow<ClaudeMessageDto>(extraBufferCapacity = 16)
    val finishedReplies: SharedFlow<ClaudeMessageDto> = finished
    private val isNew = routeId == NEW
    private val store = ClaudeThreads.of(app)
    private val recap = ClaudeChatRecap(app)
    private val local = MutableStateFlow(
        ClaudeThreadUi(isNew = isNew, language = app.prefs.askClaudeLanguage, listening = app.prefs.askClaudeListening, loading = !isNew, hasSentence = hasSentence, context = newContext ?: ClaudeContextDto()),
    )
    private val listen = AskListening(
        app, viewModelScope,
        state = { local.value.listen },
        update = { f -> local.update { it.copy(listen = f(it.listen)) } },
        notice = { n -> local.update { it.copy(listenNotice = n?.let { x -> x.id to x.text }) } },
        stopOthers = { LessonRuntime.of(app).audio.stop() },
        voice = { voice() },
    )

    /** The voice Claude's lines are read in: a role-play's persona (the server keeps it on the thread), else Claude's own. */
    private fun voice(): Pair<String, Double> {
        val c = cached.value?.thread?.context ?: local.value.context
        return if (c.kind == ClaudeChats.PRACTICE) ClaudePractice.voiceFor(c.voice_id, c.scenario, c.ai_role) to ClaudePractice.VOICE_SPEED else AskClaude.VOICE to AskClaude.SPEED
    }

    /** The thread's id now (a thread started offline follows its client id to its server id). */
    private val threadId: StateFlow<String?> =
        (if (isNew) flowOf(null) else store.observeResolved(routeId)).stateIn(viewModelScope, SharingStarted.Eagerly, if (isNew) null else routeId)

    private val cached: StateFlow<CachedClaudeThread?> =
        threadId.flatMapLatest { id -> if (id == null) flowOf(null) else store.observe(id) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val outboxItems: Flow<List<OutboxEntity>> = app.outbox.observe(ClaudeThreads.OUTBOX_KIND)

    private val recapCount: Flow<Int> = threadId.flatMapLatest { WordRecapStore.observeChatCount(app, it ?: NEW) }

    private val threadPart: Flow<Pair<CachedClaudeThread?, List<OutboxEntity>>> = combine(cached, outboxItems) { c, o -> c to o }

    val ui: StateFlow<ClaudeThreadUi> = combine(threadPart, local, app.online, recapCount, LessonRuntime.of(app).audio.playing) { (c, items), u, online, recapN, playing ->
        val byId = items.associateBy { it.id }
        val failed = HashMap<String, String>()
        val rows = c?.messages.orEmpty().map { m ->
            if (!m.queued) return@map m
            val item = byId[m.client_id ?: m.id]
            when {
                m.held -> m
                item == null -> m.copy(queued = false) // sent: the next fetch brings the server's row
                item.state == Outbox.FAILED -> m.also { failed[m.id] = ClaudeThreads.outboxError(item) ?: "refused" }.copy(queued = false)
                else -> m
            }
        }
        u.copy(
            threadId = c?.thread?.id ?: threadId.value,
            title = c?.thread?.title.orEmpty(),
            context = c?.thread?.context ?: newContext ?: ClaudeContextDto(),
            threadReadOnly = c?.thread?.read_only == true,
            hasThread = c != null,
            messages = rows,
            queueFailed = failed,
            loading = u.loading && c == null,
            online = online,
            recapCount = recapN,
            playingText = playing,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, local.value)

    private var lastEventAt: Long? = null
    /** Reply ids whose first words came over the socket. */
    private val viaSocket = HashSet<String>()

    private data class Timing(val startedAt: Long, var firstTextAt: Long? = null, var via: String? = null)
    private val timings = HashMap<String, Timing>()

    init {
        listen.start()
        viewModelScope.launch {
            val known = withContext(Dispatchers.IO) { runCatching { app.repo.dao.allNotes().mapTo(HashSet()) { it.hanzi.trim() } }.getOrDefault(HashSet()) }
            local.update { it.copy(known = known) }
        }
        // claude.thread_open — once the thread is known (a fresh one at once).
        viewModelScope.launch {
            val kind = if (isNew) (newContext?.kind ?: ClaudeChats.GENERAL) else cached.filter { it != null }.first()!!.thread.context.kind
            app.analytics.track("claude.thread_open", mapOf("context_kind" to kind, "source" to source, "resumed" to !isNew))
        }
        if (!isNew) {
            // Open: what this phone still holds goes out, then the thread is fetched (whole the first time).
            viewModelScope.launch {
                if (app.online.value) runCatching { app.outbox.drain() }
                refreshNow(full = store.get(store.resolve(routeId))?.cursor == null)
                local.update { it.copy(loading = false) }
            }
            // Live: the reply's text as it is written; a reconnect / a finished reply catches up over REST.
            viewModelScope.launch { app.chatLive.claudeTurns.collect(::onTurn) }
            viewModelScope.launch {
                var first = true
                app.chatLive.connected.collect { up -> if (up && !first) refreshNow(); first = false }
            }
            // A queued message went out: a thread started offline gets its server id; the rows their server copies.
            viewModelScope.launch {
                app.outbox.completed.collect { item ->
                    if (item.kind != ClaudeThreads.OUTBOX_KIND) return@collect
                    val more = runCatching { store.resolveLocal() }.getOrDefault(0)
                    if (more > 0 && app.online.value) runCatching { app.outbox.drain() }
                    refreshNow()
                }
            }
        }
        // claude.reply_shown: how long each reply took to show (first words, whole) and how it arrived.
        viewModelScope.launch {
            cached.collect { c ->
                val rows = c?.messages.orEmpty()
                for (m in rows) {
                    if (m.role != "assistant") continue
                    val t = timings[m.id]
                    if (m.status == "pending") {
                        val timing = t ?: Timing(now()).also { timings[m.id] = it }
                        if (m.content.isNotEmpty() && timing.firstTextAt == null) {
                            timing.firstTextAt = now()
                            timing.via = if (m.id in viaSocket) "socket" else "poll"
                        }
                        continue
                    }
                    if (t != null && m.status == null) {
                        finished.tryEmit(m)
                        // A card question's "check my Chinese" may land a moment after the reply: look again.
                        if (c?.thread?.context?.kind == ClaudeChats.CARD) viewModelScope.launch {
                            for (wait in longArrayOf(2500, 5500)) {
                                delay(wait)
                                if (app.online.value) refreshNow()
                            }
                        }
                        val at = now()
                        val mine = rows.lastOrNull { it.role == "user" && it.created_at <= m.created_at }
                        app.analytics.track(
                            "claude.reply_shown",
                            mapOf(
                                "first_text_ms" to ((t.firstTextAt ?: at) - t.startedAt),
                                "done_ms" to (at - t.startedAt),
                                "via" to (t.via ?: if (m.id in viaSocket) "socket" else "poll"),
                                "intent" to (mine?.intent ?: "ask"),
                                "context_kind" to (c?.thread?.context?.kind ?: ClaudeChats.GENERAL),
                            ),
                        )
                        timings.remove(m.id)
                    } else if (t != null && m.status == "failed") {
                        timings.remove(m.id)
                    }
                }
            }
        }
    }

    private suspend fun refreshNow(full: Boolean = false) {
        val id = threadId.value ?: return
        try {
            store.refresh(id, full)
            local.update { it.copy(loadError = null) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            local.update { it.copy(loadError = if (app.online.value) "Couldn't load this chat." else "You're offline and this chat isn't on this phone yet.") }
        }
    }

    fun reload() {
        local.update { it.copy(loading = true) }
        viewModelScope.launch {
            refreshNow(full = true)
            local.update { it.copy(loading = false) }
        }
    }

    /** A live frame for this thread: its text, what Claude is doing; done / failed → the final row over REST. */
    suspend fun onTurn(e: ClaudeTurnEvent) {
        if (e.thread_id != threadId.value) return
        lastEventAt = now()
        local.update { it.copy(liveTool = if (e.status == "tool" || e.status == "thinking") LiveTool(e.message_id, e.status, e.tool) else null) }
        val changed = store.applyTurn(e)
        if (changed && !e.text.isNullOrEmpty()) viaSocket += e.message_id
        if (e.status == "done" || e.status == "failed") refreshNow()
    }

    /** Looks again while a reply is pending, only while the screen is shown (the route's LaunchedEffect). */
    suspend fun pollWhilePending() {
        var pendingId: String? = null
        var since = 0L
        while (true) {
            val id = threadId.value
            val p = cached.value?.messages?.firstOrNull { it.role == "assistant" && it.status == "pending" && !it.queued }
            if (id == null || p == null || cached.value?.local == true) {
                pendingId = null
                delay(IDLE_TICK_MS)
                continue
            }
            if (p.id != pendingId) { pendingId = p.id; since = now() }
            delay(ClaudeChats.replyPollMs(now() - since, app.chatLive.connected.value, lastEventAt?.let { now() - it }))
            if (app.online.value) refreshNow()
        }
    }

    fun setDraft(s: String) = local.update { it.copy(draft = s) }

    /**
     * Send (the first message starts the thread; [onStarted] moves the screen to its route). Offline
     * — or when the request didn't get through — it waits in the outbox and shows at once.
     */
    fun send(text: String, spoken: Boolean, intent: String = "ask", chip: String? = null, onStarted: (String) -> Unit = {}) {
        val msg = text.trim()
        val u = ui.value
        if (msg.isEmpty() || u.busy || u.readOnly) return
        if (chip != null) local.update { it.copy(usedChips = it.usedChips + chip) }
        local.update { it.copy(sending = msg, sendError = null, notice = null) }
        val language = local.value.language
        val online = app.online.value
        viewModelScope.launch {
            try {
                val id = threadId.value
                val kind = u.context.kind
                if (kind == ClaudeChats.CARD) {
                    app.analytics.track("study.ask_claude", mapOf("card_type" to (cardType ?: u.context.card_type), "language" to language, "quick" to (chip != null), "via" to "thread"))
                }
                if (id == null) {
                    val res = store.start(newContext ?: ClaudeContextDto(), msg, intent, language, online, quick = chip != null)
                    app.analytics.track("claude.message_send", mapOf("context_kind" to kind, "intent" to intent, "offline" to res.queued, "chip" to (chip != null), "spoken" to spoken))
                    recap.move(NEW, res.threadId)
                    if (res.queued) app.scheduleBackgroundUpload()
                    app.haptics.tick()
                    local.update { it.copy(sending = null, draft = "") }
                    onStarted(res.threadId)
                } else {
                    val res = store.send(id, msg, language, online, quick = chip != null, typed = if (kind == ClaudeChats.CARD) (typed ?: JsonNull) else null)
                    app.analytics.track("claude.message_send", mapOf("context_kind" to kind, "intent" to "ask", "offline" to res.queued, "chip" to (chip != null), "spoken" to spoken))
                    if (res.queued) app.scheduleBackgroundUpload()
                    app.haptics.tick()
                    local.update { it.copy(sending = null, draft = if (it.draft.trim() == msg) "" else it.draft) }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(sending = null, sendError = sendErrorText(e)) }
                if ((e as? HttpException)?.code == 409) refreshNow()
            }
        }
    }

    private var autoSent = false

    /** A deep link's text (`?text=&intent=`) runs at once — once. */
    fun autoSend(text: String, intent: String, onStarted: (String) -> Unit) {
        if (autoSent || !isNew) return
        autoSent = true
        send(text, spoken = false, intent = intent, onStarted = onStarted)
    }

    private val autoAsked = HashSet<String>()

    /**
     * Ask this into the thread on screen once it is loaded and Claude isn't answering — once per
     * [key] (the leech sheet's memory hook); in a fresh thread at once.
     */
    fun autoAsk(text: String, key: String, onStarted: (String) -> Unit) {
        if (key in autoAsked) return
        autoAsked += key
        viewModelScope.launch {
            if (!isNew) ui.filter { it.hasThread && !it.busy }.first()
            send(text, spoken = false, onStarted = onStarted)
        }
    }

    private var draftClaimed = false

    /** `?draft=` fills the box once. */
    fun claimDraft(draft: String) {
        if (draftClaimed) return
        draftClaimed = true
        local.update { it.copy(draft = draft) }
    }

    fun retry(messageId: String) {
        val id = threadId.value ?: return
        if (!app.online.value) { local.update { it.copy(sendError = "You're offline — Claude needs a connection.") }; return }
        local.update { it.copy(retryingId = messageId, sendError = null) }
        viewModelScope.launch {
            try {
                store.retry(id, messageId)
                app.analytics.track("coach.reply_retry")
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(sendError = sendErrorText(e)) }
            } finally {
                local.update { it.copy(retryingId = null) }
            }
        }
    }

    fun discardQueued(messageId: String) {
        val id = threadId.value ?: return
        viewModelScope.launch { runCatching { store.discard(id, messageId) } }
    }

    suspend fun translate(messageId: String): String? {
        val id = threadId.value ?: return null
        return runCatching {
            val t = app.repo.api.translateCoachMessage(id, messageId).translation
            store.setTranslation(id, messageId, t)
            t
        }.getOrNull()
    }

    // ---- 🎧 / 中文 | EN / ▶ (the account's Ask Claude settings, as on the card) ----

    fun setLanguage(language: String) {
        val l = AskClaude.parseLanguage(language) ?: return
        if (l == local.value.language) return
        app.prefs.askClaudeLanguage = l
        local.update { it.copy(language = l) }
        app.analytics.track("coach.ask_tool", mapOf("action" to "language", "role" to "claude"))
        app.scope.launch { runCatching { app.repo.api.setAskClaudeLanguage(l) } }
    }

    fun setListening(on: Boolean) {
        app.prefs.askClaudeListening = on
        if (on) listen.keepOnScreen(ui.value.messages.filter { it.role == "assistant" && it.status == null && it.content_type == "text" }.map { AskAnswer(it.id, answer = it.content, answer_lang = it.answer_lang) }) else listen.stop()
        app.haptics.tick()
        local.update { it.copy(listening = on, listenNotice = null) }
        app.analytics.track("coach.ask_tool", mapOf("action" to if (on) "listening_on" else "listening_off", "role" to "claude"))
        app.scope.launch { runCatching { app.repo.api.setAskClaudeListening(on) } }
    }

    fun listen(messageId: String, auto: Boolean) {
        val m = ui.value.messages.firstOrNull { it.id == messageId } ?: return
        app.analytics.track("coach.ask_tool", mapOf("action" to if (auto) "listen_auto" else "listen", "role" to "claude"))
        listen.play(AskAnswer(m.id, answer = m.content, answer_lang = m.answer_lang), auto)
    }

    fun reveal(messageId: String) {
        app.analytics.track("coach.ask_tool", mapOf("action" to "reveal", "role" to "claude"))
        listen.reveal(messageId)
    }

    fun toggleSlow() = listen.toggleSlow()

    fun audioBusy(): Boolean = listen.busy() || LessonRuntime.of(app).audio.playing.value != null

    fun play(text: String, mine: Boolean) {
        listen.stop()
        app.analytics.track("coach.ask_tool", mapOf("action" to "play", "role" to if (mine) "mine" else "claude"))
        viewModelScope.launch {
            val audio = LessonRuntime.of(app).audio
            val (v, speed) = voice()
            if (audio.playing.value == text) audio.stop() else audio.playClip(text, v, speed)
        }
    }

    fun stopAudio() {
        listen.stop()
        LessonRuntime.of(app).audio.stop()
    }

    fun track(action: String, mine: Boolean) = app.analytics.track("coach.ask_tool", mapOf("action" to action, "role" to if (mine) "mine" else "claude"))

    /** A tapped word: kept to recap (the explorer opens from the screen). */
    fun recordTapped(w: ReaderWordDto, sentence: String) {
        val id = threadId.value ?: NEW
        viewModelScope.launch {
            recap.record(id, listOf(CoachAsk.RecapWord(w.text, sentence, listOf(CoachAsk.TAPPED), w.pinyin.ifEmpty { null }, w.gloss.ifEmpty { null })))
        }
    }

    fun recordSaidWrong(words: List<CoachAsk.RecapWord>) {
        val id = threadId.value ?: NEW
        viewModelScope.launch { recap.record(id, words) }
    }

    fun itemFor(w: ReaderWordDto, sentence: String) = ExplorerStack.itemForText(w.text, w.pinyin.ifEmpty { null }, w.gloss.ifEmpty { null }, sentence)

    /** The header chip: the card's hub, or the chat the message was in (looked up: its relationship). */
    fun contextPath(link: ClaudeChats.Link, open: (String) -> Unit) {
        when (link.kind) {
            ClaudeChats.CARD -> link.noteId?.let { open(Routes.cardHub(it)) }
            ClaudeChats.CHAT_MESSAGE -> {
                val conv = link.conversationId ?: return
                viewModelScope.launch {
                    runCatching { app.repo.api.conversation(conv) }
                        .onSuccess { c -> if (c.relationship_id.isNotEmpty()) open(Routes.chat(c.relationship_id, c.id)) }
                        .onFailure { e -> local.update { it.copy(sendError = "Couldn't open that chat. ${e.userMessage()}") } }
                }
            }
        }
    }

    // ---- "🎯 Mini lesson on this mistake" (the Coach's, same endpoints: a coach conversation IS a thread) ----

    fun requestMistakeLesson() {
        val id = threadId.value ?: return
        if (local.value.lessonRequesting) return
        if (!app.online.value) { local.update { it.copy(lessonError = "The mini lesson needs a connection — try again when you're back online.") }; return }
        local.update { it.copy(lessonRequesting = true, lessonError = null) }
        viewModelScope.launch {
            try {
                val res = app.repo.api.requestCoachMistakeLesson(id)
                app.analytics.track("coach.mistake_lesson_generate", mapOf("existing" to res.existing))
                app.haptics.tick()
                refreshNow()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(lessonError = "Couldn't start the lesson. ${e.userMessage()}") }
            } finally {
                local.update { it.copy(lessonRequesting = false) }
            }
        }
    }

    /** ▶ Do it: the saved lesson's own run when it is on this phone, else the preview (`/coach/:c/lesson/:m`). */
    fun playLesson(messageId: String, content: CoachMistakeLesson.Content, open: (String) -> Unit) {
        val id = threadId.value ?: return
        viewModelScope.launch {
            val saved = content.lessonId?.let { lid -> app.safely("claude lesson local") { LessonRuntime.of(app).store.entry(lid) } }
            open(if (saved != null) "/lessons/${android.net.Uri.encode(saved.id)}/play?from=coach" else Routes.coachLesson(id, messageId))
        }
    }

    fun saveMistakeLesson(messageId: String) {
        val id = threadId.value ?: return
        if (local.value.lessonSaving != null) return
        if (!app.online.value) { local.update { it.copy(lessonError = "Saving needs a connection — try again when you're back online.") }; return }
        local.update { it.copy(lessonSaving = messageId, lessonError = null) }
        viewModelScope.launch {
            try {
                app.repo.api.saveCoachMistakeLesson(id, messageId, null)
                app.analytics.track("coach.mistake_lesson_save", mapOf("done" to false, "rating" to null))
                app.haptics.correct()
                refreshNow()
                app.scope.launch { app.safely("claude lesson sync") { LessonRuntime.of(app).store.sync(online = true) } }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(lessonError = "Couldn't save it. ${e.userMessage()}") }
            } finally {
                local.update { it.copy(lessonSaving = null) }
            }
        }
    }

    // ---- "Make flashcards from this chat" ----

    fun makeCards() {
        val id = threadId.value ?: return
        if (local.value.proposing) return
        if (!app.online.value) { local.update { it.copy(sendError = "You're offline — making cards needs a connection.") }; return }
        local.update { it.copy(proposing = true, notice = null, sendError = null) }
        viewModelScope.launch {
            try {
                val words = recap.words(id).map { it.hanzi }
                val res = app.repo.api.proposeCoachFlashcards(id, CoachAsk.focusWords(words))
                if (res.cards.isEmpty()) {
                    local.update { it.copy(sendError = "Claude found nothing new to make cards from in this chat.") }
                    return@launch
                }
                val cards = res.cards.map(ChatViewModel::proposed)
                val checked = cards.indices.filter { CoachAsk.cardChecked(cards[it].hanzi, cards[it].alreadyHave, words) }.toSet()
                val decks = withContext(Dispatchers.IO) {
                    PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { DeckChoice(it.id, it.name) }
                }
                app.haptics.tick()
                app.sounds.play(Sounds.Sfx.FLIP, 0.5f)
                local.update {
                    it.copy(decks = decks, review = ReviewUi(FlashcardReview(cards, checked), emptyMap(), "Cards from this chat", decks.firstOrNull()?.id, newDeck = if (decks.isEmpty()) "" else null))
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(sendError = "Couldn't make cards. ${e.userMessage()}") }
            } finally {
                local.update { it.copy(proposing = false) }
            }
        }
    }

    private fun updateReview(f: (ReviewUi) -> ReviewUi) = local.update { s -> s.review?.let { s.copy(review = f(it)) } ?: s }
    fun reviewToggle(i: Int) { app.haptics.tick(); updateReview { it.copy(review = it.review.toggle(i), error = null) } }
    fun reviewEdit(i: Int, card: ProposedCard) = updateReview { it.copy(review = it.review.edit(i, card)) }
    fun reviewOpenEdit(i: Int?) = updateReview { it.copy(editing = if (it.editing == i) null else i) }
    fun reviewPickDeck(deckId: String) { app.haptics.tick(); updateReview { it.copy(deckId = deckId, newDeck = null, error = null) } }
    fun reviewNewDeck(name: String?) = updateReview { it.copy(newDeck = name, error = null) }
    fun closeReview() = local.update { it.copy(review = null) }

    /** "Add N cards": the checked ones in one batch (the content service validates them again). */
    fun saveReview() {
        val id = threadId.value ?: return
        val r = local.value.review ?: return
        if (r.saving) return
        val chosen = r.review.chosen()
        if (chosen.isEmpty()) return
        val problems = r.review.localProblems()
        if (problems.isNotEmpty()) {
            app.haptics.wrong()
            updateReview { it.copy(review = it.review.copy(problems = problems), editing = problems.keys.first(), error = "Fix the marked card first.") }
            return
        }
        if (!app.online.value) { updateReview { it.copy(error = "You're offline — adding cards needs a connection. Your picks stay here.") }; return }
        val newName = r.newDeck?.trim()
        if (r.deckId == null && newName.isNullOrEmpty()) { updateReview { it.copy(error = "Pick a deck (or name a new one).") }; return }
        updateReview { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            try {
                val (deckId, deckName) = if (!newName.isNullOrEmpty()) app.repo.api.createDeck(newName, null).let { d -> d.id to d.name.ifEmpty { newName } }
                else r.deckId!! to (local.value.decks.firstOrNull { it.id == r.deckId }?.name ?: "your deck")
                val res = app.repo.api.addNotesBatch(deckId, chosen.map { ChatViewModel.noteOf(it.second) })
                val failed = res.failed.associate { it.index to it.error.ifBlank { "Couldn't add this card." } }
                val added = res.created.size
                app.analytics.track("coach.ask_flashcards", mapOf("count" to added, "focus" to recap.words(id).isNotEmpty()))
                if (added > 0) { app.haptics.celebrate(); app.sounds.play(Sounds.Sfx.MILESTONE, 0.7f) }
                val msg = "Added $added card${if (added == 1) "" else "s"} to $deckName ✓"
                if (failed.isEmpty()) local.update { it.copy(review = null, notice = msg) }
                else {
                    val next = r.review.afterBatch(chosen.map { it.first }, failed)
                    updateReview { it.copy(review = next, saving = false, editing = next.problems.keys.firstOrNull(), error = (if (added > 0) "$msg " else "") + "${failed.size} couldn't be added — fix and try again.") }
                }
                app.scope.launch { runCatching { app.repo.sync() } }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                updateReview { it.copy(saving = false, error = "Couldn't add the cards. ${e.userMessage()}") }
            }
        }
    }

    class Factory(
        private val app: LabApp,
        private val id: String,
        private val newContext: ClaudeContextDto?,
        private val source: String,
        private val hasSentence: Boolean,
        private val cardType: String? = null,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ClaudeThreadViewModel(app, id, newContext, source, hasSentence, cardType = cardType) as T
    }

    companion object {
        const val NEW = "new"
        private const val IDLE_TICK_MS = 500L

        /** The web's sendErrorText: the server's reason, else a plain "try again". */
        fun sendErrorText(e: Throwable): String = when {
            e is UnauthorizedException -> e.userMessage()
            e is HttpException && e.code == 409 -> e.userMessage().takeIf { !it.startsWith("The server said no") } ?: "Claude is still answering your last message."
            e is HttpException -> e.userMessage()
            else -> "Couldn't send that — try again."
        }
    }
}
