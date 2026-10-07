package dev.jeromeswannack.chineselearning.lab.data

import dev.jeromeswannack.chineselearning.lab.data.noteLongTerm
import android.content.Context
import dev.jeromeswannack.chineselearning.lab.core.BuiltQueue
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.Introduced
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.core.WordFrequency
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream

/**
 * Study-state debug report — the Lab app's half of shared/debug/report.ts (keep the two in
 * step). Built from Room with the SAME calls the home screen (ui/home/HomeViewModel.load) and
 * the study session (ui/study/StudyViewModel.load) make — StudyQueue.introducedToday / cutoff /
 * build / counts over `CardEntity.toQueueCard()` — and uploaded to POST /api/debug/reports so
 * the worker can diff it against the web app's (GET /api/debug/compare, MCP
 * `compare_debug_reports`).
 */
object DebugReportBuilder {
    const val VERSION = 1
    val CARD_COLUMNS = listOf(
        "card_id", "note_id", "deck_id", "card_type", "queue", "due_ms", "reps", "lapses",
        "event_count", "in_due_queue", "first_review_ms",
    )
    const val INTRODUCED_BASIS =
        "derived from review events: a card's first-ever review at/after local midnight (StudyQueue.introducedToday)"

    /**
     * `eventIdHash` of shared/debug/report.ts: FNV-1a (32-bit) over UTF-16 code units, 8 hex
     * digits. Kotlin Strings are UTF-16, so `code` is the same unit JS `charCodeAt` reads.
     */
    fun eventIdHash(id: String): String {
        var h = 0x811c9dc5.toInt()
        for (ch in id) {
            h = h xor ch.code
            h *= 16777619
        }
        return String.format("%08x", h.toLong() and 0xffffffffL)
    }

    private fun counts(c: QueueCounts, hasMoreNew: Boolean? = null) = buildJsonObject {
        put("new", c.new); put("secondaryNew", c.secondaryNew); put("learning", c.learning); put("review", c.review)
        if (hasMoreNew != null) put("hasMoreNew", hasMoreNew)
    }

    private fun pair(primary: Int, secondary: Int) = buildJsonObject { put("primary", primary); put("secondary", secondary) }

    private fun iso(ms: Long) = Js.toIsoString(ms)

    private fun rows(db: LabDatabase, sql: String): List<List<String?>> {
        val out = ArrayList<List<String?>>()
        db.openHelper.readableDatabase.query(sql).use { c ->
            while (c.moveToNext()) out += (0 until c.columnCount).map { if (c.isNull(it)) null else c.getString(it) }
        }
        return out
    }

