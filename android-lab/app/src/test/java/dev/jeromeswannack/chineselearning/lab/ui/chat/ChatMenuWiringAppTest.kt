package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.data.api.ChatCorrectionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The long-press menu wired to the real ChatViewModel (docs/CHAT.md "Round 2"): each action id does
 * its thing — reply, the pinyin / translation toggles, Select with the message ticked, Explain and
 * Save as flashcard from the cached breakdown (no network), Correct / Edit / Delete sheets, the
 * check result, Copy, the time toggle and the remembered speed chip. Same sandbox as
 * ChatDeliveryAppTest (sdk 33, the real LabApp).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class ChatMenuWiringAppTest {
    private lateinit var app: LabApp
    private lateinit var vm: ChatViewModel

    private val tutor = ChatSenderDto("t1", "Minghui")
    private val me = ChatSenderDto("me", "Jerome")
    private val m1 = ChatMessageDto("m1", "c1", "t1", "周末你做了什么？", "2026-10-02T09:00:00.000Z", sender = tutor, translation = "What did you do at the weekend?")
    private val m2 = ChatMessageDto(
        "m2", "c1", "me", "我去商店了。", "2026-10-02T09:01:00.000Z", sender = me, check_status = "needs_improvement", check_feedback = "了 placement.",
        correction = ChatCorrectionDto("我去了商店。", null, "t1", "2026-10-02T09:05:00.000Z"),
    )

    private fun idle(what: String = "", check: () -> Boolean = { true }) {
        repeat(500) {
            shadowOf(Looper.getMainLooper()).idle()
            if (check()) return
            Thread.sleep(10)
        }
        error("timed out waiting for $what")
    }

    @Before
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = "test-session"
        runBlocking {
            app.cache.put(ConnectionsKeys.ME, ConnectionsKeys.KIND, "me")
            app.cache.put(ConnectionsKeys.relationship("rel1"), ConnectionsKeys.KIND, RelationshipDto("rel1", "me", "t1", "student", "active"))
            app.cache.put("chat/c1/messages", ChatViewModel.KIND, listOf(m1, m2))
            // Explain / Save as flashcard read the Coach's cache by text first.
            CardTools(app).cacheTextExplanation(
                m1.content,
                SentenceExplanation(listOf(ExplainedWord("周末", "zhōumò", "weekend"), ExplainedWord("你", "nǐ", "you"), ExplainedWord("做了", "zuò le", "did"), ExplainedWord("什么", "shénme", "what")), "了 after the verb.", "What did you do?"),
            )
        }
        vm = ChatViewModel(app, "rel1", "c1")
        idle("the cached chat") { vm.ui.value.messages.size == 2 && vm.ui.value.myId == "me" }
    }

    private val ui get() = vm.ui.value

    @Test fun eachMenuActionDoesItsThing() {
        vm.onMenuAction(MessageMenu.REPLY, m1)
        assertEquals("m1", ui.replyingTo?.id)

        vm.onMenuAction(MessageMenu.PINYIN, m1)
        assertTrue(ui.aids.pinyin("m1"))
        assertEquals("Hide pinyin", ui.menu(m1).items.first { it.id == MessageMenu.PINYIN }.label)

        // Already translated: the toggle, no request.
        vm.onMenuAction(MessageMenu.TRANSLATE, m1)
        assertTrue(ui.aids.translation("m1"))
        vm.onMenuAction(MessageMenu.TRANSLATE, m1)
        assertTrue(!ui.aids.translation("m1"))

        vm.onMenuAction(MessageMenu.SELECT, m1)
        assertEquals(setOf("m1"), ui.selection?.selected)
        vm.cancelSelecting()
        vm.onMenuAction(MessageMenu.SELECT_CARDS, m2)
        assertEquals(setOf("m2"), ui.selection?.selected)
        vm.cancelSelecting()

        vm.onMenuAction(MessageMenu.EXPLAIN, m1)
        assertEquals(ChatSheet.Explain(m1, saveCard = false), ui.sheet)
        idle("the cached explanation") { ui.explain?.result != null }
        assertEquals("What did you do at the weekend?", ui.explain?.translation, "the message's own translation wins")
        vm.closeExplain()
        assertNull(ui.sheet)

        vm.onMenuAction(MessageMenu.SAVE_CARD, m1)
        assertEquals(ChatSheet.Explain(m1, saveCard = true), ui.sheet)
        idle("the card") { ui.explain?.result != null }
        val card = sentenceCardOf(ui.explain!!.text, ui.explain!!.translation, ui.explain!!.result!!)
        assertEquals("周末你做了什么？", card.hanzi)
        assertEquals("zhōumò nǐ zuò le shénme", card.pinyin)
        vm.closeExplain()

        vm.onMenuAction(MessageMenu.VIEW_CORRECTIONS, m2)
        assertIs<ChatSheet.Check>(ui.sheet)
        vm.openSheet(null)

        vm.onMenuAction(MessageMenu.CORRECT, m1)
        assertEquals(ChatSheet.Correct(m1), ui.sheet)
        vm.openSheet(null)

        vm.onMenuAction(MessageMenu.DELETE, m2)
        assertEquals(ChatSheet.ConfirmDelete(m2), ui.sheet)
        vm.openSheet(null)

        vm.onMenuAction(MessageMenu.EDIT, m2)
        assertEquals("m2", ui.editing?.id)
        assertEquals("我去商店了。", ui.draft)
        vm.cancelEdit()

        vm.onMenuAction(MessageMenu.COPY, m1)
        assertEquals("Copied.", ui.notice?.text)
        val clip = app.getSystemService(android.content.ClipboardManager::class.java).primaryClip
        assertEquals("周末你做了什么？", clip?.getItemAt(0)?.text?.toString())
    }

    @Test fun tapShowsTheTime_speedIsRemembered() {
        vm.toggleTime("m1")
        assertEquals(setOf("m1"), ui.timeShown)
        vm.toggleTime("m1")
        assertEquals(emptySet(), ui.timeShown)

        vm.cycleSpeed()
        assertEquals(1.5f, ui.voiceSpeed)
        vm.cycleSpeed()
        assertEquals(2f, ui.voiceSpeed)
        idle("the speed saved") { runBlocking { app.cache.get<Float>(ChatViewModel.SPEED_KEY) } == 2f }
        val again = ChatViewModel(app, "rel1", "c1")
        idle("the speed loaded") { again.ui.value.voiceSpeed == 2f }
        vm.cycleSpeed()
        assertEquals(1f, ui.voiceSpeed)
    }

    @Test fun selectionCopyPutsTheTextsOnTheClipboard() {
        vm.startSelecting("m1")
        vm.toggleSelect("m2")
        vm.copySelection()
        assertNull(ui.selection)
        val clip = app.getSystemService(android.content.ClipboardManager::class.java).primaryClip
        assertEquals("周末你做了什么？\n我去商店了。", clip?.getItemAt(0)?.text?.toString())
        assertNotNull(ui.notice)
    }
}
