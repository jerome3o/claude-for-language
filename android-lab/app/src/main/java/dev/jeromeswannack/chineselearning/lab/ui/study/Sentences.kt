package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.DeckChipList
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFooterSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.PinnedFooterColumn
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A sentence row: the card's own clue first, then the generated graded set. */
data class SentenceRow(
    val key: String,
    /** The set row's id; null for the card's own sentence (explained by its text). */
    val sentenceId: String?,
    val hanzi: String,
    val pinyin: String?,
    val translation: String?,
    val audioUrl: String?,
    val badge: String?,
    val focusNote: String? = null,
    /** The card's own sentence: its badge is a small tab on the row's top edge, left of ▶ (takes no line). */
    val fromCard: Boolean = false,
    /**
     * The card's own sentence with no translation on the note (MCP-added / older notes): the
     * English step is still there and the line is fetched when the row starts opening
     * ([SentenceActions.translate], cached on the device by text).
     */
    val fetchTranslation: Boolean = false,
)

/** SentenceSet.tsx `FOCUS_LABELS`. */
private val FOCUS_LABELS = mapOf(
    "shared_character" to "Shared character",
    "contrast" to "Contrast",
    "collocation" to "Collocation",
    "complex" to "Complex",
)

fun sentenceRows(view: CardView): List<SentenceRow> = sentenceRows(view.note, view.sentences)

fun sentenceRows(note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity, sentences: List<dev.jeromeswannack.chineselearning.lab.data.SentenceEntity>): List<SentenceRow> {
    val rows = ArrayList<SentenceRow>()
    val clue = note.sentenceClue?.takeIf { it.isNotBlank() }
    if (clue != null && sentences.none { it.hanzi == clue }) {
        // A clue written without pinyin gets the device's own (the app's one automatic pinyin), so
        // it reveals hanzi → pinyin → English like every other row.
        val pinyin = note.sentenceCluePinyin?.takeIf { it.isNotBlank() } ?: devicePinyinLine(clue).takeIf { it.isNotEmpty() }
        val translation = note.sentenceClueTranslation?.takeIf { it.isNotBlank() }
        rows += SentenceRow(
            clueRowKey(note.id), null, clue, pinyin, translation, note.sentenceClueAudioUrl, "From the card",
            fromCard = true, fetchTranslation = translation == null,
        )
    }
    sentences.sortedBy { it.position }.forEach { s ->
        rows += SentenceRow(s.id, s.id, s.hanzi, s.pinyin, s.translation, s.audioUrl, s.focus?.let { FOCUS_LABELS[it] ?: it.takeIf { f -> f != "core" }?.replace('_', ' ') }, s.focusNote)
    }
    return rows
}

private val HAN_RUN = Regex("\\p{IsHan}+")

/**
 * Pinyin of a whole sentence made on the phone (web `devicePinyinLine`): pinyin-pro's
 * `nonZh: 'consecutive'` — only the Han runs become pinyin — then `tidyPinyin`: no space before
 * punctuation or inside quotes, one after a Chinese comma / full stop. "" when it can't.
 */
fun devicePinyinLine(text: String): String = runCatching {
    HAN_RUN.replace(text) { m -> " " + dev.jeromeswannack.chineselearning.lab.core.ToneChange.autoPinyin(m.value).trim() + " " }
        .replace(Regex("\\s+([，。！？、：；”’）」』,.!?;:)])"), "$1")
        .replace(Regex("([“‘（「『(])\\s+"), "$1")
        .replace(Regex("([，。！？、：；])\\s*"), "$1 ")
        .replace(Regex(" {2,}"), " ")
        .trim()
}.getOrDefault("")

/**
 * A new set's rows get their clips a moment after the set (the provider makes them one by one):
 * ▶ on such a row waits for the real clip — "Audio coming…" — instead of reading it in the
 * phone's voice (the web's SentenceSet does the same). Asks every [POLL_MS], [POLLS] times.
 */
object SentenceAudioWait {
    const val COMING = "coming"
    const val LABEL = "Audio coming…"
    const val POLL_MS = 4_000L
    const val POLLS = 30

