package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.ui.chats.chatsCompose
import dev.jeromeswannack.chineselearning.lab.ui.claude.claudeThread
import dev.jeromeswannack.chineselearning.lab.ui.claude.claudeThreadNew
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.claudeChatGraph
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * `/coach?…` — the Sentence Coach's old address. There is no Coach page any more (Nov 2026, web
 * pages/CoachEntry.tsx): every address goes to a Claude thread or the Chats tab's box ([CoachEntry]).
 * The Coach's results are drawn by the thread screen (ui/claude/ClaudeThreadScreen.kt with this
 * package's `CoachMessageItem` / `CoachToolResults`); its mistake lesson plays at `/coach/:c/lesson/:m`.
 */
fun NavGraphBuilder.coachGraph(nav: LabNav) {
    composable(
        Routes.route("/coach?text={text}&c={c}&focus={focus}&draft={draft}&action={action}&from_message={from_message}&from={from}"),
        arguments = listOf("action", "from_message", "from", "text", "c", "focus", "draft").map { name ->
            navArgument(name) { type = NavType.StringType; nullable = true; defaultValue = null }
        },
    ) { entry ->
        val a = entry.arguments
        val target = androidx.compose.runtime.remember(entry) {
            CoachEntry.target(a?.getString("c"), a?.getString("text"), a?.getString("action"), a?.getString("draft"), a?.getString("from_message"))
        }
        LaunchedEffect(target) {
            nav.back()
            nav.open(target)
        }
        Box(Modifier.fillMaxSize().background(Lab.colors.background))
    }
    // "💬 Ask Claude": a plain chat with Claude (`/coach/chat/{id}`, `new` for a fresh one; ui/claudechat).
    claudeChatGraph(nav)
    // "🎯 Mini lesson on this mistake": the lesson in the player (preview), `/coach/:c/lesson/:m`.
    coachLessonGraph(nav)
}

/**
 * Adding a word / the whole sentence from an Explain result: the same AddChunkSheet (deck chips,
 * duplicate warning) as the study card's "What's going on here?" breakdown, through the same calls.
 */
internal fun coachCardActions(app: LabApp): SentenceActions {
    val tools = CardTools(app)
    return SentenceActions(
        decks = {
            withContext(Dispatchers.IO) { dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { it.id to it.name } }
        },
        deckHas = tools::deckHas,
        addCard = { deckId, c -> tools.addNote(deckId, NewNoteBody(c.hanzi, c.pinyin, c.english, c.funFacts)) },
        // Source decks: the add sheet saves straight into its source deck (core SourceDecks.kt).
        alreadyHave = { h -> tools.decksHolding(h).isNotEmpty() },
        move = dev.jeromeswannack.chineselearning.lab.ui.kit.SourceDeckActions.from(tools, "add_chunk"),
    )
}

/**
 * `/coach` — the Sentence Coach's old address (docs/CHAT.md "Chats tab — one list for people and
 * Claude" → "Coach entry points"; port of coachEntryTarget, web pages/CoachEntry.tsx). The Coach lives
 * in the Chats tab: its box at the bottom does Ask · ✏️ Check · 🔍 Explain · Translate, and every result
 * is a Claude thread.
 *
 * - `/coach` (also `?focus=1`, the widget's ✏️) → `/chats?compose=1` (the box, ready to type);
 * - `?c=<id>` → `/chats/claude/<id>` (a coach conversation IS a thread: same id);
 * - `?text=&action=` (or English text, which can only be translated) → a new thread with that intent,
 *   sent at once — with `&from_message=` ("Open in Coach" from a chat message) started from that message,
 *   whose stored check is the analysis (no Claude call); Chinese text without an action → the Chats box
 *   with the text; `?draft=` → the box.
 */
object CoachEntry {
    /** Where a `/coach` address goes. */
    fun target(c: String?, text: String?, action: String?, draft: String?, fromMessage: String?): String {
        if (!c.isNullOrEmpty()) return Routes.claudeThread(c)
        val t = text?.trim().orEmpty()
        if (t.isNotEmpty()) {
            val run = CoachActions.deepLinkAction(t, action)
            return when {
                run != null && !fromMessage.isNullOrEmpty() -> Routes.claudeThreadNew(text = t, intent = run.id, source = SOURCE_CHAT_MESSAGE, fromMessage = fromMessage)
                run != null -> Routes.claudeThreadNew(text = t, intent = run.id, source = "coach_link")
                else -> Routes.chatsCompose(t)
            }
        }
        val d = draft?.trim().orEmpty()
        if (d.isNotEmpty()) return Routes.chatsCompose(d)
        return Routes.chatsCompose()
    }

    /** A thread started by "Open in Coach" from a chat message (analytics). */
    const val SOURCE_CHAT_MESSAGE = "chat_message"
}

/**
 * "Open in Coach" from a chat message (docs/CHAT.md "Chat ↔ Coach"): a Claude thread started from that
 * message — my own message's stored check is the analysis at once (no Claude call), opening it again reuses the
 * thread; back returns to the chat. The web goes through `/coach?…&from_message=` (core SayBetter.coachDeepLink).
 */
fun coachOpenPath(text: String, action: String, fromMessage: String?): String =
    if (fromMessage.isNullOrEmpty()) Routes.claudeThreadNew(text = text, intent = action, source = "coach_link")
    else Routes.claudeThreadNew(text = text, intent = action, source = CoachEntry.SOURCE_CHAT_MESSAGE, fromMessage = fromMessage)
