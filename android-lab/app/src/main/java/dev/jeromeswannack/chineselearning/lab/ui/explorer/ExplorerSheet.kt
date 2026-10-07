package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CharWordRow
import dev.jeromeswannack.chineselearning.lab.core.CharWordStatus
import dev.jeromeswannack.chineselearning.lab.core.explorer.Crumb
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.core.explorer.RelatedWords
import dev.jeromeswannack.chineselearning.lab.data.api.CharRecordDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import dev.jeromeswannack.chineselearning.lab.ui.bumps.STUDY_IT_TODAY
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharMore
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetUi
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharacterSheetContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabModalSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/*
 * The explorer sheet (docs/LANGUAGE_EXPLORER.md): ONE bottom sheet over the app showing the top
 * view of [ExplorerController.stack] — header ← · breadcrumb · ✕, the view's body scrolling, its
 * actions pinned in the footer (SheetScaffold: never under the status bar, the footer always
 * visible; the footer row has room for more actions, e.g. mini drills later). Android back
 * takes ONE level off — a drill, then a view — and closes on the first view; ✕, the scrim and a
 * swipe down close.
 */

const val EXPLORER_SHEET_TAG = "explorer-sheet"
const val EXPLORER_BACK_TAG = "explorer-back"
const val EXPLORER_CLOSE_TAG = "explorer-close"
const val EXPLORER_CRUMB_TAG = "explorer-crumb"

/** Placed once in the app shell: the sheet while the stack isn't empty (+ the add-card / writing sheets it opens). */
@Composable
fun ExplorerHost(controller: ExplorerController, env: ExplorerEnv) {
    var adding by remember { mutableStateOf<Chunk?>(null) }
    var writing by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    if (controller.isOpen) {
        // Back is ours, ONE level per press (the drill first, then a view, then the sheet) — the
        // sheet's own back handling is off, or it closes everything (see LabModalSheet).
        LabModalSheet(onDismiss = controller::close, dismissOnBack = false) {
            BackHandler(enabled = controller.isOpen) { controller.back() }
            ExplorerStackView(
                controller, env, refresh,
                onAdd = { adding = it },
                onWrite = { ch -> controller.record("explorer.write"); writing = ch },
            )
        }
    }
    adding?.let { chunk ->
        AddChunkSheet(
            chunk,
            preferredDeck = "",
            actions = env.addActions,
            onDismiss = { adding = null; refresh++ },
            bumpSource = "explorer",
            bump = env.bump,
            onAdded = { controller.record("explorer.add_card") },
        )
    }
    writing?.let { text -> dev.jeromeswannack.chineselearning.lab.ui.strokes.WritingSheet(text, onClose = { writing = null }) }
}

/** The top view of the stack with its header and footer (keyed per view, so each opens scrolled to the top). */
@Composable
fun ExplorerStackView(
    controller: ExplorerController,
    env: ExplorerEnv,
    refresh: Int = 0,
    onAdd: (Chunk) -> Unit = {},
    onWrite: (String) -> Unit = {},
) {
    val item = controller.current ?: return
    key(ExplorerStack.itemKey(item)) {
        val drill = controller.drill
        if (drill != null) {
            key(drill) {
                DrillView(
                    controller.stack, drill.questions,
                    fx = env.drillFx,
                    play = env.play,
                    strokeLoader = env.strokeLoader,
                    onBack = controller::pop,
                    onCrumb = controller::popTo,
                    onClose = controller::close,
                    onFinish = controller::finishDrill,
                    onAgain = { controller.startDrill(drill.target, drill.pool) },
                    onExit = controller::endDrill,
                )
            }
        } else when (item) {
            is ExplorerItem.Char -> CharacterViewHost(item.char, controller, env, onWrite)
            is ExplorerItem.Word -> WordViewHost(item, controller, env, refresh, onAdd)
        }
    }
}