    /** Asks until the clip is there: its key, or null when it can't be had (or still isn't after [POLLS]). */
    suspend fun await(ask: suspend () -> String?, onComing: () -> Unit, sleep: suspend (Long) -> Unit = { delay(it) }): Result {
        repeat(POLLS) { i ->
            val got = runCatching { ask() }.getOrNull() ?: return Result.Unavailable
            if (got != COMING) return Result.Ready(got)
            onComing()
            if (i < POLLS - 1) sleep(POLL_MS)
        }
        return Result.StillComing
    }

    sealed interface Result {
        data class Ready(val key: String) : Result
        /** The server can't make it (or we're offline after all): the device voice. */
        data object Unavailable : Result
        /** Gave up waiting: nothing plays (the clip arrives with a later sync). */
        data object StillComing : Result
    }
}

/** A word or sentence the learner is turning into a card (AddChunkModal's `Chunk`; fun_facts optional, sent as is). */
data class Chunk(val hanzi: String, val pinyin: String, val english: String, val funFacts: String? = null)

/** The sentence list's network side (all online; the list itself is offline). */
class SentenceActions(
    /** `generateAndStoreSentenceSet` for the current note; the card shows the new set. */
    val generate: suspend (count: Int, keepExisting: Boolean, customPrompt: String?) -> Unit = { _, _, _ -> },
    val clear: suspend () -> Unit = {},
    /**
     * ▶ on a set row with no clip yet: the clip's key when it is there, [SentenceAudioWait.COMING]
     * while it is being made, null = it can't be had (the device voice reads the row). Null
     * function = no server side here (the device voice, as before).
     */
    val ensureAudio: (suspend (sentenceId: String) -> String?)? = null,
    val cachedExplanation: suspend (SentenceRow) -> SentenceExplanation? = { null },
    val explain: suspend (SentenceRow) -> SentenceExplanation = { error("offline") },
    /** The English this device holds for a card sentence without one (offline), or null. */
    val cachedTranslation: suspend (SentenceRow) -> String? = { null },
    /** The English for a card sentence without one (`/api/sentences/explain-text`'s translation line). */
    val translate: suspend (SentenceRow) -> String = { error("offline") },
    /** Decks (current note's deck first) and whether one already has this hanzi. */
    val decks: suspend () -> List<Pair<String, String>> = { emptyList() },
    val deckHas: suspend (deckId: String, hanzi: String) -> Boolean = { _, _ -> false },
    val addCard: suspend (deckId: String, Chunk) -> Unit = { _, _ -> },
)

/**
 * The web's SentenceSet on the card back: every row starts blank (listen first); each tap
 * uncovers one more line (hanzi → pinyin → English) and a tap on a fully open row hides it
 * again. EN flips a row to translate-back mode. A fully open row has its tools line —
 * "What's going on here?" (word-by-word breakdown, each word tappable to make a card) and
 * + Add as card — and the header ⋯ regenerates / extends / clears the set.
 */
@Composable
fun SentenceList(view: CardView, ui: StudyUi, playingKey: String?, actions: StudyActions, startExplained: Map<String, SentenceExplanation> = emptyMap(), startShowAll: Boolean = false, modifier: Modifier = Modifier) =
    SentenceList(
        view.note, view.sentences, view.presentation, ui.aiAvailable, playingKey, actions.sentences, actions.onPlay, startExplained, startShowAll, modifier,
        // Auto-audio: the card's own sentence clip is being made.
        audioBusy = if (ui.cardAudio.sentence == ClipState.GENERATING) setOf(clueRowKey(view.note.id)) else emptySet(),
    )

/** The key of the row that is the card's own sentence (row 1). */
fun clueRowKey(noteId: String) = "clue:" + noteId

/**
 * The same list for any note (the card editor's "Sentence Set" section): [presentation]
 * resets the reveal state when it changes; [onPlay] plays a clip key with the text as fallback.
 *
 * It is ONE node — a Column holding the header, the rows and the "+ 5 more sentences" line — so a
 * caller may wrap it in anything (the card back wraps it in a tap-keeping block): emitted as loose
 * siblings, a Box parent drew them all on top of each other (the header under the rows, the
 * "+ 5 more" line over the first row).
 */
