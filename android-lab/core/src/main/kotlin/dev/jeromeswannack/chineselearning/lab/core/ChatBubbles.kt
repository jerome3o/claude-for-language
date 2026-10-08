package dev.jeromeswannack.chineselearning.lab.core

/**
 * How a chat thread is drawn — chat round 2 (docs/CHAT.md "Round 2"): Signal-like groups of
 * consecutive bubbles, delivery ticks and the first link of a message (its link preview). Port of
 * shared/chats/bubbles.ts (`layoutBubbles`, `tickFor`, `localDay`, `firstLink`, `GROUP_GAP_MS`),
 * parity-tested (parity/fixtures/chat-round2.ts → ChatRound2ParityTest).
 */
object ChatBubbles {
    /** Consecutive messages from one person within this gap form a group. */
    const val GROUP_GAP_MS = 3 * 60 * 1000L

    /** Photos sent before albums existed: consecutive photos this close together form one album. */
    const val ALBUM_LEGACY_GAP_MS = 10 * 1000L

    /** At most this many photos are picked at once (so, in one album). */
    const val ALBUM_MAX_PHOTOS = 10

    /**
     * `BubbleMessage`. [pending] = 'sending' | 'failed' | null (outbox state); [attachmentKind] =
     * 'image' | 'voice' | 'file' | 'video' (photos can form an album); [content] = the text / a
     * photo's caption; [albumId] = photos picked together share it (docs/CHAT.md "Photo albums").
     */
    data class Message(
        val id: String,
        val senderId: String,
        /** ISO string. */
        val createdAt: String,
        val deletedAt: String? = null,
        val pending: String? = null,
        val attachmentKind: String? = null,
        val content: String? = null,
        val albumId: String? = null,
    )

    enum class Tick(val id: String) { NONE("none"), PENDING("pending"), FAILED("failed"), SENT("sent"), READ("read") }

    data class Layout(
        /** The (first shown) message's id. */
        val id: String,
        val mine: Boolean,
        /** First bubble of its group: a little more space above. */
        val firstInGroup: Boolean,
        /** Last bubble of its group: the time + ticks show inside it, and its tail corner. */
        val lastInGroup: Boolean,
        /** A new local day starts here (the day pill above it). */
        val newDay: Boolean,
        /** Local calendar day, YYYY-MM-DD. */
        val day: String,
        val tick: Tick,
        /** One message, or several photos drawn as one album bubble. */
        val album: Boolean = false,
        /** The messages this bubble shows, oldest first: `[id]` for a message, the album's photos. */
        val messageIds: List<String> = listOf(id),
        /** Album: the photo whose caption shows under the collage (the last one with a caption). */
        val captionId: String? = null,
    ) {
        /** The web's `kind`: 'message' | 'album'. */
        val kind: String get() = if (album) "album" else "message"
    }

    /** `Date.parse` for the shapes the server sends (ISO with Z / offset, date-only, SQLite UTC); null = NaN. */
    fun parse(iso: String?): Long? = GhostDecks.parseServerTime(iso)

    /** Port of localDay: YYYY-MM-DD at a fixed offset (minutes EAST of UTC); "" when unparseable. */
    fun localDay(iso: String, offsetMinutes: Int): String {
        val ms = parse(iso) ?: return ""
        return Js.toIsoString(ms + offsetMinutes * 60_000L).take(10)
    }

    /** Port of tickFor. */
    fun tickFor(msg: Message, viewerId: String, otherReadAt: String?): Tick {
        if (msg.senderId != viewerId || !msg.deletedAt.isNullOrEmpty()) return Tick.NONE
        if (msg.pending == "failed") return Tick.FAILED
        if (!msg.pending.isNullOrEmpty()) return Tick.PENDING
        return if (!otherReadAt.isNullOrEmpty() && msg.createdAt <= otherReadAt) Tick.READ else Tick.SENT
    }

    private fun isPhoto(m: Message) = m.attachmentKind == "image" && m.deletedAt.isNullOrEmpty()
    private fun hasCaption(m: Message) = !m.content.isNullOrEmpty() && NoteSearch.jsTrim(m.content).isNotEmpty()
    private fun isDeleted(m: Message) = !m.deletedAt.isNullOrEmpty()

