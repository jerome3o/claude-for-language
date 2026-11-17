package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.claude.CardTools
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.CardClaudeTags
import dev.jeromeswannack.chineselearning.lab.ui.study.CardThreadPreview
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import dev.jeromeswannack.chineselearning.lab.ui.study.CardClaudeSamples as S

/**
 * The lines under a Claude reply open what they made (ResultLinks.kt; docs/CHAT.md "Tool lines you
 * can tap"; the web's components/claude/ResultLink.tsx): "🎓 Mini lesson made: … · Start ›" is one
 * tap target → the lesson's path; back (the nav back stack) lands on the card again with its sheet
 * open — the study card remembers its sheet in saved state (CardStage's `askReturn`), as here.
 * Roborazzi: `claude-result-*` (light + dark).
 */
class ResultLinksTest : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    @Test fun theLessonLineIsOneTapToTheLesson() {
        val opened = mutableListOf<CardTools.Link>()
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalResultOpen provides { link: CardTools.Link -> opened += link }, LocalResultContext provides "card") {
                    CardThreadPreview(S.lessonMade, height = 900.dp)
                }
            }
        }
        val line = compose.onNodeWithTag(ResultLinkTags.line("lesson"))
        line.assertTextContains("🎓 Mini lesson made: 治理 vs 这里：听力辨音", substring = true)
        line.assertTextContains("Start ›", substring = true)
        line.assertHasClickAction()
        compose.onNodeWithTag(CardClaudeTags.tool("lesson")).assertExists()
        line.performClick()
        assertEquals(listOf("/lessons/L1/play?from=claude"), opened.map { it.path })
        assertEquals("lesson", opened.single().kind)
    }

    @Test fun theEditLineKeepsUndoAndOpensTheCard() {
        val opened = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalResultOpen provides { link: CardTools.Link -> opened += link.path }) {
                    CardThreadPreview(S.edited, height = 900.dp)
                }
            }
        }
        compose.onNodeWithTag(CardClaudeTags.UNDO).assertExists()
        compose.onNodeWithTag(ResultLinkTags.go("edited")).performClick()
        assertEquals(listOf("/cards/n1"), opened)
    }

    /** The study card's way back: the sheet's state is saved with the screen, so back shows it open again. */
    @Test fun backFromTheLessonShowsTheSheetAgain() {
        compose.setContent {
            LabTheme {
                val nav = rememberNavController()
                NavHost(nav, startDestination = "study") {
                    composable("study") {
                        var askReturn by rememberSaveable { mutableStateOf<String?>(null) }
                        var open by rememberSaveable { mutableStateOf(true) }
                        if (askReturn != null) open = true
                        Box(Modifier.fillMaxSize().testTag("study-card")) {
                            if (open) {
                                CompositionLocalProvider(LocalResultOpen provides { link: CardTools.Link -> askReturn = "t1"; nav.navigate("lesson") }) {
                                    CardThreadPreview(S.lessonMade, height = 900.dp)
                                }
                            }
                        }
                    }
                    composable("lesson") { Text("治理 vs 这里：听力辨音 — the player", Modifier.testTag("player")) }
                }
                androidx.compose.runtime.LaunchedEffect(Unit) { navRef = nav }
            }
        }
        compose.onNodeWithTag(ResultLinkTags.line("lesson")).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("player").assertExists()
        compose.runOnUiThread { navRef!!.popBackStack() }
        compose.waitForIdle()
        compose.onNodeWithTag("study-card").assertExists()
        compose.onNodeWithTag(ResultLinkTags.line("lesson")).assertExists()
        compose.onNodeWithText("Start ›", substring = true).assertExists()
    }

    @Test fun shotLessonLine() = shoot("claude-result-01-lesson-line") { CompositionLocalProvider(LocalResultContext provides "card") { CardThreadPreview(S.lessonMade, height = 915.dp) } }
    @Test fun shotLessonLineDark() = shoot("claude-result-02-lesson-line-dark", dark = true) { CardThreadPreview(S.lessonMade, height = 915.dp) }
    @Test fun shotEditLineDark() = shoot("claude-result-03-edit-line-dark", dark = true) { CardThreadPreview(S.edited, height = 915.dp) }

    private companion object {
        var navRef: androidx.navigation.NavHostController? = null
    }
}
