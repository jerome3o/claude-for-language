package dev.jeromeswannack.chineselearning.lab.data.readers

import dev.jeromeswannack.chineselearning.lab.core.DailyReader
import dev.jeromeswannack.chineselearning.lab.core.ItemEvent
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.ReaderSchedule
import dev.jeromeswannack.chineselearning.lab.core.RevisitState
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.time.ZoneId
import java.util.UUID

/**
 * A cached reader with its reviews. A story is read ONCE, never repeated (core [DailyReader],
 * shared/study/daily-reader.ts): [read] = it has a review event (Finish, or listened to the end).
 */
data class ReaderEntry(
    val reader: GradedReaderDto,
    val events: List<ItemEvent>,
) {
    val id: String get() = reader.id
    val read: Boolean get() = events.isNotEmpty()
    /** The last time it was finished (ISO), null while unread. */
    val lastReadAt: String? get() = events.maxOfOrNull { it.at }
    /** NEW while unread, then "scheduled" with no due date = read (never offered again). */
    val state: RevisitState get() = ReaderSchedule.state(events)
    val item: ScheduledItem get() = ScheduledItem(reader.id, reader.createdAt, state, reader.studyable)
}

@Serializable
private data class Cursor(val since: String, val afterId: String = "")

/**
 * Graded readers offline — the web's services/readerSync.ts + reader-study.ts on the Lab
 * platform: the readers (with pages) in the JsonCache, review events merged from the server
 * (`GET /api/reader-reviews`, cursor-paged) and made here (sent through the Outbox,
 * idempotent by id), read once — one UNREAD reader a day, never a repeat ([DailyReader]) —,
 * illustrations and EVERY page's narration of the next unread story cached for the train
 * (listen-first: ▶ Play whole story works offline).
 */
class ReaderStore(private val cache: JsonCache, private val outbox: Outbox, private val api: Api) {
    private val filesDir: File = outbox.dir.parentFile ?: outbox.dir
    val media = LessonMedia(filesDir, api)
    private val homework = HomeworkLink(cache, outbox)
    private val listSerializer = ListSerializer(GradedReaderDto.serializer())
    private val eventsSerializer = ListSerializer(ReaderReviewDto.serializer())

    fun observe(): Flow<List<ReaderEntry>> =
        combine(cache.observe(LIST, listSerializer), cache.observe(EVENTS, eventsSerializer)) { list, events ->
            merge(list.orEmpty(), events.orEmpty())
        }.flowOn(Dispatchers.Default)

    suspend fun hasCache(): Boolean = cache.entry(LIST) != null

    suspend fun entries(): List<ReaderEntry> {
        val list = cache.get(LIST, listSerializer).orEmpty()
        val events = events()
        return withContext(Dispatchers.Default) { merge(list, events) }
    }

    suspend fun entry(id: String): ReaderEntry? = entries().firstOrNull { it.id == id }

    private suspend fun events(): List<ReaderReviewDto> = cache.get(EVENTS, eventsSerializer).orEmpty()

    private fun merge(list: List<GradedReaderDto>, events: List<ReaderReviewDto>): List<ReaderEntry> {
        val byReader = events.groupBy { it.readerId }
        return list.map { r ->
            ReaderEntry(r, byReader[r.id].orEmpty().map { ItemEvent(it.id, it.readerId, it.rating, it.reviewedAt) })
        }
    }

    /** Readers assigned as one-off homework only (read in the homework pass, never in the rotation). */
    suspend fun oneOffOnly(): Set<String> = homework.oneOffOnly()

    /** The session's rotation (one-off homework readers are read in the homework pass) and whether one was read today. */
    private suspend fun rotation(nowMs: Long, zone: ZoneId): Pair<List<ReaderEntry>, Boolean> {
        val oneOff = homework.oneOffOnly()
        val all = entries().filter { it.id !in oneOff }
        val readToday = ReaderSchedule.readToday(all.flatMap { it.events }, nowMs, zone)
        return all to readToday.isNotEmpty()
    }

    private fun offer(e: ReaderEntry) = dev.jeromeswannack.chineselearning.lab.core.ReaderOffer(e.id, e.reader.createdAt, e.reader.studyable, e.read)

    /** `getDueReaders`: at most one — the newest UNREAD story, nothing once one was read today. */
    suspend fun todaysReader(nowMs: Long, @Suppress("UNUSED_PARAMETER") cutoff: StudyCutoff, zone: ZoneId): ReaderEntry? {
        val (all, readToday) = rotation(nowMs, zone)
        return DailyReader.pickTodays(all, readToday, ::offer)
    }

    /** `nextUnreadReader`: the story offered next — today, or tomorrow once today's was read (its narration is prefetched). */
    suspend fun nextUnread(nowMs: Long, zone: ZoneId): ReaderEntry? = DailyReader.nextUnread(rotation(nowMs, zone).first, ::offer)

    /**
     * `recordReaderFinish`: append the event (a finish is stored as Good), queue it for upload,
     * mark homework done. The story is read — it never comes back. [how] = finish | listened.
     */
    suspend fun finish(
        readerId: String,
        timeSpentMs: Long,
        how: String = "finish",
        nowMs: Long = System.currentTimeMillis(),
    ): Unit = lock.withLock {
        val pages = cache.get(LIST, listSerializer)?.firstOrNull { it.id == readerId }?.pages?.size
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("reader.finish", mapOf("how" to how, "pages" to pages))
        val now = Js.toIsoString(nowMs)
        val event = ReaderReviewDto(UUID.randomUUID().toString(), readerId, Rating.GOOD, timeSpentMs, now)
        cache.put(EVENTS, KIND, events() + event, eventsSerializer)
        outbox.enqueueJson("reader-reviews", "POST", "/api/reader-reviews", ReaderReviewsUpload(listOf(event.copy(createdAt = null))), id = event.id)
        homework.recordDone("reader", readerId)
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
     * `ensureDailyReader` (`shouldGenerateDailyReader`): nothing while an unread story is waiting
     * (the session keeps offering it) or one was read today; otherwise ask the server — at most
     * once per local day — for a new story. True while one is being generated.
     */
    suspend fun ensureDaily(dueNoteIds: List<String>, nowMs: Long, @Suppress("UNUSED_PARAMETER") cutoff: StudyCutoff, zone: ZoneId, online: Boolean): Boolean {
        if (!online) return false
        val (all, readToday) = rotation(nowMs, zone)
        val today = java.time.Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().toString()
        val hasUnread = DailyReader.nextUnread(all, ::offer) != null
        if (!DailyReader.shouldGenerate(readToday, hasUnread, cache.get<String>(ATTEMPT), today)) return false
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

    /** Every page's narration of [reader] on the phone (`cacheReaderNarration`): how many pages have audio. */
    suspend fun cacheNarration(reader: GradedReaderDto, online: Boolean): Int = reader.pages.count { pageAudio(it, online) != null }

    /**
     * `prefetchReaderMedia`: every existing illustration; the next unread story's narration
     * (EVERY page — listen-first, so the whole story plays offline as soon as it exists), then
     * its missing illustrations.
     */
    suspend fun prefetchMedia(nowMs: Long, @Suppress("UNUSED_PARAMETER") cutoff: StudyCutoff, zone: ZoneId) {
        for (r in entries()) for (p in r.reader.pages) if (p.imageUrl != null) media.image(p.imageUrl, online = true)
        val next = nextUnread(nowMs, zone) ?: return
        cacheNarration(next.reader, online = true)
        for (p in next.reader.pages) pageImage(next.id, p, online = true)
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
