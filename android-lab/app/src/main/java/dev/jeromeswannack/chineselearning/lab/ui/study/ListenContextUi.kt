package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ListenContext
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.buttonBorder
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * "Listen in context" — the question side of a listening card (web
 * `components/study/ListenContext.tsx`; rules in core [ListenContext], parity-tested): the
 * note's sentences as AUDIO-ONLY rows (▶ · number · ✓ once heard; EN shows only the English —
 * never the Chinese or pinyin, they would give the answer away), "+ More sentences" (online),
 * then "▶ The word", which asks "Try the sentences first?" while no sentence has been heard.
 */

/** Per card presentation (CardStage remembers one): what was heard, the ask, EN rows, generating. */
@Stable
class ListenState {
    /** Heard on this card — by the sentence's text, so a regenerated set keeps its ✓s. */
    val played = mutableStateMapOf<String, Boolean>()
    val english = mutableStateMapOf<String, Boolean>()
    var prompt by mutableStateOf(false)
    var promptShown by mutableStateOf(false)
    var anyway by mutableStateOf(false)
    var generating by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    /** ▶ on a set row with no clip yet: asking / queued ("Audio coming…"). */
    val asking = mutableStateMapOf<String, Boolean>()
    val coming = mutableStateMapOf<String, Boolean>()
    /** `study.listen_context` went out for this card. */
    var tracked = false

    val playedCount: Int get() = played.size
}

const val LISTEN_CONTEXT_TAG = "listen-context"
const val LISTEN_ROW_TAG = "listen-row"
const val LISTEN_EN_TAG = "listen-en"
const val LISTEN_PROMPT_TAG = "listen-prompt"
const val LISTEN_MORE_TAG = "listen-more"

/** The rows of [view] (the card's own sentence first, then the set). */
fun listenRows(view: CardView): List<ListenContext.Row> = ListenContext.rows(
    view.note.id,
    ListenContext.Clue(view.note.sentenceClue, view.note.sentenceClueTranslation, view.note.sentenceClueAudioUrl),
    view.sentences.map { ListenContext.Sentence(it.id, it.hanzi, it.translation, it.audioUrl, it.position) },
)

fun listenStates(rows: List<ListenContext.Row>, view: CardView, online: Boolean): List<ListenContext.RowState> =
    rows.map { ListenContext.rowState(it.audioUrl, it.sentenceId, online, it.audioUrl != null && it.audioUrl in view.cachedClips) }

/**
 * ▶ on a row: the clip (or the device voice for the card's own sentence still being made); a set
 * row with no clip yet waits for it ("Audio coming…", [SentenceAudioWait]). Marks it heard.
 */
fun listenPlay(
    row: ListenContext.Row,
    state: ListenContext.RowState,
    listen: ListenState,
    actions: StudyActions,
    scope: CoroutineScope,
    isCurrent: () -> Boolean,
) {
    if (state == ListenContext.RowState.UNAVAILABLE) return
    listen.prompt = false
    listen.played[row.hanzi] = true
    val ensure = actions.sentences.ensureAudio
    val id = row.sentenceId
    if (state == ListenContext.RowState.FETCH && id != null && ensure != null) {
        if (listen.asking[row.key] == true) return
        listen.asking[row.key] = true
        scope.launch {
            try {
                val r = SentenceAudioWait.await({ if (!isCurrent()) null else ensure(id) }, onComing = { listen.coming[row.key] = true })
                if (isCurrent()) when (r) {
                    is SentenceAudioWait.Result.Ready -> actions.onPlay(r.key, row.hanzi)
                    SentenceAudioWait.Result.Unavailable -> actions.onPlay(null, row.hanzi)
                    SentenceAudioWait.Result.StillComing -> Unit
                }
            } finally {
                listen.asking.remove(row.key)
                listen.coming.remove(row.key)
            }
        }
        return
    }
    actions.onPlay(if (state == ListenContext.RowState.READY) row.audioUrl else null, row.hanzi)
}

