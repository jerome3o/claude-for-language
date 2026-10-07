package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.data.chat.LinkPreviewDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/**
 * Chat round 2 as the user touches it (docs/CHAT.md "Round 2"): long-press → the menu, each menu
 * row → its action (offline ones disabled), tap → the time, swipe right → reply, the meta + ticks
 * in the last bubble of a group, the one-row composer (+, 😊 at the caret, mic ↔ ➤, hold vs tap),
 * the voice speed chip, link previews, the selection bar, the Explain / Save-as-card sheet.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatRound2ComposeTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()

    private fun actions() = ChatActions(
        onOpenSheet = { s -> calls += when (s) { is ChatSheet.Actions -> "menu ${s.message.id}"; null -> "close"; else -> "sheet ${s::class.simpleName}" } },
        onToggleTime = { calls += "time $it" },
        onReply = { calls += "reply ${it?.id}" },
        onToggleSelect = { calls += "select $it" },
        onRecordStart = { calls += "record-start"; true },
        onRecordSendNow = { calls += "record-send" },
        onRecordCancel = { calls += "record-cancel" },
        onDraft = { calls += "draft $it" },
        onSend = { calls += "send" },
        onCycleSpeed = { calls += "speed" },
        onRequestWaveform = { id, _, _ -> calls += "wave $id" },
        onRequestLinkPreview = { calls += "preview $it" },
        onOpenLink = { calls += "open $it" },
        onCopySelection = { calls += "copy-selection" },
        onPropose = { calls += "propose" },
        onVideoCall = { calls += "call" },
        onReact = { m, e -> calls += "react ${m.id} $e" },
    )

    private fun show(ui: ChatUi) = compose.setContent { LabTheme { ChatScreen(ui, actions()) } }

    private val two = S.student.copy(messages = listOf(S.m1, S.m2), aids = ChatLearning.Aids())

    private fun longPress(node: androidx.compose.ui.test.SemanticsNodeInteraction) {
        node.performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(LONG_PRESS_MS + 100)
        node.performTouchInput { up() }
        compose.waitForIdle()
    }

    @Test fun longPressOpensTheMenu_tapShowsTheTime() {
        // A message without chips: the press lands on the bubble itself.
        show(two.copy(messages = listOf(S.m1.copy(words = null), S.m2)))
        compose.onAllNodesWithTag("chat-bubble")[0].performClick()
        compose.waitForIdle()
        assertTrue("time m1" in calls, calls.toString())
        longPress(compose.onAllNodesWithTag("chat-bubble")[0])
        assertTrue("menu m1" in calls, calls.toString())
    }

    @Test fun aLongPressOnAWordChipOpensTheMenuToo() {
        show(two)
        longPress(compose.onNodeWithText("周末"))
        assertTrue("menu m1" in calls, calls.toString())
    }

    @Test fun swipeRightReplies_aShortSwipeDoesNot() {
        show(two)
        compose.onAllNodesWithTag("chat-bubble")[0].performTouchInput { swipeRight(startX = left + 4f, endX = left + 4f + 30.dp.toPx(), durationMillis = 200) }
        compose.waitForIdle()
        assertFalse(calls.any { it.startsWith("reply") }, calls.toString())
        compose.onAllNodesWithTag("chat-bubble")[0].performTouchInput { swipeRight(startX = left + 4f, endX = left + 4f + 120.dp.toPx(), durationMillis = 300) }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        assertTrue("reply m1" in calls, calls.toString())
    }

    @Test fun theLastBubbleOfAGroupCarriesTheTimeAndTicks() {
        // m4 (mine) is the newest of my messages and Minghui has read up to 11 min ago → ✓✓.
        show(S.student.copy(aids = ChatLearning.Aids()))
        compose.waitForIdle()
        val metas = compose.onAllNodesWithTag("chat-meta", useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue(metas.isNotEmpty())
        compose.onAllNodesWithText("✓✓", substring = true, useUnmergedTree = true).onFirst().assertExistsCompat()
        assertTrue("wave v1" in calls)
    }

    private fun androidx.compose.ui.test.SemanticsNodeInteraction.assertExistsCompat() = assertExists()

    @Test fun everyMenuRowCallsItsAction_offlineOnesAreDisabled() {
        val got = mutableListOf<String>()
        val menu = two.menu(S.m2)
        compose.setContent {
            LabTheme {
                androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.androidxScroll()) {
                    MessageMenuContent(S.m2, menu, online = true, recent = emptyList(), mine = true, onReact = { got += "react $it" }, onAction = { got += it })
                }
            }
        }
        for (item in menu.items) compose.onNodeWithTag(menuTag(item.id)).performScrollTo().performClick()
        compose.onNodeWithContentDescription("React ❤️").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(menu.items.map { it.id } + "react ❤️", got)
        assertEquals(
            // m2 is mine and corrected by Minghui: "How to say it better" leads (auto-check), "Open in Coach" second.
            listOf("say_better", "open_coach", "reply", "copy", "forward", "translate", "pinyin", "explain", "save_card", "select_cards", "check", "correction_card", "play", "discuss", "pin", "info", "edit", "delete", "select"),
            menu.items.map { it.id },
        )
    }

    @Test fun offlineTheNetworkItemsDoNothing() {
        val got = mutableListOf<String>()
        val menu = two.menu(S.m1)
        compose.setContent {
            LabTheme {
                androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.androidxScroll()) {
                    MessageMenuContent(S.m1, menu, online = false, recent = emptyList(), mine = false, onReact = { got += "react $it" }, onAction = { got += it })
                }
            }
        }
        compose.onNodeWithTag(menuTag(MessageMenu.EXPLAIN)).performClick()
        compose.onNodeWithTag(menuTag(MessageMenu.REPLY)).performClick()
        compose.onNodeWithTag(menuTag(MessageMenu.PINYIN)).performClick()
        // m1 already has its translation: Translate works offline.
        compose.onNodeWithTag(menuTag(MessageMenu.TRANSLATE)).performClick()
        compose.waitForIdle()
        assertEquals(listOf("reply", "pinyin", "translate"), got)
        compose.onAllNodesWithText("Needs internet").fetchSemanticsNodes().isNotEmpty().let(::assertTrue)
    }

    @Test fun composerMicBecomesSend_emojiGoesInAtTheCaret_attachOpensTheSheet() {
        show(two)
        compose.onNodeWithTag("chat-mic").assertExists()
        compose.onAllNodesWithTag("chat-send").assertCountEquals(0)
        compose.onNodeWithTag("chat-attach").performClick()
        compose.onNodeWithTag("chat-emoji").performClick()
        compose.onNodeWithTag("chat-emoji-panel").assertExists()
        compose.onAllNodesWithText("😂").onFirst().performClick()
        compose.waitForIdle()
        assertTrue("sheet Attach" in calls, calls.toString())
        assertTrue("draft 😂" in calls, calls.toString())
    }

    @Test fun withTextTheMicIsSend() {
        show(two.copy(draft = "明天见"))
        compose.onNodeWithTag("chat-send").performClick()
        compose.onAllNodesWithTag("chat-mic").assertCountEquals(0)
        compose.onNodeWithTag("chat-input").performTextInput("！")
        compose.waitForIdle()
        assertTrue("send" in calls)
        assertTrue(calls.any { it.startsWith("draft ") && it.contains("！") }, calls.toString())
    }

    @Test fun aQuickTapOnTheMicOnlySaysHoldToRecord_aHoldRecordsAndReleaseSends() {
        show(two)
        compose.onNodeWithTag("chat-mic").performTouchInput { down(center); up() }
        compose.waitForIdle()
        assertFalse("record-start" in calls, calls.toString())
        compose.onNodeWithTag("chat-hold-hint", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("chat-mic").performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(400)
        compose.onNodeWithTag("chat-mic").performTouchInput { up() }
        compose.waitForIdle()
        assertEquals(listOf("record-start", "record-send"), calls.filter { it.startsWith("record") })
    }

    @Test fun slideLeftCancelsTheRecording() {
        show(two)
        compose.onNodeWithTag("chat-mic").performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(400)
        compose.onNodeWithTag("chat-mic").performTouchInput { moveBy(androidx.compose.ui.geometry.Offset(-(CANCEL_SLIDE.toPx() + 10f), 0f)); up() }
        compose.waitForIdle()
        assertEquals(listOf("record-start", "record-cancel"), calls.filter { it.startsWith("record") })
    }

    @Test fun voiceSpeedChipAndLinkPreview() {
        val link = S.m1.copy(id = "l1", content = "看看这个 https://example.com/article，很有意思", words = null, translation = null)
        val ui = S.student.copy(
            messages = listOf(S.v1, link), aids = ChatLearning.Aids(), voiceSpeed = 1.5f,
            linkPreviews = mapOf("https://example.com/article" to LinkPreviewDto("https://example.com/article", "学中文的十个方法", "A short guide.", null, "Example")),
        )
        show(ui)
        compose.onNodeWithText("1.5×").assertExists()
        compose.onNodeWithTag("chat-voice-speed").performClick()
        compose.onNodeWithTag("chat-link-preview").performClick()
        compose.waitForIdle()
        assertTrue("speed" in calls)
        assertTrue("preview https://example.com/article" in calls, calls.toString())
        assertTrue("open https://example.com/article" in calls, calls.toString())
    }

    @Test fun selectionBarCopiesAndMakesFlashcards() {
        show(two.copy(selection = SelectionUi(setOf("m1"))))
        compose.onNodeWithTag("chat-select-count").assertExists()
        compose.onNodeWithTag("chat-select-copy").performClick()
        compose.onNodeWithTag("chat-propose").performClick()
        compose.waitForIdle()
        assertEquals(listOf("copy-selection", "propose"), calls.filter { it == "copy-selection" || it == "propose" })
    }

    @Test fun headerVideoCall() {
        show(two)
        compose.onNodeWithTag("chat-video-call").performClick()
        compose.waitForIdle()
        assertTrue("call" in calls)
    }

    private val explanation = SentenceExplanation(
        listOf(ExplainedWord("周末", "zhōumò", "weekend"), ExplainedWord("你", "nǐ", "you"), ExplainedWord("做", "zuò", "do"), ExplainedWord("了", "le", "(done)"), ExplainedWord("什么", "shénme", "what")),
        construction = "了 after the verb: it happened.",
        translation = "What did you do at the weekend?",
    )

    @Test fun explainShowsTheBreakdown_saveCardGoesStraightToTheAddSheet() {
        var save by androidx.compose.runtime.mutableStateOf(false)
        compose.setContent {
            LabTheme {
                androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.androidxScroll()) {
                    ExplainContent(ExplainUi("m1", "周末你做了什么？", null, loading = false, result = explanation), save, online = true, cards = dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions(), onRetry = {}, onClose = {})
                }
            }
        }
        compose.onNodeWithText("周末").assertExists()
        compose.onNodeWithText("+ Add whole sentence as card").assertExists()
        save = true
        compose.waitForIdle()
        compose.onNodeWithText("Save as flashcard").assertExists()
        compose.onNodeWithText("What did you do at the weekend?").assertExists()
        compose.onNodeWithText("Add to deck").assertExists()
    }
}

@androidx.compose.runtime.Composable
private fun androidx.compose.ui.Modifier.androidxScroll() = this.verticalScroll(rememberScrollState())
