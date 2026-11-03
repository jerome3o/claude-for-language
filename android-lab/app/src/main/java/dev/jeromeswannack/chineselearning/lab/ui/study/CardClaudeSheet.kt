package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.claude.CardTools
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadContent
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadViewModel
import dev.jeromeswannack.chineselearning.lab.ui.claude.ThreadMenuItem
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabTallSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * Ask Claude on a study card = the card's Claude THREAD in a sheet over the card (the web's
 * components/claude/CardClaudeSheet.tsx; docs/STUDY_SESSION.md "Ask Claude"). The same screen as
 * every Claude chat ([ClaudeThreadContent], `sheet`): the card's suggestion chips, Ask only, the reply
 * streamed, 🎧 / 中文 | EN / word chips / Read it back, the long-press menu and the ✎ check on my
 * Chinese.
 *
 * - Which thread: the card's recent one (core [ClaudeChats.resumeThreadFor] — its last message within
 *   30 minutes of opening), else a new one made by the first question. ⋯ → "🕘 Earlier about 银行 ·
 *   2 chats" lists the card's other threads ([CardTools.earlierCardThreads]); ⋯ → ＋ New chat starts
 *   afresh. The thread shows in the Chats tab with "📇 Asked on card · 银行" (the sheet shows no chip).
 * - Compact (Jerome, Nov 2026; [LabTallSheet]): the whole height under the status bar, a slim grab
 *   handle instead of ✕, one header row, chips only before the first message, Claude's bubbles the
 *   full width.
 * - Claude's card tools (edit / delete this card, make cards, a mini lesson, ⚡ bump) are applied by
 *   the server; when a reply the card saw being written finishes, [CardClaudeActions.onToolResults]
 *   brings the phone's study state in line (once per reply, [ClaudeThreads.markCardEffectsApplied])
 *   and the reply shows a line per result — "✓ Claude edited this card · Undo" ([CardTools.lines]).
 *   [CardClaudeEffects] keeps listening while the sheet is closed, so a reply still being written
 *   lands and its tools apply.
 * - Offline: the question waits in the outbox ("🕓 Will send when you're online").
 */

/** What the card's Claude sheet calls (StudyViewModel). */
class CardClaudeActions(
    /** Open a path (Open in Coach, the card hub). */
    val openPath: (String) -> Unit = {},
    /** A finished reply's card tools, once per reply ([replyId]): the study state follows them. */
    val onToolResults: (results: List<CardTools.Result>, replyId: String) -> Unit = { _, _ -> },
    /** This reply's edit can be undone on this phone (its "before" was kept when it was applied). */
    val canUndo: (replyId: String) -> Boolean = { false },
    /** Undo the reply's edit (a normal note update); throws on failure. */
    val undo: suspend (replyId: String) -> Unit = {},
)

/** Which thread the card's sheet shows — held by the card on screen, so it outlives the sheet. */
@Stable
class CardClaudeState(val noteId: String) {
    /** A thread picked by hand / made here (null = the resume rule's). [NEW] = a fresh chat. */
    var chosen by mutableStateOf<String?>(null)
    /** A fresh chat's ViewModel generation (＋ New chat twice = two fresh chats). */
    var fresh by mutableIntStateOf(0)
    /** When the sheet first opened (the 30-minute resume rule is measured from it). */
    var openedAt by mutableLongStateOf(0L)
    /** The sheet was opened on this showing of the card: its ViewModel is listening. */
    var used by mutableStateOf(false)
    /** Ask this at once (the leech sheet's memory hook): text + a key. */
    var autoAsk by mutableStateOf<Pair<String, String>?>(null)

    fun open(now: Long = System.currentTimeMillis()) {
        if (!used) openedAt = now
        used = true
    }

    companion object {
        const val NEW = ClaudeThreadViewModel.NEW
    }
}

