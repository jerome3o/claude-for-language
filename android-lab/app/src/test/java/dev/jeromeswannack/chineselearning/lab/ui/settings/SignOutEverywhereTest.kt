package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText

import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.test.assertEquals

/**
 * Settings → "Sign out of all devices…" (web: components/settings/SignOutSection.tsx): a confirm
 * first, then the action; a refusal (offline, server) is shown and nothing else happens.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
@OptIn(ExperimentalRoborazziApi::class)
class SignOutEverywhereTest {
    @get:Rule val compose = createComposeRule()

    private val ui = SettingsUi(budget = StudyBudget(3, 6), budgetDraft = StudyBudget(3, 6))

    private fun show(online: Boolean = true, onEverywhere: ((String) -> Unit) -> Unit) {
        compose.setContent {
            LabTheme {
                SettingsScreen(ui, SettingsEnv(role = NavRole(loaded = true), online = online), SettingsActions(onBack = {}, signOutEverywhere = onEverywhere))
            }
        }
        compose.waitForIdle()
    }

    private fun scrollToSignOutAll() {
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Sign out of all devices…"))
        compose.waitForIdle()
    }

    @Test fun confirmThenSignOutEverywhere() {
        var calls = 0
        show { calls++ }
        scrollToSignOutAll()
        compose.onNodeWithText("Sign out of all devices…").performClick()
        compose.waitForIdle()
        assertEquals(0, calls) // nothing before the confirm
        compose.onNodeWithText("Sign out everywhere?").assertExists()
        captureScreenRoboImage("screenshots/settings-12-sign-out-everywhere.png")
        compose.onNodeWithText("Sign out everywhere").performClick()
        compose.waitForIdle()
        assertEquals(1, calls)
        compose.onNodeWithText("Signing out…").assertExists()
    }

    @Test fun cancelDoesNothing() {
        var calls = 0
        show { calls++ }
        scrollToSignOutAll()
        compose.onNodeWithText("Sign out of all devices…").performClick()
        compose.onNodeWithText("Cancel").performClick()
        compose.waitForIdle()
        assertEquals(0, calls)
        compose.onNodeWithText("Sign out everywhere?").assertDoesNotExist()
    }

    @Test fun aRefusalIsShown() {
        show { failed -> failed("Nothing was signed out: No connection — try again when you're online.") }
        scrollToSignOutAll()
        compose.onNodeWithText("Sign out of all devices…").performClick()
        compose.onNodeWithText("Sign out everywhere").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Nothing was signed out: No connection — try again when you're online.", substring = true).assertExists()
        compose.onNodeWithText("Sign out of all devices…").assertExists() // usable again
    }

    @Test fun offlineSaysItNeedsAConnection() {
        var calls = 0
        show(online = false) { calls++ }
        scrollToSignOutAll()
        compose.onNodeWithText("Sign out of all devices…").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Sign out everywhere?").assertDoesNotExist()
        compose.onNodeWithText("You’re offline — this needs a connection.", substring = true).assertExists()
        assertEquals(0, calls)
    }
}