@Composable
fun ListenContextPanel(
    view: CardView,
    ui: StudyUi,
    playingKey: String?,
    actions: StudyActions,
    listen: ListenState,
    scope: CoroutineScope,
    isCurrent: () -> Boolean,
    wordPlaying: Boolean,
    wordGenerating: Boolean,
    /** Under the word button: the voices hint, offline / "Audio coming…" lines. */
    wordFooter: @Composable () -> Unit = {},
) {
    val rows = listenRows(view)
    val states = listenStates(rows, view, ui.aiAvailable)
    val playable = states.count(ListenContext::isPlayable)
    Column(
        Modifier.fillMaxWidth().widthIn(max = 520.dp).testTag(LISTEN_CONTEXT_TAG),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (rows.isNotEmpty()) {
            Text(
                ListenContext.Copy.HEADING.uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = Lab.colors.muted,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.6.sp,
            )
            rows.forEachIndexed { i, row ->
                val state = states[i]
                ListenRowView(
                    index = i,
                    row = row,
                    state = state,
                    heard = listen.played[row.hanzi] == true,
                    playing = playingKey != null && (playingKey == row.audioUrl || playingKey == "tts:${row.hanzi}"),
                    coming = listen.coming[row.key] == true || listen.asking[row.key] == true,
                    english = listen.english[row.key] == true,
                    onPlay = {
                        actions.onTick()
                        listenPlay(row, state, listen, actions, scope, isCurrent)
                    },
                    onEnglish = { listen.english[row.key] = !(listen.english[row.key] ?: false) },
                )
            }
        } else {
            Text(ListenContext.Copy.NO_SENTENCES, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        if (ui.aiAvailable) {
            TextButton(
                enabled = !listen.generating,
                onClick = {
                    val before = rows.size
                    listen.generating = true
                    listen.error = null
                    scope.launch {
                        try {
                            actions.sentences.generate(ListenContext.moreCount(before), true, null)
                            actions.onListenMore(before)
                        } catch (e: kotlinx.coroutines.CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            listen.error = ListenContext.Copy.MORE_FAILED
                        } finally {
                            listen.generating = false
                        }
                    }
                },
                modifier = Modifier.align(Alignment.CenterHorizontally).heightIn(min = 44.dp).testTag(LISTEN_MORE_TAG),
            ) {
                if (listen.generating) {
                    CircularProgressIndicator(Modifier.size(16.dp), color = Lab.colors.accent, strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    if (listen.generating) ListenContext.Copy.GENERATING else ListenContext.Copy.MORE,
                    color = if (listen.generating) Lab.colors.muted else Lab.colors.accent,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        listen.error?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.Again, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        AnimatedVisibility(listen.prompt, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            WordFirstPrompt(
                onAnyway = {
                    listen.anyway = true
                    listen.prompt = false
                    actions.onPlayWord(true)
                },
                onSentence = {
                    val i = states.indexOfFirst(ListenContext::isPlayable)
                    listen.prompt = false
                    if (i >= 0) listenPlay(rows[i], states[i], listen, actions, scope, isCurrent)
                },
            )
        }
        Spacer(Modifier.height(2.dp))
        ListenWordButton(playing = wordPlaying, generating = wordGenerating) {
            when (ListenContext.wordTap(listen.playedCount, playable, listen.anyway)) {
                ListenContext.WordTap.PROMPT -> {
                    actions.onTick()
                    listen.prompt = true
                    listen.promptShown = true
                }
                ListenContext.WordTap.PLAY -> {
                    listen.prompt = false
                    actions.onPlayWord(true)
                }
            }
        }
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) { wordFooter() }
    }
}

@Composable
private fun ListenRowView(
    index: Int,
    row: ListenContext.Row,
    state: ListenContext.RowState,
    heard: Boolean,
    playing: Boolean,
    coming: Boolean,
    english: Boolean,
    onPlay: () -> Unit,
    onEnglish: () -> Unit,
) {
    val unavailable = state == ListenContext.RowState.UNAVAILABLE
    val border by animateColorAsState(if (heard) Palette.Good.copy(alpha = 0.55f) else Lab.colors.cardBorder, label = "listen-row-border")
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Lab.colors.card)
            .border(1.dp, border, shape)
            .testTag(LISTEN_ROW_TAG),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .clickable(enabled = !unavailable, onClick = onPlay)
                    .semantics { contentDescription = ListenContext.rowLabel(index, heard) }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val pulse by animateFloatAsState(if (playing) 1.12f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow), label = "listen-pulse")
                Box(
                    Modifier.size(32.dp).scale(pulse).clip(CircleShape).background(if (playing) Lab.colors.accent else Lab.colors.faint),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (playing) Icons.Filled.Stop else Icons.Filled.PlayArrow,
                        null,
                        Modifier.size(18.dp),
                        tint = when { playing -> Lab.colors.onAccent; unavailable -> Lab.colors.muted.copy(alpha = 0.5f); else -> Lab.colors.ink },
                    )
                }
                Spacer(Modifier.width(12.dp))
                Text("${index + 1}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = if (unavailable) Lab.colors.muted else Lab.colors.ink)
                Spacer(Modifier.weight(1f))
                when {
                    coming -> Text(SentenceAudioWait.LABEL, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                    unavailable -> Text(ListenContext.Copy.UNAVAILABLE, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                    heard -> Text("✓", color = Palette.Good, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                }
            }
            if (row.translation != null) {
                Box(
                    Modifier
                        .heightIn(min = 48.dp)
                        .widthIn(min = 52.dp)
                        .clickable(onClick = onEnglish)
                        .testTag(LISTEN_EN_TAG)
                        .semantics { contentDescription = if (english) "Hide the English" else "Show the English" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("EN", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = if (english) Lab.colors.accent else Lab.colors.muted)
                }
            }
        }
        AnimatedVisibility(english && row.translation != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Text(
                row.translation.orEmpty(),
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.ink,
                modifier = Modifier.padding(start = 56.dp, end = 12.dp, bottom = 10.dp),
            )
        }
    }
}

@Composable
private fun WordFirstPrompt(onAnyway: () -> Unit, onSentence: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Lab.colors.card)
            .border(1.dp, Lab.colors.accent.copy(alpha = 0.45f), shape)
            .padding(14.dp)
            .testTag(LISTEN_PROMPT_TAG),
    ) {
        Text(ListenContext.Copy.PROMPT_TITLE, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
        Spacer(Modifier.height(2.dp))
        Text(ListenContext.Copy.PROMPT_BODY, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        Spacer(Modifier.height(10.dp))
        // Stacked, full width: the nudge (a sentence) first, the word still one tap away.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryPill(ListenContext.Copy.PROMPT_SENTENCE, Modifier.fillMaxWidth().height(48.dp), onClick = onSentence)
            SecondaryPill(ListenContext.Copy.PROMPT_ANYWAY, Modifier.fillMaxWidth().height(48.dp), onClick = onAnyway)
        }
    }
}

/** "▶ The word" at the bottom of the list (tagged [PLAY_WORD_TAG] like the old speaker). */
@Composable
private fun ListenWordButton(playing: Boolean, generating: Boolean, onClick: () -> Unit) {
    val pulse by animateFloatAsState(if (playing) 1.04f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow), label = "word-pulse")
    val shape = RoundedCornerShape(26.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .scale(pulse)
            .clip(shape)
            .background(if (playing) Lab.colors.accentSoft else Lab.colors.faint)
            .buttonBorder(shape)
            .clickable(onClick = onClick)
            .testTag(PLAY_WORD_TAG),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
            if (generating) CircularProgressIndicator(Modifier.fillMaxSize(), color = Lab.colors.accent, strokeWidth = 2.dp)
            Icon(
                Icons.AutoMirrored.Filled.VolumeUp,
                if (generating) CardAudioRules.GENERATING else "Play",
                Modifier.size(18.dp),
                tint = Lab.colors.accent.copy(alpha = if (generating) 0.5f else 1f),
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(ListenContext.Copy.WORD, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
    }
}
