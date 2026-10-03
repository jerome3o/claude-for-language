package dev.jeromeswannack.chineselearning.lab.data.readers

import dev.jeromeswannack.chineselearning.lab.core.ComputedCardState
import dev.jeromeswannack.chineselearning.lab.core.ItemEvent
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReaderSchedule
import dev.jeromeswannack.chineselearning.lab.core.ScheduledItem
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderReviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderReviewsUpload
import dev.jeromeswannack.chineselearning.lab.data.api.dailyReader
import dev.jeromeswannack.chineselearning.lab.data.api.deleteReader
import dev.jeromeswannack.chineselearning.lab.data.api.generatePageImage
import dev.jeromeswannack.chineselearning.lab.data.api.readerReviews
import dev.jeromeswannack.chineselearning.lab.data.api.PageWordsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplainBody
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.api.backfillReaderWords
import dev.jeromeswannack.chineselearning.lab.data.api.explainReaderWord
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.data.api.readersWithPages
import dev.jeromeswannack.chineselearning.lab.data.api.retryReader
import dev.jeromeswannack.chineselearning.lab.data.lessons.HomeworkLink
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonMedia
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.time.ZoneId
import java.util.UUID

/** A cached reader with its replayed FSRS state. */
data class ReaderEntry(val reader: GradedReaderDto, val events: List<ItemEvent>, val state: ComputedCardState) {
    val id: String get() = reader.id
    val item: ScheduledItem get() = ScheduledItem(reader.id, reader.createdAt, state, reader.studyable)
}

@Serializable
private data class Cursor(val since: String, val afterId: String = "")

/**
 * Graded readers offline — the web's services/readerSync.ts + reader-study.ts on the Lab
 * platform: the readers (with pages) in the JsonCache, review events merged from the server
 * (`GET /api/reader-reviews`, cursor-paged) and made here (sent through the Outbox,
 * idempotent by id), scheduling replayed from them, one reader a day, illustrations and
 * page narration cached for the train.
 */
class ReaderStore(private val cache: JsonCache, private val outbox: Outbox, private val api: Api) {
    private val filesDir: File = outbox.dir.parentFile ?: outbox.dir
    val media = LessonMedia(filesDir, api)
    private val homework = HomeworkLink(cache, outbox)
    private val listSerializer = ListSerializer(GradedReaderDto.serializer())
    private val eventsSerializer = ListSerializer(ReaderReviewDto.serializer())

    fun observe(): Flow<List<ReaderEntry>> =
        combine(cache.observe(LIST, listSerializer), cache.observe(EVENTS, eventsSerializer)) { list, events -> merge(list.orEmpty(), events.orEmpty()) }

    suspend fun hasCache(): Boolean = cache.entry(LIST) != null

    suspend fun entries(): List<ReaderEntry> = merge(cache.get(LIST, listSerializer).orEmpty(), events())

    suspend fun entry(id: String): ReaderEntry? = entries().firstOrNull { it.id == id }

    private suspend fun events(): List<ReaderReviewDto> = cache.get(EVENTS, eventsSerializer).orEmpty()

    private fun merge(list: List<GradedReaderDto>, events: List<ReaderReviewDto>): List<ReaderEntry> {
        val byReader = events.groupBy { it.readerId }
        return list.map { r ->
            val ev = byReader[r.id].orEmpty().map { ItemEvent(it.id, it.readerId, it.rating, it.reviewedAt) }
            ReaderEntry(r, ev, ItemSchedule.state(ev))
        }
    }

    /** `getDueReaders`: at most one — today's reader (one-off homework readers stay out). */
    suspend fun todaysReader(nowMs: Long, cutoff: StudyCutoff, zone: ZoneId): ReaderEntry? {
        val all = entries()
        val oneOff = homework.oneOffOnly()
        val readToday = ReaderSchedule.readToday(all.flatMap { it.events }, nowMs, zone)
        val picked = ReaderSchedule.pickTodays(all.filter { it.id !in oneOff }.map { it.item }, readToday, cutoff) ?: return null
        return all.firstOrNull { it.id == picked.id }
    }

    /**
     * `recordReaderReview`: append the event, queue it for upload, mark homework done.
     * Returns the new state (a reader rated back into learning stays in the session).
     */
    suspend fun rate(readerId: String, rating: Int, timeSpentMs: Long, nowMs: Long = System.currentTimeMillis()): ComputedCardState = lock.withLock {
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("reader.finish", mapOf("rating" to listOf("again", "hard", "good", "easy").getOrNull(rating)))
        val now = Js.toIsoString(nowMs)
        val before = events().filter { it.readerId == readerId }.map { ItemEvent(it.id, it.readerId, it.rating, it.reviewedAt) }
        val state = ItemSchedule.afterRating(before, rating, now)
        val event = ReaderReviewDto(UUID.randomUUID().toString(), readerId, rating, timeSpentMs, now)
        cache.put(EVENTS, KIND, events() + event, eventsSerializer)
        outbox.enqueueJson("reader-reviews", "POST", "/api/reader-reviews", ReaderReviewsUpload(listOf(event.copy(createdAt = null))), id = event.id)
        homework.recordDone("reader", readerId)
        state
    }

