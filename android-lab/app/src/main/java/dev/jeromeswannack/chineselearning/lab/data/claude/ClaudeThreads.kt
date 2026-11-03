package dev.jeromeswannack.chineselearning.lab.data.claude

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_THREADS_PATH
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeCreateBody
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeSendBody
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeThreadRes
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeTurnEvent
import dev.jeromeswannack.chineselearning.lab.data.api.cardClaudeThreads
import dev.jeromeswannack.chineselearning.lab.data.api.claudeMessagesPath
import dev.jeromeswannack.chineselearning.lab.data.api.claudeThread
import dev.jeromeswannack.chineselearning.lab.data.api.createClaudeThread
import dev.jeromeswannack.chineselearning.lab.data.api.messageClaudeThreads
import dev.jeromeswannack.chineselearning.lab.data.api.retryClaudeMessage
import dev.jeromeswannack.chineselearning.lab.data.api.sendClaudeMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.IOException
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

/** A thread on the phone: as last fetched, plus what was written here and not sent yet. */
@Serializable
data class CachedClaudeThread(
    val thread: ClaudeThreadDto,
    val messages: List<ClaudeMessageDto> = emptyList(),
    /** The server's `server_time` of the last fetch (the next `?since=`). */
    val cursor: String? = null,
    /** Started offline: not on the server yet ([thread]'s id is its client id). */
    val local: Boolean = false,
    /** A thread started offline: what its create call sends (the outbox item's id = [PendingCreate.message_client_id]). */
    val create: PendingCreate? = null,
)

@Serializable
data class PendingCreate(val message_client_id: String, val context: ClaudeContextDto, val intent: String, val text: String, val language: String? = null, val quick: Boolean? = null)

/**
 * Claude threads on the phone (docs/CHAT.md "Claude thread view"; port of the web's
 * services/claudeThreads.ts): every thread opened here is kept in the [JsonCache]
 * (`claude/t/<id>`) so it reads offline, and a message written without a connection goes to the
 * [Outbox] (kind [OUTBOX_KIND], id = the message's client id) — shown at once as my bubble
 * ("🕓 Will send when you're online") and sent in order with the rest of the outbox on reconnect / in
 * every sync. The server is idempotent by client id, so a resend never makes a second thread or
 * message.
 *
 * A thread started offline lives under its CLIENT id (cache kind [LOCAL_KIND]) until the server has
 * it: once the outbox sent its create, [resolveLocal] asks the server for it again (idempotent by the
 * client id → the thread with its server id), moves the rows over, remembers the alias
 * (`/chats/claude/<client id>` still finds it, [observeResolved]) and only then queues the messages
 * written after the first one ([ClaudeMessageDto.held]: their path needs the server's id).
 *
 * Live replies (`claude_turn`) patch the pending reply's text here ([applyTurn]); a poll's shorter
 * text never overwrites a longer streamed one ([mergeMessage]).
 */
