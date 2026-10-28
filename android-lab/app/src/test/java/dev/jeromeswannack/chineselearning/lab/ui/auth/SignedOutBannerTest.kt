package dev.jeromeswannack.chineselearning.lab.ui.auth

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.auth.SessionRules
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.ui.kit.SIGNED_OUT_BANNER_TAG
import dev.jeromeswannack.chineselearning.lab.ui.kit.SIGNED_OUT_SIGN_IN_TAG
import dev.jeromeswannack.chineselearning.lab.ui.kit.SignedOutBanner
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.ShellFrame
import dev.jeromeswannack.chineselearning.lab.ui.study.TakeTranscription
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionComparison
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionUi
import dev.jeromeswannack.chineselearning.lab.ui.study.YouSaidFailed
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/** The signed-out banner over every screen, and the transcription row's "Signed out — sign in again". */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class SignedOutBannerTest {
    @get:Rule val compose = createComposeRule()

    @Test fun theBannerShowsAboveTheScreenAndSignsIn() {
        var signIns = 0
        compose.setContent {
            LabTheme {
                ShellFrame(NavRules.tabsFor(NavRole()), null, showBar = true, onSelect = {}, topBanner = { SignedOutBanner({ signIns++ }) }) {
                    Box(Modifier.fillMaxSize()) { Text("Home") }
                }
            }
        }
        compose.onNodeWithTag(SIGNED_OUT_BANNER_TAG).assertIsDisplayed()
        compose.onNodeWithText(SessionRules.signedOutBanner("lab")).assertIsDisplayed()
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithTag(SIGNED_OUT_SIGN_IN_TAG).performClick()
        assertEquals(1, signIns)
    }

    @Test fun aStudySessionGetsTheCompactBar() {
        compose.setContent { LabTheme { SignedOutBanner({}, compact = true) } }
        compose.onNodeWithText("Sign in").assertIsDisplayed()
    }

    @Test fun a401OnTheUploadIsSignedOutNotCouldntTranscribe() {
        val live = CompletableDeferred<String>().apply { completeExceptionally(IllegalStateException("mint 401")) }
        val out = runBlocking { TakeTranscription.outcome(live, online = { true }, compare = { TranscriptionComparison(it, "", false, false) }, upload = { throw UnauthorizedException() }) }
        assertEquals(TranscriptionUi.SignedOut, out.ui)
        compose.setContent { LabTheme { YouSaidFailed(SessionRules.SIGNED_OUT_TRANSCRIPTION_NOTE, {}, title = SessionRules.SIGNED_OUT_TRANSCRIPTION) } }
        compose.onNodeWithText("Signed out — sign in again").assertIsDisplayed()
    }
}
