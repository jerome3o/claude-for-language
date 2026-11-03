package dev.jeromeswannack.chineselearning.lab.ui.claude

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.core.SayBetter
import dev.jeromeswannack.chineselearning.lab.core.WordRecap
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.readers.WordRecapStore
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewActions
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatThreadActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.coachCardActions
import dev.jeromeswannack.chineselearning.lab.ui.explorer.rememberExplorerTap
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.readers.WordRecapRoute
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** One Claude thread (web `/chats/claude/:id`). */
fun Routes.claudeThread(id: String) = "/chats/claude/${Uri.encode(id)}"

/** Its "📝 N words to recap" pass (web `/chats/claude/:id/recap`). */
fun Routes.claudeThreadRecap(id: String) = "/chats/claude/${Uri.encode(id)}/recap"

/**
 * A fresh thread (web `/chats/claude/new?…`): [text] + [intent] send at once (the Coach's deep links),
 * [draft] only fills the box; [context] card + [noteId] (+ [label]) for a card, chat_message +
 * [messageId] for a chat message, else a plain chat; [source] for analytics.
 */
fun Routes.claudeThreadNew(
    text: String? = null,
    intent: String? = null,
    draft: String? = null,
    source: String? = null,
    context: String? = null,
    noteId: String? = null,
    messageId: String? = null,
    conversationId: String? = null,
    label: String? = null,
    hasSentence: Boolean = false,
): String {
    val q = listOf(
        "context" to context, "note_id" to noteId, "message_id" to messageId, "conversation_id" to conversationId, "label" to label,
        "text" to text, "intent" to intent, "draft" to draft, "source" to source, "has_sentence" to (if (hasSentence) "1" else null),
    ).filter { !it.second.isNullOrEmpty() }.joinToString("&") { "${it.first}=${Uri.encode(it.second)}" }
    return "/chats/claude/${ClaudeThreadViewModel.NEW}" + (if (q.isEmpty()) "" else "?$q")
}

/** The context of a fresh thread from its route's query (the web's ClaudeThreadPage). */
fun newThreadContext(context: String?, noteId: String?, messageId: String?, conversationId: String?, label: String?): ClaudeContextDto = when {
    context == ClaudeChats.CARD && !noteId.isNullOrEmpty() -> ClaudeContextDto(ClaudeChats.CARD, note_id = noteId, label = label?.ifEmpty { null })
    context == ClaudeChats.CHAT_MESSAGE && !messageId.isNullOrEmpty() ->
        ClaudeContextDto(ClaudeChats.CHAT_MESSAGE, message_id = messageId, conversation_id = conversationId?.ifEmpty { null }, label = label?.ifEmpty { null })
    else -> ClaudeContextDto(ClaudeChats.GENERAL)
}

private val QUERY = listOf("context", "note_id", "message_id", "conversation_id", "label", "text", "intent", "draft", "source", "has_sentence")

/**
 * `/chats/claude/{id}` (+ the fresh-thread query) and `/chats/claude/{id}/recap` — docs/CHAT.md
 * "Claude thread view". `/coach/chat/{id}` (the Coach's "💬 Ask Claude" chats — the same rows) lands
 * here too (ui/claudechat/ClaudeChatNav.kt).
 */
fun NavGraphBuilder.claudeThreadGraph(nav: LabNav) {
    composable(Routes.route("/chats/claude/{id}/recap")) { entry ->
        ClaudeRecapRoute(nav, entry.arguments?.getString("id").orEmpty())
    }
    composable(
        Routes.route("/chats/claude/{id}?" + QUERY.joinToString("&") { "$it={$it}" }),
        arguments = QUERY.map { name -> navArgument(name) { type = NavType.StringType; nullable = true; defaultValue = null } },
    ) { entry ->
        val a = entry.arguments
        val id = a?.getString("id") ?: ClaudeThreadViewModel.NEW
        val isNew = id == ClaudeThreadViewModel.NEW
        val text = a?.getString("text")?.trim()?.takeIf { it.isNotEmpty() }
        val intent = a?.getString("intent")?.takeIf { it in ClaudeChats.INTENT_LABELS.keys }
        ClaudeThreadRoute(
            nav,
            id = id,
            newContext = if (isNew) newThreadContext(a?.getString("context"), a?.getString("note_id"), a?.getString("message_id"), a?.getString("conversation_id"), a?.getString("label")) else null,
            autoSend = if (isNew && text != null && intent != null) text to intent else null,
            draft = a?.getString("draft"),
            source = a?.getString("source") ?: if (isNew) "coach" else "link",
            hasSentence = a?.getString("has_sentence") == "1",
        )
    }
}

/** The words-to-recap pass of a thread: the readers' word recap on the chat's run ([WordRecapStore.openChat]). */
@Composable
fun ClaudeRecapRoute(nav: LabNav, id: String) {
    val app = nav.app
    val ready by produceState(false, id) {
        runCatching { WordRecapStore.openChat(app, id) }
        value = true
    }
    if (ready) {
        WordRecapRoute(nav, WordRecap.chatRunId(id), WordRecap.SOURCE_CHAT, WordRecap.sourceLabel(WordRecap.SOURCE_CHAT)) { words ->
            app.analytics.track(WordRecap.event(WordRecap.SOURCE_CHAT, "start"), mapOf("from" to "menu", "words" to words))
        }
    } else {
        Box(Modifier.fillMaxSize().background(Lab.colors.background))
    }
}