@Composable
fun SentenceList(
    note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity,
    sentences: List<dev.jeromeswannack.chineselearning.lab.data.SentenceEntity>,
    presentation: Int,
    online: Boolean,
    playingKey: String?,
    s: SentenceActions,
    onPlay: (key: String?, text: String) -> Unit,
    startExplained: Map<String, SentenceExplanation> = emptyMap(),
    startShowAll: Boolean = false,
    modifier: Modifier = Modifier,
    /** Rows whose clip is being made (a spinner instead of the play button). */
    audioBusy: Set<String> = emptySet(),
) = Column(modifier.fillMaxWidth()) {
    val rows = remember(presentation, sentences, note.sentenceClue, note.sentenceCluePinyin, note.sentenceClueTranslation) { sentenceRows(note, sentences) }
    val state = rememberSentenceRowsState(presentation, startExplained, startShowAll)
    var menu by remember(presentation) { mutableStateOf(false) }
    var custom by remember(presentation) { mutableStateOf(false) }
    var prompt by remember(presentation) { mutableStateOf("") }
    var generating by remember(presentation) { mutableStateOf(false) }
    var error by remember(presentation) { mutableStateOf<String?>(null) }
    var adding by remember(presentation) { mutableStateOf<Chunk?>(null) }
    val scope = rememberCoroutineScope()
    val hasSet = sentences.isNotEmpty()
    // ▶ on a set row whose clip isn't made yet: asking (spinner) / queued ("Audio coming…").
    val asking = remember(presentation) { mutableStateMapOf<String, Boolean>() }
    val coming = remember(presentation) { mutableStateMapOf<String, Boolean>() }
    val shownPresentation by androidx.compose.runtime.rememberUpdatedState(presentation)
    val playRow: (SentenceRow) -> Unit = play@{ row ->
        val ensure = s.ensureAudio
        val id = row.sentenceId
        if (asking[row.key] == true) return@play
        if (!row.audioUrl.isNullOrBlank() || id == null || ensure == null || !online) return@play onPlay(row.audioUrl, row.hanzi)
        asking[row.key] = true
        val askedOn = presentation
        scope.launch {
            try {
                val r = SentenceAudioWait.await({ if (shownPresentation != askedOn) null else ensure(id) }, onComing = { coming[row.key] = true })
                // Moved on to another card meanwhile: play nothing.
                if (shownPresentation == askedOn) when (r) {
                    is SentenceAudioWait.Result.Ready -> onPlay(r.key, row.hanzi)
                    SentenceAudioWait.Result.Unavailable -> onPlay(null, row.hanzi)
                    SentenceAudioWait.Result.StillComing -> Unit
                }
            } finally {
                asking.remove(row.key)
                coming.remove(row.key)
            }
        }
    }

    fun generate(count: Int, keep: Boolean = false, customPrompt: String? = null) {
        menu = false
        generating = true
        error = null
        scope.launch {
            try { s.generate(count, keep, customPrompt) } catch (e: Exception) { error = "Could not generate sentences. Try again in a moment." } finally { generating = false }
        }
    }

    if (rows.isEmpty()) {
        SecondaryPill(
            if (generating) "Generating sentences…" else "✨ Generate example sentences",
            Modifier.fillMaxWidth().height(48.dp),
            enabled = !generating && online,
        ) { generate(6) }
        error?.let { Spacer(Modifier.height(8.dp)); InlineNotice(it, kind = NoticeKind.Error) }
        Spacer(Modifier.height(12.dp))
    } else {

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Example sentences", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            TextButton(onClick = { state.showAll = !state.showAll; if (!state.showAll) state.steps.clear() }) {
                Text(if (state.showAll) "Hide all" else "Show all", color = Lab.colors.accent)
            }
            Box {
                TextButton(onClick = { menu = true }, enabled = online && !generating) {
                    Text(if (generating) "…" else "⋯", color = if (online) Lab.colors.ink else Lab.colors.muted, fontWeight = FontWeight.Bold)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Lab.colors.card) {
                    for (count in listOf(5, 10)) DropdownMenuItem(text = { Text(if (hasSet) "New set of $count" else "Generate $count") }, onClick = { generate(count) })
                    if (hasSet) DropdownMenuItem(text = { Text("Add 5 more") }, onClick = { generate(5, keep = true) })
                    DropdownMenuItem(text = { Text("Custom…") }, onClick = { menu = false; custom = true })
                    if (hasSet) DropdownMenuItem(text = { Text("Clear set", color = Palette.Again) }, onClick = {
                        menu = false
                        scope.launch { runCatching { s.clear() } }
                    })
                }
            }
        }
        error?.let { InlineNotice(it, kind = NoticeKind.Error); Spacer(Modifier.height(8.dp)) }
        AnimatedVisibility(custom) {
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    placeholder = { Text("Describe the sentences you want…") },
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
                )
                Spacer(Modifier.width(6.dp))
                TextButton(enabled = prompt.isNotBlank(), onClick = { generate(6, customPrompt = prompt.trim()); prompt = ""; custom = false }) { Text("Go", color = Lab.colors.accent) }
                TextButton(onClick = { custom = false; prompt = "" }) { Text("Cancel", color = Lab.colors.muted) }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (row in rows) SentenceRowView(
                row, state, online, playingKey, s, onPlay = { _, _ -> playRow(row) }, onAdd = { adding = it },
                audioBusy = row.key in audioBusy || asking[row.key] == true,
                audioNote = if (coming[row.key] == true) SentenceAudioWait.LABEL else null,
            )
        }
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            TextButton(onClick = { if (hasSet) generate(5, keep = true) else generate(6) }, enabled = online && !generating) {
                Text(if (generating) "Generating…" else if (hasSet) "+ 5 more sentences" else "✨ Generate example sentences", color = if (online) Lab.colors.accent else Lab.colors.muted)
            }
        }
        Spacer(Modifier.height(12.dp))
        adding?.let { chunk -> AddChunkSheet(chunk, note.deckId, s, onDismiss = { adding = null }) }
    }
}