object CardClaudeTags {
    const val SHEET = "ask-claude-sheet"
    const val EARLIER = "card-claude-earlier"
    const val EARLIER_ROW = "card-claude-earlier-row"
    const val EARLIER_LIST = "card-claude-earlier-list"
    const val EARLIER_HIDE = "card-claude-earlier-hide"
    const val NEW_CHAT = "card-claude-new"
    const val TOOLS = "card-claude-tools"
    const val UNDO = "card-claude-undo"
    fun tool(kind: String) = "card-claude-tool-$kind"
}

private fun ClaudeThreadDto.ref() = CardTools.ThreadRef(id, context_kind, context.note_id, last_message_at, created_at, archived)

/** The card's thread id now (picked, resumed or a fresh one) and the card's threads on the phone. */
@Composable
private fun cardThread(app: LabApp, state: CardClaudeState): Pair<String, List<ClaudeThreadDto>> {
    val flow = remember(state.noteId) { ClaudeThreads.of(app).observeCardThreads(state.noteId) }
    val threads by flow.collectAsState(initial = emptyList())
    val resumed = remember(threads, state.openedAt) {
        ClaudeChats.resumeThreadFor(
            threads.map { ClaudeChats.ResumeCandidate(it.id, it.context.core(), it.last_message_at, it.created_at, it.archived) },
            ClaudeChats.Context(ClaudeChats.CARD, noteId = state.noteId),
            state.openedAt,
        )
    }
    return (state.chosen ?: resumed ?: CardClaudeState.NEW) to threads
}

/** The ViewModel of the card's thread [id] (the sheet and [CardClaudeEffects] share it). */
@Composable
private fun cardThreadVm(app: LabApp, state: CardClaudeState, id: String, view: CardView, typed: JsonElement): ClaudeThreadViewModel {
    val newContext = ClaudeContextDto(
        ClaudeChats.CARD,
        note_id = view.note.id,
        card_type = view.card.cardType,
        typed = (typed as? kotlinx.serialization.json.JsonObject),
        label = view.note.hanzi,
        sublabel = view.deckName,
    )
    val key = "card-claude-${state.noteId}-$id" + (if (id == CardClaudeState.NEW) "-${state.fresh}" else "")
    val vm: ClaudeThreadViewModel = viewModel(
        key = key,
        factory = ClaudeThreadViewModel.Factory(app, id, if (id == CardClaudeState.NEW) newContext else null, "study_card", !view.note.sentenceClue.isNullOrBlank(), cardType = view.card.cardType),
    )
    vm.typed = typed
    return vm
}

/** The typed answer of this showing of a typing card (`{ answer, correct }`), JsonNull = none. */
fun cardTyped(view: CardView, userAnswer: String?): JsonElement {
    val typing = view.card.cardType != CardTypes.HANZI_TO_MEANING
    val answer = userAnswer?.trim().orEmpty()
    if (!typing || answer.isEmpty()) return JsonNull
    return buildJsonObject {
        put("answer", JsonPrimitive(answer))
        put("correct", JsonPrimitive(view.note.hanzi))
    }
}

/**
 * Keeps the card's thread listening while the card is on screen (once its sheet was opened): looks
 * again while a reply is being written and hands each finished reply's card tools to the study
 * page — once per reply.
 */
@Composable
fun CardClaudeEffects(view: CardView, userAnswer: String?, state: CardClaudeState, actions: CardClaudeActions) {
    if (!state.used) return
    val app = LocalContext.current.applicationContext as LabApp
    val (id, _) = cardThread(app, state)
    val vm = cardThreadVm(app, state, id, view, cardTyped(view, userAnswer))
    LaunchedEffect(vm) { vm.pollWhilePending() }
    LaunchedEffect(vm) {
        vm.finishedReplies.collect { m ->
            val results = CardTools.parse(m.tool_results)
            if (results.isNotEmpty() && ClaudeThreads.of(app).markCardEffectsApplied(m.id)) actions.onToolResults(results, m.id)
        }
    }
}