/**
 * The thread screen wired to its ViewModel — the page `/chats/claude/{id}` here; the study card's Ask
 * Claude sheet draws the same thing over the card ([ClaudeThreadContent], ui/study/CardClaudeSheet.kt).
 */
@Composable
fun ClaudeThreadRoute(
    nav: LabNav,
    id: String,
    newContext: ClaudeContextDto? = null,
    autoSend: Pair<String, String>? = null,
    draft: String? = null,
    source: String = "link",
    hasSentence: Boolean = false,
) {
    val app = nav.app
    val vm: ClaudeThreadViewModel = viewModel(key = "claude-thread-$id-${newContext?.kind}-${newContext?.note_id}-${newContext?.message_id}", factory = ClaudeThreadViewModel.Factory(app, id, newContext, source, hasSentence))
    LaunchedEffect(vm) { vm.pollWhilePending() }
    // A fresh thread exists now: the screen moves to its route (the web's onThreadCreated).
    val started: (String) -> Unit = { newId ->
        nav.back()
        nav.open(Routes.claudeThread(newId))
    }
    LaunchedEffect(autoSend) { autoSend?.let { (text, intent) -> vm.autoSend(text, intent, started) } }
    LaunchedEffect(draft) { if (!draft.isNullOrBlank()) vm.claimDraft(draft) }
    ClaudeThreadContent(app, vm, open = { path -> nav.open(path) }, back = nav::back, started = started)
}

/**
 * A thread's screen for a ViewModel: the page ([sheet] false) or the study card's sheet ([sheet] true:
 * ✕ = [onClose]), with the card sheet's extras ([headerExtra] under the header chip, [toolResults]
 * under a reply, [closedNote] instead of the composer).
 */
@Composable
fun ClaudeThreadContent(
    app: dev.jeromeswannack.chineselearning.lab.LabApp,
    vm: ClaudeThreadViewModel,
    open: (String) -> Unit,
    back: () -> Unit,
    started: (String) -> Unit,
    sheet: Boolean = false,
    onClose: () -> Unit = {},
    headerExtra: (@Composable () -> Unit)? = null,
    toolResults: (@Composable (dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto) -> Unit)? = null,
    closedNote: String? = null,
    explorerSource: String = "claude_chat",
) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val explore = rememberExplorerTap(explorerSource)
    ClaudeThreadScreen(
        ui,
        ClaudeThreadActions(
            onBack = back,
            onClose = onClose,
            onDraft = vm::setDraft,
            onSend = { text, spoken, intent, chip -> vm.send(text, spoken, intent, chip, started) },
            onLanguage = vm::setLanguage,
            onListening = vm::setListening,
            onContext = { link -> vm.contextPath(link) { path -> open(path) } },
            onMakeCards = vm::makeCards,
            onRecap = { ui.threadId?.let { open(Routes.claudeThreadRecap(it)) } },
            onRetryLoad = vm::reload,
            thread = ClaudeChatThreadActions(
                onWord = { w, sentence, _ ->
                    vm.recordTapped(w, sentence)
                    vm.itemFor(w, sentence)?.let { explore?.invoke(it) }
                },
                translate = vm::translate,
                retry = vm::retry,
                play = { m -> vm.play(m.text, m.mine) },
                listen = vm::listen,
                reveal = vm::reveal,
                toggleSlow = vm::toggleSlow,
                audioBusy = vm::audioBusy,
                onReadBackWords = vm::recordSaidWrong,
                stopAudio = vm::stopAudio,
                track = vm::track,
                onDiscardQueued = { m -> vm.discardQueued(m.id) },
            ),
            review = ReviewActions(
                onClose = vm::closeReview,
                onToggle = vm::reviewToggle,
                onEdit = vm::reviewEdit,
                onOpenEdit = vm::reviewOpenEdit,
                onPickDeck = vm::reviewPickDeck,
                onNewDeck = vm::reviewNewDeck,
                onSave = vm::saveReview,
            ),
            coach = CoachChatActions(
                onRetryReply = vm::retry,
                onMistakeLesson = vm::requestMistakeLesson,
                onPlayLesson = { messageId, content -> vm.playLesson(messageId, content) { path -> open(path) } },
                onSaveLesson = vm::saveMistakeLesson,
            ),
            cards = coachCardActions(app),
            onOpenCoach = { m, source ->
                SayBetter.openInCoachRequest(if (m.mine) "me" else "claude", m.text, null, null, null, null, "me")?.let { req ->
                    vm.track(if (source == "menu") "open_coach" else "open_coach_$source", m.mine)
                    open(dev.jeromeswannack.chineselearning.lab.ui.coach.coachOpenPath(req.text, req.action, null))
                }
            },
        ),
        sheet = sheet,
        headerExtra = headerExtra,
        toolResults = toolResults,
        closedNote = closedNote,
    )
}
