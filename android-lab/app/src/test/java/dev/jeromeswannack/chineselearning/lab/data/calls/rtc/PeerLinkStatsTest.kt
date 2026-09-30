package dev.jeromeswannack.chineselearning.lab.data.calls.rtc

import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerStats
import org.junit.Assert.assertEquals
import org.junit.Test

/** The route + bandwidth read from WebRTC stats (for the connection log and the encoder). */
class PeerLinkStatsTest {
    private fun e(type: String, id: String, vararg members: Pair<String, Any?>) = type to (mapOf("__id" to id) + members)

    @Test fun selectedPairThroughATurnRelay() {
        val stats = PeerLink.statsFrom(
            listOf(
                e("transport", "T1", "selectedCandidatePairId" to "P2"),
                e("candidate-pair", "P1", "localCandidateId" to "L1", "nominated" to false, "availableOutgoingBitrate" to 9_000_000.0),
                e("candidate-pair", "P2", "localCandidateId" to "L2", "nominated" to true, "state" to "succeeded", "availableOutgoingBitrate" to 412_000.0),
                e("local-candidate", "L1", "candidateType" to "host", "protocol" to "udp"),
                e("local-candidate", "L2", "candidateType" to "relay", "protocol" to "udp", "relayProtocol" to "tcp"),
            ),
        )
        assertEquals(PeerStats(412_000.0, "relay/tcp via turn"), stats)
    }

    @Test fun nominatedPairWithoutTransportAndTheRouteWording() {
        val stats = PeerLink.statsFrom(
            listOf(
                e("candidate-pair", "P1", "localCandidateId" to "L1", "nominated" to true, "state" to "succeeded"),
                e("local-candidate", "L1", "candidateType" to "srflx", "protocol" to "udp"),
            ),
        )
        assertEquals(PeerStats(null, "srflx"), stats)
        assertEquals(PeerStats(null, null), PeerLink.statsFrom(emptyList()))
        assertEquals("relay/udp via turn", PeerLink.describeRoute("relay", "udp", "udp"))
        assertEquals("relay/tls via turns", PeerLink.describeRoute("relay", "udp", "tls"))
        assertEquals("host", PeerLink.describeRoute("host", "udp", null))
    }
}