/**
 * The reveal state of one list of sentence rows (SentenceSet.tsx's `revealed` / `englishFirst` /
 * `explanations` / `showAll`): one per card, so a new card starts from scratch.
 */
@Stable
class SentenceRowsState(startExplained: Map<String, SentenceExplanation> = emptyMap(), startShowAll: Boolean = false) {
    val steps = mutableStateMapOf<String, Int>()
    val english = mutableStateMapOf<String, Boolean>()
    val explanations = mutableStateMapOf<String, SentenceExplanation?>().apply { putAll(startExplained) }
    val explaining = mutableStateMapOf<String, Boolean>()
    val failed = mutableStateMapOf<String, Boolean>()
    /** English fetched for card sentences that have none on the note, and how that is going. */
    val translations = mutableStateMapOf<String, String>()
    val translateFailed = mutableStateMapOf<String, Boolean>()
    var showAll by mutableStateOf(startShowAll)
}

@Composable
fun rememberSentenceRowsState(key: Any?, startExplained: Map<String, SentenceExplanation> = emptyMap(), startShowAll: Boolean = false): SentenceRowsState =
    remember(key) { SentenceRowsState(startExplained, startShowAll) }

/** Test tags on a sentence row (the tap-to-reveal body and the tools). */
const val SENTENCE_AUDIO_BUSY_TAG = "sentence-audio-busy"
const val SENTENCE_AUDIO_COMING_TAG = "sentence-audio-coming"
const val SENTENCE_ROW_TAG = "sentence-row"
const val SENTENCE_EXPLAIN_TAG = "sentence-explain"
const val SENTENCE_ADD_TAG = "sentence-add"
const val SENTENCE_TRANSLATION_PENDING_TAG = "sentence-translation-pending"
const val SENTENCE_CARD_BADGE_TAG = "sentence-card-badge"
const val SENTENCE_PLAY_TAG = "sentence-play"

/**
 * One sentence row, as on the study card (SentenceSet.tsx's `<li class="sentence-set-row">`):
 * ▶ on the right plays the clip (the device voice when there is none); each tap on the row
 * uncovers one more line — hanzi → pinyin → English — and a tap on a fully open row hides it
 * again. A fully open row carries the tools line ("What's going on here?" → [SentenceBreakdown],
 * each word tappable; + Add as card); a breakdown already cached shows at once, offline too.
 *
 * [startStep] is how much a row shows before any tap: 0 on the study card (listen first), 1 in
 * the homework pass (the Chinese is up; taps add the pinyin, then the English). [englishToggle]
 * shows the EN button (the translate-back exercise) on the left.
 */
