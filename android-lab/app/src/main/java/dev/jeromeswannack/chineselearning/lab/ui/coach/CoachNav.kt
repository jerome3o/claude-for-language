package dev.jeromeswannack.chineselearning.lab.ui.coach

import android.content.Context
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CoachAction
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.CoachBreakdownWord
import dev.jeromeswannack.chineselearning.lab.core.CoachNewWords
import dev.jeromeswannack.chineselearning.lab.data.api.EnrichWordIn
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainTextBody
import dev.jeromeswannack.chineselearning.lab.data.api.addNotesBatch
import dev.jeromeswannack.chineselearning.lab.data.api.enrichWords
import dev.jeromeswannack.chineselearning.lab.data.api.explainSentenceText
import dev.jeromeswannack.chineselearning.lab.data.api.retryCoachReply
import dev.jeromeswannack.chineselearning.lab.data.api.serverMessage
import kotlinx.coroutines.flow.first
import dev.jeromeswannack.chineselearning.lab.data.api.CoachAnalysisDto
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.data.api.CoachBreakdownDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.coachConversation
import dev.jeromeswannack.chineselearning.lab.data.api.coachConversations
import dev.jeromeswannack.chineselearning.lab.data.api.deleteCoachConversation
import dev.jeromeswannack.chineselearning.lab.data.api.sendCoachMessage
import dev.jeromeswannack.chineselearning.lab.data.api.startCoachConversation
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * `/coach?text=&c=&focus=` (package H): the home (new sentence + conversations) or, with `c`, one
 * conversation. The home offers the web's buttons (`CoachActions.buttons`, shared/coach): Chinese →
 * Check my sentence + Explain, English → Translate. `?text=` ("select text → Sentence Coach")
 * translates English at once and puts Chinese in the box on the two buttons, like the web;
 * `?focus=1` (the widget's ✏️) opens the home with the sentence box focused, keyboard up;
 * `?draft=` (study card ⋯ → Sentence coach) fills the box without sending — back returns to the card.
 */
fun NavGraphBuilder.coachGraph(nav: LabNav) {
    composable(
        Routes.route("/coach?text={text}&c={c}&focus={focus}&draft={draft}&action={action}&from_message={from_message}"),
        arguments = listOf(
            navArgument("action") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("from_message") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("text") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("c") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("focus") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("draft") { type = NavType.StringType; nullable = true; defaultValue = null },
        ),
    ) { entry ->
        val conversationId = entry.arguments?.getString("c")
        val text = entry.arguments?.getString("text")
        val focus = entry.arguments?.getString("focus") == "1"
        val draft = entry.arguments?.getString("draft")
        val action = entry.arguments?.getString("action")
        val fromMessage = entry.arguments?.getString("from_message")
        if (conversationId != null) {
            val vm: CoachChatViewModel = viewModel(key = "coach-$conversationId", factory = CoachChatViewModel.Factory(nav.app, conversationId))
            val ui by vm.ui.collectAsStateWithLifecycle()
            // A reply written in the background: look again every ~2.5 s while one is pending, only while this screen is shown.
            LaunchedEffect(vm) { vm.pollWhilePending() }
            CoachChatScreen(
                ui,
                CoachChatActions(
                    onBack = nav::back,
                    onNew = { nav.back(); nav.open(Routes.coach()) },
                    onFollowUp = vm::setFollowUp,
                    onSend = vm::send,
                    onDeck = vm::selectDeck,
                    onRetryLoad = vm::reload,
                    cards = coachCardActions(nav.app),
                    onBumpExact = vm::bumpExact,
                    onOpenBumpPicker = vm::openBumpPicker,
                    onCloseBumpPicker = vm::closeBumpPicker,
                    onBumpPicked = vm::bumpPicked,
                    onRetryReply = vm::retryReply,
                    onOpenNewWords = vm::openNewWords,
                    newWords = NewWordsActions(
                        onToggle = vm::toggleNewWord,
                        onDeck = vm::selectNewWordsDeck,
                        onAdd = vm::addNewWords,
                        onBump = vm::bumpExisting,
                        onClose = vm::closeNewWords,
                    ),
                ),
            )
        } else {
            val vm: CoachHomeViewModel = viewModel(factory = CoachHomeViewModel.Factory(nav.app))
            val ui by vm.ui.collectAsStateWithLifecycle()
            // ?draft= (a study card's sentence): in the box, not sent; back returns to the card.
            LaunchedEffect(draft) { if (!draft.isNullOrBlank() && vm.claimDraft(draft)) vm.setDraft(draft) }
            // While a conversation is still thinking, the list looks again every few seconds.
            LaunchedEffect(vm) { vm.pollListWhilePending() }
            // ?text=[&action=&from_message=] (core CoachActions.deepLinkAction): an explicit action runs at
            // once ("Open in Coach" from a chat message — its auto-check is reused); without one English is
            // translated at once and Chinese waits in the box on Check / Explain.
            LaunchedEffect(text, action) {
                if (!text.isNullOrBlank() && vm.claimDeepLink(text + "\u0000" + action.orEmpty())) {
                    val run = CoachActions.deepLinkAction(text, action)
                    if (run != null) vm.start(text.trim(), run, chatMessageId = fromMessage) { id -> nav.open(Routes.coachConversation(id)) } else vm.setDraft(text)
                }
            }
            CoachHomeScreen(
                ui,
                autoFocus = focus && text.isNullOrBlank() && vm.claimFocus(),
                actions = CoachHomeActions(
                    onBack = nav::back,
                    onDraft = vm::setDraft,
                    onAction = { action -> vm.start(ui.draft.trim(), action) { id -> nav.open(Routes.coachConversation(id)) } },
                    onOpen = { nav.open(Routes.coachConversation(it)) },
                    onDelete = vm::delete,
                    cards = coachCardActions(nav.app),
                ),
            )
        }
    }
}

/**
 * Adding a word / the whole sentence from an Explain result: the same AddChunkSheet (deck chips,
 * duplicate warning) as the study card's "What's going on here?" breakdown, through the same calls.
 */
private fun coachCardActions(app: LabApp): SentenceActions {
    val tools = CardTools(app)
    return SentenceActions(
        decks = {
            withContext(Dispatchers.IO) { dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { it.id to it.name } }
        },
        deckHas = tools::deckHas,
        addCard = { deckId, c -> tools.addNote(deckId, NewNoteBody(c.hanzi, c.pinyin, c.english, c.funFacts)) },
    )
}

/** The conversation route (web: `/coach?c=<id>`). */
fun Routes.coachConversation(id: String) = "/coach?c=${android.net.Uri.encode(id)}"

/**
 * "Open in Coach" from a chat message (docs/CHAT.md "Chat ↔ Coach"): `/coach?text=&action=&from_message=`
 * — the same link as core SayBetter.coachDeepLink, encoded for the Lab's router (Uri.encode: `%20`,
 * which Navigation decodes; it would keep a form-encoded `+`).
 */
fun coachOpenPath(text: String, action: String, fromMessage: String?): String =
    "/coach?text=${android.net.Uri.encode(text)}&action=${android.net.Uri.encode(action)}" +
        (if (fromMessage.isNullOrEmpty()) "" else "&from_message=${android.net.Uri.encode(fromMessage)}")

private const val LIST_KEY = "coach/conversations"
private fun threadKey(id: String) = "coach/c/$id"

class CoachHomeViewModel(private val app: LabApp) : ViewModel() {
    private val list = app.cachedResource<List<CoachConversationDto>>(viewModelScope, LIST_KEY, "coach") { coachConversations() }
    private val local = MutableStateFlow(CoachHomeUi())
    val ui: StateFlow<CoachHomeUi> = combine(list.state, local, app.online) { l, u, online -> u.copy(conversations = l, online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, CoachHomeUi())

    private var handledDeepLink: String? = null
    private var focusClaimed = false

    /** `?focus=1` (the widget's ✏️) raises the keyboard once — not again when coming back from a conversation. */
    fun claimFocus(): Boolean {
        if (focusClaimed) return false
        focusClaimed = true
        return true
    }

    private var handledDraft: String? = null

    /** `?draft=` fills the box once — not again over what was typed since. */
    fun claimDraft(draft: String): Boolean {
        if (handledDraft == draft) return false
        handledDraft = draft
        return true
    }

    /** `?text=` starts a conversation once — not again when coming back to this screen. */
    fun claimDeepLink(text: String): Boolean {
        if (handledDeepLink == text) return false
        handledDeepLink = text
        return true
    }

    fun setDraft(s: String) = local.update { it.copy(draft = s, startError = null, savedBreakdown = null) }

    private val tools = CardTools(app)

    /**
     * Run a button (the web's startMutation). Explain is the same brief breakdown as the study card's
     * "What's going on here?", kept by its text: the cached one is sent (the server stores it, no
     * Claude call) and the answer kept, so the sentence is explained offline next time — offline or
     * unreachable, the saved breakdown shows on this screen instead.
     */
    /** The list again every [LIST_POLL_MS] while a conversation is still thinking (cancelled with the screen). */
    suspend fun pollListWhilePending() {
        while (true) {
            kotlinx.coroutines.delay(LIST_POLL_MS)
            if (list.state.value.data.orEmpty().any { it.pending_reply } && app.online.value) list.refresh().join()
        }
    }

    fun start(text: String, action: CoachAction, chatMessageId: String? = null, onStarted: (String) -> Unit) {
        if (text.isEmpty() || local.value.starting) return
        local.update { it.copy(draft = text, starting = true, pendingAction = action, startError = null, savedBreakdown = null) }
        app.analytics.track("coach.start", mapOf("action" to action.id))
        viewModelScope.launch {
            val cached = if (action == CoachAction.EXPLAIN) runCatching { tools.cachedTextExplanation(text) }.getOrNull() else null
            if (cached != null && !app.online.value) {
                local.update { it.copy(starting = false, pendingAction = null, savedBreakdown = CoachBreakdownDto.of(text, cached)) }
                return@launch
            }
            if (!app.online.value) {
                // The text stays in the box for when the connection is back.
                local.update { it.copy(starting = false, pendingAction = null, lastAction = action, startError = CoachRules.OFFLINE) }
                return@launch
            }
            try {
                // background: true — the reply is written by the server's queue, so leaving never cancels it.
                val res = CoachRules.retryOnce { app.repo.api.startCoachConversation(text, action.id, cached?.takeIf { !it.translation.isNullOrBlank() }, chatMessageId) }
                app.cache.put(threadKey(res.conversation.id), "coach-thread", res)
                CoachChatViewModel.startedHere += res.conversation.id
                if (action == CoachAction.EXPLAIN) {
                    res.messages.firstOrNull { it.content_type == "analysis" && it.status == null }?.let { CoachAnalysisDto.parse(it.content)?.breakdown }
                        ?.let { runCatching { tools.cacheTextExplanation(text, it.asExplanation()) } }
                }
                app.haptics.tick()
                local.update { it.copy(draft = "", starting = false, pendingAction = null) }
                list.refresh()
                onStarted(res.conversation.id)
            } catch (e: Exception) {
                // The text stays in the box for Try again.
                local.update {
                    it.copy(
                        starting = false,
                        pendingAction = null,
                        lastAction = action,
                        startError = CoachRules.errorText(e, "Couldn't reach the coach", app.online.value),
                        savedBreakdown = cached?.let { c -> CoachBreakdownDto.of(text, c) },
                    )
                }
            }
        }
    }

    fun delete(id: String) {
        viewModelScope.launch {
            runCatching {
                app.repo.api.deleteCoachConversation(id)
                list.update { l -> l.orEmpty().filter { it.id != id } }
                app.cache.delete(threadKey(id))
            }.onFailure { e -> local.update { it.copy(startError = e.userMessage()) } }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CoachHomeViewModel(app) as T
    }
}

private const val LIST_POLL_MS = 4000L
private const val THREAD_POLL_MS = 2500L

class CoachChatViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val thread = app.cachedResource<CoachThreadDto>(viewModelScope, threadKey(id), "coach-thread") { coachConversation(id) }
    private val local = MutableStateFlow(CoachChatUi(deckId = lastDeck(app)))
    private val tools = CardTools(app)
    /** Reply ids seen pending on this screen: when one lands, its follow-ups run (sync, cache, haptic). */
    private val seenPending = HashSet<String>()
    val ui: StateFlow<CoachChatUi> = combine(thread.state, local, app.online) { t, u, online -> u.copy(thread = t, online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, CoachChatUi())

    init {
        viewModelScope.launch {
            val decks = withContext(Dispatchers.IO) {
                app.repo.dao.decks().sortedWith(compareByDescending<dev.jeromeswannack.chineselearning.lab.data.DeckEntity> { it.studyPriority }.thenByDescending { it.createdAt })
                    .map { CoachDeck(it.id, it.name) }
            }
            // Default the picker to the remembered deck, else the first deck.
            local.update { u -> u.copy(decks = decks, deckId = u.deckId?.takeIf { d -> decks.any { it.id == d } } ?: decks.firstOrNull()?.id) }
        }
    }

    init {
        // "⚡ Study … today" (core SentenceBumps): the sentence's own card, else its words that
        // are cards (the picker), and which notes are already in today's pocket.
        viewModelScope.launch {
            kotlinx.coroutines.flow.combine(
                thread.state.map { t ->
                    t.data?.messages?.firstOrNull { it.content_type == "analysis" }?.let { dev.jeromeswannack.chineselearning.lab.data.api.CoachAnalysisDto.parse(it.content) }?.sentence
                }.distinctUntilChanged(),
                app.repo.dataVersion,
            ) { s, _ -> s }.collect { sentence ->
                val found = if (sentence.isNullOrBlank()) null else app.safely("coach sentence bumps") {
                    withContext(Dispatchers.IO) { BumpStore.sentenceBumps(app.repo.dao, sentence) to BumpStore.openNoteIds(app.repo.dao) }
                }
                local.update {
                    it.copy(
                        bumpExact = found?.first?.exact,
                        bumpWords = found?.first?.words.orEmpty(),
                        bumpedNoteIds = found?.second.orEmpty(),
                        bumpPicker = it.bumpPicker && !found?.first?.words.isNullOrEmpty(),
                    )
                }
            }
        }
    }

    /** "⚡ Study this today": only the sentence's own card. */
    fun bumpExact() {
        val exact = local.value.bumpExact ?: return
        bump(listOf(exact.noteId))
    }

    fun openBumpPicker() = local.update { it.copy(bumpPicker = it.bumpWords.isNotEmpty(), bumpMessage = null) }

    fun closeBumpPicker() = local.update { it.copy(bumpPicker = false) }

    /** The picker's "⚡ Add N to today": exactly the ticked notes. */
    fun bumpPicked(noteIds: List<String>) {
        local.update { it.copy(bumpPicker = false) }
        bump(noteIds)
    }

    private fun bump(noteIds: List<String>) {
        if (noteIds.isEmpty()) return
        viewModelScope.launch {
            val msg = app.safely("coach bump") { BumpStore.bumpNotes(app, noteIds, "coach").message } ?: return@launch
            app.haptics.correct()
            local.update { it.copy(bumpMessage = msg, bumpedNoteIds = it.bumpedNoteIds + noteIds) }
            kotlinx.coroutines.delay(3500)
            local.update { if (it.bumpMessage == msg) it.copy(bumpMessage = null) else it }
        }
    }

    fun reload() { thread.refresh() }

    fun setFollowUp(s: String) = local.update { it.copy(followUp = s) }

    fun selectDeck(deckId: String) {
        local.update { it.copy(deckId = deckId) }
        prefs(app).edit().putString("last-deck", deckId).apply()
    }

    fun send(message: String) {
        if (message.isBlank() || local.value.sending || ui.value.replyPending) return
        if (!app.online.value) {
            // Offline: say so; the typed text stays in the box.
            local.update { it.copy(sendError = CoachRules.OFFLINE) }
            return
        }
        local.update { it.copy(sending = true, pendingMessage = message, sendError = null) }
        startedHere += id
        viewModelScope.launch {
            try {
                // background: true → 202 with my message and the PENDING reply, which [pollWhilePending] follows.
                val res = app.repo.api.sendCoachMessage(id, message)
                thread.update { t -> t?.copy(messages = t.messages + res.messages) ?: CoachThreadDto(dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto(id), res.messages) }
                local.update { it.copy(sending = false, pendingMessage = null, followUp = if (it.followUp.trim() == message) "" else it.followUp) }
                app.haptics.tick()
                // New cards / a mini lesson: pull them onto the phone so they're in the next session, even offline.
                if (res.toolResults.any { it.success && (it.tool == "create_flashcards" || it.tool == "create_custom_lesson") }) {
                    app.sounds.play(Sounds.Sfx.CORRECT, 0.6f)
                    app.haptics.correct()
                    app.scope.launch { runCatching { app.repo.sync() } }
                }
                app.cache.delete(LIST_KEY)
            } catch (e: Exception) {
                local.update { it.copy(sending = false, pendingMessage = null, sendError = CoachRules.errorText(e, "Couldn't send that", app.online.value)) }
                // 409: a reply is still being written — pick it up.
                if ((e as? dev.jeromeswannack.chineselearning.lab.data.HttpException)?.code == 409) thread.refresh()
            }
        }
    }

    // ---------------- replies written in the background (docs/CHAT.md "Chat ↔ Coach") ----------------

    /** Look again every [THREAD_POLL_MS] while a reply is pending; cancelled when the screen goes. */
    suspend fun pollWhilePending() {
        while (true) {
            kotlinx.coroutines.delay(THREAD_POLL_MS)
            if (thread.state.value.data?.hasPending == true && app.online.value) thread.refresh().join()
        }
    }

    /** Retry a reply that failed: back on the server's queue (the thread comes back with it pending). */
    fun retryReply(messageId: String) {
        if (local.value.retrying) return
        if (!app.online.value) { local.update { it.copy(sendError = CoachRules.OFFLINE) }; return }
        local.update { it.copy(retrying = true, sendError = null) }
        startedHere += id
        viewModelScope.launch {
            try {
                val res = app.repo.api.retryCoachReply(id, messageId)
                app.cache.put(threadKey(id), "coach-thread", res)
                app.analytics.track("coach.reply_retry")
                app.haptics.tick()
                app.cache.delete(LIST_KEY)
            } catch (e: Exception) {
                local.update { it.copy(sendError = CoachRules.errorText(e, "Couldn't retry that", app.online.value)) }
                thread.refresh()
            } finally {
                local.update { it.copy(retrying = false) }
            }
        }
    }

    init {
        // Opened (not just sent from here) while a reply is still being written: counted once.
        viewModelScope.launch {
            val first = thread.state.first { !it.loading && it.data != null }.data!!
            if (first.hasPending && id !in startedHere && resumeTracked.add(id)) app.analytics.track("coach.reply_resumed")
        }
        // A reply that lands: the same follow-ups as a reply that came back at once.
        viewModelScope.launch {
            thread.state.map { it.data?.messages.orEmpty() }.distinctUntilChanged().collect { msgs ->
                for (m in msgs) {
                    if (m.isPending) { seenPending += m.id; continue }
                    if (!seenPending.remove(m.id) || m.isFailed) continue
                    app.haptics.tick()
                    app.cache.delete(LIST_KEY)
                    if (m.content_type == "analysis") {
                        // An Explain answer that came in the background is kept on the device too (offline second look).
                        CoachAnalysisDto.parse(m.content)?.breakdown?.let { b ->
                            app.safely("coach cache explain") { if (tools.cachedTextExplanation(b.hanzi) == null) tools.cacheTextExplanation(b.hanzi, b.asExplanation()) }
                        }
                    }
                    val results = CoachAnalysisDto.toolResults(m.tool_results)
                    // New cards / a mini lesson / bumped words: pull them onto the phone for the next session, even offline.
                    if (results.any { it.success && (it.tool == "create_flashcards" || it.tool == "create_custom_lesson" || it.tool == "bump_cards") }) {
                        if (results.any { it.success && it.tool == "create_flashcards" }) {
                            app.sounds.play(Sounds.Sfx.CORRECT, 0.6f)
                            app.haptics.correct()
                        }
                        app.scope.launch { runCatching { app.repo.sync() } }
                    }
                }
            }
        }
    }

    // ---------------- "➕ Add new words" / "🃏 Card for this sentence" ----------------

    /** Words added / found from this screen, so the chip stops offering them before the sync lands. */
    private val justAdded = MutableStateFlow<Set<String>>(emptySet())

    init {
        // The sentence's breakdown: Explain's own, else the device's cached explain-text, else fetched once.
        viewModelScope.launch {
            thread.state.map { t -> t.data?.messages?.firstOrNull { it.content_type == "analysis" && it.status == null }?.let { CoachAnalysisDto.parse(it.content) } }
                .distinctUntilChanged().collect { a ->
                    val b = if (a == null) null else app.safely("coach breakdown") { sentenceBreakdown(a) }
                    local.update { it.copy(breakdown = b) }
                }
        }
        // Which of its words are in none of his decks (core CoachNewWords), whenever the notes change.
        viewModelScope.launch {
            combine(ui.map { it.breakdown }.distinctUntilChanged(), app.repo.dataVersion, justAdded) { b, _, added -> b to added }.collect { (b, added) ->
                val words = if (b == null) emptyList() else app.safely("coach new words") {
                    val known = withContext(Dispatchers.IO) {
                        val live = app.repo.dao.decks().map { it.id }.toHashSet()
                        app.repo.dao.allNotes().filter { it.deckId in live }.map { it.hanzi }
                    }
                    CoachNewWords.newWordsInSentence(b.words.map { CoachBreakdownWord(it.hanzi, it.pinyin, it.gloss) }, known + added)
                }.orEmpty()
                local.update { it.copy(newWords = words) }
            }
        }
    }

    private suspend fun sentenceBreakdown(a: CoachAnalysisDto): CoachBreakdownDto? {
        val hanzi = a.sentence?.takeIf { it.isNotBlank() } ?: return null
        val (pinyin, english) = when {
            a.kind == "chinese" && a.coach != null -> a.coach.corrected.pinyin to a.coach.corrected.english
            a.kind == "explain" && a.breakdown != null -> a.breakdown.pinyin to a.breakdown.translation.orEmpty()
            else -> (a.translation?.primary?.pinyin.orEmpty()) to (a.translation?.primary?.english.orEmpty())
        }
        val e = if (a.kind == "explain" && a.breakdown != null) a.breakdown.asExplanation()
        else tools.cachedTextExplanation(hanzi) ?: run {
            if (!app.online.value) return null
            app.repo.api.explainSentenceText(ExplainTextBody(hanzi, pinyin.ifBlank { null }, english.ifBlank { null })).also { tools.cacheTextExplanation(hanzi, it) }
        }
        return CoachBreakdownDto(
            hanzi = hanzi,
            pinyin = pinyin.ifBlank { e.words.map { it.pinyin }.filter { it.isNotEmpty() }.joinToString(" ") },
            translation = english.ifBlank { e.translation.orEmpty() }.trim(),
            words = e.words,
            construction = e.construction.orEmpty(),
        )
    }

    /** "➕ Add new words (N)": the picker, NOTHING ticked, the deck = the top of the study queue. */
    fun openNewWords() {
        val u = ui.value
        if (u.newWords.isEmpty() || u.breakdown == null) return
        viewModelScope.launch {
            val decks = withContext(Dispatchers.IO) {
                dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { CoachDeck(it.id, it.name) }
            }
            if (decks.isEmpty()) return@launch
            local.update { it.copy(newWordsSheet = NewWordsSheetUi(u.newWords, decks)) }
        }
    }

    fun closeNewWords() = local.update { if (it.newWordsSheet?.saving == true) it else it.copy(newWordsSheet = null) }

    fun toggleNewWord(hanzi: String) = local.update { u ->
        val s = u.newWordsSheet?.takeIf { !it.saving } ?: return@update u
        u.copy(newWordsSheet = s.copy(picked = if (hanzi in s.picked) s.picked - hanzi else s.picked + hanzi, error = null))
    }

    fun selectNewWordsDeck(deckId: String) = local.update { u -> u.copy(newWordsSheet = u.newWordsSheet?.copy(deckId = deckId)) }

    /**
     * Save the ticked words (web NewWordsSheet.add): card drafts (core CoachNewWords.newWordCards) →
     * enrich-words for the explanation and a shorter example (saved without it when Claude can't be
     * reached) → ONE batch call with `skip_existing=1` → the done screen; then a sync.
     */
    fun addNewWords() {
        val sheet = local.value.newWordsSheet ?: return
        val b = local.value.breakdown ?: return
        val deck = sheet.deck ?: return
        val chosen = sheet.chosen
        if (sheet.saving || chosen.isEmpty()) return
        if (!app.online.value) {
            local.update { it.copy(newWordsSheet = sheet.copy(error = "You're offline — adding cards needs a connection. Your ticks are kept.")) }
            return
        }
        local.update { it.copy(newWordsSheet = sheet.copy(saving = true, error = null)) }
        viewModelScope.launch {
            val cards = CoachNewWords.newWordCards(chosen, b.hanzi, b.pinyin, b.translation)
            val enriched = try {
                app.repo.api.enrichWords(cards.map { EnrichWordIn(it.hanzi, it.pinyin, it.english) })
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                emptyList()
            }
            val byHanzi = enriched.associateBy { it.hanzi }
            val notes = cards.map { c ->
                val e = byHanzi[c.hanzi]
                val ownClue = e?.sentence_clue?.takeIf { it.isNotBlank() && it.contains(c.hanzi) } != null
                NewNoteBody(
                    c.hanzi, c.pinyin, c.english,
                    fun_facts = e?.fun_facts?.takeIf { it.isNotBlank() },
                    sentence_clue = if (ownClue) e!!.sentence_clue else c.sentenceClue,
                    sentence_clue_pinyin = if (ownClue) e!!.sentence_clue_pinyin else c.sentenceCluePinyin,
                    sentence_clue_translation = if (ownClue) e!!.sentence_clue_translation else c.sentenceClueTranslation,
                )
            }
            try {
                val res = app.repo.api.addNotesBatch(deck.id, notes, skipExisting = true)
                val added = res.created.map { it.hanzi }
                val failed = res.failed.map { f -> "${f.hanzi}: ${f.error}" }
                justAdded.update { it + added + res.existing.map { e -> e.hanzi } }
                app.analytics.track("coach.add_new_words", mapOf("count" to res.created.size, "existing" to res.existing.size))
                if (res.created.isNotEmpty()) {
                    app.sounds.play(Sounds.Sfx.CORRECT, 0.6f)
                    app.haptics.correct()
                }
                local.update { u -> u.copy(newWordsSheet = u.newWordsSheet?.copy(saving = false, result = NewWordsResult(added, deck.name, res.existing, failed))) }
                app.scope.launch { runCatching { app.repo.sync() } }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = (e as? dev.jeromeswannack.chineselearning.lab.data.HttpException)?.serverMessage()?.takeIf { it.isNotBlank() } ?: "Couldn't add the cards — try again."
                local.update { u -> u.copy(newWordsSheet = u.newWordsSheet?.copy(saving = false, error = if (!app.online.value) CoachRules.OFFLINE else msg)) }
            }
        }
    }

    /** The done screen's "⚡ Study it today" on a word that was already in a deck. */
    fun bumpExisting(noteId: String) {
        viewModelScope.launch {
            app.safely("coach new words bump") { BumpStore.bumpNotes(app, listOf(noteId), "coach") } ?: return@launch
            app.haptics.correct()
            local.update { u -> u.copy(newWordsSheet = u.newWordsSheet?.let { it.copy(bumped = it.bumped + noteId) }, bumpedNoteIds = u.bumpedNoteIds + noteId) }
        }
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CoachChatViewModel(app, id) as T
    }

    companion object {
        /** Conversations whose reply was asked for on this run of the app (vs. one still thinking when he came back). */
        val startedHere: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())
        private val resumeTracked: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())

        private fun prefs(c: Context) = c.getSharedPreferences("lab-coach", Context.MODE_PRIVATE)
        private fun lastDeck(c: Context): String? = prefs(c).getString("last-deck", null)
    }
}

