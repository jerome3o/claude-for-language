package dev.jeromeswannack.chineselearning.lab.data.sentences

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceEventDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceEventsBody
import dev.jeromeswannack.chineselearning.lab.data.api.sentencePracticeSince
import dev.jeromeswannack.chineselearning.lab.data.api.topUpSentences
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.coroutines.delay
import java.time.Instant
import java.util.UUID

/**
 * Practice per example sentence on the phone (the web's services/sentencePractice.ts; rules in core
 * [SentenceHistory]; docs/STUDY_SESSION.md "Sentence practice history"). Every 🎤 take on a sentence (the
 * Sentence round, the answer side's rows) and every "Stop showing this sentence" / "Show again" is an
 * event: kept in the JsonCache (`sentences/practice`), uploaded through the Outbox
 * (`POST /api/me/sentence-practice`, one client id each — idempotent), and every device's events come down
 * after a cursor in [Sync]. [events] feeds the round's picks and the hidden rows.
 *
 * Fresh sentences: the Sentence round asks sentences he has never practised first and keeps a buffer of them
 * (core [SentenceHistory.moreWanted]) — fewer than six fresh (or four left) asks the sentence top-up for more
 * ([requestMore], at most every ten minutes per word, [SentenceTopUps]); the new rows + clips are pulled a little
 * later; offline the ask waits for the next sync. "✨ New sentences coming" only when the round itself is short.
 */
object SentencePracticeStore {
    private const val KEY = "sentences/practice"
    private const val KIND = "sentence-practice"

    @Serializable
    data class Doc(val events: List<SentenceEventDto> = emptyList(), val cursor: String? = null)

    private val lock = Mutex()
    private val _events = MutableStateFlow<List<SentenceHistory.Event>?>(null)
    /** Every event on the phone (null until read once). */
    val events: StateFlow<List<SentenceHistory.Event>?> = _events

    private fun SentenceEventDto.core() = SentenceHistory.Event(id, note_id, sentence_key, kind, mode, result, reason, at)

    private suspend fun read(cache: JsonCache): Doc = runCatching { cache.get<Doc>(KEY) }.getOrNull() ?: Doc()

    /** For [Sync]'s waiting asks (the sync step has no Context). */
    @Volatile private var appContext: Context? = null

    /** Loads the events into [events] (once). */
    suspend fun load(app: LabApp) {
        appContext = app.applicationContext
        if (_events.value != null) return
        lock.withLock { _events.value = read(app.cache).events.map { it.core() } }
    }

    /** No store to read (previews, tests): nothing practised yet. */
    fun markEmpty() {
        if (_events.value == null) _events.value = emptyList()
    }

    private suspend fun merge(cache: JsonCache, add: List<SentenceEventDto>, cursor: String? = null) = lock.withLock {
        val doc = read(cache)
        val known = doc.events.map { it.id }.toHashSet()
        val next = Doc(doc.events + add.filter { known.add(it.id) }, cursor ?: doc.cursor)
        cache.put(KEY, KIND, next)
        _events.value = next.events.map { it.core() }
    }

    private fun add(app: LabApp, noteId: String, rowKey: String, kind: String, mode: String? = null, result: String? = null, reason: String? = null) {
        val e = SentenceEventDto(UUID.randomUUID().toString(), noteId, SentenceHistory.key(rowKey), kind, mode, result, reason, Instant.now().toString())
        app.scope.launch {
            runCatching {
                merge(app.cache, listOf(e))
                app.outbox.enqueueJson("sentence-practice", "POST", "/api/me/sentence-practice", SentenceEventsBody(listOf(e)), id = e.id)
                if (app.online.value) app.outbox.drain() else app.scheduleBackgroundUpload()
            }
        }
    }

    /** A 🎤 take on a sentence was judged right / close / wrong (round or row). */
    fun recordAttempt(app: LabApp, noteId: String, rowKey: String, mode: String, result: String) {
        if (result != "right" && result != "close" && result != "wrong") return
        add(app, noteId, rowKey, "attempt", mode = mode, result = result)
    }

