package dev.jeromeswannack.chineselearning.lab.ui.study

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The study card's own per-device settings (the web keeps these in localStorage):
 * the forced-offline override (services/offlineMode.ts `manualOfflineMode`) and whether the
 * first-card explainer has been dismissed (`firstCardExplainerSeen`), whether a spoken answer
 * skips the review step (`spokenSkipReview`) whether the answer shows word tags (`wordTagsOn`)
 * and whether never-seen characters shimmer (`newCharShimmerOn`).
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

    private val _wordTagsOn = MutableStateFlow(sp.getBoolean(WORD_TAGS_ON, true))

    /**
     * Settings → Study → "Word tags on the answer" (ON by default; the web's
     * services/wordTags.ts `readWordTagsOn`): the small pills under the meaning.
     */
    val wordTagsOn: StateFlow<Boolean> = _wordTagsOn

    fun setWordTagsOn(on: Boolean) {
        sp.edit().putBoolean(WORD_TAGS_ON, on).apply()
        _wordTagsOn.value = on
    }

    private val _picturesOn = MutableStateFlow(sp.getBoolean(PICTURES_ON, true))

    /**
     * Settings → Study → "Show pictures on cards" (ON by default; the web's services/noteImages.ts
     * `cardPicturesEnabled`): a note's picture with the English on meaning → hanzi, and on the
     * answer side of the other cards (core cards/NoteImage.kt).
     */
    val picturesOn: StateFlow<Boolean> = _picturesOn

    fun setPicturesOn(on: Boolean) {
        sp.edit().putBoolean(PICTURES_ON, on).apply()
        _picturesOn.value = on
    }

    private val _newCharShimmerOn = MutableStateFlow(sp.getBoolean(NEW_CHAR_SHIMMER_ON, true))

    /**
     * Settings → Study → "Shimmer new characters" (ON by default; the web's
     * services/newCharacters.ts `readNewCharShimmerOn`): never-seen characters shimmer on the card.
     */
    val newCharShimmerOn: StateFlow<Boolean> = _newCharShimmerOn

    fun setNewCharShimmerOn(on: Boolean) {
        sp.edit().putBoolean(NEW_CHAR_SHIMMER_ON, on).apply()
        _newCharShimmerOn.value = on
    }

    private val _hardMode = MutableStateFlow(
        sp.getString(HARD_MODE, null)?.let { dev.jeromeswannack.chineselearning.lab.core.HardMode.parse(it) }
            ?: if (sp.getBoolean(SENTENCE_GATE, false)) dev.jeromeswannack.chineselearning.lab.core.HardMode.ALL else dev.jeromeswannack.chineselearning.lab.core.HardMode.OFF,
    )

    /**
     * Hard mode (core HardMode; the web's services/hardModePrefs.ts): "off" (the default) · "red" (red cards
     * only: learning / relearning) · "all". Set from the study session's 🎯 chip or Settings → Study. A
     * phone that had the old "Sentence round before the answer" switch on reads All cards.
     */
    val hardMode: StateFlow<String> = _hardMode

    fun setHardMode(mode: String) {
        val m = dev.jeromeswannack.chineselearning.lab.core.HardMode.parse(mode)
        sp.edit().putString(HARD_MODE, m).apply()
        _hardMode.value = m
    }

    private val _passHardMode = MutableStateFlow(dev.jeromeswannack.chineselearning.lab.core.PassAngles.parseMode(sp.getString(PASS_HARD_MODE, null)))

    /**
     * Hard mode in the homework pass (core PassAngles; the web's `usePassHardMode`, docs/HOMEWORK.md §3d):
     * its own setting so the session's stays as he set it — "all" (the default: a one-off pass is the only
     * time he sees those words for a while) · "red" (words he marks Not yet) · "off". Set from the pass's 🎯
     * chip or Settings → Study.
     */
    val passHardMode: StateFlow<String> = _passHardMode

    fun setPassHardMode(mode: String) {
        val m = dev.jeromeswannack.chineselearning.lab.core.PassAngles.parseMode(mode)
        sp.edit().putString(PASS_HARD_MODE, m).apply()
        _passHardMode.value = m
    }

    companion object {
        private const val SENTENCE_GATE = "sentence_gate"
        private const val PASS_HARD_MODE = "pass_hard_mode"
        private const val HARD_MODE = "hard_mode"
        private const val NEW_CHAR_SHIMMER_ON = "new_char_shimmer_on"
        private const val PICTURES_ON = "card_pictures_on"
        private const val WORD_TAGS_ON = "word_tags_on"
        private const val FORCED_OFFLINE = "forced_offline"
        private const val EXPLAINER_SEEN = "first_card_explainer_seen"
        private const val SPOKEN_AUTO_SUBMIT = "spoken_auto_submit"
        @Volatile private var instance: StudyPrefs? = null
        fun get(context: Context): StudyPrefs = instance ?: synchronized(this) {
            instance ?: StudyPrefs(context.applicationContext).also { instance = it }
        }
    }
}
