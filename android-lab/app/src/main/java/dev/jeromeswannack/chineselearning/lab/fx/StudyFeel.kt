package dev.jeromeswannack.chineselearning.lab.fx

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.HardMode

/**
 * Hard mode's moments, felt (core [HardMode] `StudyFeel`: success · round_right · round_done · nearly · miss;
 * the web's services/studyFeel.ts). Haptics follow More / Settings → Haptics, sounds the app's sound switch.
 */
fun interface StudyFeelPlayer {
    fun play(feel: String)
}

/** The app's player: [Haptics] + [Sounds]. */
class AppStudyFeel(private val app: LabApp) : StudyFeelPlayer {
    override fun play(feel: String) {
        when (feel) {
            HardMode.FEEL_SUCCESS -> { app.haptics.success(); app.sounds.play(Sounds.Sfx.CORRECT, 0.9f) }
            HardMode.FEEL_ROUND_RIGHT -> { app.haptics.success(0.85f); app.sounds.play(Sounds.Sfx.CORRECT, 0.7f, rate = 1.12f) }
            HardMode.FEEL_ROUND_DONE -> { app.haptics.celebrate(); app.sounds.play(Sounds.Sfx.MILESTONE, 0.8f) }
            HardMode.FEEL_NEARLY -> app.haptics.tick()
            HardMode.FEEL_MISS -> { app.haptics.wrong(); app.sounds.play(Sounds.Sfx.WRONG, 0.5f) }
        }
    }
}

/** Tests provide a recording player here; null = the app's. */
val LocalStudyFeel = staticCompositionLocalOf<StudyFeelPlayer?> { null }

/** `(feel?) -> Unit` for this composition: the test's player, else the app's, else nothing (previews). */
@Composable
fun rememberStudyFeel(): (String?) -> Unit {
    val local = LocalStudyFeel.current
    val app = LocalContext.current.applicationContext as? LabApp
    return remember(local, app) {
        val player = local ?: app?.let { AppStudyFeel(it) }
        val play: (String?) -> Unit = { feel -> if (feel != null) player?.play(feel) }
        play
    }
}