    /** "Stop showing this sentence". */
    fun hide(app: LabApp, noteId: String, rowKey: String, reason: String, where: String) {
        Analytics.track("study.sentence_hidden", mapOf("reason" to reason, "where" to where, "unhidden" to false))
        add(app, noteId, rowKey, "hide", reason = reason)
    }

    /** "Show again" / Undo. */
    fun unhide(app: LabApp, noteId: String, rowKey: String, where: String) {
        Analytics.track("study.sentence_hidden", mapOf("where" to where, "unhidden" to true))
        add(app, noteId, rowKey, "unhide")
    }

    /** One note's stats (core [SentenceHistory.stats]). */
    fun stats(all: List<SentenceHistory.Event>?, noteId: String): Map<String, SentenceHistory.Stats> =
        SentenceHistory.stats(all.orEmpty(), noteId)

    // --- more sentences: the fresh buffer -----------------------------------------------------------

    @Volatile private var topUps: SentenceTopUps? = null
    private fun topUps(context: Context): SentenceTopUps = topUps ?: synchronized(this) {
        topUps ?: SentenceTopUps(context.getSharedPreferences(SentenceTopUps.PREFS, Context.MODE_PRIVATE)).also { topUps = it }
    }

    /**
     * Ask for more sentences for this word (`requestMoreSentences`; [reason] / [count] from core
     * [SentenceHistory.moreWanted]): at most every ten minutes per word; offline → the next sync.
     */
    fun requestMore(app: LabApp, noteId: String, reason: String, count: Int) {
        appContext = app.applicationContext
        val want = SentenceTopUps.Want(reason, count)
        val t = topUps(app)
        when (t.claim(noteId, want, app.online.value)) {
            SentenceTopUps.Decision.SKIP -> return
            SentenceTopUps.Decision.QUEUE ->
                Analytics.track("study.sentence_topup_requested", mapOf("why" to reason, "count" to count, "queued" to false))
            SentenceTopUps.Decision.SEND -> {
                Analytics.track("study.sentence_topup_requested", mapOf("why" to reason, "count" to count, "queued" to true))
                app.scope.launch {
                    runCatching { app.repo.api.topUpSentences(listOf(noteId), reason, mapOf(noteId to count)) }
                        .onSuccess { pullNewSentencesSoon(app, listOf(noteId)) }
                        .onFailure { t.failed(noteId, want) }
                }
            }
        }
    }

    /** `pullNewSentencesSoon`: when the new rows are pulled after an ask (the server writes them in well under a minute). */
    val PULL_DELAYS_MS = listOf(45_000L, 150_000L)

    /**
     * The new rows come down with the next sync; pull them a little after the ask instead and download their
     * clips, so the round's buffer plays offline. Best-effort.
     */
    private fun pullNewSentencesSoon(app: LabApp, noteIds: List<String>) {
        for (wait in PULL_DELAYS_MS) {
            app.scope.launch {
                delay(wait)
                runCatching {
                    app.repo.pullSentenceChanges()
                    for (id in noteIds) for (row in app.repo.dao.sentencesFor(id)) {
                        val url = row.audioUrl?.takeIf { it.isNotBlank() } ?: continue
                        if (app.repo.cachedAudio(url) == null) runCatching { app.repo.cacheClip(url) }
                    }
                }
            }
        }
    }

    /** After each sync: this device's events went up with the Outbox; every device's come down; waiting asks go. */
    object Sync : FeatureSync {
        override suspend fun sync(ctx: SyncContext) {
            var cursor = runCatching { ctx.cache.get<Doc>(KEY) }.getOrNull()?.cursor
            for (page in 0 until 20) {
                val res = ctx.api.sentencePracticeSince(cursor)
                if (res.events.isNotEmpty() || res.cursor != cursor) merge(ctx.cache, res.events, res.cursor)
                cursor = res.cursor ?: cursor
                if (!res.more) break
            }
            val context = appContext ?: return
            val sent = topUps(context).flush { ids, reason, counts -> ctx.api.topUpSentences(ids, reason, counts) }
            val app = context as? LabApp
            if (sent.isNotEmpty() && app != null) pullNewSentencesSoon(app, sent)
        }
    }
}
