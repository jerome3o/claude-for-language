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
        Routes.route("/coach?text={text}&c={c}&focus={focus}&draft={draft}"),
        arguments = listOf(
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
        if (conversationId != null) {
            val vm: CoachChatViewModel = viewModel(key = "coach-$conversationId", factory = CoachChatViewModel.Factory(nav.app, conversationId))
            val ui by vm.ui.collectAsStateWithLifecycle()
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
                ),
            )
        } else {
            val vm: CoachHomeViewModel = viewModel(factory = CoachHomeViewModel.Factory(nav.app))
            val ui by vm.ui.collectAsStateWithLifecycle()
            // ?draft= (a study card's sentence): in the box, not sent; back returns to the card.
            LaunchedEffect(draft) { if (!draft.isNullOrBlank() && vm.claimDraft(draft)) vm.setDraft(draft) }
            // ?text=: English is translated at once; Chinese waits in the box on Check / Explain.
            LaunchedEffect(text) {
                if (!text.isNullOrBlank() && vm.claimDeepLink(text)) {
                    val only = CoachActions.buttons(text).actions.singleOrNull()
                    if (only != null) vm.start(text.trim(), only) { id -> nav.open(Routes.coachConversation(id)) } else vm.setDraft(text)
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
    fun start(text: String, action: CoachAction, onStarted: (String) -> Unit) {
        if (text.isEmpty() || local.value.starting) return
        local.update { it.copy(draft = text, starting = true, pendingAction = action, startError = null, savedBreakdown = null) }
        app.analytics.track("coach.start", mapOf("action" to action.id))
        viewModelScope.launch {
            val cached = if (action == CoachAction.EXPLAIN) runCatching { tools.cachedTextExplanation(text) }.getOrNull() else null
            if (cached != null && !app.online.value) {
                local.update { it.copy(starting = false, pendingAction = null, savedBreakdown = CoachBreakdownDto.of(text, cached)) }
                return@launch
            }
            try {
                val res = CoachRules.retryOnce { app.repo.api.startCoachConversation(text, action.id, cached?.takeIf { !it.translation.isNullOrBlank() }) }
                app.cache.put(threadKey(res.conversation.id), "coach-thread", res)
                if (action == CoachAction.EXPLAIN) {
                    res.messages.firstOrNull { it.content_type == "analysis" }?.let { CoachAnalysisDto.parse(it.content)?.breakdown }
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

class CoachChatViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val thread = app.cachedResource<CoachThreadDto>(viewModelScope, threadKey(id), "coach-thread") { coachConversation(id) }
    private val local = MutableStateFlow(CoachChatUi(deckId = lastDeck(app)))
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
        if (message.isBlank() || local.value.sending) return
        local.update { it.copy(sending = true, pendingMessage = message, sendError = null) }
        viewModelScope.launch {
            try {
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
            }
        }
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CoachChatViewModel(app, id) as T
    }

    private companion object {
        fun prefs(c: Context) = c.getSharedPreferences("lab-coach", Context.MODE_PRIVATE)
        fun lastDeck(c: Context): String? = prefs(c).getString("last-deck", null)
    }
}

