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
import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
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
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * `/coach?text=&c=` (package H): the home (new sentence + conversations) or, with `c`, one
 * conversation. `?text=` (the widget / "select text → Sentence Coach") starts a conversation
 * at once, like the web.
 */
fun NavGraphBuilder.coachGraph(nav: LabNav) {
    composable(
        Routes.route("/coach?text={text}&c={c}"),
        arguments = listOf(
            navArgument("text") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("c") { type = NavType.StringType; nullable = true; defaultValue = null },
        ),
    ) { entry ->
        val conversationId = entry.arguments?.getString("c")
        val text = entry.arguments?.getString("text")
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
                ),
            )
        } else {
            val vm: CoachHomeViewModel = viewModel(factory = CoachHomeViewModel.Factory(nav.app))
            val ui by vm.ui.collectAsStateWithLifecycle()
            LaunchedEffect(text) { if (!text.isNullOrBlank() && vm.claimDeepLink(text)) vm.start(text.trim()) { id -> nav.open(Routes.coachConversation(id)) } }
            CoachHomeScreen(
                ui,
                CoachHomeActions(
                    onBack = nav::back,
                    onDraft = vm::setDraft,
                    onSend = { vm.start(ui.draft.trim()) { id -> nav.open(Routes.coachConversation(id)) } },
                    onOpen = { nav.open(Routes.coachConversation(it)) },
                    onDelete = vm::delete,
                ),
            )
        }
    }
}

/** The conversation route (web: `/coach?c=<id>`). */
fun Routes.coachConversation(id: String) = "/coach?c=${android.net.Uri.encode(id)}"

private const val LIST_KEY = "coach/conversations"
private fun threadKey(id: String) = "coach/c/$id"

class CoachHomeViewModel(private val app: LabApp) : ViewModel() {
    private val list = app.cachedResource<List<CoachConversationDto>>(viewModelScope, LIST_KEY, "coach") { coachConversations() }
    private val local = MutableStateFlow(CoachHomeUi())
    val ui: StateFlow<CoachHomeUi> = combine(list.state, local) { l, u -> u.copy(conversations = l) }.stateIn(viewModelScope, SharingStarted.Eagerly, CoachHomeUi())

    private var handledDeepLink: String? = null

    /** `?text=` starts a conversation once — not again when coming back to this screen. */
    fun claimDeepLink(text: String): Boolean {
        if (handledDeepLink == text) return false
        handledDeepLink = text
        return true
    }

    fun setDraft(s: String) = local.update { it.copy(draft = s, startError = null) }

    fun start(text: String, onStarted: (String) -> Unit) {
        if (text.isEmpty() || local.value.starting) return
        local.update { it.copy(draft = text, starting = true, startError = null) }
        viewModelScope.launch {
            try {
                val res = CoachRules.retryOnce { app.repo.api.startCoachConversation(text) }
                app.cache.put(threadKey(res.conversation.id), "coach-thread", res)
                app.haptics.tick()
                local.update { it.copy(draft = "", starting = false) }
                list.refresh()
                onStarted(res.conversation.id)
            } catch (e: Exception) {
                // The text stays in the box for Try again.
                local.update { it.copy(starting = false, startError = CoachRules.errorText(e, "Couldn't reach the coach", app.online.value)) }
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