    /** The report as JSON (the upload body's `report`). */
    suspend fun build(
        db: LabDatabase,
        prefs: Prefs,
        appVersion: String,
        nowMs: Long = System.currentTimeMillis(),
        zone: ZoneId = ZoneId.systemDefault(),
        /** The last sync's per-step timings (Repository.status), so a slow sync can be read off a report. */
        lastRun: SyncRun? = null,
    ): JsonObject = withContext(Dispatchers.IO) {
        val dao = db.dao()
        val budget: StudyBudget = prefs.budget

        // ---- exactly HomeViewModel.load ----
        val decks = dao.decks()
        val cardEntities = dao.cards()
        val cards = cardEntities.map { it.toQueueCard() }
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val dayStart = StudyQueue.startOfDay(nowMs, zone)
        val introduced = StudyQueue.introducedToday(cards, first, dayStart)
        val cutoff = StudyQueue.cutoff(nowMs, zone)
        val queueDecks = decks.map { it.toQueueDeck() }
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().toString()
        val bonusAll = prefs.bonus("all", today)
        val longTerm = dao.noteLongTerm()
        val bumps = dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.queueBumps(dao)
        // The queue a session would get: with the notes' hanzi and "Order new cards by" (HomeViewModel's `all`).
        val order = prefs.newCardOrder
        val all: BuiltQueue = StudyQueue.build(queueDecks, cards, budget, bonusAll, introduced, cutoff, null, dao.noteHanzi(), longTerm = longTerm, bumps = bumps, order = order, frequency = WordFrequency.shipped)
        val homeCounts = StudyQueue.counts(all.dueCards, all.reviewedNoteIds)
        val perDeck = decks.associate { d ->
            val q = StudyQueue.build(queueDecks, cards, budget, prefs.bonus(d.id, today), introduced, cutoff, d.id, longTerm = longTerm, bumps = bumps)
            d.id to (StudyQueue.counts(q.dueCards, q.reviewedNoteIds) to q.hasMoreNew)
        }

        // ---- events (raw SQL: nothing here changes the schema) ----
        val eventStats = rows(db, "SELECT cardId, COUNT(*), MIN(reviewedAt) FROM review_events GROUP BY cardId")
        val eventCount = HashMap<String, Int>()
        for (r in eventStats) eventCount[r[0]!!] = r[1]!!.toInt()
        val eventIds = rows(db, "SELECT id FROM review_events").map { it[0]!! }
        val span = rows(db, "SELECT MIN(reviewedAt), MAX(reviewedAt) FROM review_events").firstOrNull()
        val pendingDeletions = rows(db, "SELECT COUNT(*) FROM pending_deletions").first()[0]!!.toInt()
        val cardIds = cardEntities.mapTo(HashSet()) { it.id }
        val orphanEvents = eventCount.filterKeys { it !in cardIds }.values.sum()
        val inQueue = all.dueCards.mapTo(HashSet()) { it.id }
        val noteCounts = dao.noteCounts().associate { it.deckId to it.count }
        val cardCounts = cardEntities.groupingBy { it.deckId }.eachCount()

        // Raw pools, same definitions as the web (shared/decks/study-queue.ts): learning /
        // relearning and review cards due by the cutoff; new pools from the budget input.
        val learningPool = HashMap<String, Int>()
        val reviewPool = HashMap<String, Int>()
        for (c in cards) {
            if (c.queue == CardQueue.NEW || (c.state.dueTimestamp ?: Long.MIN_VALUE) > cutoff.ts) continue
            val pool = if (c.queue == CardQueue.REVIEW) reviewPool else learningPool
            pool[c.deckId] = (pool[c.deckId] ?: 0) + 1
        }
        val poolByDeck = all.pools.associateBy { it.deckId }

        val homeTotal = homeCounts.total
        val noteTotal = dao.noteCount()
        val unsynced = dao.unsyncedCount()
        buildJsonObject {
            put("version", VERSION)
            put("client", "lab")
            put("app_version", appVersion)
            put("generated_at", iso(nowMs))
            putJsonObject("timezone") {
                put("iana", zone.id)
                put("offset_minutes", zone.rules.getOffset(Instant.ofEpochMilli(nowMs)).totalSeconds / 60)
            }
            put("now_ms", nowMs)
            putJsonObject("cutoff") { put("ms", cutoff.ts); put("iso", iso(cutoff.ts)) }
            putJsonObject("day_start") { put("ms", dayStart); put("iso", iso(dayStart)); put("local_date", today) }
            put("introduced_basis", INTRODUCED_BASIS)
            putJsonObject("budget") {
                put("new_cards_per_day", budget.newCardsPerDay)
                put("secondary_cards_per_day", budget.secondaryCardsPerDay)
            }
            putJsonObject("new_card_order") {
                put("new_characters_first", order.newCharactersFirst)
                put("new_words_first", order.newWordsFirst)
                put("most_common_first", order.mostCommonFirst)
                put("sentences_last", order.sentencesLast)
            }
            putJsonObject("bonus") {
                put("all", bonusAll)
                putJsonObject("by_deck") { for (d in decks) prefs.bonus(d.id, today).takeIf { it > 0 }?.let { put(d.id, it) } }
                put("day_key", today)
            }
            putJsonObject("sync") {
                put("last_full_sync", prefs.lastFullSync)
                put("changes_cursor", prefs.changesCursor)
                put("events_cursor", prefs.eventsCursor)
                put("sentences_cursor", prefs.sentencesCursor)
                put("last_sync_at", prefs.lastSyncAt)
                if (lastRun != null) putJsonObject("last_run") {
                    put("full", lastRun.full)
                    put("ok", lastRun.ok)
                    put("at", iso(lastRun.atMs))
                    put("total_ms", lastRun.totalMs)
                    putJsonArray("phases") {
                        for (p in lastRun.phases) add(buildJsonObject { put("name", p.name); put("ms", p.ms); put("detail", p.detail) })
                    }
                }
            }
            putJsonObject("totals") {
                put("decks", decks.size)
                put("notes", noteTotal)
                put("cards", cardEntities.size)
                put("events", eventIds.size)
                put("unsynced_events", unsynced)
                put("pending_deletions", pendingDeletions)
                put("orphan_events", orphanEvents)
                put("earliest_reviewed_at", span?.get(0))
                put("latest_reviewed_at", span?.get(1))
            }
            putJsonObject("home") {
                put("total", homeTotal)
                put("counts", counts(homeCounts, all.hasMoreNew))
                putJsonObject("extras") {}
                put("note", "Home = StudyQueue.counts over the all-decks due queue (learning only when due by the cutoff); no readers or lessons.")
            }
            putJsonObject("queue") {
                put("due_cards", all.dueCards.size)
                put("from_due_cards", counts(homeCounts))
                put("reported", counts(homeCounts))
            }
            putJsonArray("decks") {
                for (d in decks) {
                    val qd = d.toQueueDeck()
                    val pool = poolByDeck[d.id]
                    val intro = introduced[d.id] ?: Introduced(0, 0)
                    val alloc = all.allocation[d.id]
                    val (shown, more) = perDeck.getValue(d.id)
                    add(buildJsonObject {
                        put("id", d.id)
                        put("name", d.name)
                        put("priority", d.studyPriority)
                        put("created_at", d.createdAt)
                        put("caps", pair(qd.capPrimary, qd.capSecondary))
                        put("introduced_today", pair(intro.primary, intro.secondary))
                        putJsonObject("pools") {
                            put("totalNew", pool?.totalNew ?: 0)
                            put("totalSecondaryNew", pool?.totalSecondaryNew ?: 0)
                            put("learning", learningPool[d.id] ?: 0)
                            put("review", reviewPool[d.id] ?: 0)
                        }
                        put("allocation", pair(alloc?.primary ?: 0, alloc?.secondary ?: 0))
                        put("counts", counts(shown, more))
                        put("note_count", noteCounts[d.id] ?: 0)
                        put("card_count", cardCounts[d.id] ?: 0)
                    })
                }
            }
            putJsonArray("card_columns") { CARD_COLUMNS.forEach { add(it) } }
            putJsonArray("cards") {
                for (c in cardEntities) addJsonArray {
                    add(c.id); add(c.noteId); add(c.deckId); add(c.cardType); add(c.queue)
                    add(if (c.queue == CardQueue.NEW) null else c.dueTimestamp)
                    add(c.reps); add(c.lapses)
                    add(eventCount[c.id] ?: 0)
                    add(if (c.id in inQueue) 1 else 0)
                    add(first[c.id])
                }
            }
            put("event_hashes", JsonArray(eventIds.map(::eventIdHash).sorted().map(::JsonPrimitive)))
            putJsonObject("notes") {
                put("per_deck_counts", "StudyQueue.build(deckId, bonus(deckId)) as each deck row shows it")
                put("homework", "not supported in the Lab app yet")
            }
        }
    }

