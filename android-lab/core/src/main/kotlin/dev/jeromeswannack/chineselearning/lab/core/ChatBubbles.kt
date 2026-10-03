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

    /** `BubbleMessage`. [pending] = 'sending' | 'failed' | null (outbox state). */
    data class Message(
        val id: String,
        val senderId: String,
        /** ISO string. */
        val createdAt: String,
        val deletedAt: String? = null,
        val pending: String? = null,
    )

    enum class Tick(val id: String) { NONE("none"), PENDING("pending"), FAILED("failed"), SENT("sent"), READ("read") }

    data class Layout(
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
    )

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

    /** Port of layoutBubbles: one layout per message, in the order given (oldest first). */
    fun layoutBubbles(messages: List<Message>, viewerId: String, otherReadAt: String?, offsetMinutes: Int): List<Layout> {
        val days = messages.map { localDay(it.createdAt, offsetMinutes) }
        val times = messages.map { parse(it.createdAt) }
        fun joins(a: Int, b: Int): Boolean {
            val x = messages.getOrNull(a) ?: return false
            val y = messages.getOrNull(b) ?: return false
            if (x.senderId != y.senderId || days[a] != days[b]) return false
            val ta = times[a] ?: return false
            val tb = times[b] ?: return false
            val gap = tb - ta
            return gap in 0..GROUP_GAP_MS
        }
        return messages.mapIndexed { i, m ->
            Layout(
                id = m.id,
                mine = m.senderId == viewerId,
                firstInGroup = !joins(i - 1, i),
                lastInGroup = !joins(i, i + 1),
                newDay = i == 0 || days[i] != days[i - 1],
                day = days[i],
                tick = tickFor(m, viewerId, otherReadAt),
            )
        }
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
