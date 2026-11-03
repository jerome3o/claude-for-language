package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudePractice
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatScreen
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatSheetActions
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatUi
import dev.jeromeswannack.chineselearning.lab.ui.chat.ProposedDiscussCards
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatCoachSamples as C
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadSamples as S

/**
 * Practice with Claude + Discuss with Claude in the Lab app (docs/CHAT.md "Practice with Claude",
 * "Discuss with Claude"): a role-play thread's help chips (🆘 goes into the box), the roles line, Ask
 * only; the "Practice a situation" form; Discuss = the message's thread with the quote and Claude's
 * proposed cards — plus the Roborazzi shots, light + dark.
 */
class PracticeDiscussTest : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    private val typing = VoiceDictationUi(mode = "type")

    // ---------------- a role-play thread ----------------

    @Test fun aRolePlayHasTheHelpChipsAndTheRolesAndAsksOnly() {
        val drafts = mutableListOf<String>()
        val sent = mutableListOf<String>()
        compose.setContent { LabTheme { ClaudeThreadScreen(S.practiceRole, ClaudeThreadActions(onDraft = { drafts += it }, onSend = { t, _, _, _ -> sent += t }), voicePreview = typing) } }
        compose.waitForIdle()
        compose.onNodeWithTag(ClaudeThreadTags.READ_ONLY).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.COMPOSER).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.ROLES).assertTextEquals("✦ Claude plays 服务员 (a waiter) · You: 客人 (a customer)")
        compose.onNodeWithText("🎭 Practice · 在饭店点菜", useUnmergedTree = true).assertIsDisplayed()
        // Ask only: no ✏️ Check / 🔍 Explain in a role-play.
        compose.onNodeWithTag(ClaudeThreadTags.INTENTS).assertDoesNotExist()
        for (id in listOf("hint", "say", "correct")) compose.onNodeWithTag(ClaudeThreadTags.chip(id)).assertExists()
        // 🆘 How do I say…: into the box, nothing sent.
        compose.onNodeWithTag(ClaudeThreadTags.chip("say")).performClick()
        compose.waitForIdle()
        assertTrue(drafts.last().startsWith("🆘"), drafts.toString())
        assertTrue(sent.isEmpty())
        // 💡 is sent as it is.
        compose.onNodeWithTag(ClaudeThreadTags.chip("hint")).performClick()
        compose.waitForIdle()
        assertTrue(sent.single().startsWith("💡"))
    }

    @Test fun anOldCopiedPracticeChatStaysReadOnly() {
        compose.setContent { LabTheme { ClaudeThreadScreen(S.practice, ClaudeThreadActions()) } }
        compose.waitForIdle()
        compose.onNodeWithTag(ClaudeThreadTags.READ_ONLY).assertIsDisplayed()
        compose.onNodeWithText(dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats.PRACTICE_READ_ONLY_NOTE).assertIsDisplayed()
    }

    // ---------------- "Practice a situation" ----------------

    @Test fun aPresetFillsTheFormAndTheLevelIsPicked() {
        var form by mutableStateOf(PracticeForm())
        compose.setContent { LabTheme { Column { PracticeSituationForm(form, online = true, error = null) { form = it } } } }
        compose.waitForIdle()
        assertNull(form.context)
        compose.onNodeWithTag(PracticeTags.preset("taxi")).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(PracticeTags.level("beginner")).performClick()
        compose.waitForIdle()
        assertEquals(ClaudePractice.Context(scenario = "打车去火车站", aiRole = "出租车司机 (a taxi driver)", userRole = "乘客 (a passenger)", level = "beginner"), form.context)
        assertEquals("taxi", form.presetId)
        assertEquals("custom", form.copy(scenario = "打车去机场").presetId)
        // The API body.
        val dto = form.context!!.toDto()
        assertEquals("practice", dto.kind)
        assertEquals("beginner", dto.level)
    }

    @Test fun offlineTheFormSaysItNeedsAConnection() {
        compose.setContent { LabTheme { Column { PracticeSituationForm(PracticeForm().pick(ClaudePractice.SCENARIOS[0]), online = false, error = null) {} } } }
        compose.waitForIdle()
        compose.onNodeWithText("Practising with Claude needs a connection.").assertIsDisplayed()
    }

    // ---------------- Discuss with Claude ----------------

    @Test fun proposedCardsAreReadFromTheReply() {
        val cards = proposedCardsOf(S.discussThread.messages.last().tool_results)!!
        assertEquals(listOf("迟到", "下午"), cards.map { it.hanzi })
        assertNull(proposedCardsOf("""[{"tool":"search_cards","success":true,"data":{}}]"""))
        assertNull(proposedCardsOf("not json"))
    }

    @Test fun theDiscussSheetQuotesTheMessageAndShowsTheProposedCards() {
        compose.setContent { LabTheme { DiscussSheet(dark = false) } }
        compose.waitForIdle()
        compose.onNodeWithTag(DiscussClaudeTags.QUOTE).assertTextEquals(MESSAGE.content)
        compose.onNodeWithTag("discuss-cards").assertIsDisplayed()
        compose.onNodeWithText("✨ Claude suggests 2 cards — tick the ones you want").assertIsDisplayed()
        // A started thread: no suggestion chips (only before the first message).
        compose.onNodeWithTag(ClaudeThreadTags.CHIPS).assertDoesNotExist()
    }

    // ---------------- shots ----------------

    private val MESSAGE = ChatMessageDto("m1", "c1", "tutor", "明天下午三点见，别迟到！")

    @Composable
    private fun DiscussSheet(dark: Boolean) {
        Box(Modifier.fillMaxSize()) {
            ChatScreen(C.ui, dev.jeromeswannack.chineselearning.lab.ui.chat.ChatActions())
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = if (dark) 0.6f else 0.4f)))
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().fillMaxHeight(0.96f).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)) {
                ClaudeThreadScreen(
                    S.discussThread,
                    ClaudeThreadActions(),
                    sheet = true,
                    voicePreview = typing,
                    headerExtra = { MessageQuote(MESSAGE.content) },
                    toolResults = { reply -> proposedCardsOf(reply.tool_results)?.let { ProposedDiscussCards(MESSAGE, it, reply.id, ChatUi(), ChatSheetActions()) } },
                )
            }
        }
    }

    @Composable
    private fun SituationSheet() {
        var form by remember { mutableStateOf(PracticeForm().pick(ClaudePractice.SCENARIOS[0])) }
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f))) {
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().fillMaxHeight(0.95f).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)) {
                SheetScaffold(
                    header = { SheetTitle("🎭 Practice a situation") },
                    footer = {
                        SecondaryPill("Cancel", Modifier.weight(0.6f)) {}
                        PrimaryPill("▶ Start", Modifier.weight(1f).height(52.dp)) {}
                    },
                ) { PracticeSituationForm(form, online = true, error = null) { form = it } }
            }
        }
    }

    @Test fun shotPracticeThread() = shoot("claude-practice-01-thread") { ClaudeThreadScreen(S.practiceRole, ClaudeThreadActions(), voicePreview = typing) }
    @Test fun shotPracticeThreadDark() = shoot("claude-practice-02-thread-dark", dark = true) { ClaudeThreadScreen(S.practiceRole, ClaudeThreadActions(), voicePreview = typing) }
    @Test fun shotSituationSheet() = shoot("claude-practice-03-situation-sheet") { SituationSheet() }
    @Test fun shotSituationSheetDark() = shoot("claude-practice-04-situation-sheet-dark", dark = true) { SituationSheet() }
    @Test fun shotDiscussSheet() = shoot("claude-discuss-01-sheet") { DiscussSheet(dark = false) }
    @Test fun shotDiscussSheetDark() = shoot("claude-discuss-02-sheet-dark", dark = true) { DiscussSheet(dark = true) }
}
