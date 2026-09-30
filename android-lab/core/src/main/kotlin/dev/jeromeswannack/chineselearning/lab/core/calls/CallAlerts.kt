package dev.jeromeswannack.chineselearning.lab.core.calls

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/**
 * Port of shared/calls/alerts.ts — which live call to announce ("📹 王老师 is calling — Join")
 * and when to ring, from the `GET /api/calls?live=1` list. Parity-tested against the
 * TypeScript (parity/fixtures/calls-alerts.ts → CallsAlertsParityTest).
 */
object CallAlerts {
    data class LiveCall(
        val id: String,
        val relationshipId: String?,
        val createdBy: String,
        val status: String,
        val createdAt: String,
        val otherUserName: String?,
        /** Who is connected to the room right now; null from an older server (then the call's age decides). */
        val presentUserIds: List<String>? = null,
    )

    enum class Kind(val wire: String) { INCOMING("incoming"), REJOIN("rejoin"), TEST("test") }

    data class Banner(
        val callId: String,
        val relationshipId: String?,
        val kind: Kind,
        val title: String,
        val action: String,
        val url: String,
        val name: String?,
    )

    const val CALL_BANNER_MAX_AGE_MS = 4 * 60 * 60_000L
    const val CALL_RING_WINDOW_MS = 2 * 60_000L
    const val CALL_RING_DURATION_MS = 30_000L
    const val LIVE_CALL_POLL_MS = 20_000L

    private val SQLITE = Regex("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?$")
    private val CALL_PATH = Regex("^/calls/([^/?#]+)/?$")

    /** Port of parseCallTime: SQLite datetime (UTC) or ISO → epoch ms; null when unreadable. */
    fun parseCallTime(value: String?): Long? {
        if (value.isNullOrEmpty()) return null
        return try {
            if (SQLITE.matches(value)) {
                val s = value.replace(' ', 'T').let { if (it.length == 16) "$it:00" else it }
                LocalDateTime.parse(s).toInstant(ZoneOffset.UTC).toEpochMilli()
            } else {
                Instant.parse(value).toEpochMilli()
            }
        } catch (_: DateTimeParseException) {
            null
        }
    }

    /**
     * Port of someoneElseInCall: someone other than me is connected to the call right now and I am
     * not (on any device). Null when the server didn't say.
     */
    fun someoneElseInCall(call: LiveCall, myUserId: String): Boolean? {
        val present = call.presentUserIds ?: return null
        return myUserId !in present && present.any { it != myUserId }
    }

    /** Port of callIdFromPath: the id of a live call page (`/calls/<id>`, not its review). */
    fun callIdFromPath(path: String): String? = CALL_PATH.find(path)?.groupValues?.get(1)?.let { java.net.URLDecoder.decode(it, "UTF-8") }

    private fun bannerFor(c: LiveCall, me: String): Banner {
        val name = c.otherUserName?.trim()?.takeIf { it.isNotEmpty() }
        val who = name ?: "Your partner"
        val url = "/calls/${c.id}"
        if (c.relationshipId == null) return Banner(c.id, null, Kind.TEST, "Your test call is still open", "Open", url, null)
        if (c.createdBy != me) return Banner(c.id, c.relationshipId, Kind.INCOMING, "$who is calling", "Join", url, name)
        return Banner(c.id, c.relationshipId, Kind.REJOIN, if (name != null) "Your call with $name is still on" else "Your call is still on", "Rejoin", url, name)
    }

    /** Port of pickCallBanner. [relationshipId] null = any relationship. */
    fun pickCallBanner(
        calls: List<LiveCall>,
        myUserId: String,
        path: String,
        now: Long,
        dismissed: Collection<String> = emptyList(),
        relationshipId: String? = null,
        includeTest: Boolean = false,
    ): Banner? {
        val onPage = callIdFromPath(path)
        val candidates = calls.filter { c ->
            if (c.status != "live" || c.id == onPage || c.id in dismissed) return@filter false
            if (relationshipId != null && c.relationshipId != relationshipId) return@filter false
            if (c.relationshipId == null && !includeTest) return@filter false
            val t = parseCallTime(c.createdAt) ?: return@filter false
            someoneElseInCall(c, myUserId) ?: (now - t <= CALL_BANNER_MAX_AGE_MS)
        }
        fun rank(c: LiveCall) = if (c.relationshipId == null) 2 else if (c.createdBy != myUserId) 0 else 1
        val best = candidates.sortedWith(
            compareBy<LiveCall> { rank(it) }
                .thenByDescending { parseCallTime(it.createdAt)!! }
                .thenBy { it.id },
        ).firstOrNull() ?: return null
        return bannerFor(best, myUserId)
    }

    /** Port of callToRing. */
    fun callToRing(calls: List<LiveCall>, myUserId: String, now: Long, rung: Collection<String>, silent: Boolean, path: String): LiveCall? {
        if (silent) return null
        val onPage = callIdFromPath(path)
        var best: LiveCall? = null
        var bestT = Long.MIN_VALUE
        for (c in calls) {
            if (c.status != "live" || c.relationshipId == null || c.createdBy == myUserId || c.id in rung || c.id == onPage) continue
            if (someoneElseInCall(c, myUserId) == false) continue
            val t = parseCallTime(c.createdAt) ?: continue
            if (now - t > CALL_RING_WINDOW_MS || t - now > CALL_RING_WINDOW_MS) continue
            if (best == null || t > bestT) { best = c; bestT = t }
        }
        return best
    }
}
