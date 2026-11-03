package dev.jeromeswannack.chineselearning.lab.data.readers

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.ReadAloud
import dev.jeromeswannack.chineselearning.lab.core.ToneChange
import dev.jeromeswannack.chineselearning.lab.core.WordRecap
import dev.jeromeswannack.chineselearning.lab.core.WordRecapRun
import dev.jeromeswannack.chineselearning.lab.core.WordRecapWord
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.DeckDto
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.api.post
import dev.jeromeswannack.chineselearning.lab.data.api.DeckPaths
import dev.jeromeswannack.chineselearning.lab.data.api.EnrichWordIn
import dev.jeromeswannack.chineselearning.lab.data.api.GlossWordIn
import dev.jeromeswannack.chineselearning.lab.data.api.MoveDeckBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.UpNextAddBody
import dev.jeromeswannack.chineselearning.lab.data.api.addNotesBatch
import dev.jeromeswannack.chineselearning.lab.data.api.addUpNext
import dev.jeromeswannack.chineselearning.lab.data.api.createDeck
import dev.jeromeswannack.chineselearning.lab.data.api.enrichWords
import dev.jeromeswannack.chineselearning.lab.data.api.glossWords
import dev.jeromeswannack.chineselearning.lab.data.api.upNextPosition
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

/** A word switched to "Add to my long-term review", waiting to become a card (sent when online). */
@Serializable
data class PendingRecapAdd(val id: String, val reader_id: String, val word: WordRecapWord, val created_at: String)

/** The end-of-story offer ("📝 Recap N words"), shown over whatever comes next (ui/readers/WordRecapScreens.kt). */
data class RecapOffer(val readerId: String, val words: Int, val line: String)

/**
 * The reader word recap on the phone — the web's services/wordRecap.ts (docs/STUDY_SESSION.md
 * "Reader word recap"; rules in core [WordRecap]). ONE run per reader in the JsonCache
 * (`reader-recap/run/<readerId>`, kept across closes and days) and the words switched to "Add to my
 * long-term review" (`reader-recap/adds`), sent at once when online or by [Sync]: the "From my
 * readers" deck (made on first use, moved to the bottom of the deck queue), gloss / explanation via
 * gloss-words + enrich-words (the story sentence as the card's sentence when it is short enough),
 * one notes/batch (skip_existing — a resend never duplicates), then Up next. "⚡ Study it today" on a
 * word he already has = [BumpStore.bumpNotes] (offline-first).
 */
object WordRecapStore {
    /** Runs only (so `cache.observeAll(KIND)` reads them all); the queued adds have their own kind. */
    const val KIND = "reader-recap"
    private const val ADDS_KIND = "reader-recap-adds"
    private const val ADDS = "reader-recap-adds/list"
    fun runKey(readerId: String) = "reader-recap/run/$readerId"

    private val lock = Mutex()
    private fun now() = Instant.now().toString()

    private val _offer = MutableStateFlow<RecapOffer?>(null)
    val offer: StateFlow<RecapOffer?> = _offer.asStateFlow()
    fun offer(o: RecapOffer?) { _offer.value = o }

    suspend fun run(cache: JsonCache, readerId: String): WordRecapRun? = cache.get<WordRecapRun>(runKey(readerId))
    fun observe(cache: JsonCache, readerId: String): Flow<WordRecapRun?> = cache.observe<WordRecapRun>(runKey(readerId))

    /** Reader id → words of every run that can be recapped (the Readers list's "📝 Recap words from last read"). */
    fun observeAvailable(cache: JsonCache): Flow<Map<String, Int>> =
        cache.observeAll(KIND, WordRecapRun.serializer()).map { runs -> runs.filter(WordRecap::available).associate { it.reader_id to it.words.size } }

    /** One read-modify-write at a time. */
    suspend fun update(cache: JsonCache, readerId: String, fn: (WordRecapRun?) -> WordRecapRun?): WordRecapRun? = lock.withLock {
        val cur = runCatching { run(cache, readerId) }.getOrNull()
        val next = fn(cur)
        if (next != null && next != cur) cache.put(runKey(readerId), KIND, next)
        next
    }

