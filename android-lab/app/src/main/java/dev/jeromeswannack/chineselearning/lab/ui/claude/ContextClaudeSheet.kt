package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.data.claude.ContextFields
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabTallSheet
import dev.jeromeswannack.chineselearning.lab.ui.nav.LocalLabNav

/*
 * A Claude thread in a sheet over what he is doing — a graded reader's page ("📖 Ask Claude about this
 * page", ui/readers/ReaderClaude.kt) or a mini lesson's exercise ("💬 Ask Claude", ui/lessons/
 * ExerciseClaude.kt) — the web's components/claude/ContextClaudeSheet.tsx. The same screen as every
 * Claude chat ([ClaudeThreadContent], `sheet`): the context's suggestion chips, Ask only, the reply
 * streamed, 中文 | EN, 🎧, word chips.
 *
 * - Which thread: the context's recent one (core [ClaudeChats.resumeThreadFor] — its last message within
 *   30 minutes of opening), else a new one made by the first question; ＋ New chat starts afresh. The
 *   thread shows in the Chats tab with its chip ("📖 Reader · 成都 p.3", "🧩 Exercise · Translate").
 * - [fields] (a page's looked-up / misread words, an exercise's answer + check) ride with every question.
 * - Offline: the question waits in the outbox.
 */

object ContextClaudeTags {
    const val SHEET = "context-claude-sheet"
    const val NEW_CHAT = "context-claude-new"
}

@Composable
fun ContextClaudeSheet(
    context: ClaudeContextDto,
    fields: ContextFields?,
    /** Where it was opened from (analytics: claude.thread_open). */
    source: String,
    explorerSource: String,
    onDismiss: () -> Unit,
    /** Once the threads are known: whether it resumed one (the entry point's analytics). */
    onResolved: (resumed: Boolean) -> Unit = {},
) {
    val app = LocalContext.current.applicationContext as LabApp
    val nav = LocalLabNav.current
    val ref = remember(context) { context.core().ref.orEmpty() }
    val store = remember(app) { ClaudeThreads.of(app) }
    val flow = remember(context.kind, ref) { store.observeContextThreads(context.kind, ref) }
    val threads by flow.collectAsState(initial = null)
    val openedAt = remember { System.currentTimeMillis() }
    var chosen by remember { mutableStateOf<String?>(null) }
    var fresh by remember { mutableIntStateOf(0) }
    LaunchedEffect(ref) {
        if (app.online.value) runCatching { store.refreshContextThreads(context.kind, ref) }
    }
    val loaded = threads ?: return LabTallSheet(onDismiss = onDismiss, modifier = Modifier.testTag(ContextClaudeTags.SHEET)) {}
    val resumed = remember(loaded) {
        ClaudeChats.resumeThreadFor(
            loaded.map { ClaudeChats.ResumeCandidate(it.id, it.context.core(), it.last_message_at, it.created_at, it.archived) },
            context.core(),
            openedAt,
        )
    }
    var reported by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!reported) {
            reported = true
            onResolved(resumed != null)
        }
    }
    val id = chosen ?: resumed ?: ClaudeThreadViewModel.NEW
    val vm: ClaudeThreadViewModel = viewModel(
        key = "context-claude-${context.kind}-$ref-$id" + (if (id == ClaudeThreadViewModel.NEW) "-$fresh" else ""),
        factory = ClaudeThreadViewModel.Factory(app, id, if (id == ClaudeThreadViewModel.NEW) context else null, source, false),
    )
    LaunchedEffect(vm, fields) { vm.setFields(fields) }
    LaunchedEffect(vm) { vm.pollWhilePending() }
    // ⋯ → ＋ New chat (the sheet keeps its room for the thread).
    val menuItems = if (id != ClaudeThreadViewModel.NEW) listOf(
        ThreadMenuItem("＋ New chat", ContextClaudeTags.NEW_CHAT) {
            fresh += 1
            chosen = ClaudeThreadViewModel.NEW
            app.analytics.track("claude.thread_action", mapOf("action" to "new", "context_kind" to context.kind))
        },
    ) else emptyList()
    LabTallSheet(onDismiss = onDismiss, modifier = Modifier.testTag(ContextClaudeTags.SHEET)) {
        ClaudeThreadContent(
            app, vm,
            open = { path -> onDismiss(); nav?.open(path) },
            back = onDismiss,
            started = { newId -> chosen = newId },
            sheet = true,
            onClose = onDismiss,
            explorerSource = explorerSource,
            menuItems = menuItems,
        )
    }
}