    /** A page illustration generated on demand, kept on the cached reader (`updateLocalReaderPageImage`). */
    suspend fun pageImage(readerId: String, page: ReaderPageDto, online: Boolean): File? {
        media.cachedImage(page.imageUrl)?.let { return it }
        if (!online) return null
        val key = page.imageUrl ?: run {
            if (page.imagePrompt.isNullOrBlank()) return null
            val generated = runCatching { api.generatePageImage(readerId, page.id).image_url }.getOrNull() ?: return null
            setPageImage(readerId, page.id, generated)
            generated
        }
        return media.image(key, online = true)
    }

    private suspend fun setPageImage(readerId: String, pageId: String, key: String) = lock.withLock {
        val list = cache.get(LIST, listSerializer).orEmpty()
        cache.put(LIST, KIND, list.map { r -> if (r.id != readerId) r else r.copy(pages = r.pages.map { if (it.id == pageId) it.copy(imageUrl = key) else it }) }, listSerializer)
    }

    /** `readerTtsKey`: page id + a hash of the text and voice, at the reader speed. */
    fun pageTtsKey(page: ReaderPageDto): String {
        var hash = 5381L
        for (c in "${page.contentChinese}|${LessonMedia.DEFAULT_VOICE}") hash = ((hash shl 5) + hash + c.code) and 0xFFFFFFFFL
        return "reader-tts/${page.id}/${java.lang.Long.toString(hash, 36)}-x$READER_TTS_SPEED"
    }

    /** `getReaderPageTTS`: cached page narration, generated when online. */
    suspend fun pageAudio(page: ReaderPageDto, online: Boolean, regenerate: Boolean = false): File? =
        media.tts(page.contentChinese, null, READER_TTS_SPEED, pageTtsKey(page), online, regenerate)

    /**
     * A page's word chips (`useReaderPageWords`): the page's own words when they came with the
     * sync, else asked for (`POST /api/reader-words/backfill`, the reader's pages at once) and
     * kept on the cached reader so they stay tappable offline. Null until then — plain text.
     */
    suspend fun words(readerId: String, page: ReaderPageDto, online: Boolean): List<ReaderWordDto>? {
        page.currentWords()?.let { return it }
        cachedPage(readerId, page.id)?.takeIf { it.contentChinese == page.contentChinese }?.currentWords()?.let { return it }
        sessionWords[page.id]?.takeIf { ReaderWords.matches(it.map { w -> w.text }, page.contentChinese) }?.let { return it }
        if (!online) return null
        backfillWords(readerId)
        return sessionWords[page.id]?.takeIf { ReaderWords.matches(it.map { w -> w.text }, page.contentChinese) }
    }

    private suspend fun cachedPage(readerId: String, pageId: String): ReaderPageDto? =
        cache.get(LIST, listSerializer)?.firstOrNull { it.id == readerId }?.pages?.firstOrNull { it.id == pageId }

    /** Words made this session, for a reader that isn't cached yet. */
    private val sessionWords = java.util.concurrent.ConcurrentHashMap<String, List<ReaderWordDto>>()
    private val backfillLock = Mutex()

    /** One backfill call (deduplicated): stores what it made on the cached readers. Returns `remaining`, or null on failure. */
    suspend fun backfillWords(readerId: String?): Int? = backfillLock.withLock {
        val res = runCatching { api.backfillReaderWords(readerId) }.getOrElse { e ->
            if (e is kotlinx.coroutines.CancellationException) throw e
            return@withLock null
        }
        for (p in res.pages) sessionWords[p.id] = p.words
        if (res.pages.isNotEmpty()) storeWords(res.pages)
        res.remaining
    }

    private suspend fun storeWords(made: List<PageWordsDto>) = lock.withLock {
        val byPage = made.associateBy { it.id }
        val list = cache.get(LIST, listSerializer) ?: return@withLock
        cache.put(LIST, KIND, list.map { r ->
            if (r.pages.none { it.id in byPage }) r
            else r.copy(pages = r.pages.map { pg ->
                val w = byPage[pg.id]?.words
                if (w != null && ReaderWords.matches(w.map { it.text }, pg.contentChinese)) pg.copy(words = w) else pg
            })
        }, listSerializer)
    }

    /** Part of every sync (`backfillReaderWordsInSync`): a couple of calls, then hourly once none remain. */
    suspend fun backfillWordsInSync(maxCalls: Int = 2) {
        if (cache.isFresh(WORDS_DONE, 60 * 60 * 1000L)) return
        repeat(maxCalls) {
            val remaining = backfillWords(null) ?: return
            if (remaining <= 0) {
                cache.put(WORDS_DONE, KIND, true)
                return
            }
        }
    }

    /** "More about this word": the device cache first (works offline), else Haiku on the server. */
    suspend fun explainWord(word: String, sentence: String, pinyin: String?, gloss: String?): ReaderWordExplanationDto {
        val key = "readers/word-explain/$word|$sentence"
        cache.get(key, ReaderWordExplanationDto.serializer())?.let { return it }
        val fresh = api.explainReaderWord(ReaderWordExplainBody(word, sentence, pinyin?.ifBlank { null }, gloss?.ifBlank { null }))
        cache.put(key, KIND, fresh, ReaderWordExplanationDto.serializer())
        return fresh
    }