    /** What one opening of a reading view collects (core [WordRecap.runFor] decides carry on vs new). */
    class Collector(private val app: LabApp, private val readerId: String, private val openedAt: String = Instant.now().toString()) {
        private fun add(fn: (WordRecapRun) -> WordRecapRun) {
            app.scope.launch {
                runCatching {
                    update(app.cache, readerId) { cur ->
                        val run = WordRecap.runFor(cur, readerId, openedAt, now())
                        val next = fn(run)
                        if (run !== cur && next.words.isEmpty()) cur else next
                    }
                }
            }
        }

        fun tap(t: WordRecap.Tap) = add { WordRecap.addTap(it, t, now()) }
        fun take(page: WordRecap.Page, result: ReadAloud.Result) = add { WordRecap.addMistakes(it, page, result, now()) }

        /** The story was finished: offer the recap when this reading has words. */
        fun finish() {
            app.scope.launch {
                var finished = false
                val run = runCatching {
                    update(app.cache, readerId) { cur ->
                        if (cur == null || cur.reader_id != readerId || (cur.finished_at != null && cur.finished_at!! <= openedAt)) cur
                        else { finished = true; WordRecap.finish(cur, now()) }
                    }
                }.getOrNull()
                if (finished && run != null && run.words.isNotEmpty()) offer(RecapOffer(readerId, run.words.size, WordRecap.promptLine(run)))
            }
        }
    }

    suspend fun answer(cache: JsonCache, readerId: String, key: String, right: Boolean) =
        update(cache, readerId) { it?.let { r -> WordRecap.answer(r, key, right, now(), UUID.randomUUID().toString()) } }

    suspend fun keep(cache: JsonCache, readerId: String, key: String, on: Boolean) =
        update(cache, readerId) { it?.let { r -> WordRecap.setKeep(r, key, on) } }

    suspend fun restart(cache: JsonCache, readerId: String) = update(cache, readerId) { it?.let(WordRecap::restart) }

    /** Recap key → note id of the words he already has. */
    suspend fun owned(app: LabApp, run: WordRecapRun): Map<String, String> = withContext(Dispatchers.IO) {
        val keys = run.words.map { WordRecap.key(it.hanzi) }.toHashSet()
        val out = HashMap<String, String>()
        for (n in app.repo.dao.allNotes()) {
            val k = WordRecap.key(n.hanzi)
            if (k in keys) out.putIfAbsent(k, n.id)
        }
        out
    }

    data class Outcome(val added: Int, val bumped: Int)

    /** Done: bump the switched-on words he has, queue the new ones (sent now when online), mark recapped. */
    suspend fun finishRecap(app: LabApp, readerId: String): Outcome {
        val run = run(app.cache, readerId) ?: return Outcome(0, 0)
        val owned = owned(app, run)
        val c = WordRecap.choices(run) { it in owned }
        if (c.bump.isNotEmpty()) runCatching { BumpStore.bumpNotes(app, c.bump.mapNotNull { owned[WordRecap.key(it.hanzi)] }, "reader") }
        if (c.add.isNotEmpty()) lock.withLock {
            val pending = app.cache.get<List<PendingRecapAdd>>(ADDS).orEmpty()
            val t = now()
            val fresh = c.add.map { PendingRecapAdd("$readerId:${WordRecap.key(it.hanzi)}", readerId, it, t) }
            val ids = fresh.map { it.id }.toHashSet()
            app.cache.put(ADDS, ADDS_KIND, pending.filter { it.id !in ids } + fresh)
        }
        update(app.cache, readerId) { it?.let { r -> WordRecap.markRecapped(r, now()) } }
        app.analytics.track(
            "reader.word_recap_finish",
            mapOf("words" to run.words.size, "got_it_first_time" to WordRecap.rightFirstTime(run), "added" to c.add.size, "bumped" to c.bump.size),
        )
        if (c.add.isNotEmpty() && app.online.value) app.scope.launch { runCatching { flush(app.repo.api, app.cache, app.repo.dao) } }
        return Outcome(c.add.size, c.bump.size)
    }

    private val flushing = Mutex()