/** Header (← · breadcrumbs · ✕) + the scrolling body + the pinned footer. Stateless (screenshot tests). */
@Composable
fun ExplorerFrame(
    stack: List<ExplorerItem>,
    onBack: () -> Unit,
    onCrumb: (Int) -> Unit,
    onClose: () -> Unit,
    footer: (@Composable RowScope.() -> Unit)?,
    footerAbove: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    SheetScaffold(
        modifier = Modifier.testTag(EXPLORER_SHEET_TAG),
        header = { ExplorerHeader(stack, onBack, onCrumb, onClose) },
        footer = footer,
        footerAbove = footerAbove,
        contentPadding = PaddingValues(0.dp),
        spacing = 0.dp,
    ) {
        CompositionLocalProvider(LocalInExplorer provides true) { content() }
    }
}

@Composable
fun ExplorerHeader(stack: List<ExplorerItem>, onBack: () -> Unit, onCrumb: (Int) -> Unit, onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (stack.size > 1) HeaderButton("←", "Back", EXPLORER_BACK_TAG, onBack) else Spacer(Modifier.width(12.dp))
        Row(
            Modifier.weight(1f).horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ExplorerStack.breadcrumbTrail(stack).forEachIndexed { i, c ->
                if (i > 0) Text("›", color = Lab.colors.muted, style = MaterialTheme.typography.bodyMedium)
                when (c) {
                    Crumb.Gap -> Text("…", color = Lab.colors.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 2.dp))
                    is Crumb.Item -> Text(
                        c.label,
                        fontSize = 17.sp,
                        fontWeight = if (c.current) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (c.current) Lab.colors.ink else Lab.colors.accent,
                        maxLines = 1,
                        modifier = Modifier
                            .heightIn(min = 36.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (c.current) androidx.compose.ui.graphics.Color.Transparent else Lab.colors.accentSoft)
                            .then(if (c.current) Modifier else Modifier.clickable { onCrumb(c.index) })
                            .testTag(EXPLORER_CRUMB_TAG)
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }
        }
        HeaderButton("✕", "Close", EXPLORER_CLOSE_TAG, onClose)
    }
}

@Composable
private fun HeaderButton(glyph: String, label: String, tag: String, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(onClickLabel = label, onClick = onClick).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(glyph, fontSize = 22.sp, color = Lab.colors.muted) }
}

// ── Character view ─────────────────────────────────────────────────────────

@Composable
private fun CharacterViewHost(char: String, controller: ExplorerController, env: ExplorerEnv, onWrite: (String) -> Unit) {
    val actions = env.chars
    var lookup by remember { mutableStateOf<CharDict.Lookup?>(null) }
    var rows by remember { mutableStateOf<List<CharWordRow<CharWordDto>>?>(null) }
    var more by remember { mutableStateOf<CharMore>(CharMore.Idle) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        val r = actions.lookup(char)
        lookup = r
        val record = (r as? CharDict.Lookup.Ok)?.record
        actions.track("study.char_sheet_open", mapOf("found" to (record != null), "words" to (record?.words?.size ?: 0)))
    }
    val record = (lookup as? CharDict.Lookup.Ok)?.record
    LaunchedEffect(record) {
        val words = record?.words ?: return@LaunchedEffect
        rows = runCatching { actions.statuses(words, controller.context) }
            .getOrElse { words.map { CharWordRow(it, CharWordStatus.None, emptyList(), false) } }
    }
    fun askMore() {
        more = CharMore.Loading
        controller.record("explorer.more", mapOf("kind" to "char"))
        scope.launch {
            more = when (val out = actions.explain(char)) {
                is CharDict.Explain.Ok -> CharMore.Done(out.text)
                CharDict.Explain.Offline -> CharMore.Offline
                is CharDict.Explain.Error -> CharMore.Error(out.message)
            }
        }
    }
    CharacterView(
        CharSheetUi(char, lookup, rows, more, canWrite = false),
        controller.stack,
        canWrite = env.canWrite,
        onBack = controller::pop,
        onCrumb = controller::popTo,
        onClose = controller::close,
        onMore = ::askMore,
        onChar = { controller.push(ExplorerItem.Char(it)) },
        onRow = { row -> ExplorerStack.itemForText(row.word.hanzi, row.word.pinyin, row.word.english)?.let(controller::push) },
        onWrite = { onWrite(char) },
        onDrill = { t, pool -> controller.startDrill(t, pool) },
    )
}

