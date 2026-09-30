package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The banner / ring follow the room's presence (web: shared/calls/alerts.ts, the same rules are
 * also parity-tested): a call row that is still "live" but that nobody is in — both people left,
 * or the caller never came — shows nothing, and the banner clears on the next poll once the
 * caller has gone.
 */
class CallAlertsPresenceTest {
    private val now = CallAlerts.parseCallTime("2026-09-30 08:42:50")!!
    private fun call(present: List<String>?, createdBy: String = "minghui", createdAt: String = "2026-09-30 08:42:38", id: String = "c1") =
        CallAlerts.LiveCall(id, "rel-1", createdBy, "live", createdAt, "明慧老师", present)

    @Test
    fun bannerShowsWhileSheIsInTheCallAndClearsOnceSheLeft() {
        assertEquals("明慧老师 is calling", CallAlerts.pickCallBanner(listOf(call(listOf("minghui"))), "me", "/decks", now)?.title)
        assertNull(CallAlerts.pickCallBanner(listOf(call(emptyList())), "me", "/decks", now))
        assertNull(CallAlerts.pickCallBanner(emptyList(), "me", "/decks", now)) // ended: gone from the list
    }

    @Test
    fun theStuckEmptyCallNeverShowsOrRingsHoursLater() {
        val later = now + 3 * 3600_000L
        val stuck = call(emptyList(), createdBy = "me")
        assertNull(CallAlerts.pickCallBanner(listOf(stuck), "me", "/", later))
        assertNull(CallAlerts.callToRing(listOf(call(emptyList())), "me", now, emptyList(), silent = false, path = "/"))
    }

    @Test
    fun notWhileImInItElsewhere_andRingsOnlyForSomeoneThere() {
        assertNull(CallAlerts.pickCallBanner(listOf(call(listOf("me", "minghui"))), "me", "/", now))
        assertEquals("c1", CallAlerts.callToRing(listOf(call(listOf("minghui"))), "me", now, emptyList(), silent = false, path = "/")?.id)
        assertEquals(null, CallAlerts.someoneElseInCall(call(null), "me"))
        assertEquals(false, CallAlerts.someoneElseInCall(call(listOf("me")), "me"))
    }

    @Test
    fun leaveMessage() {
        assertEquals("""{"type":"leave"}""", CallProtocol.leave())
    }
}