@Composable
fun SentenceRowView(
    row: SentenceRow,
    state: SentenceRowsState,
    online: Boolean,
    playingKey: String?,
    s: SentenceActions,
    onPlay: (key: String?, text: String) -> Unit,
    onAdd: (Chunk) -> Unit,
    startStep: Int = 0,
    englishToggle: Boolean = true,
    audioBusy: Boolean = false,
    /** Under the row's text while its clip is on the way ("Audio coming…"). */
    audioNote: String? = null,
) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(row.key) { if (state.explanations[row.key] == null) s.cachedExplanation(row)?.let { state.explanations[row.key] = it } }
    // The card's sentence without an English line: the one cached here, else fetched as it opens.
    LaunchedEffect(row.key) {
        if (row.fetchTranslation && row.translation == null && state.translations[row.key] == null) {
            runCatching { s.cachedTranslation(row) }.getOrNull()?.let { state.translations[row.key] = it }
        }
    }
    val translation = row.translation?.takeIf { it.isNotBlank() } ?: state.translations[row.key]
    val resolved = if (translation == row.translation) row else row.copy(translation = translation)
    val en = englishToggle && state.english[row.key] == true && translation != null
    val chain = buildList {
        add("hanzi")
        if (!row.pinyin.isNullOrBlank()) add("pinyin")
        if (!en && (translation != null || row.fetchTranslation)) add("translation")
    }
    val first = if (en) 0 else startStep.coerceIn(0, chain.size)
    val step = if (state.showAll) chain.size else (state.steps[row.key] ?: first)
    val open = step >= chain.size
    // Fetched as soon as the row starts opening, so it is there by the time he taps through to it.
    val wantsTranslation = row.fetchTranslation && translation == null && step >= 1
    val translateFailed = state.translateFailed[row.key] == true
    LaunchedEffect(row.key, wantsTranslation, online, translateFailed) {
        if (!wantsTranslation || !online || translateFailed) return@LaunchedEffect
        try {
            state.translations[row.key] = s.translate(row)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            state.translateFailed[row.key] = true
        }
    }
    val playing = playingKey != null && (playingKey == row.audioUrl || playingKey == "tts:${row.hanzi}")
    val toolsStart = if (englishToggle) 50.dp else 10.dp
    Box(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).animateContentSize(),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable {
                        val cur = state.steps[row.key] ?: first
                        state.steps[row.key] = if (cur >= chain.size) first else cur + 1
                    }
                    .testTag(SENTENCE_ROW_TAG)
                    .padding(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (englishToggle) {
                    Box(
                        Modifier.size(34.dp).clip(CircleShape)
                            .background(if (en) Lab.colors.accentSoft else Lab.colors.card)
                            .clickable(enabled = translation != null) { state.english[row.key] = !en; state.steps[row.key] = 0; if (!en) state.showAll = false },
                        contentAlignment = Alignment.Center,
                    ) { Text("EN", style = MaterialTheme.typography.labelSmall, color = if (en) Lab.colors.accent else Lab.colors.muted) }
                    Spacer(Modifier.width(10.dp))
                } else {
                    Spacer(Modifier.width(6.dp))
                }
                Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                    if (en) Text(translation!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    if (step == 0 && !en) Text("Tap to reveal", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted.copy(alpha = 0.6f))
                    if (step >= 1) Text(row.hanzi, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                    if (step >= 2 && chain.getOrNull(1) == "pinyin") Text(row.pinyin!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent)
                    val translationStep = chain.indexOf("translation") + 1
                    if (translationStep > 0 && step >= translationStep) {
                        if (translation != null) Text(translation, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                        else Text(
                            when {
                                !online -> "Translation needs a connection"
                                translateFailed -> "Couldn’t get the English"
                                else -> "Translating…"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                            color = Lab.colors.muted.copy(alpha = 0.7f),
                            modifier = Modifier.testTag(SENTENCE_TRANSLATION_PENDING_TAG),
                        )
                    }
                    // A row that starts with the Chinese up (the pass) says what the next tap adds.
                    if (startStep > 0 && step >= 1 && !open) {
                        Text(
                            if (chain.getOrNull(step) == "pinyin") "Tap for pinyin" else "Tap for English",
                            style = MaterialTheme.typography.labelSmall,
                            color = Lab.colors.muted.copy(alpha = 0.7f),
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                    if (audioNote != null) Text(audioNote, style = MaterialTheme.typography.labelSmall, color = Lab.colors.accent, modifier = Modifier.padding(top = 2.dp).testTag(SENTENCE_AUDIO_COMING_TAG))
                    val focusLine = listOfNotNull(row.badge?.takeIf { !row.fromCard }, row.focusNote)
                    if (open && focusLine.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        Text(focusLine.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                    }
                }
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(if (playing) Lab.colors.accentSoft else Lab.colors.card).clickable(enabled = !audioBusy) { onPlay(row.audioUrl, row.hanzi) }.testTag(SENTENCE_PLAY_TAG),
                    contentAlignment = Alignment.Center,
                ) {
                    if (audioBusy) androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp).testTag(SENTENCE_AUDIO_BUSY_TAG), color = Lab.colors.accent, strokeWidth = 2.dp)
                    else Icon(Icons.Filled.PlayArrow, "Play sentence", tint = Lab.colors.accent)
                }
            }
            if (open) {
                val ex = state.explanations[row.key]
                Row(Modifier.padding(start = toolsStart, end = 8.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (row.fetchTranslation && translation == null && translateFailed && online) {
                        ToolLink("Retry English", enabled = true) { state.translateFailed[row.key] = false }
                    }
                    if (ex == null) {
                        val busy = state.explaining[row.key] == true
                        ToolLink(
                            when { busy -> "Explaining…"; state.failed[row.key] == true -> "Explain failed — retry"; else -> "What’s going on here?" },
                            enabled = !busy && online,
                            modifier = Modifier.testTag(SENTENCE_EXPLAIN_TAG),
                        ) {
                            state.explaining[row.key] = true
                            state.failed[row.key] = false
                            scope.launch {
                                try { state.explanations[row.key] = s.explain(resolved) } catch (e: Exception) { state.failed[row.key] = true } finally { state.explaining[row.key] = false }
                            }
                        }
                    }
                    if (!row.pinyin.isNullOrBlank() && !translation.isNullOrBlank()) {
                        ToolLink("+ Add as card", enabled = online, modifier = Modifier.testTag(SENTENCE_ADD_TAG)) { onAdd(Chunk(row.hanzi, row.pinyin, translation)) }
                    }
                }
                state.explanations[row.key]?.let { ex ->
                    SentenceBreakdown(
                        ex,
                        enabled = online,
                        onWord = { w -> onAdd(Chunk(w.hanzi, w.pinyin, w.gloss)) },
                        modifier = Modifier.padding(start = toolsStart, end = 10.dp, bottom = 10.dp),
                        sentence = row.hanzi,
                    )
                }
            }
        }
        // The card's own sentence: a small tab on the row's top edge, left of ▶ — it takes no line,
        // so the row is as tall as the others and "Tap to reveal" sits where it does on every row,
        // and it never lands in a line the taps uncover (hanzi / pinyin / English).
        if (row.fromCard && row.badge != null) {
            Text(
                row.badge,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, lineHeight = 12.sp),
                color = Lab.colors.muted,
                maxLines = 1,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = -CLUE_BADGE_END)
                    // Straddles the edge: half above the row, half on it (by its own height, so
                    // a larger font scale still clears the first line).
                    .layout { m, c -> val p = m.measure(c); layout(p.width, p.height) { p.place(0, -p.height / 2) } }
                    .clip(RoundedCornerShape(50))
                    .background(Lab.colors.card)
                    .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(50))
                    .padding(horizontal = 7.dp, vertical = 1.dp)
                    .testTag(SENTENCE_CARD_BADGE_TAG),
            )
        }
    }
}