    /** Short line for the settings sheet / logs. */
    fun describe(report: JsonObject): String {
        val home = report["home"]!!.jsonObject
        val totals = report["totals"]!!.jsonObject
        return "${home["total"]!!.jsonPrimitive.content} due · ${totals["cards"]!!.jsonPrimitive.content} cards · ${totals["events"]!!.jsonPrimitive.content} reviews"
    }
}

/**
 * Builds and uploads debug reports: on demand (Lab settings → "Send debug report") and after
 * a successful sync at most every 30 minutes ([sendIfDue], wired in LabApp).
 */
class DebugReporter(
    context: Context,
    private val repo: Repository,
    private val appVersion: String,
    private val http: OkHttpClient = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build(),
) {
    private val sp = context.getSharedPreferences("lab_debug", Context.MODE_PRIVATE)
    private val appContext: Context = context.applicationContext ?: context
    private val busy = Mutex()
    private val _status = MutableStateFlow<String?>(null)
    /** What the last send did, for the settings sheet. */
    val status: StateFlow<String?> = _status.asStateFlow()
    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending.asStateFlow()

    data class Sent(val id: String, val summary: String, val kb: Double)

    /** Build + upload now. Throws on failure. */
    suspend fun send(nowMs: Long = System.currentTimeMillis()): Sent = withContext(Dispatchers.IO) {
        val token = repo.prefs.sessionToken ?: throw UnauthorizedException()
        val built = DebugReportBuilder.build(repo.db, repo.prefs, appVersion, nowMs, lastRun = repo.status.value.lastRun)
        // Crashes / ANRs since the last report (CrashLog.kt): the only way we see them.
        val crashes = CrashLog.pending(appContext)
        val rt = Runtime.getRuntime()
        val runtime = buildJsonObject {
            put("max_heap_mb", rt.maxMemory() / 1_048_576)
            put("used_heap_mb", (rt.totalMemory() - rt.freeMemory()) / 1_048_576)
        }
        val report = JsonObject(built + ("runtime" to runtime) + (if (crashes.isEmpty()) emptyMap() else mapOf("crashes" to crashes)))
        val body = buildJsonObject {
            put("client", "lab")
            put("app_version", appVersion)
            put("install_kind", "lab")
            put("report", report)
        }.toString().toByteArray(Charsets.UTF_8)
        val zipped = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(body) } }.toByteArray()
        val req = Request.Builder()
            .url("${repo.api.baseUrl}/api/debug/reports")
            .header("Authorization", "Bearer $token")
            .post(zipped.toRequestBody(GZIP))
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (res.code == 401) throw UnauthorizedException()
            if (!res.isSuccessful) {
                val msg = runCatching { Json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
                throw HttpException(res.code, msg ?: text.take(200))
            }
            val id = Json.parseToJsonElement(text).jsonObject["report"]!!.jsonObject["id"]!!.jsonPrimitive.content
            sp.edit().putLong(LAST_UPLOAD, System.currentTimeMillis()).apply()
            if (crashes.isNotEmpty()) CrashLog.clear(appContext)
            Sent(id, DebugReportBuilder.describe(report), Math.round(zipped.size / 102.4) / 10.0)
        }
    }

    /** The settings button: send and record the outcome in [status]. Never throws. */
    suspend fun sendNow() {
        if (!busy.tryLock()) return
        _sending.value = true
        try {
            val sent = send()
            _status.value = "Sent: ${sent.summary} (${sent.kb} KB)"
        } catch (e: Exception) {
            _status.value = "Could not send the report: ${e.message ?: e.javaClass.simpleName}"
        } finally {
            _sending.value = false
            busy.unlock()
        }
    }

    /** After a sync: upload at most every 30 minutes (at once when a crash is waiting to be told). Never throws. */
    suspend fun sendIfDue(nowMs: Long = System.currentTimeMillis()) {
        if (repo.prefs.sessionToken == null) return
        val crashWaiting = CrashLog.hasPendingUncaught(appContext)
        if (!crashWaiting && nowMs - sp.getLong(LAST_UPLOAD, 0) < AUTO_INTERVAL_MS) return
        if (!busy.tryLock()) return
        // Stamp before trying: a failing upload waits for the next window too.
        sp.edit().putLong(LAST_UPLOAD, nowMs).apply()
        try {
            send(nowMs)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Never a crash from a report (an OutOfMemoryError building one included).
        } finally {
            busy.unlock()
        }
    }

    companion object {
        const val AUTO_INTERVAL_MS = 30 * 60 * 1000L
        private const val LAST_UPLOAD = "last_upload"
        private val GZIP = "application/gzip".toMediaType()
    }
}