    /** Send the queued words (online; idempotent by hanzi). Returns how many were sent. */
    suspend fun flush(api: Api, cache: JsonCache, dao: LabDao): Int = flushing.withLock {
        val rows = cache.get<List<PendingRecapAdd>>(ADDS).orEmpty()
        if (rows.isEmpty()) return 0
        val deckId = deckId(api, dao)
        val notes = rows.map { r ->
            val w = r.word
            val clue = WordRecap.sentenceClue(w)
            NoteFields(
                hanzi = w.hanzi,
                pinyin = w.pinyin.ifEmpty { ToneChange.autoPinyin(w.hanzi) },
                english = w.gloss,
                clue = clue,
                cluePinyin = if (clue.isNotEmpty()) ToneChange.autoPinyin(clue) else "",
            )
        }.toMutableList()
        if (notes.any { it.english.isEmpty() || it.pinyin.isEmpty() }) runCatching {
            val filled = api.glossWords(notes.map { GlossWordIn(it.hanzi, it.pinyin.ifEmpty { null }, it.english.ifEmpty { null }) })
            filled.forEachIndexed { i, f ->
                if (i < notes.size) notes[i] = notes[i].copy(english = notes[i].english.ifEmpty { f.english }, pinyin = notes[i].pinyin.ifEmpty { f.pinyin })
            }
        }
        for (start in notes.indices step 15) {
            val chunk = notes.subList(start, minOf(notes.size, start + 15))
            runCatching {
                val out = api.enrichWords(chunk.map { EnrichWordIn(it.hanzi, it.pinyin, it.english, sentence_clue = it.clue.ifEmpty { null }) })
                for (e in out) {
                    val i = notes.indexOfFirst { it.hanzi == e.hanzi }
                    if (i < 0) continue
                    var n = notes[i].copy(funFacts = e.fun_facts.orEmpty().ifEmpty { notes[i].funFacts })
                    if (n.clue.isEmpty() && !e.sentence_clue.isNullOrEmpty()) {
                        n = n.copy(clue = e.sentence_clue, cluePinyin = e.sentence_clue_pinyin.orEmpty(), clueTranslation = e.sentence_clue_translation.orEmpty())
                    }
                    notes[i] = n
                }
            }
        }
        val ready = notes.indices.filter { notes[it].english.isNotEmpty() && notes[it].pinyin.isNotEmpty() }
        if (ready.isEmpty()) return 0
        val result = api.addNotesBatch(deckId, ready.map { notes[it].body() }, skipExisting = true)
        val failed = result.failed.map { it.index }.toHashSet()
        val sent = ready.filterIndexed { i, _ -> i !in failed }.map { rows[it].id }.toHashSet()
        lock.withLock {
            val now = cache.get<List<PendingRecapAdd>>(ADDS).orEmpty()
            cache.put(ADDS, ADDS_KIND, now.filter { it.id !in sent })
        }
        val created = result.created.map { it.id }
        if (created.isNotEmpty()) runCatching { api.addUpNext(UpNextAddBody(note_ids = created, position = upNextPosition("bottom"), source = "reader_recap")) }
        sent.size
    }

    private data class NoteFields(
        val hanzi: String,
        val pinyin: String,
        val english: String,
        val funFacts: String = "",
        val clue: String = "",
        val cluePinyin: String = "",
        val clueTranslation: String = "",
    ) {
        fun body() = NewNoteBody(
            hanzi = hanzi, pinyin = pinyin, english = english,
            fun_facts = funFacts.ifEmpty { null },
            sentence_clue = clue.ifEmpty { null },
            sentence_clue_pinyin = cluePinyin.ifEmpty { null },
            sentence_clue_translation = clueTranslation.ifEmpty { null },
        )
    }

    private suspend fun deckId(api: Api, dao: LabDao): String {
        withContext(Dispatchers.IO) { dao.decks() }.firstOrNull { it.name == WordRecap.DECK }?.let { return it.id }
        api.decks().firstOrNull { it.name == WordRecap.DECK }?.let { return it.id }
        val deck = api.createDeck(WordRecap.DECK, WordRecap.DECK_DESCRIPTION)
        // Organisation only: the chosen words go on Up next, so the deck itself waits at the bottom.
        runCatching { api.post<MoveDeckBody, DeckDto>(DeckPaths.move(deck.id), MoveDeckBody("bottom")) }
        return deck.id
    }

    /** After every sync: words chosen while offline become cards. */
    val Sync = FeatureSync { ctx ->
        if (ctx.cache.get<List<PendingRecapAdd>>(ADDS).isNullOrEmpty()) return@FeatureSync
        flush(ctx.api, ctx.cache, ctx.db.dao())
    }

    /** How many words wait to become cards (Settings / tests). */
    suspend fun pending(cache: JsonCache): List<PendingRecapAdd> = cache.get<List<PendingRecapAdd>>(ADDS).orEmpty()
}