/** How far the "From the card" tab sits from the row's end: the row's 6dp padding + ▶ (40dp) + a gap. */
private val CLUE_BADGE_END = 54.dp

/** Test tags on a breakdown word's two cells (the row merges them, so tests read the unmerged tree). */
const val BREAKDOWN_HANZI_TAG = "breakdown-hanzi"
const val BREAKDOWN_MEANING_TAG = "breakdown-meaning"

/**
 * "What's going on here?" — port of `renderExplanation` in SentenceSet.tsx (`.sentence-set-words`):
 * one word per full-width row, stacked top to bottom — the hanzi in its own column (as wide as the
 * longest word, so every row lines up), then pinyin + meaning, wrapping inside their column — and
 * the construction paragraph under the list. Each row adds that word as a card; inside the card
 * back's tap-keeping block it is interactive, so it never flips the card.
 */
@Composable
fun SentenceBreakdown(
    ex: SentenceExplanation,
    enabled: Boolean,
    onWord: (ExplainedWord) -> Unit,
    modifier: Modifier = Modifier,
    /** The sentence the words are from (the explorer's "In context"); default = the words joined. */
    sentence: String? = null,
) = Column(
    modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.card).padding(horizontal = 4.dp, vertical = 6.dp),
) {
    val hanziStyle = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Medium)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    // The hanzi column is as wide as the widest word (web: min-width 3.25rem), capped so a long
    // phrase can't squeeze the meanings out; a word wider than the cap wraps inside its column.
    val widest = remember(ex.words, hanziStyle, density) {
        with(density) { (ex.words.maxOfOrNull { measurer.measure(it.hanzi, hanziStyle, maxLines = 1).size.width } ?: 0).toDp() }
    }
    // A row opens the language explorer's Word view (Add is inside it); without one, the add sheet as before.
    val explore = dev.jeromeswannack.chineselearning.lab.ui.explorer.rememberExplorerTap("breakdown")
    val whole = sentence ?: ex.words.joinToString("") { it.hanzi }
    val onRow: (ExplainedWord) -> Unit = { w ->
        val item = dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack.itemForText(w.hanzi, w.pinyin, w.gloss, whole)
        if (explore != null && item != null) explore(item) else onWord(w)
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val column = widest.coerceIn(52.dp, maxOf(52.dp, maxWidth * 0.4f))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (w in ex.words) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = enabled || explore != null, onClickLabel = if (explore != null) "Explore ${w.hanzi}" else "Add ${w.hanzi} as a card") { onRow(w) }
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(Modifier.weight(1f)) {
                        Text(
                            w.hanzi, style = hanziStyle, color = Lab.colors.ink,
                            modifier = Modifier.width(column).alignByBaseline().testTag(BREAKDOWN_HANZI_TAG),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            buildAnnotatedString {
                                withStyle(SpanStyle(color = Lab.colors.accent)) { append(w.pinyin) }
                                if (w.pinyin.isNotBlank() && w.gloss.isNotBlank()) append("  ")
                                withStyle(SpanStyle(color = Lab.colors.ink.copy(alpha = 0.85f))) { append(w.gloss) }
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f).alignByBaseline().testTag(BREAKDOWN_MEANING_TAG),
                        )
                    }
                }
            }
        }
    }
    ex.construction?.takeIf { it.isNotBlank() }?.let {
        Spacer(Modifier.height(6.dp))
        MarkdownText(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

@Composable
private fun ToolLink(label: String, enabled: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = if (enabled) Lab.colors.accent else Lab.colors.muted,
        modifier = modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 6.dp, vertical = 10.dp),
    )
}

