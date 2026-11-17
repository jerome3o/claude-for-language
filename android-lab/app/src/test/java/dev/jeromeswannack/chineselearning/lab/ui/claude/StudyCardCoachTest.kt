package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadSamples as S

/**
 * The study card's Coach is a Claude thread now (docs/CHAT.md "Coach entry points"; the web's
 * ClaudeThreadPage `source=study_card`): ⋯ → Sentence coach opens `/chats/claude/new?draft=…&source=study_card`,
 * ✎ Check on "You said" `…?text=…&intent=check&source=study_card`; "← Back to your card" under the header goes
 * back to the card, kept under the thread in the back stack. Roborazzi `retire-coach-*` (dark).
 */
class StudyCardCoachTest : LabScreenshotTest() {
    @Test fun theCardsLinksAreThreads() {
        assertEquals("/chats/claude/new?draft=${android.net.Uri.encode("我打算明年去中国")}&source=study_card", Routes.claudeThreadNew(draft = "我打算明年去中国", source = SOURCE_STUDY_CARD))
        assertEquals("/chats/claude/new?text=${android.net.Uri.encode("我想去")}&intent=check&source=study_card", Routes.claudeThreadNew(text = "我想去", intent = "check", source = SOURCE_STUDY_CARD))
    }

    @Test fun backToYourCardReturnsToTheCard() {
        compose.setContent {
            LabTheme {
                val nav = rememberNavController()
                NavHost(nav, startDestination = "study") {
                    composable("study") {
                        Box(Modifier.fillMaxSize()) {
                            Text("打算 · to plan", Modifier.testTag("card"))
                            androidx.compose.material3.Button(onClick = { nav.navigate("thread") }, modifier = Modifier.testTag("open-coach")) { Text("Sentence coach") }
                        }
                    }
                    composable("thread") { ClaudeThreadScreen(S.checkResult, ClaudeThreadActions(), headerExtra = { BackToCardButton { nav.popBackStack() } }) }
                }
            }
        }
        compose.onNodeWithTag("open-coach").performClick()
        compose.onNodeWithTag(BACK_TO_CARD_TAG).performClick()
        compose.onNodeWithText("打算 · to plan").assertExists()
    }

    @Test fun shotDraftDark() = shoot("retire-coach-01-card-draft-dark", dark = true) {
        ClaudeThreadScreen(S.newChinese, ClaudeThreadActions(), headerExtra = { BackToCardButton {} })
    }

    @Test fun shotCheckedDark() = shoot("retire-coach-02-card-checked-dark", dark = true) {
        ClaudeThreadScreen(S.checkResult, ClaudeThreadActions(), headerExtra = { BackToCardButton {} })
    }
}
