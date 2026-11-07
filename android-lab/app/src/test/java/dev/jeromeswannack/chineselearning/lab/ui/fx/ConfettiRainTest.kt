package dev.jeromeswannack.chineselearning.lab.ui.fx

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * "When I go off and do extra sentences … the confetti falls whenever I try an additional one, even
 * when I get it wrong" (Jerome, Nov 2026): the Sentence round's "done" confetti restarted every time
 * its area changed size (a take starting / ending changes the layout). It rains ONCE per key.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class ConfettiRainTest {
    @get:Rule val compose = createComposeRule()

    @Test fun rainsOncePerKeyWhateverTheAreaDoes() {
        var rains = 0
        var height by mutableIntStateOf(600)
        var key by mutableIntStateOf(1)
        compose.setContent {
            Box(Modifier.fillMaxWidth().height(height.dp)) {
                ConfettiRain(key, listOf(Color.Red), Modifier.fillMaxWidth().height(height.dp), count = 10, onRain = { rains++ })
            }
        }
        compose.waitForIdle()
        assertEquals(1, rains)

        // The layout changes under it (a take starts, a "You said" row appears): no second rain.
        compose.runOnIdle { height = 420 }
        compose.waitForIdle()
        compose.runOnIdle { height = 700 }
        compose.waitForIdle()
        assertEquals(1, rains)

        // A new celebration (a new key) rains again.
        compose.runOnIdle { key = 2 }
        compose.waitForIdle()
        assertEquals(2, rains)
    }
}