/**
 * AddChunkModal: pick a deck, warn on a duplicate, add. [actions] lists the decks in queue
 * order; the sheet starts on [preferredDeck] when given (the study card's own deck), else on
 * the top of the queue (chat, Coach). The deck chips scroll on their own and Cancel / Add stay
 * pinned at the bottom, however many decks there are.
 */
@Composable
fun AddChunkSheet(
    chunk: Chunk, preferredDeck: String, actions: SentenceActions, onDismiss: () -> Unit,
    bumpSource: String = "breakdown",
    bump: dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi? = dev.jeromeswannack.chineselearning.lab.ui.bumps.rememberBumpHanzi(bumpSource),
    existing: AddChunkExisting? = null,
    onAdded: () -> Unit = {},
) {
    LabFooterSheet(onDismiss = onDismiss) { AddChunkBody(chunk, preferredDeck, actions, onDismiss, bump = bump, existing = existing, onAdded = onAdded) }
}

/**
 * The word is already one of his notes (in any deck, AddChunkModal's `existing`): [deckNames]
 * for "You already have 银行 in HSK 2", and "Open card →" (the card hub) when [onOpenCard] is set.
 */
data class AddChunkExisting(val deckNames: List<String>, val onOpenCard: (() -> Unit)? = null)

@Composable
fun AddChunkBody(
    chunk: Chunk, preferredDeck: String, actions: SentenceActions, onDismiss: () -> Unit,
    bumpSource: String = "breakdown",
    /** "⚡ Study it today" when the word is already a card (null = no bump: previews, outside the app). */
    bump: dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi? = dev.jeromeswannack.chineselearning.lab.ui.bumps.rememberBumpHanzi(bumpSource),
    /** Known to be a note already (any deck): the bump-first footer whatever deck is picked. */
    existing: AddChunkExisting? = null,
    /** After a successful add (analytics). */
    onAdded: () -> Unit = {},
) {
    var bumped by remember { mutableStateOf<String?>(null) }
    var decks by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var deckId by remember { mutableStateOf(preferredDeck) }
    var duplicate by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        // Queue order from the caller; the preferred deck (if any) leads, else the top deck is the default.
        decks = actions.decks().sortedByDescending { it.first == preferredDeck }
        if (decks.none { it.first == deckId }) deckId = decks.firstOrNull()?.first.orEmpty()
    }
    LaunchedEffect(deckId) { duplicate = existing != null || (deckId.isNotEmpty() && runCatching { actions.deckHas(deckId, chunk.hanzi) }.getOrDefault(false)) }
    PinnedFooterColumn(
        Modifier.testTag("add-chunk-sheet"),
        body = {
            Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(chunk.hanzi, style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink)
                Text(chunk.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
                Text(chunk.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                bumped?.let { InlineNotice(it, kind = NoticeKind.Success) }
                if (existing != null && bumped == null) {
                    val where = existing.deckNames.distinct().joinToString(", ").ifEmpty { "your decks" }
                    InlineNotice(
                        "You already have ${chunk.hanzi} in $where." + if (bump != null) " Study it today instead of adding it again?" else "",
                        kind = NoticeKind.Warning,
                        actionLabel = existing.onOpenCard?.let { "Open card →" },
                        onAction = existing.onOpenCard,
                    )
                } else if (duplicate && bumped == null) InlineNotice(if (bump != null) "Already in this deck — study it today instead?" else "This word is already in the selected deck.", kind = NoticeKind.Warning)
                Text("Save to deck:", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth())
                DeckChipList(Modifier.testTag("add-chunk-decks")) { for ((id, name) in decks) LabChip(name, selected = id == deckId) { deckId = id } }
            }
        },
        footer = {
            if (duplicate && bump != null && !done) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 22.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill(if (busy) "Adding…" else "Add anyway", Modifier.weight(1f).height(50.dp).testTag("add-chunk-add"), enabled = !busy && bumped == null) {
                        busy = true
                        error = null
                        scope.launch {
                            try { actions.addCard(deckId, chunk); done = true; onAdded(); delay(800); onDismiss() } catch (e: Exception) { error = CardTools.message(e) } finally { busy = false }
                        }
                    }
                    PrimaryPill(if (bumped != null) "⚡ Bumped" else dev.jeromeswannack.chineselearning.lab.ui.bumps.STUDY_IT_TODAY, Modifier.weight(1.3f).height(50.dp).testTag("add-chunk-bump"), enabled = !busy && bumped == null) {
                        busy = true
                        error = null
                        scope.launch {
                            try { bumped = bump(listOf(chunk.hanzi), deckId); delay(1400); onDismiss() } catch (e: Exception) { error = CardTools.message(e) } finally { busy = false }
                        }
                    }
                }
            } else Row(Modifier.fillMaxWidth().padding(horizontal = 22.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill("Cancel", Modifier.weight(1f).height(50.dp), onClick = onDismiss)
                PrimaryPill(if (done) "✓ Added" else if (busy) "Adding…" else if (duplicate) "Add anyway" else "Add to deck", Modifier.weight(1f).height(50.dp).testTag("add-chunk-add"), enabled = !busy && !done && deckId.isNotEmpty()) {
                    busy = true
                    error = null
                    scope.launch {
                        try { actions.addCard(deckId, chunk); done = true; onAdded(); delay(800); onDismiss() } catch (e: Exception) { error = CardTools.message(e) } finally { busy = false }
                    }
                }
            }
        },
    )
}
