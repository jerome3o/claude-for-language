package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.foundation.verticalScroll
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.core.SayBetter
import dev.jeromeswannack.chineselearning.lab.ui.coach.coachOpenPath
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatAutoCheckSamples as A
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatCoachSamples as C

/** "Open in Coach" in the chat (docs/CHAT.md "Chat ↔ Coach"): the ✎ on captions / transcripts, the menu item, the chip, the sheet. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatCoachTest {
    @get:Rule val compose = createComposeRule()

    @Test fun captionsAndTranscriptsGetTheMarkTheChipAndTheMenuItem() {
        for (m in listOf(C.photo, C.voice)) {
            assertEquals(SayBetter.IMPROVABLE, C.ui.sayBetter(m), m.id)
            assertTrue(C.ui.showCoachChip(m), m.id)
            assertEquals(listOf(MessageMenu.SAY_BETTER, MessageMenu.OPEN_COACH, MessageMenu.REPLY), C.ui.menu(m).items.take(3).map { it.id }, m.id)
            assertEquals(SayBetter.CoachRequest(A.TEXT, "check"), C.ui.coachRequest(m))
        }
        // A transcript still on its way: nothing yet.
        val pending = C.voice.copy(attachment = C.voice.attachment!!.copy(transcript_status = "pending"))
        assertNull(C.ui.sayBetter(pending))
        assertFalse(C.ui.showCoachChip(pending))
        // Their message: explained, after Save as flashcard; no chip.
        val theirs = C.photo.copy(sender_id = "them", auto_check = null)
        assertFalse(C.ui.showCoachChip(theirs))
        val ids = C.ui.menu(theirs).items.map { it.id }
        assertEquals(ids.indexOf(MessageMenu.SAVE_CARD) + 1, ids.indexOf(MessageMenu.OPEN_COACH))
        assertEquals("explain", C.ui.coachRequest(theirs)?.action)
    }

    @Test fun theSheetIsAboutTheCaption() {
        val v = assertNotNull(SayBetterView.of(C.photo, "me", "Minghui"))
        assertEquals(A.TEXT, v.original)
        assertEquals(A.CORRECTED, v.corrected)
        assertEquals(1, v.mistakes.size)
        val voice = assertNotNull(SayBetterView.of(C.voice, "me", "Minghui"))
        assertEquals(A.TEXT, voice.original)
    }

    @Test fun deepLinkPathIsReadableByTheRouter() {
        assertEquals("/coach?text=%E6%88%91%20%E5%A5%BD&action=check&from_message=m1", coachOpenPath("我 好", "check", "m1"))
        assertEquals("/coach?text=hi&action=explain", coachOpenPath("hi", "explain", null))
    }

    @Test fun chipOpensTheCoach() {
        var opened: Pair<String, String>? = null
        compose.setContent { LabTheme { ChatScreen(C.ui, ChatActions(onOpenCoach = { m, source -> opened = m.id to source })) } }
        compose.onNodeWithTag(CHAT_COACH_CHIP_TAG).assertIsDisplayed().performClick()
        assertEquals("ph" to "chip", opened)
    }

    @Test fun sheetButtonOpensTheCoach() {
        var opened = 0
        val v = SayBetterView.of(C.photo, "me", "Minghui")!!
        compose.setContent {
            LabTheme {
                androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                    SayBetterContent(v, online = true, playing = false, cards = SentenceActions(), onPlay = {}, onAsk = {}, onClose = {}, onOpenCoach = { opened++ })
                }
            }
        }
        compose.onNodeWithTag(SayBetterTags.OPEN_COACH).performScrollTo().assertIsDisplayed().performClick()
        assertEquals(1, opened)
    }
}