/** The sheet: the card's thread over the card. */
@Composable
fun CardClaudeSheet(
    view: CardView,
    userAnswer: String?,
    state: CardClaudeState,
    cardDeleted: Boolean,
    actions: CardClaudeActions,
    onDismiss: () -> Unit,
) {
    val app = LocalContext.current.applicationContext as LabApp
    LaunchedEffect(state.noteId) {
        state.open()
        if (app.online.value) runCatching { ClaudeThreads.of(app).refreshCardThreads(state.noteId) }
    }
    val (id, threads) = cardThread(app, state)
    val vm = cardThreadVm(app, state, id, view, cardTyped(view, userAnswer))
    val started: (String) -> Unit = { newId -> state.chosen = newId }
    LaunchedEffect(vm, state.autoAsk) {
        state.autoAsk?.let { (text, key) -> vm.autoAsk(text, key, started) }
    }
    val earlier = remember(threads, id) { CardTools.earlierCardThreads(threads.map { it.ref() }, state.noteId, id.takeIf { it != CardClaudeState.NEW }) }
    val byId = remember(threads) { threads.associateBy { it.id } }
    var earlierOpen by remember(id) { mutableStateOf(false) }
    val earlierThreads = earlier.mapNotNull { byId[it.id] }
    val menuItems = cardMenuItems(
        hanzi = view.note.hanzi,
        earlierCount = earlierThreads.size,
        canStartNew = id != CardClaudeState.NEW,
        onEarlier = { earlierOpen = true },
        onNew = {
            state.fresh += 1
            state.chosen = CardClaudeState.NEW
            app.analytics.track("claude.thread_action", mapOf("action" to "new", "context_kind" to ClaudeChats.CARD))
        },
    )
    LabTallSheet(onDismiss = onDismiss, modifier = Modifier.testTag(CardClaudeTags.SHEET)) {
        ClaudeThreadContent(
            app, vm,
            open = { path -> onDismiss(); actions.openPath(path) },
            back = onDismiss,
            started = started,
            sheet = true,
            onClose = onDismiss,
            explorerSource = "ask_claude",
            menuItems = menuItems,
            headerExtra = if (earlierOpen && earlierThreads.isNotEmpty()) ({
                EarlierList(
                    hanzi = view.note.hanzi,
                    earlier = earlierThreads,
                    onPick = { t ->
                        earlierOpen = false
                        state.chosen = t.id
                        app.analytics.track("claude.thread_action", mapOf("action" to "switch", "context_kind" to ClaudeChats.CARD))
                    },
                    onHide = { earlierOpen = false },
                )
            }) else null,
            toolResults = { reply ->
                val online by app.online.collectAsState()
                CardToolLines(reply, actions, online) {
                    app.analytics.track("claude.undo_card_edit", mapOf("context_kind" to ClaudeChats.CARD))
                    app.haptics.tick()
                }
            },
            closedNote = if (cardDeleted) "This card was deleted — moving on to the next one." else null,
        )
    }
}

/**
 * The card sheet's ⋯ items (Jerome, Nov 2026: folded into the menu so the thread keeps the room):
 * "🕘 Earlier about 银行 · 2 chats" (opens the list under the header) and "＋ New chat".
 */
internal fun cardMenuItems(hanzi: String, earlierCount: Int, canStartNew: Boolean, onEarlier: () -> Unit, onNew: () -> Unit): List<ThreadMenuItem> = buildList {
    CardTools.earlierLabel(hanzi, earlierCount)?.let { add(ThreadMenuItem("🕘 $it", CardClaudeTags.EARLIER, onClick = onEarlier)) }
    if (canStartNew) add(ThreadMenuItem("＋ New chat", CardClaudeTags.NEW_CHAT, onClick = onNew))
}

