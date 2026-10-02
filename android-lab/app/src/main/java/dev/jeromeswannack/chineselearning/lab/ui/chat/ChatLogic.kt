package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.connections.Fmt
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The chat page's pure rules (web: pages/ChatPage.tsx), unit-tested in ChatLogicTest. */
object ChatLogic {
    const val POLL_MS = 3_000L
    /** While the live socket is up the poll is only a safety net (docs/CHAT.md §4). */
    const val LIVE_POLL_MS = 20_000L
    val DEFAULT_EMOJIS = listOf("👍", "❤️", "😂", "😮", "👏", "🔥")
    const val MAX_RECENT = 5

    val FULL_EMOJIS = listOf(
        "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😋", "😛", "😜", "🤪",
        "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "😮‍💨", "🤥", "😌", "😔", "😪", "🤤", "😴",
        "😷", "🤒", "🤕", "🤢", "🤮", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐", "😕", "😟", "🙁", "😮",
        "😯", "😲", "😳", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬",
        "👋", "🤚", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊",
        "👊", "🤛", "🤜", "👏", "🙌", "🤲", "🤝", "🙏", "💪", "🦾",
        "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "♥️",
        "💯", "💢", "💥", "💫", "💦", "💨", "🕳️", "💣", "💬", "💭",
        "🔥", "⭐", "🌟", "✨", "⚡", "🎉", "🎊", "🎈", "🎁", "🏆", "🥇", "🥈", "🥉", "🏅", "🎯", "🎵", "🎶", "🔔", "📣", "📢",
        "🌈", "☀️", "🌤️", "⛅", "🌙", "🌸", "🌺", "🌻", "🌹", "🍀",
        "🐶", "🐱", "🐭", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🍎", "🍕", "🍔", "🍣", "🍜", "🍦", "🍰", "🧁", "☕", "🍵",
    )

    /** Initial page + polled/sent messages, first occurrence of each id wins (web: the dedupe in ChatPage). */
    fun merge(vararg lists: List<ChatMessageDto>): List<ChatMessageDto> {
        val seen = HashSet<String>()
        return lists.flatMap { it }.filter { seen.add(it.id) }
    }

    /** Replaces messages by id (a reaction / check refresh) keeping the order. */
    fun replace(list: List<ChatMessageDto>, updated: List<ChatMessageDto>): List<ChatMessageDto> {
        val byId = updated.associateBy { it.id }
        return list.map { byId[it.id] ?: it }
    }

    data class DateGroup(val label: String, val messages: List<ChatMessageDto>)

    private val longDay = DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.US)
    private val time = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    /** Messages under "Today" / "Yesterday" / "Tuesday, Sep 15" dividers (web: messagesByDate + formatDate). */
    fun groupByDate(messages: List<ChatMessageDto>, today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): List<DateGroup> {
        val out = mutableListOf<Pair<LocalDate?, MutableList<ChatMessageDto>>>()
        for (m in messages) {
            val day = Fmt.parse(m.created_at)?.atZone(zone)?.toLocalDate()
            if (out.isEmpty() || out.last().first != day) out += day to mutableListOf(m) else out.last().second += m
        }
        return out.map { (day, list) ->
            DateGroup(
                when (day) {
                    null -> ""
                    today -> "Today"
                    today.minusDays(1) -> "Yesterday"
                    else -> longDay.format(day)
                },
                list,
            )
        }
    }

    fun formatTime(iso: String, zone: ZoneId = ZoneId.systemDefault()): String = Fmt.parse(iso)?.let { time.format(it.atZone(zone)) } ?: ""

    private val CALL_LINK = Regex("https?://\\S+/calls/([A-Za-z0-9_-]{8,})")
    private val CALL_STRIP = Regex("\\s*(—\\s*join here:)?\\s*https?://\\S+/calls/\\S+")

    /** A video-call invite ("join here: …/calls/<id>") → (text without the link, call id); null otherwise. */
    fun callInvite(content: String): Pair<String, String>? {
        val id = CALL_LINK.find(content)?.groupValues?.get(1) ?: return null
        return content.replaceFirst(CALL_STRIP, "") to id
    }

    /** Recent reactions first, then the defaults, six in all (web: getQuickEmojis). */
    fun quickEmojis(recent: List<String>): List<String> {
        if (recent.isEmpty()) return DEFAULT_EMOJIS
        val merged = recent.toMutableList()
        for (e in DEFAULT_EMOJIS) if (e !in merged && merged.size < 6) merged += e
        return merged.take(6)
    }

    /** web saveRecentEmoji: most recent first, at most five. */
    fun pushRecent(recent: List<String>, emoji: String): List<String> = (listOf(emoji) + recent.filter { it != emoji }).take(MAX_RECENT)

    fun truncate(text: String, max: Int): String = if (text.length > max) text.take(max) + "..." else text

    /** Newest timestamp we have, the `since` for the next poll. */
    fun latest(messages: List<ChatMessageDto>, fallback: String?): String? =
        messages.maxByOrNull { Fmt.parse(it.created_at) ?: Instant.EPOCH }?.created_at?.let { newest ->
            if (fallback != null && (Fmt.parse(fallback) ?: Instant.EPOCH) > (Fmt.parse(newest) ?: Instant.EPOCH)) fallback else newest
        } ?: fallback
}