class ClaudeThreads(
    private val api: Api,
    private val cache: JsonCache,
    private val outbox: Outbox,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    data class SendResult(val threadId: String, val queued: Boolean)

    // ---------------- reading ----------------

    fun observe(id: String): Flow<CachedClaudeThread?> = cache.observe(key(id), CachedClaudeThread.serializer())

    suspend fun get(id: String): CachedClaudeThread? = runCatching { cache.get(key(id), CachedClaudeThread.serializer()) }.getOrNull()

    /** The thread a route id names now: itself, or the server id of a thread started offline under it. */
    fun observeResolved(routeId: String): Flow<String> =
        cache.observe<Map<String, String>>(ALIASES).map { it?.get(routeId) ?: routeId }.distinctUntilChanged()

    suspend fun resolve(routeId: String): String = aliases()[routeId] ?: routeId

    private suspend fun aliases(): Map<String, String> = runCatching { cache.get<Map<String, String>>(ALIASES) }.getOrNull().orEmpty()

    // ---------------- one card's threads (Ask Claude on a study card) ----------------

    /**
     * The threads about one note on this phone: the server's list as last fetched ([refreshCardThreads])
     * merged with every thread opened / started here (a cached thread's row wins — it is the fresher).
     */
    fun observeCardThreads(noteId: String): Flow<List<ClaudeThreadDto>> = combine(
        cache.observe(cardKey(noteId), ListSerializer(ClaudeThreadDto.serializer())),
        cache.observeAll(KIND, CachedClaudeThread.serializer()),
        cache.observeAll(LOCAL_KIND, CachedClaudeThread.serializer()),
    ) { listed, opened, local ->
        val byId = LinkedHashMap<String, ClaudeThreadDto>()
        for (t in listed.orEmpty()) byId[t.id] = t
        for (c in opened + local) byId[c.thread.id] = c.thread
        byId.values.filter { it.context_kind == ClaudeChats.CARD && it.context.note_id == noteId }
    }.distinctUntilChanged()

    /** True the first time for a reply id (remembered): its card tools are applied on this phone once. */
    suspend fun markCardEffectsApplied(replyId: String): Boolean = lock.withLock {
        val list = runCatching { cache.get<List<String>>(EFFECTS) }.getOrNull().orEmpty()
        if (replyId in list) return@withLock false
        cache.put(EFFECTS, EFFECTS_KIND, (list + replyId).takeLast(EFFECTS_MAX))
        true
    }

    /** `GET /api/claude/threads?context_kind=card&note_id=` into the cache. Throws on a network / server error. */
    suspend fun refreshCardThreads(noteId: String) {
        val res = api.cardClaudeThreads(noteId)
        cache.put(cardKey(noteId), CARD_LIST_KIND, res.threads, ListSerializer(ClaudeThreadDto.serializer()))
    }

    // ---------------- one chat message's threads (Discuss with Claude) ----------------

    /** The Discuss threads about one chat message on this phone (the server's list as last fetched + any opened here). */
    fun observeMessageThreads(messageId: String): Flow<List<ClaudeThreadDto>> = combine(
        cache.observe(MESSAGE_LIST, ListSerializer(ClaudeThreadDto.serializer())),
        cache.observeAll(KIND, CachedClaudeThread.serializer()),
        cache.observeAll(LOCAL_KIND, CachedClaudeThread.serializer()),
    ) { listed, opened, local ->
        val byId = LinkedHashMap<String, ClaudeThreadDto>()
        for (t in listed.orEmpty()) byId[t.id] = t
        for (c in opened + local) byId[c.thread.id] = c.thread
        byId.values.filter { it.context_kind == ClaudeChats.CHAT_MESSAGE && it.context.message_id == messageId }
    }.distinctUntilChanged()

    /** `GET /api/claude/threads?context_kind=chat_message` into the cache. Throws on a network / server error. */
    suspend fun refreshMessageThreads() {
        val res = api.messageClaudeThreads()
        cache.put(MESSAGE_LIST, CARD_LIST_KIND, res.threads, ListSerializer(ClaudeThreadDto.serializer()))
    }

    // ---------------- a role-play (Practice with Claude) ----------------

    /**
     * Start a role-play: a practice thread with no message — Claude speaks first (the web's
     * `startPracticeThread`). Online only (the scene is written by the server); the thread with Claude's
     * pending opener is cached at once. Throws when the server says no / there is no connection.
     */
    suspend fun startPractice(context: ClaudeContextDto, language: String?): String {
        val body = ClaudeCreateBody(newId(), newId(), context.descriptor(), "ask", "", language, null)
        val res = api.createClaudeThread(body)
        cacheResponse(res, full = true)
        return res.thread.id
    }

    // ---------------- writing the cache ----------------

    private suspend fun save(c: CachedClaudeThread) =
        cache.put(key(c.thread.id), if (c.local) LOCAL_KIND else KIND, c.copy(messages = sortMessages(c.messages)), CachedClaudeThread.serializer())

    /** A thread / messages response into the cache (my optimistic rows replaced by their server rows). */
    suspend fun cacheResponse(res: ClaudeThreadRes, full: Boolean = false) = lock.withLock {
        val thread = res.thread
        var prev = get(thread.id)
        // A thread started offline: its rows move from the client id to the server id.
        val clientId = thread.client_id
        if (clientId != null && clientId != thread.id) {
            val local = get(clientId)
            if (local?.local == true) {
                cache.delete(key(clientId))
                cache.put(ALIASES, ALIAS_KIND, aliases() + (clientId to thread.id))
                val moved = local.messages.map { it.copy(thread_id = thread.id) }
                prev = (prev ?: local).copy(messages = (prev?.messages.orEmpty().filter { p -> moved.none { it.id == p.id } }) + moved)
            }
        }
        var rows = prev?.messages.orEmpty()
        if (full) {
            // The server's whole list: anything else but my still-queued messages is gone.
            val keep = res.messages.mapTo(HashSet()) { it.id }
            rows = rows.filter { it.id in keep || it.queued }
        }
        for (m in res.messages) {
            m.client_id?.let { cid -> rows = rows.filter { !(it.client_id == cid && it.id != m.id) } }
            val i = rows.indexOfFirst { it.id == m.id }
            val merged = mergeMessage(rows.getOrNull(i), m)
            rows = if (i >= 0) rows.toMutableList().also { it[i] = merged } else rows + merged
        }
        save(CachedClaudeThread(thread, rows, res.server_time ?: prev?.cursor, local = false, create = null))
        // The Chats tab's row follows (unread cleared on open, a new thread listed at once).
        runCatching { ClaudeThreadList.upsert(cache, thread) }
    }

    /** Fetch a thread (whole the first time, then what changed since the cursor) into the cache. */
    suspend fun refresh(id: String, full: Boolean = false): ClaudeThreadRes? {
        val local = get(id)
        if (local?.local == true) return null
        val since = if (!full) local?.cursor else null
        val res = api.claudeThread(id, since)
        cacheResponse(res, full = since == null)
        return res
    }

    /**
     * A live `claude_turn` frame: the pending reply's whole text so far ([ClaudeTurnEvent.seq] only
     * grows — an older frame is ignored). True when it changed what the screen shows.
     */
    suspend fun applyTurn(e: ClaudeTurnEvent): Boolean = lock.withLock {
        val c = get(e.thread_id) ?: return@withLock false
        val i = c.messages.indexOfFirst { it.id == e.message_id }
        if (i < 0) return@withLock false
        val row = c.messages[i]
        if (row.seq != null && e.seq <= row.seq) return@withLock false
        if (row.status != "pending" && e.status != "failed") return@withLock false
        var next = row.copy(seq = e.seq)
        val text = e.text
        if (text != null && text.length >= row.content.length) next = next.copy(content = text, streaming = text.isNotEmpty())
        if (e.status == "failed") next = next.copy(status = "failed", streaming = false, error = e.error ?: row.error)
        save(c.copy(messages = c.messages.toMutableList().also { it[i] = next }))
        true
    }

    /** The English of a message, kept on its cached row. */
    suspend fun setTranslation(threadId: String, messageId: String, translation: String) = lock.withLock {
        val c = get(threadId) ?: return@withLock
        save(c.copy(messages = c.messages.map { if (it.id == messageId) it.copy(translation = translation) else it }))
    }

    // ---------------- sending ----------------

    /**
     * Start a thread with its first message. Online: created on the server (202, the reply starting);
     * offline (or the request didn't get through): the thread and my bubble are kept here under client
     * ids and the create waits in the outbox. A refusal (4xx) is thrown — the caller says why.
     */
    suspend fun start(context: ClaudeContextDto, text: String, intent: String, language: String?, online: Boolean, quick: Boolean = false): SendResult {
        val threadClientId = newId()
        val messageClientId = newId()
        val body = ClaudeCreateBody(threadClientId, messageClientId, context.descriptor(), intent, text, language, quick.takeIf { it })
        if (online) {
            try {
                val res = api.createClaudeThread(body)
                cacheResponse(res, full = true)
                return SendResult(res.thread.id, queued = false)
            } catch (e: HttpException) {
                if (!shouldQueue(e.code)) throw e
            } catch (e: UnauthorizedException) {
                throw e
            } catch (_: IOException) {
                // no connection after all: queued below
            }
        }
        lock.withLock {
            save(
                CachedClaudeThread(
                    localThread(threadClientId, context, text, intent, language),
                    listOf(localUserMessage(threadClientId, messageClientId, text, intent, held = false, language = language)),
                    local = true,
                    create = PendingCreate(messageClientId, context.descriptor(), intent, text, language, quick.takeIf { it }),
                ),
            )
        }
        outbox.enqueueJson(OUTBOX_KIND, "POST", CLAUDE_THREADS_PATH, body, id = messageClientId)
        return SendResult(threadClientId, queued = true)
    }

    /**
     * A message in an existing thread (Ask). Offline → queued like [start]. [quick] = a suggestion chip
     * (not checked); [typed] = a card thread's typed answer (see [ClaudeSendBody.typed]).
     */
    suspend fun send(threadId: String, text: String, language: String?, online: Boolean, quick: Boolean = false, typed: JsonElement? = null): SendResult {
        val clientId = newId()
        val cached = get(threadId)
        val body = ClaudeSendBody(clientId, text, "ask", language, quick.takeIf { it }, typed)
        if (online && cached?.local != true) {
            try {
                cacheResponse(api.sendClaudeMessage(threadId, body))
                return SendResult(threadId, queued = false)
            } catch (e: HttpException) {
                if (!shouldQueue(e.code)) throw e
            } catch (e: UnauthorizedException) {
                throw e
            } catch (_: IOException) {
                // queued below
            }
        }
        // In a thread the server doesn't have yet: kept here until it does ([resolveLocal]).
        val held = cached?.local == true
        lock.withLock {
            val c = get(threadId) ?: CachedClaudeThread(ClaudeThreadDto(threadId))
            save(c.copy(messages = c.messages + localUserMessage(threadId, clientId, text, "ask", held, language)))
        }
        if (!held) outbox.enqueueJson(OUTBOX_KIND, "POST", claudeMessagesPath(threadId), body, id = clientId)
        return SendResult(threadId, queued = true)
    }

    suspend fun retry(threadId: String, messageId: String) {
        cacheResponse(api.retryClaudeMessage(threadId, messageId), full = true)
    }

    /** Forget a message the outbox couldn't send (✕ on its bubble); the first of a thread started offline takes the thread with it. */
    suspend fun discard(threadId: String, clientId: String) {
        outbox.discard(clientId)
        lock.withLock {
            val c = get(threadId) ?: return@withLock
            if (c.local && c.create?.message_client_id == clientId) cache.delete(key(threadId))
            else save(c.copy(messages = c.messages.filter { it.id != clientId }))
        }
    }

    /**
     * Threads started offline whose create the outbox has sent: fetched (idempotent by the thread's
     * client id), moved to their server id, and the messages written after the first queued with the
     * real path. Returns how many messages were queued (drain the outbox when > 0).
     */
    suspend fun resolveLocal(): Int {
        val locals = runCatching { cache.all(LOCAL_KIND, CachedClaudeThread.serializer()) }.getOrDefault(emptyList())
        if (locals.isEmpty()) return 0
        val inOutbox = outbox.all().mapTo(HashSet()) { it.id }
        var queued = 0
        for (l in locals) {
            val create = l.create ?: continue
            if (create.message_client_id in inOutbox) continue
            val res = try {
                api.createClaudeThread(ClaudeCreateBody(l.thread.id, create.message_client_id, create.context, create.intent, create.text, create.language, create.quick))
            } catch (e: UnauthorizedException) {
                throw e
            } catch (_: Exception) {
                continue
            }
            cacheResponse(res, full = true)
            val serverId = res.thread.id
            val held = get(serverId)?.messages.orEmpty().filter { it.held }
            for (m in held) {
                val cid = m.client_id ?: m.id
                outbox.enqueueJson(OUTBOX_KIND, "POST", claudeMessagesPath(serverId), ClaudeSendBody(cid, m.content, "ask", m.send_language), id = cid)
                queued++
            }
            if (held.isNotEmpty()) lock.withLock {
                get(serverId)?.let { c -> save(c.copy(messages = c.messages.map { if (it.held) it.copy(held = false) else it })) }
            }
        }
        return queued
    }

    private val lock = Mutex()

    private fun nowIso(): String = ISO.format(Instant.ofEpochMilli(clock()))

    private fun localThread(clientId: String, context: ClaudeContextDto, text: String, intent: String, language: String?): ClaudeThreadDto {
        val at = nowIso()
        return ClaudeThreadDto(
            id = clientId,
            client_id = clientId,
            title = titleFor(context, text),
            context_kind = context.kind,
            context = context,
            first_intent = intent,
            preview = oneLine(text, PREVIEW_MAX),
            last_message_at = at,
            created_at = at,
            language = language,
            source = "app",
        )
    }

    private fun localUserMessage(threadId: String, clientId: String, text: String, intent: String, held: Boolean, language: String?): ClaudeMessageDto {
        val at = nowIso()
        return ClaudeMessageDto(
            id = clientId, thread_id = threadId, client_id = clientId, role = "user", content_type = "text", content = text, intent = intent,
            created_at = at, updated_at = at, queued = true, held = held, send_language = language,
        )
    }

    companion object {
        const val KIND = "claude-thread"
        const val LOCAL_KIND = "claude-thread-local"
        const val ALIAS_KIND = "claude-thread-alias"
        const val OUTBOX_KIND = "claude-message"
        const val ALIASES = "claude/aliases"
        const val PREVIEW_MAX = 120
        const val TITLE_MAX = 120

        fun key(id: String) = "claude/t/$id"
        const val CARD_LIST_KIND = "claude-card-threads"
        const val EFFECTS = "claude/card-effects"
        const val EFFECTS_KIND = "claude-card-effects"
        const val EFFECTS_MAX = 200
        fun cardKey(noteId: String) = "claude/card/$noteId"

        /** The Discuss-with-Claude threads as last fetched. */
        const val MESSAGE_LIST = "claude/messages"

        private val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

        fun of(app: LabApp) = ClaudeThreads(app.repo.api, app.cache, app.outbox)

        fun newId(): String = UUID.randomUUID().toString()

        /** A network error or a server that may answer next time (5xx, 408, 429): keep it in the outbox. */
        fun shouldQueue(code: Int): Boolean = code == 408 || code == 429 || code >= 500

        /** Port of sortMessages: created_at, then my message before its reply (stable). */
        fun sortMessages(rows: List<ClaudeMessageDto>): List<ClaudeMessageDto> = rows.sortedWith { a, b ->
            when {
                a.created_at < b.created_at -> -1
                a.created_at > b.created_at -> 1
                a.role == b.role -> 0
                a.role == "user" -> -1
                else -> 1
            }
        }

        /**
         * Port of mergeMessage: a reply still being written keeps the longer text this phone already
         * streamed (the row is written ≤ every 400 ms, the socket ≤ every 120 ms); anything finished,
         * failed or newer wins.
         */
        fun mergeMessage(local: ClaudeMessageDto?, server: ClaudeMessageDto): ClaudeMessageDto {
            if (local != null && server.status == "pending" && local.status == "pending" && local.content.length > server.content.length && local.content.startsWith(server.content)) {
                return server.copy(content = local.content, streaming = true, seq = local.seq)
            }
            return if (local?.seq != null) server.copy(seq = local.seq) else server
        }

        private fun oneLine(s: String, max: Int): String {
            val line = s.replace(Regex("\\s+"), " ").trim()
            return if (line.length > max) line.take(max - 1) + "…" else line
        }

        /** Port of titleFor (shared/claude/context.ts): the first message on one line, else a word for the context. */
        fun titleFor(ctx: ClaudeContextDto, firstText: String): String {
            val line = oneLine(firstText, TITLE_MAX)
            if (line.isNotEmpty()) return line
            return when (ctx.kind) {
                ClaudeChats.CARD -> ctx.label?.let { "About $it" } ?: "About a card"
                ClaudeChats.PRACTICE -> ctx.scenario?.let { "Practice: $it" } ?: "Practice with Claude"
                ClaudeChats.CHAT_MESSAGE -> "About a message"
                else -> "Chat with Claude"
            }
        }

        /** The readable reason of an outbox item the server refused (`HTTP 400: {"error":"…"}` → "…"). */
        fun outboxError(item: OutboxEntity?): String? {
            val raw = item?.lastError ?: return null
            val body = raw.substringAfter(": ", raw)
            val parsed = runCatching { (Json.parseToJsonElement(body) as? JsonObject)?.get("error") as? JsonPrimitive }.getOrNull()?.contentOrNull
            return parsed ?: raw
        }

        /** The sync step: threads started offline whose create went out → their server id + the rest of their messages. */
        val Sync = FeatureSync { ctx ->
            if (ClaudeThreads(ctx.api, ctx.cache, ctx.outbox).resolveLocal() > 0) ctx.outbox.drain()
        }
    }
}
