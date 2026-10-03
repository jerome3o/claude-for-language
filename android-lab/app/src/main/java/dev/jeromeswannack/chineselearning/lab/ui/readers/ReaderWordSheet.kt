package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

/** What the word sheet may do outside itself (fakes in tests and screenshots). */
class ReaderWordActions(
    val online: () -> Boolean = { true },
    val play: (text: String) -> Unit = {},
    /** The explanation already on the phone (opens instantly, offline too). */
    val cachedExplanation: suspend (word: ReaderWordDto, sentence: String) -> ReaderWordExplanationDto? = { _, _ -> null },
    /** "More about this word": cache-first, Haiku on the server. */
    val explain: suspend (word: ReaderWordDto, sentence: String) -> ReaderWordExplanationDto = { _, _ -> throw java.io.IOException("offline") },
    val decks: suspend () -> List<DeckChoice> = { emptyList() },
    val isDuplicate: suspend (deckId: String, hanzi: String) -> Boolean = { _, _ -> false },
    /** Creates the note (the content service makes the cards and the audio). */
    val add: suspend (deckId: String, word: ReaderWordDto, explanation: ReaderWordExplanationDto?) -> Unit = { _, _, _ -> },
)

private sealed interface Explain {
    data object Idle : Explain
    data object Loading : Explain
    data class Ready(val value: ReaderWordExplanationDto) : Explain
    data class Failed(val message: String) : Explain
}

/**
 * A tapped reader word (`ReaderWordSheet` on the web): hanzi · pinyin · gloss, ▶ to hear it,
 * the sentence it was read in, "More about this word" (Haiku's explanation of the word in that
 * sentence, cached) and "+ Add as card" (deck chips; the card gets the explanation's
 * card-standard explanation and sentence clue). A word already in a deck says so.
 */
@Composable
fun ReaderWordSheet(
    word: ReaderWordDto,
    sentence: String,
    known: Boolean,
    actions: ReaderWordActions,
    onDismiss: () -> Unit,
    onAdded: () -> Unit = {},
    initialExplanation: ReaderWordExplanationDto? = null,
    startAdding: Boolean = false,
) {
    LabSheetFrame(onDismiss = onDismiss) {
        ReaderWordPanel(word, sentence, known, actions, onAdded, initialExplanation, startAdding, pinnedFooter = true)
    }
}

