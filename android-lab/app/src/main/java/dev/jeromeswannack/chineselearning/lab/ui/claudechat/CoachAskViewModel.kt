package dev.jeromeswannack.chineselearning.lab.ui.claudechat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.CoachAsk
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.FlashcardReview
import dev.jeromeswannack.chineselearning.lab.core.PickerDecks
import dev.jeromeswannack.chineselearning.lab.core.ProposedCard
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.addNotesBatch
import dev.jeromeswannack.chineselearning.lab.data.api.coachConversation
import dev.jeromeswannack.chineselearning.lab.data.api.createDeck
import dev.jeromeswannack.chineselearning.lab.data.api.proposeCoachFlashcards
import dev.jeromeswannack.chineselearning.lab.data.api.retryCoachReply
import dev.jeromeswannack.chineselearning.lab.data.api.sendCoachMessage
import dev.jeromeswannack.chineselearning.lab.data.api.setAskClaudeLanguage
import dev.jeromeswannack.chineselearning.lab.data.api.setAskClaudeListening
import dev.jeromeswannack.chineselearning.lab.data.api.startCoachAsk
import dev.jeromeswannack.chineselearning.lab.data.api.translateCoachMessage
import dev.jeromeswannack.chineselearning.lab.data.claudechat.ClaudeChatRecap
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatViewModel
import dev.jeromeswannack.chineselearning.lab.ui.chat.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.chat.ListeningUi
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewUi
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatViewModel
import dev.jeromeswannack.chineselearning.lab.ui.study.AskListening
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * "💬 Ask Claude" backed by a coach conversation of kind 'ask' (the web's pages/ClaudeChatPage.tsx;
 * worker routes/coach.ts `POST /coach/ask`, follow-ups through `…/messages` with `language`): replies
 * are written in the background and polled while pending; the thread is cached on the phone
 * (JsonCache `coach/c/<id>`, the Coach's own key) so a chat opens offline. 中文 | EN and 🎧 are the
 * account's Ask Claude settings (Prefs + `PUT /api/profile/ask-claude-*`). Tapped / said-wrong words go
 * to [ClaudeChatRecap] (this phone).
 */
class CoachAskViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val isNew = id == NEW
    private val thread = if (isNew) null else app.cachedResource<CoachThreadDto>(viewModelScope, threadKey(id), "coach-thread") { coachConversation(id) }
    private val recap = ClaudeChatRecap(app)
    private val local = MutableStateFlow(ClaudeChatUi(language = app.prefs.askClaudeLanguage, listening = app.prefs.askClaudeListening, loading = !isNew))
    private val listen = AskListening(
        app, viewModelScope,
        state = { local.value.listen },
        update = { f -> local.update { it.copy(listen = f(it.listen)) } },
        notice = { n -> local.update { it.copy(listenNotice = n?.let { x -> x.id to x.text }) } },
        stopOthers = { LessonRuntime.of(app).audio.stop() },
    )
    /** When each reply was asked for (`coach.ask_reply { ms }`: Jerome — "the first message is slow"). */
    private val sentAt = HashMap<String, Pair<Long, Boolean>>()

    private val threadState: Flow<Loadable<CoachThreadDto>?> = thread?.state ?: flowOf(null)

    val ui: StateFlow<ClaudeChatUi> = combine(
        threadState,
        local,
        app.online,
        recap.observe(id),
        LessonRuntime.of(app).audio.playing,
    ) { t, u, online, words, playing ->
        val data = t?.data
        u.copy(
            title = data?.conversation?.title.orEmpty(),
            messages = data?.messages.orEmpty().filter { it.content_type == "text" }.map {
                ClaudeChatMsg(it.id, it.role, it.content, it.answer_lang, it.status, it.error, it.translation)
            },
            loading = !isNew && data == null && t?.loading != false,
            loadError = if (data == null) t?.error else null,
            online = online,
            recapCount = words.size,
            playingText = playing,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, local.value)

    init {
        listen.start()
        viewModelScope.launch {
            val known = withContext(Dispatchers.IO) { runCatching { app.repo.dao.allNotes().mapTo(HashSet()) { it.hanzi.trim() } }.getOrDefault(HashSet()) }
            local.update { it.copy(known = known) }
        }
        // A reply that lands while the chat is open: how long it took.
        viewModelScope.launch {
            ui.collect { u ->
                for (m in u.messages) {
                    val s = sentAt[m.id] ?: continue
                    if (m.status == "pending") continue
                    sentAt.remove(m.id)
                    if (m.status == null) app.analytics.track("coach.ask_reply", mapOf("ms" to (System.currentTimeMillis() - s.first), "first" to s.second, "language" to (m.answerLang ?: u.language)))
                }
            }
        }
    }

    fun reload() { thread?.refresh() }

    /** Look again while a reply is pending, only while the screen is shown. */
    suspend fun pollWhilePending() {
        // Every second while a reply is pending, every 2.5 s after 15 s (CoachActions.replyPollMs, shared/coach/poll.ts).
        var pendingSince: Long? = null
        while (true) {
            val pending = thread?.state?.value?.data?.hasPending == true
            if (!pending) pendingSince = null
            val since = if (pending) (pendingSince ?: System.currentTimeMillis().also { pendingSince = it }) else null
            kotlinx.coroutines.delay(if (since != null) CoachActions.replyPollMs(System.currentTimeMillis() - since) else 1000L)
            val t = thread ?: continue
            if (t.state.value.data?.hasPending == true && app.online.value) t.refresh().join()
        }
    }

    fun setDraft(s: String) = local.update { it.copy(draft = s) }

    private fun rememberPending(messages: List<dev.jeromeswannack.chineselearning.lab.data.api.CoachMessageDto>, first: Boolean) {
        messages.firstOrNull { it.isPending }?.let { sentAt[it.id] = System.currentTimeMillis() to first }
    }

    /** Send (the first message starts the chat; [onStarted] opens its own route). */
    fun send(text: String, spoken: Boolean, onStarted: (String) -> Unit) {
        val msg = text.trim()
        if (msg.isEmpty() || ui.value.busy) return
        if (!app.online.value) {
            local.update { it.copy(sendError = "You're offline — Claude needs a connection. Your message is kept; send it again when you're back online.") }
            return
        }
        val language = local.value.language
        app.analytics.track("coach.ask_message", mapOf("language" to language, "spoken" to spoken))
        local.update { it.copy(sending = msg, sendError = null, notice = null) }
        viewModelScope.launch {
            try {
                if (isNew) {
                    val res = app.repo.api.startCoachAsk(msg, language)
                    app.analytics.track("coach.ask_start", mapOf("language" to language))
                    app.cache.put(threadKey(res.conversation.id), "coach-thread", res)
                    CoachChatViewModel.startedHere += res.conversation.id
                    pendingFirst[res.conversation.id] = System.currentTimeMillis()
                    app.haptics.tick()
                    local.update { it.copy(sending = null, draft = "") }
                    onStarted(res.conversation.id)
                } else {
                    val res = app.repo.api.sendCoachMessage(id, msg, language)
                    rememberPending(res.messages, false)
                    thread?.update { t -> t?.copy(messages = t.messages + res.messages) ?: CoachThreadDto(CoachConversationDto(id), res.messages) }
                    app.haptics.tick()
                    local.update { it.copy(sending = null, draft = if (it.draft.trim() == msg) "" else it.draft) }
                }
                app.cache.delete(LIST_KEY)
            } catch (e: Exception) {
                local.update { it.copy(sending = null, sendError = "Couldn't send that. ${e.userMessage()}") }
                if ((e as? HttpException)?.code == 409) thread?.refresh()
            }
        }
    }

    init {
        // The chat just started on the "new" screen: its first reply's clock started there.
        pendingFirst.remove(id)?.let { at ->
            viewModelScope.launch {
                val t = thread ?: return@launch
                val first = t.state.first { it.data != null }.data ?: return@launch
                first.messages.firstOrNull { it.isPending }?.let { sentAt[it.id] = at to true }
            }
        }
    }

    fun retry(messageId: String) {
        if (!app.online.value) { local.update { it.copy(sendError = "You're offline — Claude needs a connection.") }; return }
        viewModelScope.launch {
            try {
                val res = app.repo.api.retryCoachReply(id, messageId)
                app.cache.put(threadKey(id), "coach-thread", res)
                sentAt[messageId] = System.currentTimeMillis() to false
                app.analytics.track("coach.reply_retry")
            } catch (e: Exception) {
                local.update { it.copy(sendError = "Couldn't retry that. ${e.userMessage()}") }
            }
        }
    }

    suspend fun translate(messageId: String): String? = runCatching {
        val t = app.repo.api.translateCoachMessage(id, messageId).translation
        thread?.update { th -> th?.copy(messages = th.messages.map { if (it.id == messageId) it.copy(translation = t) else it }) ?: CoachThreadDto(CoachConversationDto(id)) }
        t
    }.getOrNull()

    fun setLanguage(language: String) {
        val l = AskClaude.parseLanguage(language) ?: return
        app.prefs.askClaudeLanguage = l
        local.update { it.copy(language = l) }
        app.analytics.track("coach.ask_tool", mapOf("action" to "language", "role" to "claude"))
        app.scope.launch { runCatching { app.repo.api.setAskClaudeLanguage(l) } }
    }

    fun setListening(on: Boolean) {
        app.prefs.askClaudeListening = on
        if (on) listen.keepOnScreen(ui.value.messages.filter { !it.mine }.map { AskAnswer(it.id, answer = it.text, answer_lang = it.answerLang) }) else listen.stop()
        app.haptics.tick()
        local.update { it.copy(listening = on, listenNotice = null) }
        app.analytics.track("coach.ask_tool", mapOf("action" to if (on) "listening_on" else "listening_off", "role" to "claude"))
        app.scope.launch { runCatching { app.repo.api.setAskClaudeListening(on) } }
    }

    fun listen(messageId: String, auto: Boolean) {
        val m = ui.value.messages.firstOrNull { it.id == messageId } ?: return
        app.analytics.track("coach.ask_tool", mapOf("action" to if (auto) "listen_auto" else "listen", "role" to "claude"))
        listen.play(AskAnswer(m.id, answer = m.text, answer_lang = m.answerLang), auto)
    }

    fun reveal(messageId: String) {
        app.analytics.track("coach.ask_tool", mapOf("action" to "reveal", "role" to "claude"))
        listen.reveal(messageId)
    }

    fun toggleSlow() = listen.toggleSlow()

    fun audioBusy(): Boolean = listen.busy() || LessonRuntime.of(app).audio.playing.value != null

    /** ▶: the message in Claude's voice (the Read-aloud clip, cached by text + voice + speed). */
    fun play(m: ClaudeChatMsg) {
        listen.stop()
        app.analytics.track("coach.ask_tool", mapOf("action" to "play", "role" to if (m.mine) "mine" else "claude"))
        viewModelScope.launch {
            val audio = LessonRuntime.of(app).audio
            if (audio.playing.value == m.text) audio.stop() else audio.playClip(m.text, AskClaude.VOICE, AskClaude.SPEED)
        }
    }

    fun stopAudio() {
        listen.stop()
        LessonRuntime.of(app).audio.stop()
    }

    fun track(action: String, mine: Boolean) = app.analytics.track("coach.ask_tool", mapOf("action" to action, "role" to if (mine) "mine" else "claude"))

    /** A tapped word: kept to recap (the explorer opens from the screen). */
    fun recordTapped(w: ReaderWordDto, sentence: String) {
        viewModelScope.launch {
            recap.record(id, listOf(CoachAsk.RecapWord(w.text, sentence, listOf(CoachAsk.TAPPED), w.pinyin.ifEmpty { null }, w.gloss.ifEmpty { null })))
        }
    }

    fun recordSaidWrong(words: List<CoachAsk.RecapWord>) {
        viewModelScope.launch { recap.record(id, words) }
    }

    fun itemFor(w: ReaderWordDto, sentence: String) = ExplorerStack.itemForText(w.text, w.pinyin.ifEmpty { null }, w.gloss.ifEmpty { null }, sentence)

    // ---- "Make flashcards from this chat" ----

    fun makeCards() {
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
            } catch (e: Exception) {
                updateReview { it.copy(saving = false, error = "Couldn't add the cards. ${e.userMessage()}") }
            }
        }
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CoachAskViewModel(app, id) as T
    }

    companion object {
        const val NEW = "new"
        const val LIST_KEY = "coach/conversations"
        fun threadKey(id: String) = "coach/c/$id"
        /** A chat started on the "new" screen → when (its route's screen picks the first reply's clock up). */
        private val pendingFirst: MutableMap<String, Long> = java.util.Collections.synchronizedMap(HashMap())
    }
}
