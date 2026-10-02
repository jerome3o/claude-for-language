package dev.jeromeswannack.chineselearning.lab.data.calls

import android.content.SharedPreferences
import dev.jeromeswannack.chineselearning.lab.ui.calls.CallDevicePrefs

/**
 * Mic / camera on or off as I last left a call, on this phone (web DevicePrefs micOff / camOff in
 * localStorage): the next join — the next call of the lesson, the app reopened — comes back the same way.
 */
class CallDevicePrefsStore(private val prefs: SharedPreferences) : CallDevicePrefs {
    override var micOff: Boolean
        get() = prefs.getBoolean(MIC_OFF, false)
        set(v) { prefs.edit().putBoolean(MIC_OFF, v).apply() }
    override var camOff: Boolean
        get() = prefs.getBoolean(CAM_OFF, false)
        set(v) { prefs.edit().putBoolean(CAM_OFF, v).apply() }

    private companion object {
        const val MIC_OFF = "device-mic-off"
        const val CAM_OFF = "device-cam-off"
    }
}
