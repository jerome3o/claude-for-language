package dev.jeromeswannack.chineselearning.lab.core.claude

/**
 * Claude threads on the phone — how what the server sends is merged over what the phone already has:
 * port of shared/claude/threadCache.ts (`sortMessages`, `mergeMessage`, `mergeThreadMessages`,
 * `applyTurnFrame`, `mergeThreadList`). Parity-tested (parity/fixtures/claude-thread-cache.ts →
 * ClaudeThreadCacheParityTest). The app's rows (data/claude ClaudeThreads / ClaudeThreadList) go
 * through a [MessageLens] / [ThreadLens], so the rules never see the DTOs.
 */
object ClaudeThreadCache {
    /** The fields of a cached message the rules read and write (`seq` = the highest live frame applied here). */
    interface MessageLens<T> {
        fun id(m: T): String
        fun clientId(m: T): String?
        fun role(m: T): String
        fun createdAt(m: T): String
        fun status(m: T): String?
        fun content(m: T): String
        fun streaming(m: T): Boolean
        fun error(m: T): String?
        /** Written without a connection, waiting in the outbox (never dropped by a full refresh). */
        fun queued(m: T): Boolean
        fun seq(m: T): Int?

        /** [m] with these fields. */
        fun with(m: T, status: String?, content: String, streaming: Boolean, error: String?, seq: Int?): T
    }

    /** Port of sortMessages: created_at, then my message before its reply (stable). */
    fun <T> sortMessages(rows: List<T>, lens: MessageLens<T>): List<T> = rows.sortedWith { a, b ->
        val ca = lens.createdAt(a)
        val cb = lens.createdAt(b)
        when {
            ca < cb -> -1
            ca > cb -> 1
            lens.role(a) == lens.role(b) -> 0
            lens.role(a) == "user" -> -1
            else -> 1
        }
    }

    /**
     * Port of mergeMessage: a reply still being written keeps the longer text this phone already
     * streamed (the row is written ≤ every 400 ms, the socket ≤ every 120 ms); anything finished,
     * failed or newer wins. The phone's live seq is kept.
     */
    fun <T> mergeMessage(local: T?, server: T, lens: MessageLens<T>): T {
        if (local != null && lens.status(server) == "pending" && lens.status(local) == "pending") {
            val lc = lens.content(local)
            val sc = lens.content(server)
            if (lc.length > sc.length && lc.startsWith(sc)) {
                return lens.with(server, lens.status(server), lc, true, lens.error(server), lens.seq(local))
            }
        }
        val seq = local?.let { lens.seq(it) } ?: return server
        return lens.with(server, lens.status(server), lens.content(server), lens.streaming(server), lens.error(server), seq)
    }

    data class MergedMessages<T>(val messages: List<T>, val removed: List<String>)

    /**
     * Port of mergeThreadMessages: a thread / messages response over the phone's rows of that thread.
     * [full] = the server's whole list (anything else but my still-queued messages leaves); my
     * optimistic row is replaced by the server's row with the same client id.
     */
    fun <T> mergeThreadMessages(prev: List<T>, server: List<T>, full: Boolean, lens: MessageLens<T>): MergedMessages<T> {
        var rows = prev.toMutableList()
        val removed = mutableListOf<String>()
        fun drop(keep: (T) -> Boolean) {
            val next = mutableListOf<T>()
            for (m in rows) if (keep(m)) next += m else removed += lens.id(m)
            rows = next
        }
        if (full) {
            val keep = server.mapTo(HashSet()) { lens.id(it) }
            drop { lens.id(it) in keep || lens.queued(it) }
        }
        for (m in server) {
            val cid = lens.clientId(m)
            if (!cid.isNullOrEmpty()) drop { !(lens.clientId(it) == cid && lens.id(it) != lens.id(m)) }
            val i = rows.indexOfFirst { lens.id(it) == lens.id(m) }
            val merged = mergeMessage(rows.getOrNull(i), m, lens)
            if (i >= 0) rows[i] = merged else rows += merged
        }
        val live = rows.mapTo(HashSet()) { lens.id(it) }
        return MergedMessages(sortMessages(rows, lens), removed.distinct().filter { it !in live })
    }

    /** The parts of a live `claude_turn` frame the rule reads. */
    data class TurnFrame(val seq: Int, val status: String, val text: String? = null, val error: String? = null)

    /**
     * Port of applyTurnFrame: the pending reply's whole text so far ([TurnFrame.seq] only grows — an
     * older frame is ignored). Null when nothing changes.
     */
    fun <T> applyTurnFrame(row: T, frame: TurnFrame, lens: MessageLens<T>): T? {
        val seq = lens.seq(row)
        if (seq != null && frame.seq <= seq) return null
        if (lens.status(row) != "pending" && frame.status != "failed") return null
        var status = lens.status(row)
        var content = lens.content(row)
        var streaming = lens.streaming(row)
        var error = lens.error(row)
        val text = frame.text
        if (text != null && text.length >= content.length) {
            content = text
            streaming = text.isNotEmpty()
        }
        if (frame.status == "failed") {
            status = "failed"
            streaming = false
            error = frame.error ?: error
        }
        return lens.with(row, status, content, streaming, error, frame.seq)
    }

    /** The fields of a cached thread the list rule reads (`local` = started offline, its id is its client id). */
    interface ThreadLens<T> {
        fun id(t: T): String
        fun clientId(t: T): String?
        fun local(t: T): Boolean

        /** A list row laid over the cached copy (the phone's own fields kept). */
        fun over(old: T, row: T): T
    }

    data class MergedList<T>(val threads: List<T>, val removed: List<String>, val moved: List<Pair<String, String>>)

    /**
     * Port of mergeThreadList: list rows over the phone's threads — laid over the old copy or added at
     * the end, [deleted] leave, and a thread started offline that the server now lists under its own id
     * (by the row's client id) leaves; [MergedList.moved] = (client id → server id).
     */
    fun <T> mergeThreadList(prev: List<T>, rows: List<T>, deleted: Collection<String>, lens: ThreadLens<T>): MergedList<T> {
        val byId = LinkedHashMap<String, T>()
        for (t in prev) byId[lens.id(t)] = t
        for (r in rows) {
            val old = byId[lens.id(r)]
            byId[lens.id(r)] = if (old != null) lens.over(old, r) else r
        }
        val removed = mutableListOf<String>()
        val moved = mutableListOf<Pair<String, String>>()
        for (t in byId.values.toList()) {
            val cid = lens.clientId(t)
            if (lens.local(t) || cid.isNullOrEmpty() || cid == lens.id(t)) continue
            val local = byId[cid]
            if (local != null && lens.local(local)) {
                byId.remove(cid)
                moved += cid to lens.id(t)
            }
        }
        for (id in deleted) {
            byId.remove(id)
            if (id !in removed) removed += id
        }
        return MergedList(byId.values.toList(), removed, moved)
    }
}
