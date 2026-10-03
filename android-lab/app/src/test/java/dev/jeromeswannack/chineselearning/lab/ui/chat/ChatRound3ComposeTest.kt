package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/**
 * Round 2 PR 3 as the user touches it: a file bubble opens its file, a video bubble plays in place,
 * "↪ Forwarded" on top, the attach sheet's Photos / Video / File, the several-photos sheet (✕, the
 * caption, Send N), "Forward to…" (this chat marked, a tap picks), Message info rows, the header's
 * queue line and the selection bar's Forward.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatRound3ComposeTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()

    private fun actions() = ChatActions(
        onOpenFile = { calls += "open ${it.id}" },
        onOpenPendingFile = { calls += "open-pending ${it.clientId}" },
        onToggleVideo = { calls += "video $it" },
        onForwardSelection = { calls += "forward-selection" },
        onOpenSheet = { s -> calls += "sheet ${s?.let { it::class.simpleName }}" },
    )

    private val file = S.m1.copy(id = "f1", content = "", translation = null, words = null, attachment = ChatAttachmentDto("file", name = "HSK3 词汇表.pdf", bytes = 860_000, mime = "application/pdf"), media_url = "/api/chat-media/f1")
    private val fwd = S.m2.copy(id = "fw", forwarded_from = "m0", correction = null)
    private val video = S.m1.copy(id = "v1", content = "", translation = null, words = null, attachment = ChatAttachmentDto("video", bytes = 3_000_000, mime = "video/mp4", duration_ms = 12_400, width = 1280, height = 720), media_url = "/api/chat-media/v1")

    private fun show(ui: ChatUi, a: ChatActions = actions()) = compose.setContent { LabTheme { ChatScreen(ui, a) } }

    @Test fun aFileBubbleOpensItsFileAndSaysWhatItIs() {
        show(S.student.copy(messages = listOf(file, fwd), aids = ChatLearning.Aids()))
        compose.onNodeWithText("HSK3 词汇表.pdf").assertExists()
        compose.onNodeWithText("840 KB · PDF").assertExists()
        compose.onNodeWithTag("chat-file", useUnmergedTree = true).performClick()
        assertTrue("open f1" in calls, calls.toString())
        // A forwarded message says so on top.
        compose.onAllNodesWithTag("chat-forwarded", useUnmergedTree = true).assertCountEquals(1)
    }

    @Test fun aFailedDownloadSaysTapToRetry() {
        show(S.student.copy(messages = listOf(file), fileErrors = setOf("f1"), aids = ChatLearning.Aids()))
        compose.onNodeWithText("840 KB · PDF · couldn’t download, tap to retry").assertExists()
    }

    @Test fun aVideoBubblePlaysInPlace() {
        show(S.student.copy(messages = listOf(video), aids = ChatLearning.Aids()))
        compose.onNodeWithText("🎬 0:12").assertExists()
        compose.onNodeWithTag("chat-video", useUnmergedTree = true).performClick()
        assertTrue("video v1" in calls, calls.toString())
    }

    @Test fun pendingFilesAndVideosShowWhileUploading() {
        val p = PendingBubble("p1", "file", "", System.currentTimeMillis(), name = "课文 第3课.docx", bytes = 2_400_000, filePath = "/nope")
        val v = PendingBubble("p2", "video", "", System.currentTimeMillis() + 1, durationMs = 4_000, width = 720, height = 1280)
        var pending by androidx.compose.runtime.mutableStateOf(listOf(p))
        compose.setContent { LabTheme { ChatScreen(S.student.copy(messages = listOf(S.m1), pending = pending, aids = ChatLearning.Aids()), actions()) } }
        compose.onNodeWithText("课文 第3课.docx").assertExists()
        compose.onNodeWithText("2.3 MB · DOCX").assertExists()
        compose.onNodeWithTag("chat-pending").performClick()
        assertTrue("open-pending p1" in calls, calls.toString())
        pending = listOf(p, v)
        compose.onNodeWithText("🎬 0:04", useUnmergedTree = true).assertExists()
        // Two of my sends still going: the header says so.
        compose.onNodeWithTag("chat-queue-status").assertExists()
        compose.onNodeWithText("🕓 Sending 2 messages…").assertExists()
    }

    @Test fun offlineTheHeaderSaysTheyAreWaiting() {
        val p = PendingBubble("p1", "text", "明天见", System.currentTimeMillis())
        show(S.student.copy(online = false, messages = listOf(S.m1), pending = listOf(p), aids = ChatLearning.Aids()))
        compose.onNodeWithText("🕓 1 message waiting for a connection").assertExists()
    }

    @Test fun theSelectionBarForwards() {
        show(S.student.copy(selection = SelectionUi(setOf("m1"))))
        compose.onNodeWithTag("chat-select-forward").assertIsEnabled().performClick()
        assertTrue("forward-selection" in calls)
    }

    @Test fun forwardNeedsAConnection() {
        show(S.student.copy(selection = SelectionUi(setOf("m1")), online = false))
        compose.onNodeWithTag("chat-select-forward").assertIsNotEnabled()
    }

    @Test fun noForwardInTheClaudePracticeChat() {
        show(S.student.copy(selection = SelectionUi(setOf("m1")), conversation = S.student.conversation!!.copy(is_ai_conversation = true)))
        compose.onAllNodesWithTag("chat-select-forward").assertCountEquals(0)
        compose.onNodeWithTag("chat-select-copy").assertExists()
    }

    @Test fun theAttachSheetOffersPhotosVideoAndFile() {
        val picked = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                AttachContent(
                    S.student,
                    ChatSheetActions(onGallery = { picked += "photos" }, onVideo = { picked += "video" }, onFile = { picked += "file" }),
                )
            }
        }
        compose.onNodeWithText("Photos").performClick()
        compose.onNodeWithText("Video").performClick()
        compose.onNodeWithText("File").performClick()
        assertEquals(listOf("photos", "video", "file"), picked)
    }

    @Test fun severalPhotosRemoveOneAndSendWithACaption() {
        var photos by androidx.compose.runtime.mutableStateOf(List(3) { StagedPhoto("/p$it.jpg", 1600, 1200) })
        val sent = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                Column {
                    PhotosComposeContent(photos, true, { _, _ -> null }, onRemove = { i -> photos = photos.filterIndexed { j, _ -> j != i } }, onSend = { sent += it }, onCancel = {})
                }
            }
        }
        compose.onNodeWithText("Send 3 photos").assertExists()
        compose.onAllNodesWithTag("chat-photo-thumb").assertCountEquals(3)
        compose.onAllNodesWithTag("chat-photo-remove")[1].performClick()
        compose.onAllNodesWithTag("chat-photo-thumb").assertCountEquals(2)
        compose.onNodeWithTag("chat-photo-caption").performTextInput("我们的周末")
        compose.onNodeWithText("Send 2").performClick()
        assertEquals(listOf("我们的周末"), sent)
    }

    @Test fun forwardToMarksThisChatAndPicks() {
        val picked = mutableListOf<String>()
        val f = ForwardUi(listOf("m1", "m2"), listOf(ForwardTarget("c1", "rel1", "Minghui", "Weekly chat"), ForwardTarget("c2", "rel2", "Anna", null)))
        compose.setContent { LabTheme { Column { ForwardContent(f, "c1") { picked += it.conversationId } } } }
        compose.onNodeWithText("Forward 2 messages to…").assertExists()
        compose.onNodeWithText("Weekly chat · this chat").assertExists()
        compose.onAllNodesWithTag("chat-forward-target").assertCountEquals(2)
        compose.onNodeWithText("Anna").performClick()
        assertEquals(listOf("c2"), picked)
    }

    @Test fun forwardToLoadingAndOffline() {
        compose.setContent { LabTheme { Column { ForwardContent(ForwardUi(listOf("m1"), null, "You're offline — forwarding needs a connection."), null) {} } } }
        compose.onNodeWithText("Forward message to…").assertExists()
        compose.onNodeWithText("You're offline — forwarding needs a connection.").assertExists()
    }

    @Test fun messageInfoShowsTheRows() {
        val m = S.m2.copy(edited_at = null)
        compose.setContent { LabTheme { Column { MessageInfoContent(m, ChatRound3.infoRows(m, "me", "Minghui", S.student.otherReadAt)) } } }
        compose.onNodeWithText("Message info").assertExists()
        compose.onNodeWithText("From").assertExists()
        compose.onNodeWithText("You").assertExists()
        compose.onNodeWithText("Read by Minghui").assertExists()
        compose.onNodeWithText("Yes ✓✓").assertExists()
        compose.onAllNodesWithText("Corrected").onFirst().assertExists()
        compose.onNodeWithText("Characters").assertExists()
    }
}