/** The card's earlier chats (⋯ → Earlier about 银行): a row each → that chat; ▴ hides the list. */
@Composable
internal fun EarlierList(hanzi: String, earlier: List<ClaudeThreadDto>, onPick: (ClaudeThreadDto) -> Unit, onHide: () -> Unit) {
    val label = CardTools.earlierLabel(hanzi, earlier.size) ?: return
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 6.dp).testTag(CardClaudeTags.EARLIER_LIST)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("🕘 $label", color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
            Box(
                Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(10.dp)).bouncyClickable(pressedScale = 0.94f, role = Role.Button, onClick = onHide)
                    .padding(horizontal = 12.dp).testTag(CardClaudeTags.EARLIER_HIDE),
                contentAlignment = Alignment.Center,
            ) { Text("▴", color = Lab.colors.muted, fontSize = 15.sp) }
        }
        val now = System.currentTimeMillis()
        val offset = java.util.TimeZone.getDefault().getOffset(now) / 60_000
        for (t in earlier) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp))
                    .bouncyClickable(pressedScale = 0.98f, role = Role.Button) { onPick(t) }
                    .padding(horizontal = 8.dp).testTag(CardClaudeTags.EARLIER_ROW),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(t.preview?.takeIf { it.isNotBlank() } ?: t.title, color = Lab.colors.ink, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(ChatInbox.relativeTime(t.last_message_at ?: t.created_at, now, offset), color = Lab.colors.muted, fontSize = 12.sp)
            }
        }
    }
}

/** The lines under a reply: "✓ Claude edited this card · Undo", "✓ Added 2 cards: 存钱、取钱"… */
@Composable
fun CardToolLines(reply: ClaudeMessageDto, actions: CardClaudeActions, online: Boolean, onUndone: () -> Unit = {}) {
    val lines = remember(reply.tool_results) { CardTools.lines(CardTools.parse(reply.tool_results)) }
    if (lines.isEmpty()) return
    var undo by remember(reply.id) { mutableStateOf<String?>(null) } // busy | done | error message
    val scope = rememberCoroutineScope()
    Column(Modifier.padding(top = 4.dp).testTag(CardClaudeTags.TOOLS), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (line in lines) {
            val bad = line.kind == "deleted" || line.kind == "failed"
            val color = when {
                bad -> Palette.Again
                line.kind == "bumped" -> Color(0xFFB45309)
                else -> Palette.Good
            }
            Row(
                Modifier.widthIn(max = 360.dp).clip(RoundedCornerShape(12.dp)).background(color.copy(alpha = 0.12f)).padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp)
                    .testTag(CardClaudeTags.tool(line.kind)),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val done = line.undo && undo == "done"
                Text(if (done) "↺ Undone — the card is back as it was" else line.text, color = color, fontSize = 13.sp, modifier = Modifier.weight(1f, fill = false))
                if (line.undo && !done && actions.canUndo(reply.id)) {
                    val busy = undo == "busy"
                    Box(
                        Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(50)).border(1.dp, color, RoundedCornerShape(50))
                            .bouncyClickable(enabled = online && !busy, pressedScale = 0.94f, role = Role.Button) {
                                undo = "busy"
                                scope.launch {
                                    undo = try {
                                        actions.undo(reply.id)
                                        onUndone()
                                        "done"
                                    } catch (e: kotlinx.coroutines.CancellationException) {
                                        throw e
                                    } catch (e: Exception) {
                                        e.message?.takeIf { it.isNotBlank() } ?: "Couldn’t undo it"
                                    }
                                }
                            }
                            .padding(horizontal = 12.dp).testTag(CardClaudeTags.UNDO),
                        contentAlignment = Alignment.Center,
                    ) { Text(if (busy) "Undoing…" else if (online) "Undo" else "Undo · needs a connection", color = color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
                }
            }
            if (line.undo && undo != null && undo != "busy" && undo != "done") Text(undo!!, color = Palette.Again, fontSize = 12.sp)
        }
    }
}