/** The sheet's content (tested on its own, outside the dialog window). */
@Composable
fun ReaderWordPanel(
    word: ReaderWordDto,
    sentence: String,
    known: Boolean,
    actions: ReaderWordActions,
    onAdded: () -> Unit = {},
    initialExplanation: ReaderWordExplanationDto? = null,
    startAdding: Boolean = false,
    /**
     * true (the sheet) = the word + deck chips scroll and "+ Add as card" / "Add to deck" stay
     * pinned at the bottom (SheetScaffold); false = one plain column (embedding / tests).
     */
    pinnedFooter: Boolean = false,
) {
    var explain by remember(word.text, sentence) { mutableStateOf<Explain>(initialExplanation?.let { Explain.Ready(it) } ?: Explain.Idle) }
    var adding by remember { mutableStateOf(startAdding) }
    var decks by remember { mutableStateOf<List<DeckChoice>>(emptyList()) }
    var deckId by remember { mutableStateOf<String?>(null) }
    var duplicate by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var added by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(word.text, sentence) {
        if (explain == Explain.Idle) actions.cachedExplanation(word, sentence)?.let { explain = Explain.Ready(it) }
    }
    LaunchedEffect(adding) {
        if (adding && decks.isEmpty()) {
            decks = actions.decks()
            if (deckId == null) deckId = decks.firstOrNull()?.id
        }
    }
    LaunchedEffect(deckId) { duplicate = deckId?.let { actions.isDuplicate(it, word.text) } ?: false }

    suspend fun loadExplanation(): ReaderWordExplanationDto? {
        (explain as? Explain.Ready)?.let { return it.value }
        if (!actions.online()) {
            explain = Explain.Failed("Needs a connection — tap again when you're back online.")
            return null
        }
        explain = Explain.Loading
        return try {
            actions.explain(word, sentence).also { explain = Explain.Ready(it) }
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            explain = Explain.Failed(e.userMessage())
            null
        }
    }

    val ready = (explain as? Explain.Ready)?.value
    val pinyin = ready?.pinyin?.takeIf { it.isNotBlank() } ?: word.pinyin
    val gloss = word.gloss.ifBlank { ready?.english.orEmpty() }

    fun addTo() {
        val id = deckId ?: return
        if (!actions.online()) {
            error = "Adding a card needs a connection."
            return
        }
        saving = true
        error = null
        scope.launch {
            try {
                val ex = loadExplanation()
                if (ex == null && word.gloss.isBlank()) throw IllegalStateException("No meaning for this word yet — try \"More about this word\" first.")
                actions.add(id, word, ex)
                added = decks.firstOrNull { it.id == id }?.name ?: "your deck"
                onAdded()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                error = e.userMessage()
            } finally {
                saving = false
            }
        }
    }

    val body: @Composable ColumnScope.() -> Unit = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(word.text, fontSize = 52.sp, color = Lab.colors.ink)
            Spacer(Modifier.width(16.dp))
            Box(
                Modifier.size(52.dp).bouncyClickable(pressedScale = 0.9f) { actions.play(word.text) }.clip(CircleShape).background(Lab.colors.accentSoft).testTag("play-word"),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.AutoMirrored.Filled.VolumeUp, "Play the word", Modifier.size(26.dp), tint = Lab.colors.accent) }
        }
        if (pinyin.isNotBlank()) Text(pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent)
        if (gloss.isNotBlank()) Text(gloss, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
        if (known) {
            Text(
                "✓ Already in your decks",
                color = Palette.Good,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.clip(CircleShape).background(Palette.Good.copy(alpha = 0.12f)).padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }
        Text(
            sentence,
            fontSize = 18.sp,
            lineHeight = 28.sp,
            color = Lab.colors.muted,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(horizontal = 14.dp, vertical = 10.dp),
        )

        AnimatedContent(explain, label = "explain", contentKey = { it::class }) { state ->
            when (state) {
                is Explain.Ready -> Text(
                    state.value.explanation,
                    style = MaterialTheme.typography.bodyLarge,
                    color = Lab.colors.ink,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.Secondary.copy(alpha = 0.10f))
                        .padding(horizontal = 14.dp, vertical = 10.dp).testTag("word-explanation"),
                )
                Explain.Loading -> Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Palette.Secondary)
                    Spacer(Modifier.width(10.dp))
                    Text("Asking Claude about ${word.text}…", color = Lab.colors.muted)
                }
                else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    (state as? Explain.Failed)?.let { InlineNotice(it.message, kind = NoticeKind.Warning) }
                    SecondaryPill("✨ More about this word", Modifier.fillMaxWidth().height(50.dp)) { scope.launch { loadExplanation() } }
                }
            }
        }


        if (adding && added == null) {
            Text("Save to deck:", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth())
            ChipRow(Modifier.fillMaxWidth()) {
                for (d in decks) LabChip(d.name, selected = d.id == deckId) { deckId = d.id }
            }
            if (duplicate) InlineNotice("This word is already in that deck.", kind = NoticeKind.Warning)
        }
    }
    val notice: (@Composable ColumnScope.() -> Unit)? = when {
        added != null -> { { InlineNotice("Added to $added ✓", kind = NoticeKind.Success) } }
        adding && error != null -> { { InlineNotice(error!!, kind = NoticeKind.Error) } }
        else -> null
    }
    val action: (@Composable RowScope.() -> Unit)? = when {
        added != null -> null
        !adding -> { { PrimaryPill("+ Add as card", Modifier.weight(1f).height(54.dp)) { adding = true } } }
        else -> {
            {
                PrimaryPill(
                    if (saving) "Adding…" else if (duplicate) "Add anyway" else "Add to deck",
                    Modifier.weight(1f).height(54.dp).testTag("add-to-deck"),
                    enabled = !saving && deckId != null,
                ) { addTo() }
            }
        }
    }

    if (pinnedFooter) {
        SheetScaffold(
            Modifier.testTag("reader-word-sheet"),
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
            spacing = 10.dp,
            footerAbove = notice,
            footer = action,
        ) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) { body() }
        }
    } else {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).testTag("reader-word-sheet"),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            body()
            notice?.invoke(this)
            if (action != null) Row(Modifier.fillMaxWidth()) { action() }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** The note a word becomes: the explanation's card fields when there are some, else the chip's pinyin + gloss. */
fun readerWordNote(word: ReaderWordDto, ex: ReaderWordExplanationDto?): dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody =
    dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody(
        hanzi = word.text,
        pinyin = ex?.pinyin?.takeIf { it.isNotBlank() } ?: word.pinyin,
        english = ex?.english?.takeIf { it.isNotBlank() } ?: word.gloss,
        fun_facts = ex?.funFacts?.takeIf { it.isNotBlank() },
        sentence_clue = ex?.sentenceClue?.takeIf { it.isNotBlank() },
        sentence_clue_pinyin = ex?.sentenceClue?.takeIf { it.isNotBlank() }?.let { ex.sentenceCluePinyin },
        sentence_clue_translation = ex?.sentenceClue?.takeIf { it.isNotBlank() }?.let { ex.sentenceClueTranslation },
    )

