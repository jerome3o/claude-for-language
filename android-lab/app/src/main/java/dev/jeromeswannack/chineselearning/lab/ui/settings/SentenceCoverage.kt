package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageJobs
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceCoverageDto
import dev.jeromeswannack.chineselearning.lab.data.api.backfillClueAudio
import dev.jeromeswannack.chineselearning.lab.data.api.prefetchSentenceSets
import dev.jeromeswannack.chineselearning.lab.data.api.sentenceCoverage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.progress.rememberAppear
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What this phone holds for offline study. */
data class LocalSentences(val notes: Int, val sentences: Int, val lastSyncAt: Long)

data class CoverageUi(
    val stats: SentenceCoverageDto? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val local: LocalSentences? = null,
    val busy: Boolean = false,
    val status: String? = null,
)

/**
 * The web's polling rule (SentenceCoveragePage refetchInterval): every 5 s while a clue-audio
 * backfill was asked for in the last 5 minutes, else while jobs are actually queued (not
 * stuck), for at most 120 polls. Returns the delay, or null to stop.
 */
class CoveragePoller(private val nowMs: () -> Long = System::currentTimeMillis) {
    var pollUntil = 0L
    var polls = 0

    fun next(jobs: CoverageJobs?): Long? {
        if (nowMs() < pollUntil) return POLL_MS
        val active = (jobs?.queued ?: 0) - (jobs?.stale_queued ?: 0)
        if (active <= 0) {
            polls = 0
            return null
        }
        polls += 1
        return if (polls > MAX_POLLS) null else POLL_MS
    }

    companion object {
        const val POLL_MS = 5_000L
        const val MAX_POLLS = 120
        const val CLUE_AUDIO_POLL_MS = 5 * 60 * 1000L
    }
}

class SentenceCoverageViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(CoverageUi())
    val ui: StateFlow<CoverageUi> = _ui
    private val poller = CoveragePoller()
    private var pollJob: Job? = null

    init {
        viewModelScope.launch {
            app.cache.get<SentenceCoverageDto>(KEY)?.let { c -> _ui.update { it.copy(stats = c) } }
            loadLocal()
            refresh()
        }
    }

    private suspend fun loadLocal() {
        val local = withContext(Dispatchers.IO) {
            app.repo.db.openHelper.readableDatabase.query("SELECT COUNT(DISTINCT noteId), COUNT(*) FROM sentences").use {
                it.moveToFirst()
                LocalSentences(it.getInt(0), it.getInt(1), app.prefs.lastSyncAt)
            }
        }
        _ui.update { it.copy(local = local) }
    }

    fun refresh() {
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            while (true) {
                try {
                    val s = withContext(Dispatchers.IO) { app.repo.api.sentenceCoverage() }
                    app.cache.put(KEY, "settings", s)
                    _ui.update { it.copy(stats = s, loading = false, error = null) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _ui.update { it.copy(loading = false, error = if (!app.online.value) "Couldn't load the overview — you're offline." else "Couldn't load the overview. ${e.userMessage()}") }
                    return@launch
                }
                val wait = poller.next(_ui.value.stats?.jobs) ?: return@launch
                delay(wait)
            }
        }
    }

    private fun act(start: String, block: suspend () -> String) = viewModelScope.launch {
        _ui.update { it.copy(busy = true, status = start) }
        val status = try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            "Failed: ${e.userMessage()}"
        }
        _ui.update { it.copy(busy = false, status = status) }
    }

    fun generate(limit: Int) = act("Queueing $limit words…") {
        val r = withContext(Dispatchers.IO) { app.repo.api.prefetchSentenceSets(limit) }
        poller.polls = 0
        refresh()
        if (r.queued == 0) "Nothing to queue — every word either has a set already or is waiting in the queue."
        else "Queued ${r.queued} words. ${"%,d".format(r.remaining)} still without a set. Generating in the background — this page updates as they land."
    }

    fun clueAudio() = act("Queueing audio for sentences without it…") {
        val r = withContext(Dispatchers.IO) { app.repo.api.backfillClueAudio(250) }
        poller.pollUntil = System.currentTimeMillis() + CoveragePoller.CLUE_AUDIO_POLL_MS
        refresh()
        if (r.queued == 0) "Every sentence already has audio."
        else "Queued audio for ${r.queued} sentences. ${"%,d".format(r.remaining)} still without it. They fill in over the next few minutes."
    }

    /** "Sync to this device": the Lab pulls sentence sets in every sync. */
    fun syncHere() = act("Pulling new sentences down…") {
        val before = _ui.value.local?.sentences ?: 0
        app.repo.sync()
        val err = app.repo.status.value.error
        loadLocal()
        refresh()
        val pulled = (_ui.value.local?.sentences ?: 0) - before
        when {
            err != null -> "Sync failed: $err"
            pulled <= 0 -> "Already up to date on this device."
            else -> "Pulled ${"%,d".format(pulled)} sentences down to this device."
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = SentenceCoverageViewModel(app) as T
    }

    companion object {
        const val KEY = "settings/sentence-coverage"
    }
}

class CoverageActions(
    val onBack: () -> Unit = {},
    val generate: (Int) -> Unit = {},
    val clueAudio: () -> Unit = {},
    val syncHere: () -> Unit = {},
    val openDeck: (String) -> Unit = {},
    val retry: () -> Unit = {},
)

private fun pct(value: Int, total: Int): Int = if (total <= 0) 0 else Js.round(value.toDouble() / total * 100).toInt()
private fun n(v: Int) = "%,d".format(v)