/** The Character view in the explorer frame (stateless). */
@Composable
fun CharacterView(
    ui: CharSheetUi,
    stack: List<ExplorerItem>,
    canWrite: Boolean,
    onBack: () -> Unit = {},
    onCrumb: (Int) -> Unit = {},
    onClose: () -> Unit = {},
    onMore: () -> Unit = {},
    onChar: (String) -> Unit = {},
    onRow: (CharWordRow<CharWordDto>) -> Unit = {},
    onWrite: () -> Unit = {},
    /** "🎯 Quick drill" over this character and its words (null = not offered). */
    onDrill: ((dev.jeromeswannack.chineselearning.lab.core.explorer.DrillTarget, List<dev.jeromeswannack.chineselearning.lab.core.explorer.DictWord>) -> Unit)? = null,
) {
    val drill = remember(ui.char, ui.record) { if (onDrill == null) null else charDrill(ui.char, ui.record?.words) }
    ExplorerFrame(
        stack, onBack, onCrumb, onClose,
        footer = if (!canWrite) null else {
            { SecondaryPill("✍️ Write it", Modifier.weight(1f).height(52.dp).testTag("explorer-write"), onClick = onWrite) }
        },
    ) {
        CharacterSheetContent(ui.copy(canWrite = false), onClose = onClose, onMore = onMore, onRow = onRow, onChar = onChar, showClose = false)
        if (drill != null && onDrill != null) {
            QuickDrillButton({ onDrill(drill.first, drill.second) }, Modifier.padding(start = 20.dp, top = 4.dp, bottom = 16.dp))
        }
    }
}

// ── Word view ──────────────────────────────────────────────────────────────

