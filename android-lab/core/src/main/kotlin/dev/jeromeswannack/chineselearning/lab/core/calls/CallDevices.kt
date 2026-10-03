package dev.jeromeswannack.chineselearning.lab.core.calls

/**
 * Port of shared/calls/devices.ts — microphone / camera on or off when a call (re)starts (round 5).
 *
 * Minghui found her camera "off" every time she joined (2–3 Oct 2026): round 4 remembered "camera
 * off" across calls, so switching it off at the end of one lesson started the next one dark, and on
 * the web a camera that opened while the room was still connecting was never announced. Now:
 * - the camera always starts ON (joining, rejoining, the next call of the lesson) — never remembered;
 * - the microphone keeps round 4's behaviour: a muted mic comes back muted;
 * - a device that opens after Join is announced as soon as the call has started joining ([announceDevice]).
 *
 * Parity-tested against the TypeScript (parity/fixtures/calls-follow.ts → CallsFollowParityTest).
 */
object CallDevices {
    enum class Device(val wire: String) { MIC("mic"), CAM("cam") }

    /**
     * `deviceOnWhenOpened`: on or off for a device that has just opened. [restore]: the preview / a
     * rejoin (not a tap); a tap to turn a device on always turns it on. [micOff]: the mic was muted
     * when I last left a call.
     */
    fun deviceOnWhenOpened(device: Device, restore: Boolean, micOff: Boolean): Boolean {
        if (device == Device.CAM || !restore) return true
        return !micOff
    }

    /** `CAMERA_ON_AT_START`: the camera at the start of a call — always on (nothing remembered). */
    const val CAMERA_ON_AT_START = true

    /** `announceDevice`: must a device that opened (or changed) now be announced to the room? From Join ('joining') until the call is over. */
    fun announceDevice(phase: String): Boolean = phase == "joining" || phase == "live"
}
