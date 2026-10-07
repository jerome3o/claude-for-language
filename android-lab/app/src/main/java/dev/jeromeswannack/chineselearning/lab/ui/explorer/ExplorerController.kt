package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import dev.jeromeswannack.chineselearning.lab.core.explorer.DictWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.Drill
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillQuestion
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillTarget
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerAction
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack

/*
 * The language explorer's state (docs/LANGUAGE_EXPLORER.md): ONE stack of Character / Word
 * views, hoisted to the app shell (LabShell → [ExplorerHost]) so any screen can
 * `LocalExplorer.current?.open(item, source)`. The reducer is core ExplorerStack (port of
 * shared/explorer/stack.ts, parity-tested); this class only holds the stack, remembers the card
 * on screen (the "Words with 字" highlight), runs a quick drill over the top view and records
 * the analytics events.
 */

/** A quick drill over the top view (practice only: analytics, never review events). */
class DrillRun(val target: DrillTarget, val pool: List<DictWord>, val questions: List<DrillQuestion>, val startedAt: Long)

@Stable
class ExplorerController(
    private val track: (event: String, props: Map<String, Any?>) -> Unit = { _, _ -> },
    private val tick: () -> Unit = {},
    private val now: () -> Long = System::currentTimeMillis,
) {
    var stack by mutableStateOf<List<ExplorerItem>>(emptyList())
        private set

    /** The card / text the explorer was opened from (the character view highlights its word). */
    var context by mutableStateOf<String?>(null)
        private set

    val isOpen: Boolean get() = stack.isNotEmpty()
    val current: ExplorerItem? get() = stack.lastOrNull()

    /** The drill replacing the top view's body (null = none). Moving in the stack ends it. */
    var drill by mutableStateOf<DrillRun?>(null)
        private set

    private fun dispatch(action: ExplorerAction) {
        drill = null
        stack = ExplorerStack.reduce(stack, action)
        if (stack.isEmpty()) context = null
    }

    /** A tap outside the explorer: a fresh stack. [source] = where (study, reader, chat, breakdown, homework…). */
    fun open(item: ExplorerItem, source: String, context: String? = null) {
        tick()
        this.context = context
        dispatch(ExplorerAction.Open(item))
        track("explorer.open", mapOf("source" to source, "kind" to item.kind))
    }

    /** A tap inside a view: another view on top (or back to it when it is already in the trail). */
    fun push(item: ExplorerItem) {
        val from = current?.kind
        tick()
        dispatch(ExplorerAction.Push(item))
        track("explorer.push", mapOf("kind" to item.kind, "from" to from, "depth" to stack.size))
    }

    /** ← (and Android back from the second view on). */
    fun pop() = dispatch(ExplorerAction.Pop)

    /** A breadcrumb. */
    fun popTo(index: Int) = dispatch(ExplorerAction.PopTo(index))

    /** ✕, the scrim, a swipe down, back on the first view. */
    fun close() = dispatch(ExplorerAction.Close)

    /** "🎯 Quick drill" (and Again, with a new seed): false when the pool can't make one. */
    fun startDrill(target: DrillTarget, pool: List<DictWord>, seed: Long = now() % 2147483647): Boolean {
        val questions = Drill.buildDrill(target, pool, seed)
        if (questions.isEmpty()) return false
        tick()
        track("explorer.drill_start", mapOf("kind" to target.wire, "items" to questions.size))
        drill = DrillRun(target, pool, questions, now())
        return true
    }

    /** The last question answered: the result goes to analytics only. */
    fun finishDrill(correct: Int) {
        val d = drill ?: return
        track("explorer.drill_finish", mapOf("kind" to d.target.wire, "items" to d.questions.size, "correct" to correct, "duration_ms" to (now() - d.startedAt)))
    }

    /** End / Keep exploring: back to the view. */
    fun endDrill() { drill = null }

    fun record(event: String, props: Map<String, Any?> = emptyMap()) = track(event, props)
}

/** The app's explorer (null outside the shell: previews / screenshot tests of other screens). */
val LocalExplorer = staticCompositionLocalOf<ExplorerController?> { null }

/** True inside an explorer view: a tap there pushes instead of opening a fresh stack. */
val LocalInExplorer = compositionLocalOf { false }

/**
 * What a tap on Chinese does here: inside the explorer → push; elsewhere → open a fresh stack
 * from [source] (with [context], e.g. the card's hanzi). Null when there is no explorer.
 */
@Composable
fun rememberExplorerTap(source: String, context: String? = null): ((ExplorerItem) -> Unit)? {
    val explorer = LocalExplorer.current ?: return null
    val inside = LocalInExplorer.current
    return { item -> if (inside) explorer.push(item) else explorer.open(item, source, context) }
}
