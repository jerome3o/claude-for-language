package dev.jeromeswannack.chineselearning.lab.ui.study

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The study card's own per-device settings (the web keeps these in localStorage):
 * the forced-offline override (services/offlineMode.ts `manualOfflineMode`) and whether the
 * first-card explainer has been dismissed (`firstCardExplainerSeen`), and whether a spoken answer
 * skips the review step (`spokenSkipReview`).
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
     * Settings → "Skip the review — submit spoken answers as soon as I stop" (OFF by default; the
     * web's services/spokenAnswerPrefs.ts): on, the 🎤 on a typing card checks what was said at once;
     * off, the transcript waits on the review step (🔁 Retry · ✏️ Edit · ✓ Submit).
     *
     * Stored under the old "Submit spoken answers automatically" key (same meaning: true = checked at
     * once). It was only ever written when someone flipped the switch, so a phone that never touched
     * it has no value and gets the new default (the review); a choice made on purpose is kept.
     */
    var spokenSkipReview: Boolean
        get() = sp.getBoolean(SPOKEN_AUTO_SUBMIT, false)
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
