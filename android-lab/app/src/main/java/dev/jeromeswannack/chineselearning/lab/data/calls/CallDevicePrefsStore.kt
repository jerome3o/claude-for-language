package dev.jeromeswannack.chineselearning.lab.data.calls

import android.content.SharedPreferences
import dev.jeromeswannack.chineselearning.lab.ui.calls.CallDevicePrefs

/**
 * The mic muted when I last left a call, on this phone (web DevicePrefs micOff in localStorage): the
 * next join — the next call of the lesson, the app reopened — comes back muted. The camera is never
 * remembered (round 5, core CallDevices): it always starts on. The round-4 "camera off" key is dropped.
 */
class CallDevicePrefsStore(private val prefs: SharedPreferences) : CallDevicePrefs {
    init {
        if (prefs.contains(LEGACY_CAM_OFF)) prefs.edit().remove(LEGACY_CAM_OFF).apply()
    }

    override var micOff: Boolean
        get() = prefs.getBoolean(MIC_OFF, false)
        set(v) { prefs.edit().putBoolean(MIC_OFF, v).apply() }

    private companion object {
        const val MIC_OFF = "device-mic-off"
        /** Round 4 remembered the camera off across calls; never read again. */
        const val LEGACY_CAM_OFF = "device-cam-off"
    }
}
