package dev.jeromeswannack.chineselearning.lab.data.calls.rtc

/**
 * Which transceiver carries what — the rules of frontend/src/services/calls/peer.ts, kept pure so
 * they are unit-tested without WebRTC:
 *
 * - The offerer (impolite side) creates audio, video (camera), video (screen), in that order.
 * - The answerer adopts, in the offer's order: the first audio, the first video = camera, the second
 *   video = screen ([adopt]).
 * - An older app offers only one video m-line: there is no screen channel ([Roles.screenChannel]
 *   false), so a share goes out on the camera transceiver instead ([sends]) and their screen arrives
 *   on the camera stream.
 */
object TransceiverRoles {
    enum class Kind { AUDIO, VIDEO }

    /** Indices into the peer connection's transceivers. */
    data class Roles(val audio: Int? = null, val camera: Int? = null, val screen: Int? = null) {
        /** Both sides have a screen transceiver (web `screenChannel`). */
        val screenChannel: Boolean get() = screen != null
    }

    /** Port of adoptTransceivers' loop: first audio, first video = camera, the next video = screen. */
    fun adopt(kinds: List<Kind?>, current: Roles = Roles()): Roles {
        var r = current
        kinds.forEachIndexed { i, k ->
            when {
                k == Kind.AUDIO && r.audio == null -> r = r.copy(audio = i)
                k == Kind.VIDEO && r.camera == null -> r = r.copy(camera = i)
                k == Kind.VIDEO && r.camera != i && r.screen == null -> r = r.copy(screen = i)
            }
        }
        return r
    }

    /** What the camera and screen transceivers send. */
    data class Sends<T>(val camera: T?, val screen: T?)

    /** With a screen channel: camera on camera, screen on screen. Without (an older app): a share replaces the camera. */
    fun <T> sends(screenChannel: Boolean, camera: T?, screen: T?): Sends<T> =
        if (!screenChannel && screen != null) Sends(screen, null) else Sends(camera, screen)

    /** Incoming video: the screen transceiver's track is their screen; anything else is their camera. */
    fun isRemoteScreen(receiverId: String?, screenReceiverId: String?): Boolean =
        receiverId != null && screenReceiverId != null && receiverId == screenReceiverId
}
