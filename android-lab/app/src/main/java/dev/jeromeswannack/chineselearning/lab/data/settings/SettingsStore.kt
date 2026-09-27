package dev.jeromeswannack.chineselearning.lab.data.settings

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPrefs
import kotlinx.coroutines.flow.StateFlow

/**
 * Package D's device-local settings (the web keeps these in localStorage): the forced
 * offline flag (services/offlineMode.ts `manualOfflineMode`, stored by StudyPrefs) and the
 * last backup's date and size. Own SharedPreferences file; device settings, so signing out keeps them (like localStorage).
 */
class SettingsStore private constructor(context: Context) {
    private val sp = context.getSharedPreferences("lab_settings", Context.MODE_PRIVATE)
    private val study = StudyPrefs.get(context)

    /**
     * Settings → "Force offline": audio only from the phone (cache, else the device voice),
     * AI off. The SAME flag as the study screen's offline pill (StudyPrefs) — one source of truth.
     */
    val forcedOffline: StateFlow<Boolean> get() = study.forcedOffline

    fun setForcedOffline(on: Boolean) = study.setForcedOffline(on)

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
