package dev.jeromeswannack.chineselearning.lab.data.claude

import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeInbox
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.claudeThreadList
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable

/** The Chats tab's thread list on the phone: the rows as last fetched + the next `?since=`. */
@Serializable
data class CachedThreadList(
    val threads: List<ClaudeThreadDto> = emptyList(),
    /** The server's `server_time` of the last list fetch (null = the next fetch is the whole list). */
    val cursor: String? = null,
)

/**
 * The Claude half of the unified Chats tab (docs/CHAT.md "Chats tab — one list for people and
 * Claude"; port of the web's services/claudeInbox.ts): `GET /api/claude/threads` kept in the
 * [JsonCache] ([KEY]) so the list renders offline. The first fetch is the whole list; after that
 * `?since=<server_time>` brings only what changed and the ids deleted since (their thread caches go
 * too). Every thread response the thread screen caches ([ClaudeThreads.cacheResponse]) is written
 * over its row ([upsert]) — opening a thread clears its unread, a new thread shows at once — and
 * threads started offline come from their own cache entries ([observeLocal]).
 *
 * Synced on the Chats tab (open, resume, every minute, a socket reconnect, a finished `claude_turn`)
 * and after every core sync ([Sync]).
 */
object ClaudeThreadList {
    const val KEY = "claude/list-v1"
    const val KIND = "claude-thread-list"
    const val LIMIT = 200

    /** The locks of one cache (one per signed-in app; per instance, so a test's app never waits on another's). */
    private class Locks(val edits: Mutex = Mutex(), val running: Mutex = Mutex())
    private val locks = java.util.WeakHashMap<JsonCache, Locks>()
    private fun locksOf(cache: JsonCache): Locks = synchronized(locks) { locks.getOrPut(cache) { Locks() } }

    fun observe(cache: JsonCache): Flow<CachedThreadList?> = cache.observe(KEY, CachedThreadList.serializer())

    suspend fun get(cache: JsonCache): CachedThreadList? = runCatching { cache.get(KEY, CachedThreadList.serializer()) }.getOrNull()

    /** Threads started on this phone without a connection (not on the server yet). */
    fun observeLocal(cache: JsonCache): Flow<List<ClaudeThreadDto>> =
        cache.observeAll(ClaudeThreads.LOCAL_KIND, CachedClaudeThread.serializer()).map { all -> all.filter { it.local }.map { it.thread } }

    /** The inbox's threads: the list (null until it was fetched once and nothing was cached) + the offline ones. */
    fun observeInbox(cache: JsonCache): Flow<List<ClaudeInbox.Thread>?> =
        combine(observe(cache), observeLocal(cache)) { list, locals ->
            if (list == null && locals.isEmpty()) null else inboxThreads(list?.threads.orEmpty(), locals)
        }

    /** Pure: the rows + deletions over what the phone has (port of applyThreadList; a row replaces its old copy). */
    fun apply(prev: List<ClaudeThreadDto>, rows: List<ClaudeThreadDto>, deleted: Collection<String>): List<ClaudeThreadDto> {
        val byId = LinkedHashMap<String, ClaudeThreadDto>()
        for (t in prev) byId[t.id] = t
        for (t in rows) byId[t.id] = t
        for (id in deleted) byId.remove(id)
        return byId.values.toList()
    }

    /**
     * Pure: the rows as the core inbox rule takes them. A thread started offline that the server
     * already lists (by its client id — the outbox sent it, the sync step hasn't moved it yet) shows once.
     */
    fun inboxThreads(rows: List<ClaudeThreadDto>, locals: List<ClaudeThreadDto>): List<ClaudeInbox.Thread> {
        val known = rows.mapNotNullTo(HashSet()) { it.client_id }
        return rows.map { toInbox(it, local = false) } + locals.filter { it.id !in known }.map { toInbox(it, local = true) }
    }

    fun toInbox(t: ClaudeThreadDto, local: Boolean): ClaudeInbox.Thread = ClaudeInbox.Thread(
        id = t.id,
        title = t.title,
        // The descriptor's kind, else the row's own column (an older row with an empty context).
        context = t.context.core().let { c -> if (c.kind == ClaudeChats.GENERAL && t.context_kind != ClaudeChats.GENERAL) c.copy(kind = t.context_kind) else c },
        firstIntent = t.first_intent,
        preview = t.preview,
        lastMessageAt = t.last_message_at,
        createdAt = t.created_at,
        unread = t.unread,
        pending = t.pending,
        failed = t.failed,
        archived = t.archived,
        local = local,
    )

    private suspend fun edit(cache: JsonCache, transform: (CachedThreadList) -> CachedThreadList?) = locksOf(cache).edits.withLock {
        val cur = get(cache) ?: CachedThreadList()
        val next = transform(cur) ?: return@withLock
        if (next != cur) cache.put(KEY, KIND, next, CachedThreadList.serializer())
    }

    /**
     * Bring the list up to date (whole the first time / when nothing is cached, then `?since=`).
     * Concurrent calls share one request. Throws on a network / server error (the cached list stays).
     */
    suspend fun sync(api: Api, cache: JsonCache, full: Boolean = false) {
        val running = locksOf(cache).running
        if (!running.tryLock()) {
            running.withLock { } // one already in flight: its answer is ours
            return
        }
        try {
            val prev = get(cache)
            val since = if (full || prev == null || prev.threads.isEmpty()) null else prev.cursor
            val res = api.claudeThreadList(since, LIMIT)
            edit(cache) { cur -> cur.copy(threads = apply(cur.threads, res.threads, res.deleted_ids), cursor = res.server_time ?: cur.cursor) }
            for (id in res.deleted_ids) runCatching { cache.delete(ClaudeThreads.key(id)) }
        } finally {
            running.unlock()
        }
    }

    /** A thread the thread screen fetched / started: its row, new or replaced. */
    suspend fun upsert(cache: JsonCache, thread: ClaudeThreadDto) = edit(cache) { cur ->
        val i = cur.threads.indexOfFirst { it.id == thread.id }
        cur.copy(threads = if (i >= 0) cur.threads.toMutableList().also { it[i] = thread } else cur.threads + thread)
    }

    /** A reply started in a thread (a live `claude_turn` frame): "Writing a reply…" on its row now. */
    suspend fun markPending(cache: JsonCache, threadId: String) = edit(cache) { cur ->
        val t = cur.threads.firstOrNull { it.id == threadId } ?: return@edit null
        if (t.pending) null else cur.copy(threads = cur.threads.map { if (it.id == threadId) it.copy(pending = true, failed = false) else it })
    }

    /** Opened here: nothing unread on its row (the server clears it when the thread is fetched). */
    suspend fun markOpened(cache: JsonCache, threadId: String) = edit(cache) { cur ->
        if (cur.threads.none { it.id == threadId && it.unread > 0 }) null
        else cur.copy(threads = cur.threads.map { if (it.id == threadId) it.copy(unread = 0) else it })
    }

    /** After every core sync: the list, so the Chats tab opens with it offline. */
    val Sync = FeatureSync { ctx -> sync(ctx.api, ctx.cache, full = ctx.full) }
}
