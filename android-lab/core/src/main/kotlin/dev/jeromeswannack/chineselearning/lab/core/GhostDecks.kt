package dev.jeromeswannack.chineselearning.lab.core

import java.time.LocalDate

/**
 * Ghost decks: decks this device still holds that the server no longer has (deleted before
 * tombstones existed, so no `deleted_items` row ever announced them). Port of
 * shared/decks/ghosts.ts, parity-tested (parity/fixtures/sync.ts).
 */
object GhostDecks {
    /** Seconds of slack around the server snapshot (created_at has 1 s resolution). */
    const val SNAPSHOT_MARGIN_MS = 60_000L

    private val ZONE = Regex("[zZ]|[+-][0-9][0-9]:?[0-9][0-9]$")
    private val ISO = Regex(
        "^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\\.([0-9]+))?)?)?(Z|z|([+-])([0-9]{2}):?([0-9]{2}))$",
    )

    /**
     * Port of `parseServerTime`: a SQLite `YYYY-MM-DD HH:MM:SS` (UTC) or ISO timestamp → epoch
     * ms, null where JS gives NaN. Follows V8's `Date.parse` for these shapes, including its
     * day overflow (2026-02-29 is 1 March).
     */
    fun parseServerTime(value: String?): Long? {
        if (value.isNullOrEmpty()) return null
        val iso = if (value.contains('T')) value else value.replaceFirst(' ', 'T')
        val withZone = if (ZONE.containsMatchIn(iso)) iso else "${iso}Z"
        val m = ISO.matchEntire(withZone) ?: return null
        val g = m.groupValues
        val year = g[1].toInt(); val month = g[2].toInt(); val day = g[3].toInt()
        val hour = g[4].ifEmpty { "0" }.toInt(); val minute = g[5].ifEmpty { "0" }.toInt()
        val second = g[6].ifEmpty { "0" }.toInt()
        val ms = g[7].let { if (it.isEmpty()) 0 else (it + "00").take(3).toInt() }
        if (month !in 1..12 || day !in 1..31 || hour > 24 || minute > 59 || second > 59) return null
        if (hour == 24 && (minute != 0 || second != 0 || ms != 0)) return null
        val days = LocalDate.of(year, month, 1).toEpochDay() + (day - 1)
        var t = days * 86_400_000L + hour * 3_600_000L + minute * 60_000L + second * 1000L + ms
        if (g[9].isNotEmpty()) {
            val offset = (g[10].toInt() * 60 + g[11].toInt()) * 60_000L
            t -= if (g[9] == "+") offset else -offset
        }
        return t
    }

    data class LocalDeck(val id: String, val createdAt: String?)

    /** Port of `findGhostDecks`: local decks missing from [liveDeckIds] that predate the snapshot. */
    fun find(localDecks: List<LocalDeck>, liveDeckIds: Collection<String>, liveDeckIdsAt: String?): List<String> {
        val live = liveDeckIds.toHashSet()
        val snapshot = parseServerTime(liveDeckIdsAt) ?: return emptyList()
        return localDecks.filter { deck ->
            if (deck.id in live) return@filter false
            // Unknown age: can't prove it predates the snapshot — keep it.
            val created = parseServerTime(deck.createdAt) ?: return@filter false
            created < snapshot - SNAPSHOT_MARGIN_MS
        }.map { it.id }
    }
}
