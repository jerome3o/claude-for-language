package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.claude.TutorVisibility
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.chat.ClaudeTutorVisibilitySection
import dev.jeromeswannack.chineselearning.lab.ui.chat.ClaudeTutorVisibilityTags
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadActions
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadSamples
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadScreen
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadTags
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S

/**
 * What a tutor can read of her student's Claude chats (core claude.TutorVisibility; docs/CHAT.md
 * "Claude threads" → "What your tutor sees"): the student page's "✦ Asked Claude" (context chips, the
 * card chip → her card hub view), the read-only thread (no composer / ⋯ / chips), the learner's ⋯ →
 * Share with my tutor / Hide from my tutor + the shared line, Settings → "Your tutor can see" — plus
 * the Roborazzi shots, light + dark.
 */
class StudentClaudeThreadsTest : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    private val typing = VoiceDictationUi(mode = "type")

    @Test fun theSectionListsTheSharedChatsWithTheirChips() {
        val opened = mutableListOf<String>()
        compose.setContent { LabTheme { Column { AskedClaudeSection("rel-jerome", S.claude, "Jerome", { opened += it }, S.now) } } }
        compose.onAllNodesWithTag(StudentClaudeTags.ROW).assertCountEquals3()
        compose.onNodeWithText("📇 Asked on card · 换乘").performClick()
        compose.onNodeWithText("换乘和转车有什么不一样？").performClick()
        compose.waitForIdle()
        assertEquals(listOf("/connections/rel-jerome/cards/n3", "/connections/rel-jerome/claude/nq-q1?from=student_page"), opened)
        compose.onNodeWithText("Practice · 在饭店点菜", substring = true).assertIsDisplayed()
    }

    private fun androidx.compose.ui.test.SemanticsNodeInteractionCollection.assertCountEquals3() = assertEquals(3, fetchSemanticsNodes().size)

    @Test fun nothingSharedSaysWhatHeShares() {
        compose.setContent { LabTheme { AskedClaudeSection("rel-jerome", S.claude.copy(threads = emptyList(), total = 0, visibility = "none"), "Jerome", {}, S.now) } }
        compose.onNodeWithTag(StudentClaudeTags.EMPTY).assertTextEquals(TutorVisibility.tutorEmptyText("Jerome", "none"))
    }

    @Test fun theTutorReadsTheChatReadOnly() {
        val opened = mutableListOf<String>()
        compose.setContent { LabTheme { StudentClaudeThreadScreen("rel-jerome", "Jerome", S.claudeThread, { opened += it }, {}) } }
        compose.waitForIdle()
        compose.onNodeWithTag(ClaudeThreadTags.READ_ONLY).assertTextEquals(TutorVisibility.tutorReadOnlyLine("Jerome"))
        compose.onNodeWithTag(ClaudeThreadTags.COMPOSER).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.MORE).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.CHIPS).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.CONTEXT_CHIP).performClick()
        compose.waitForIdle()
        assertEquals(listOf("/connections/rel-jerome/cards/n3"), opened)
    }

    @Test fun theLearnerSharesAChatFromItsMenu() {
        var shared = 0
        val practice = ClaudeThreadSamples.practiceRole.copy(canShare = true)
        compose.setContent { LabTheme { ClaudeThreadScreen(practice, ClaudeThreadActions(onShare = { shared++ }), voicePreview = typing, menuPreview = true) } }
        compose.waitForIdle()
        compose.onNodeWithTag(ClaudeThreadTags.SHARED).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.SHARE).assertTextEquals("👁 Share with my tutor").performClick()
        compose.waitForIdle()
        assertEquals(1, shared)
    }

    @Test fun aCardQuestionIsVisibleByDefault() {
        compose.setContent { LabTheme { ClaudeThreadScreen(ClaudeThreadSamples.cardThread.copy(canShare = true), ClaudeThreadActions(), voicePreview = typing, menuPreview = true) } }
        compose.waitForIdle()
        compose.onNodeWithTag(ClaudeThreadTags.SHARED).assertTextEquals("👁 Your tutor can read this chat")
        compose.onNodeWithTag(ClaudeThreadTags.SHARE).assertTextEquals("🙈 Hide from my tutor")
    }

    @Test fun theSettingPicksOneOfThree() {
        val picked = mutableListOf<String>()
        compose.setContent { LabTheme { ClaudeTutorVisibilitySection("card_only", null) { picked += it } } }
        compose.onNodeWithText("Card questions (default)").assertIsDisplayed()
        compose.onNodeWithTag(ClaudeTutorVisibilityTags.option("all")).performClick()
        compose.onNodeWithTag(ClaudeTutorVisibilityTags.option("none")).performClick()
        assertEquals(listOf("all", "none"), picked)
    }

    @Test fun askedClaudeToday() {
        val opened = mutableListOf<String>()
        compose.setContent { LabTheme { Column { AskedClaudeTodayLine("rel-jerome", 3, { opened += it }); AskedClaudeTodayLine("rel-lily", 0, { opened += it }) } } }
        compose.onAllNodesWithTag(StudentClaudeTags.TODAY).fetchSemanticsNodes().let { assertEquals(1, it.size) }
        compose.onNodeWithText("✦ Asked Claude 3× today").performClick()
        assertEquals(listOf("/connections/rel-jerome/claude-chats"), opened)
    }

    // ---------------- screenshots ----------------

    @androidx.compose.runtime.Composable
    private fun section() {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            AskedClaudeTodayLine("rel-jerome", 3, {})
            AskedClaudeSection("rel-jerome", S.claude, "Jerome", {}, S.now)
        }
    }

    @Test fun shotSection() = shoot("claude-tutor-01-asked-claude") { section() }
    @Test fun shotSectionDark() = shoot("claude-tutor-02-asked-claude-dark", dark = true) { section() }
    @Test fun shotReadOnly() = shoot("claude-tutor-03-read-only") { StudentClaudeThreadScreen("rel-jerome", "Jerome", S.claudeThread, {}, {}) }
    @Test fun shotReadOnlyDark() = shoot("claude-tutor-04-read-only-dark", dark = true) { StudentClaudeThreadScreen("rel-jerome", "Jerome", S.claudeThread, {}, {}) }
    @Test fun shotSettings() = shoot("claude-tutor-05-settings") { Column(Modifier.padding(16.dp)) { ClaudeTutorVisibilitySection("card_only", null) {} } }
    @Test fun shotSettingsDark() = shoot("claude-tutor-06-settings-dark", dark = true) { Column(Modifier.padding(16.dp)) { ClaudeTutorVisibilitySection("all", null) {} } }
    @Test fun shotShareMenu() = shoot("claude-tutor-07-share-menu") {
        ClaudeThreadScreen(ClaudeThreadSamples.practiceRole.copy(canShare = true), ClaudeThreadActions(), voicePreview = typing, menuPreview = true)
    }
    @Test fun shotSharedLineDark() = shoot("claude-tutor-08-shared-line-dark", dark = true) {
        ClaudeThreadScreen(ClaudeThreadSamples.cardThread.copy(canShare = true), ClaudeThreadActions(), voicePreview = typing)
    }
}