@Composable
private fun WordViewHost(item: ExplorerItem.Word, controller: ExplorerController, env: ExplorerEnv, refresh: Int, onAdd: (Chunk) -> Unit) {
    val hanzi = item.hanzi
    val chars = remember(hanzi) { hanzi.codePoints().toArray().map { String(Character.toChars(it)) }.distinct() }
    var ui by remember { mutableStateOf(WordViewUi(item, rank = env.rank(hanzi), online = env.online(), rankOf = env.rank)) }
    var bumping by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // The word dictionary (cache first) …
    LaunchedEffect(Unit) { ui = ui.copy(lookup = runCatching { env.wordLookup(hanzi) }.getOrElse { WordDict.Lookup.Error(it.userMessage()) }) }
    // … its characters in ONE batched call, then each record from the device …
    LaunchedEffect(Unit) {
        runCatching { env.prefetchChars(chars) }
        val records = LinkedHashMap<String, CharRecordDto>()
        for (c in chars) (runCatching { env.chars.lookup(c) }.getOrNull() as? CharDict.Lookup.Ok)?.let { records[c] = it.record }
        ui = ui.copy(charRecords = records)
        // … the related words' ✓ Known / 📚 In your decks from Room.
        val related = RelatedWords.relatedWords(hanzi, chars.mapNotNull { c -> records[c]?.let { dev.jeromeswannack.chineselearning.lab.core.explorer.CharWordList(c, it.words) } }, { it.hanzi }, env.rank)
        if (related.isNotEmpty()) {
            val rows = runCatching { env.chars.statuses(related.map { it.word }, null) }.getOrDefault(emptyList())
            ui = ui.copy(statuses = rows.associate { it.word.hanzi to it.status })
        }
    }
    // The learner's own card and notes (again after an add).
    LaunchedEffect(refresh) { ui = ui.copy(mine = runCatching { env.myWord(hanzi) }.getOrDefault(MyWord())) }
    // A "More about" already on the device opens at once.
    LaunchedEffect(ui.mine != null) {
        if (ui.mine == null || ui.more != WordMore.Idle) return@LaunchedEffect
        env.cachedExplanation(hanzi, ui.explainSentence)?.let { ui = ui.copy(more = WordMore.Done(it)) }
    }

    fun askMore() {
        if (!env.online()) { ui = ui.copy(more = WordMore.Offline); return }
        controller.record("explorer.more", mapOf("kind" to "word"))
        ui = ui.copy(more = WordMore.Loading)
        val r = ui.resolved
        scope.launch {
            ui = try {
                ui.copy(more = WordMore.Done(env.explain(hanzi, ui.explainSentence, r.pinyin.ifBlank { null }, r.english.ifBlank { null })))
            } catch (e: CancellationException) {
                throw e
            } catch (e: java.io.IOException) {
                ui.copy(more = WordMore.Offline)
            } catch (e: Exception) {
                ui.copy(more = WordMore.Error(e.userMessage()))
            }
        }
    }

    WordView(
        ui, controller.stack,
        canOpenCard = env.openCard != null,
        canBump = env.bump != null,
        bumping = bumping,
        onBack = controller::pop,
        onCrumb = controller::popTo,
        onClose = controller::close,
        actions = WordViewActions(
            onPlay = { env.play(hanzi) },
            onChar = { controller.push(ExplorerItem.Char(it)) },
            onWord = controller::push,
            onMore = ::askMore,
            onDrill = { t, pool -> controller.startDrill(t, pool) },
        ),
        onOpenCard = { ui.mine?.card?.let { c -> env.openCard?.invoke(c.noteId) } },
        onBump = {
            val bump = env.bump ?: return@WordView
            bumping = true
            scope.launch {
                try {
                    ui = ui.copy(bumped = bump(listOf(hanzi), null))
                    controller.record("explorer.bump")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    ui = ui.copy(bumped = null)
                } finally { bumping = false }
            }
        },
        onAdd = {
            val r = ui.resolved
            val funFacts = (ui.more as? WordMore.Done)?.value?.funFacts?.ifBlank { null }
            onAdd(Chunk(hanzi, r.pinyin, r.english, funFacts))
        },
    )
}

/** The Word view in the explorer frame (stateless): footer = Open card + ⚡ Study it today, or + Add as card. */
@Composable
fun WordView(
    ui: WordViewUi,
    stack: List<ExplorerItem>,
    canOpenCard: Boolean,
    canBump: Boolean,
    actions: WordViewActions = WordViewActions(),
    bumping: Boolean = false,
    onBack: () -> Unit = {},
    onCrumb: (Int) -> Unit = {},
    onClose: () -> Unit = {},
    onOpenCard: () -> Unit = {},
    onBump: () -> Unit = {},
    onAdd: () -> Unit = {},
) {
    val mine = ui.mine
    val card = mine?.card
    val footer: (@Composable RowScope.() -> Unit)? = when {
        mine == null -> null
        card != null && (canOpenCard || canBump) -> {
            {
                if (canOpenCard) SecondaryPill("Open card", Modifier.weight(1f).height(52.dp).testTag("explorer-open-card"), onClick = onOpenCard)
                if (canBump) PrimaryPill(
                    if (ui.bumped != null) "⚡ Bumped" else if (bumping) "Bumping…" else STUDY_IT_TODAY,
                    Modifier.weight(1.3f).height(52.dp).testTag("explorer-bump"),
                    enabled = !bumping && ui.bumped == null,
                    onClick = onBump,
                )
            }
        }
        card != null -> null
        else -> { { PrimaryPill("+ Add as card", Modifier.weight(1f).height(52.dp).testTag("explorer-add"), onClick = onAdd) } }
    }
    ExplorerFrame(stack, onBack, onCrumb, onClose, footer = footer) {
        WordViewContent(ui, actions)
    }
}
