package dev.jeromeswannack.chineselearning.lab.data.settings

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Package D's device-local settings (the web keeps these in localStorage): the forced
 * offline flag (services/offlineMode.ts `manualOfflineMode`) and the last backup's date
 * and size. Own SharedPreferences file; device settings, so signing out keeps them (like localStorage).
 */
class SettingsStore private constructor(context: Context) {
    private val sp = context.getSharedPreferences("lab_settings", Context.MODE_PRIVATE)
    private val _forcedOffline = MutableStateFlow(sp.getBoolean("manual_offline", false))

    /** Settings → "Force offline": audio only from the phone (cache, else the device voice). */
    val forcedOffline: StateFlow<Boolean> = _forcedOffline

    fun setForcedOffline(on: Boolean) {
        sp.edit().putBoolean("manual_offline", on).apply()
        _forcedOffline.value = on
    }

    var lastExportAt: Long
        get() = sp.getLong("last_export_at", 0)
        set(v) = sp.edit().putLong("last_export_at", v).apply()

    var lastExportSize: Long
        get() = sp.getLong("last_export_size", 0)
        set(v) = sp.edit().putLong("last_export_size", v).apply()

    companion object {
        @Volatile private var instance: SettingsStore? = null
        fun get(context: Context): SettingsStore =
            instance ?: synchronized(this) { instance ?: SettingsStore(context.applicationContext).also { instance = it } }

        /** For code that plays audio: true when the learner forced offline mode. */
        fun forcedOffline(context: Context): Boolean = get(context).forcedOffline.value
    }
}