    /** The cached explanation, if this phone has one. */
    suspend fun cachedExplanation(word: String, sentence: String): ReaderWordExplanationDto? =
        cache.get("readers/word-explain/$word|$sentence", ReaderWordExplanationDto.serializer())

    suspend fun delete(id: String) {
        api.deleteReader(id)
        lock.withLock {
            cache.put(LIST, KIND, cache.get(LIST, listSerializer).orEmpty().filter { it.id != id }, listSerializer)
        }
    }

    suspend fun retry(id: String) {
        val r = api.retryReader(id)
        lock.withLock {
            cache.put(LIST, KIND, cache.get(LIST, listSerializer).orEmpty().map { if (it.id == id) it.copy(status = r.status, errorMessage = null) else it }, listSerializer)
        }
    }

    /**
     * `ensureDailyReader`: nothing while today already has a reader; otherwise ask the server
     * (once per local day) for today's story. True while one is being generated.
     */
    suspend fun ensureDaily(dueNoteIds: List<String>, nowMs: Long, cutoff: StudyCutoff, zone: ZoneId, online: Boolean): Boolean {
        if (!online) return false
        val all = entries()
        val readToday = ReaderSchedule.readToday(all.flatMap { it.events }, nowMs, zone)
        if (readToday.isNotEmpty() || ReaderSchedule.pickTodays(all.map { it.item }, readToday, cutoff) != null) return false
        val today = java.time.Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().toString()
        if (cache.get<String>(ATTEMPT) == today) return false
        cache.put(ATTEMPT, KIND, today)
        return try {
            val status = api.dailyReader(dueNoteIds, today)
            when (status.status) {
                "generating" -> true
                "ready" -> { refresh(); false }
                else -> false
            }
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            false
        }
    }

    /** The readers list (with pages); readers deleted on the server take their events with them. */
    suspend fun refresh() {
        val list = api.readersWithPages()
        lock.withLock {
            cache.put(LIST, KIND, list, listSerializer)
            val ids = list.mapTo(HashSet()) { it.id }
            val pending = outbox.all().filter { it.kind == "reader-reviews" && it.state == Outbox.PENDING }.mapTo(HashSet()) { it.id }
            val events = events()
            val kept = events.filter { it.readerId in ids || it.id in pending }
            if (kept.size != events.size) cache.put(EVENTS, KIND, kept, eventsSerializer)
        }
    }

    /** `downloadReaderReviewEvents`: other devices' events, cursor-paged. */
    suspend fun downloadEvents() {
        var cursor = cache.get(CURSOR, Cursor.serializer()) ?: Cursor("1970-01-01 00:00:00")
        repeat(MAX_PAGES) {
            val page = api.readerReviews(cursor.since, cursor.afterId)
            if (page.events.isEmpty()) return
            lock.withLock {
                val have = events()
                val known = have.mapTo(HashSet()) { it.id }
                val fresh = page.events.filter { it.id !in known }
                if (fresh.isNotEmpty()) cache.put(EVENTS, KIND, have + fresh, eventsSerializer)
            }
            val last = page.events.last()
            val next = Cursor(last.createdAt ?: last.reviewedAt, last.id)
            if (next == cursor) return
            cursor = next
            cache.put(CURSOR, KIND, cursor, Cursor.serializer())
            if (!page.hasMore) return
        }
    }

    /** `prefetchReaderMedia`: every existing illustration; today's reader's missing ones and its narration. */
    suspend fun prefetchMedia(nowMs: Long, cutoff: StudyCutoff, zone: ZoneId) {
        for (r in entries()) for (p in r.reader.pages) if (p.imageUrl != null) media.image(p.imageUrl, online = true)
        val today = todaysReader(nowMs, cutoff, zone) ?: return
        for (p in today.reader.pages) {
            pageImage(today.id, p, online = true)
            pageAudio(p, online = true)
        }
    }

    /** The whole sync step: events down, readers, media (uploads went through the Outbox first). */
    suspend fun sync(zone: ZoneId = ZoneId.systemDefault(), prefetch: Boolean = true) {
        downloadEvents()
        refresh()
        runCatching { backfillWordsInSync() }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
        if (prefetch) {
            val now = System.currentTimeMillis()
            prefetchMedia(now, dev.jeromeswannack.chineselearning.lab.core.StudyQueue.cutoff(now, zone), zone)
        }
    }

    companion object {
        const val KIND = "readers"
        const val LIST = "readers/list"
        const val EVENTS = "readers/events"
        private const val CURSOR = "readers/cursor"
        private const val ATTEMPT = "readers/daily-attempt"
        private const val WORDS_DONE = "readers/words-backfill-done"
        /** READER_TTS_SPEED. */
        const val READER_TTS_SPEED = 0.6
        private const val MAX_PAGES = 100
        private val lock = Mutex()
    }
}