/** `/settings/sentences` — where the example sentences are up to (web: SentenceCoveragePage). */
@Composable
fun SentenceCoverageScreen(ui: CoverageUi, online: Boolean, actions: CoverageActions, nowMs: Long = System.currentTimeMillis()) {
    LabScreen(title = "Example Sentences", onBack = actions.onBack) {
        val s = ui.stats
        if (ui.error != null) item { InlineNotice(ui.error, kind = if (online) NoticeKind.Error else NoticeKind.Offline, actionLabel = "Retry", onAction = actions.retry) }
        if (s == null) {
            if (ui.loading) item { LoadingState() }
            return@LabScreen
        }
        val missingClueAudio = s.notes.with_clue - s.notes.with_clue_audio
        val missingAudio = missingClueAudio + (s.sentences.total - s.sentences.with_audio)
        item {
            SettingsSection(
                "Coverage",
                "${n(s.notes.total)} words · ${n(s.cards.total)} cards (${n(s.cards.new)} new, ${n(s.cards.learning)} learning, ${n(s.cards.review)} review, ${n(s.cards.relearning)} relearning).",
            ) {
                CoverageBar(
                    "Sentence on the card", s.notes.with_clue, s.notes.total,
                    if (missingClueAudio > 0) "${n(missingClueAudio)} of those have no audio — their ▶ has nothing to play" else "all of those have audio",
                )
                CoverageBar(
                    "Full sentence set", s.notes.with_set, s.notes.total,
                    if (s.notes.with_set > s.notes.with_full_set) "${n(s.notes.with_set - s.notes.with_full_set)} of those came back short (fewer than 5 sentences)" else null,
                    Palette.Secondary,
                )
                CoverageBar("Word audio", s.notes.with_note_audio, s.notes.total, "TTS for the word itself")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Fact(n(s.notes.total - s.notes.with_set), "words with no set", Modifier.weight(1f))
                    Fact(n(s.sentences.total), "sentences generated", Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Fact(n(s.sentences.total - s.sentences.with_audio), "missing audio", Modifier.weight(1f))
                    Fact(n(s.sentences.with_explanation), "breakdowns cached", Modifier.weight(1f))
                }
            }
        }
        item {
            SettingsSection(
                "Background generation",
                "Sets are written by a queue on the server — the app tops it up once an hour while syncing, and failing a card starts that word's set immediately. Use these to push a batch through now.",
            ) {
                ChipRow {
                    StatusPill("${s.jobs.queued} in the queue", Palette.Easy)
                    StatusPill("${s.jobs.done} generated", Palette.Good)
                    if (s.jobs.error > 0) StatusPill("${s.jobs.error} failed", Palette.Again)
                    if (s.jobs.stale_queued > 0) StatusPill("${s.jobs.stale_queued} stuck (will retry)", Palette.Hard)
                    if (s.jobs.exhausted > 0) StatusPill("${s.jobs.exhausted} given up on", Palette.Again)
                }
                val enabled = !ui.busy && online
                ChipRow {
                    PrimaryPill("Generate 20 now", enabled = enabled) { actions.generate(20) }
                    SecondaryPill("Generate 100", enabled = enabled) { actions.generate(100) }
                    if (missingAudio > 0) SecondaryPill("Add audio to ${n(missingAudio)} sentences", enabled = enabled, onClick = actions.clueAudio)
                    SecondaryPill("Sync to this device", enabled = enabled, onClick = actions.syncHere)
                }
                if (!online) StatusLine("Requires internet connection.")
                StatusLine(ui.status)
                ui.local?.let { l ->
                    Text(
                        "On this device: ${n(l.notes)} words · ${n(l.sentences)} sentences cached for offline study" +
                            (if (l.lastSyncAt > 0) " · last synced ${timeAgo(Js.toIsoString(l.lastSyncAt), nowMs)}" else " · never synced") + ".",
                        style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                    )
                }
            }
        }
        if (s.recent_errors.isNotEmpty()) item {
            SettingsSection("Failures", "Words whose generation errored. Three attempts and a word is left alone; the rest get picked up by a later sweep.") {
                s.recent_errors.forEach { e ->
                    Column(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(e.hanzi, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                            Text("attempt ${e.attempts} · ${timeAgo(e.updated_at, nowMs)}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                        }
                        e.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.Again, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
        if (s.decks.isNotEmpty()) item {
            Column {
                Text("By deck", style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted, modifier = Modifier.padding(start = 4.dp, top = 8.dp, bottom = 6.dp))
                LabCard {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                        Text("Deck", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.weight(1f))
                        listOf("Words", "Card", "Set").forEach { Text(it, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.width(56.dp)) }
                    }
                    s.decks.forEach { d ->
                        RowDivider()
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { actions.openDeck(d.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(d.name, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            Text(n(d.notes), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.width(56.dp))
                            Text("${pct(d.with_clue, d.notes)}%", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.width(56.dp))
                            val set = pct(d.with_set, d.notes)
                            Text("$set%", style = MaterialTheme.typography.bodyMedium, fontWeight = if (set == 100) FontWeight.Bold else FontWeight.Normal, color = if (set == 100) Palette.Good else Lab.colors.ink, modifier = Modifier.width(56.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CoverageBar(label: String, value: Int, total: Int, hint: String?, color: Color = Palette.Easy) {
    val percent = pct(value, total)
    val grow = rememberAppear(800)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row {
            Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            Text("$percent% · ${n(value)} / ${n(total)}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().heightIn(min = 10.dp).clip(RoundedCornerShape(50)).background(Lab.colors.faint)) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth(percent / 100f * grow.value).heightIn(min = 10.dp).clip(RoundedCornerShape(50)).background(color))
        }
        if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}

@Composable
private fun Fact(value: String, label: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(12.dp)) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
        Text(label, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
    }
}
