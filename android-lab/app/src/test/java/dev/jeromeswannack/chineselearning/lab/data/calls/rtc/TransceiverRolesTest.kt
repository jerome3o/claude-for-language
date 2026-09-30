package dev.jeromeswannack.chineselearning.lab.data.calls.rtc

import dev.jeromeswannack.chineselearning.lab.data.calls.rtc.TransceiverRoles.Kind.AUDIO
import dev.jeromeswannack.chineselearning.lab.data.calls.rtc.TransceiverRoles.Kind.VIDEO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The transceiver rules of peer.ts (camera + a separate screen channel; one video m-line = an older app). */
class TransceiverRolesTest {
    @Test fun answererAdoptsAudioCameraScreenInOfferOrder() {
        val r = TransceiverRoles.adopt(listOf(AUDIO, VIDEO, VIDEO))
        assertEquals(TransceiverRoles.Roles(audio = 0, camera = 1, screen = 2), r)
        assertTrue(r.screenChannel)
    }

    @Test fun anOlderOfferHasNoScreenChannel() {
        val r = TransceiverRoles.adopt(listOf(AUDIO, VIDEO))
        assertEquals(TransceiverRoles.Roles(audio = 0, camera = 1, screen = null), r)
        assertFalse(r.screenChannel)
        // My share then goes out on the camera transceiver, and the camera comes back when it ends.
        assertEquals(TransceiverRoles.Sends("screen", null), TransceiverRoles.sends(false, "camera", "screen"))
        assertEquals(TransceiverRoles.Sends("camera", null), TransceiverRoles.sends(false, "camera", null))
    }

    @Test fun withAScreenChannelTheCameraKeepsGoing() {
        assertEquals(TransceiverRoles.Sends("camera", "screen"), TransceiverRoles.sends(true, "camera", "screen"))
        assertEquals(TransceiverRoles.Sends("camera", null), TransceiverRoles.sends(true, "camera", null))
    }

    @Test fun oddOrdersAndExtraTransceivers() {
        assertEquals(TransceiverRoles.Roles(audio = 1, camera = 0, screen = 2), TransceiverRoles.adopt(listOf(VIDEO, AUDIO, VIDEO, VIDEO, AUDIO)))
        assertEquals(TransceiverRoles.Roles(audio = 0, camera = 2, screen = null), TransceiverRoles.adopt(listOf(AUDIO, null, VIDEO)))
        // Already-known roles are kept.
        assertEquals(TransceiverRoles.Roles(audio = 0, camera = 1, screen = 2), TransceiverRoles.adopt(listOf(AUDIO, VIDEO, VIDEO), TransceiverRoles.Roles(audio = 0, camera = 1)))
    }

    @Test fun incomingVideoOnTheScreenReceiverIsTheirScreen() {
        assertTrue(TransceiverRoles.isRemoteScreen("r2", "r2"))
        assertFalse(TransceiverRoles.isRemoteScreen("r1", "r2"))
        assertFalse("no screen channel: everything is the camera", TransceiverRoles.isRemoteScreen("r1", null))
    }
}
