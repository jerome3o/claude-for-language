package dev.jeromeswannack.chineselearning.lab.ui.study

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The study card's own per-device settings (the web keeps these in localStorage):
 * the forced-offline override (services/offlineMode.ts `manualOfflineMode`) and whether the
 * first-card explainer has been dismissed (`firstCardExplainerSeen`), and whether a spoken answer
 * is submitted at once (`spokenAutoSubmit`).
 */
class StudyPrefs private constructor(context: Context) {
    private val sp = context.getSharedPreferences("lab_study", Context.MODE_PRIVATE)
    private val _forcedOffline = MutableStateFlow(sp.getBoolean(FORCED_OFFLINE, false))

    /** Forced offline: audio from the cache or the device voice, AI features off. */
    val forcedOffline: StateFlow<Boolean> = _forcedOffline

    fun setForcedOffline(on: Boolean) {
        sp.edit().putBoolean(FORCED_OFFLINE, on).apply()
        _forcedOffline.value = on
    }

    var explainerSeen: Boolean
        get() = sp.getBoolean(EXPLAINER_SEEN, false)
        set(v) = sp.edit().putBoolean(EXPLAINER_SEEN, v).apply()

    /**
     * Settings → "Submit spoken answers automatically" (on by default; the web's
     * services/spokenAnswerPrefs.ts): the 🎤 on a typing card checks what was said at once;
     * off = it fills the box and Check submits it.
     */
    var spokenAutoSubmit: Boolean
        get() = sp.getBoolean(SPOKEN_AUTO_SUBMIT, true)
        set(v) = sp.edit().putBoolean(SPOKEN_AUTO_SUBMIT, v).apply()

    companion object {
        private const val FORCED_OFFLINE = "forced_offline"
        private const val EXPLAINER_SEEN = "first_card_explainer_seen"
        private const val SPOKEN_AUTO_SUBMIT = "spoken_auto_submit"
        @Volatile private var instance: StudyPrefs? = null
        fun get(context: Context): StudyPrefs = instance ?: synchronized(this) {
            instance ?: StudyPrefs(context.applicationContext).also { instance = it }
        }
    }
}
