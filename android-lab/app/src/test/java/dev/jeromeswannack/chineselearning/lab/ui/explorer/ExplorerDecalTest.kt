package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.jeromeswannack.chineselearning.lab.core.explorer.DecalKind
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.FrequencyDecal
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetSamples
import dev.jeromeswannack.chineselearning.lab.ui.chars.WORD_TILE_TAG
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Frequency decals read the list shipped with the app; the ⓘ next to "Words with 字" toggles the key. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ExplorerDecalTest {
    @get:Rule val compose = createComposeRule()

    @Test fun shippedListGivesTheDecals() {
        val decal = shippedDecals()
        assertNotNull("the shipped word-freq list loads", decal)
        decal!!
        assertEquals(FrequencyDecal.TOP100, decal("行", DecalKind.CHAR))
        assertEquals(FrequencyDecal.TOP1000, decal("银行", DecalKind.WORD))
        assertEquals(FrequencyDecal.TOP2000, decal("不行", DecalKind.WORD))
        assertNull(decal("自行车", DecalKind.WORD))
        assertEquals(FrequencyDecal.RARE, decal("银子", DecalKind.WORD))
        assertEquals(FrequencyDecal.RARE, decal("收银台", DecalKind.WORD))
    }

    @Test fun keyToggles() {
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalExplorer provides ExplorerController()) {
                    CharacterView(CharSheetSamples.loaded().copy(decalOf = ExplorerSamples.decals), listOf(ExplorerItem.Char("行")), canWrite = false)
                }
            }
        }
        compose.onAllNodesWithTag(FREQ_KEY_TAG).assertCountEquals(0)
        compose.onNodeWithTag(FREQ_KEY_TOGGLE_TAG).performScrollTo().performClick()
        compose.onAllNodesWithTag(FREQ_KEY_TAG).assertCountEquals(1)
        compose.onAllNodesWithTag(WORD_TILE_TAG, useUnmergedTree = true).assertCountEquals(CharSheetSamples.xing.words.size)
        compose.onNodeWithTag(FREQ_KEY_TOGGLE_TAG).performScrollTo().performClick()
        compose.onAllNodesWithTag(FREQ_KEY_TAG).assertCountEquals(0)
    }
}
