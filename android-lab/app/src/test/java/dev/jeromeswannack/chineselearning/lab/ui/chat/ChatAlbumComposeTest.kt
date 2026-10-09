package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/**
 * Photo albums as the user touches them (docs/CHAT.md "Photo albums"): three photos are one bubble
 * with three tiles, a tap opens the viewer at that photo ("2 / 3") and a swipe moves on ("3 / 3"),
 * a long press opens the album's menu with its photos' ids.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatAlbumComposeTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val now = Instant.now()

    private fun photo(id: String, i: Int) = ChatMessageDto(
        id, conversation_id = "c1", sender_id = S.mh.id, sender = S.mh, content = if (i == 0) "我们的猫" else "",
        created_at = now.minusSeconds(60L - i).toString(),
        attachment = ChatAttachmentDto("image", width = 1600, height = 1200, bytes = 300_000, mime = "image/jpeg"), media_url = "/api/chat-media/$id",
        album_id = "al-1", album_index = i,
    )

    private val actions = ChatActions(
        onOpenAlbumMenu = { calls += "menu ${it.joinToString(",")}" },
        onAlbumViewerOpen = { n, i -> calls += "viewer $n $i" },
    )

    @Test fun anAlbumOpensTheViewerAtTheTappedPhotoAndSwipes() {
        compose.setContent { LabTheme { ChatScreen(S.student.copy(messages = listOf(photo("a", 0), photo("b", 1), photo("c", 2)), aids = ChatLearning.Aids()), actions) } }
        compose.onAllNodesWithTag("chat-album", useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithTag("chat-album-tile").assertCountEquals(3)
        compose.onNodeWithText("我们的猫", substring = true, useUnmergedTree = true).assertExists()

        compose.onAllNodesWithTag("chat-album-tile")[1].performClick()
        compose.waitForIdle()
        assertEquals(listOf("viewer 3 1"), calls)
        compose.onNodeWithTag("chat-album-counter", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("2 / 3", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("chat-album-viewer").performTouchInput { swipeLeft() }
        compose.waitForIdle()
        compose.onNodeWithText("3 / 3", useUnmergedTree = true).assertExists()
    }

    @Test fun aLongPressOpensTheAlbumMenu() {
        compose.setContent { LabTheme { ChatScreen(S.student.copy(messages = listOf(photo("a", 0), photo("b", 1)), aids = ChatLearning.Aids()), actions) } }
        compose.onAllNodesWithTag("chat-album-tile")[0].performTouchInput { longClick() }
        compose.waitForIdle()
        assertEquals(listOf("menu a,b"), calls)
    }
}