    /**
     * Port of layoutBubbles: the bubbles of a thread, oldest first — one per message, except that an
     * album's photos are ONE bubble ([Layout.album]). Groups, day pills and ticks are worked out over
     * the bubbles; an album's tick is the worst of its photos' (failed, then pending), else its last
     * photo's.
     */
    fun layoutBubbles(messages: List<Message>, viewerId: String, otherReadAt: String?, offsetMinutes: Int): List<Layout> {
        val days = messages.map { localDay(it.createdAt, offsetMinutes) }
        val times = messages.map { parse(it.createdAt) }

        // 1. Which messages each bubble shows (indexes into `messages`).
        val items = ArrayList<List<Int>>()
        var i = 0
        while (i < messages.size) {
            val m = messages[i]
            if (!m.albumId.isNullOrEmpty() && (isPhoto(m) || isDeleted(m))) {
                // The album's run: same sender and album id, photos or deleted photos.
                var j = i
                val run = ArrayList<Int>()
                while (j < messages.size) {
                    val x = messages[j]
                    if (x.albumId != m.albumId || x.senderId != m.senderId || !(isPhoto(x) || isDeleted(x))) break
                    run += j
                    j++
                }
                val shown = run.filter { isPhoto(messages[it]) }
                items += if (shown.isNotEmpty()) shown else listOf(run[0])
                i = j
                continue
            }
            if (m.albumId.isNullOrEmpty() && isPhoto(m) && m.pending.isNullOrEmpty()) {
                // An old-style album: photos sent one after another before album ids existed.
                val run = arrayListOf(i)
                var j = i + 1
                while (j < messages.size) {
                    val x = messages[j]
                    if (!x.albumId.isNullOrEmpty() || !isPhoto(x) || !x.pending.isNullOrEmpty() || x.senderId != m.senderId || hasCaption(x) || days[j] != days[j - 1]) break
                    val tp = times[j - 1]
                    val tx = times[j]
                    if (tp == null || tx == null || (tx - tp) !in 0..ALBUM_LEGACY_GAP_MS) break
                    run += j
                    j++
                }
                items += run
                i = j
                continue
            }
            items += listOf(i)
            i++
        }

        // 2. Groups, day pills and ticks over the bubbles.
        fun first(k: Int) = items[k].first()
        fun last(k: Int) = items[k].last()
        fun joins(a: Int, b: Int): Boolean {
            if (a < 0 || b >= items.size) return false
            val x = messages[last(a)]
            val y = messages[first(b)]
            if (x.senderId != y.senderId || days[last(a)] != days[first(b)]) return false
            val ta = times[last(a)] ?: return false
            val tb = times[first(b)] ?: return false
            return (tb - ta) in 0..GROUP_GAP_MS
        }
        return items.mapIndexed { k, members ->
            val head = messages[members[0]]
            val album = members.size > 1
            val tick = if (album) {
                val ticks = members.map { tickFor(messages[it], viewerId, otherReadAt) }
                when {
                    Tick.FAILED in ticks -> Tick.FAILED
                    Tick.PENDING in ticks -> Tick.PENDING
                    else -> ticks.last()
                }
            } else tickFor(head, viewerId, otherReadAt)
            Layout(
                id = head.id,
                mine = head.senderId == viewerId,
                firstInGroup = !joins(k - 1, k),
                lastInGroup = !joins(k, k + 1),
                newDay = k == 0 || days[first(k)] != days[last(k - 1)],
                day = days[first(k)],
                tick = tick,
                album = album,
                messageIds = members.map { messages[it].id },
                captionId = if (album) members.lastOrNull { hasCaption(messages[it]) }?.let { messages[it].id } else null,
            )
        }
    }

    /** Port of albumTiles: tiles shown (≤ 4) and the "+N" on the last one. */
    data class Tiles(val tiles: Int, val more: Int)

    fun albumTiles(count: Int): Tiles {
        val n = count.coerceAtLeast(0)
        return Tiles(minOf(n, 4), if (n > 4) n - 4 else 0)
    }

    /** Port of albumCounter: "3 / 5" (index 0-based); "" for a single photo. */
    fun albumCounter(index: Int, count: Int): String {
        if (count <= 1) return ""
        return "${index.coerceIn(0, count - 1) + 1} / $count"
    }

    private val TRAILING = setOf('.', ',', ';', ':', '!', '?', ')', ']', '}', '"', '\'', '。', '，', '；', '：', '！', '？', '）', '」', '』', '》', '、')

    /** `/https?:\/\/[^\s<>"'，。！？、）」』》]+/i` — JS `\s` spelt out (Java's is ASCII only). */
    private val LINK = java.util.regex.Pattern.compile(
        "https?://[^\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF<>\"'，。！？、）」』》]+",
        java.util.regex.Pattern.CASE_INSENSITIVE,
    )
    private val HOST = java.util.regex.Pattern.compile("^https?://[^/]+\\.[^/]+", java.util.regex.Pattern.CASE_INSENSITIVE)

    /** Port of firstLink: the first http(s) link in a text, without trailing punctuation; null when there is none. */
    fun firstLink(text: String?): String? {
        val m = LINK.matcher(text.orEmpty())
        if (!m.find()) return null
        var url = m.group()
        while (url.isNotEmpty() && url.last() in TRAILING) {
            // Keep a closing parenthesis that has its opening one in the URL (wikipedia links).
            if (url.endsWith(")") && url.count { it == '(' } >= url.count { it == ')' }) break
            url = url.dropLast(1)
        }
        return if (HOST.matcher(url).find()) url else null
    }
}
