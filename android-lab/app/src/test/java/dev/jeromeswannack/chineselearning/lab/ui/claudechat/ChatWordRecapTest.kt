package dev.jeromeswannack.chineselearning.lab.ui.claudechat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.CoachAsk
import dev.jeromeswannack.chineselearning.lab.core.WordRecap
import dev.jeromeswannack.chineselearning.lab.core.WordRecapRun
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderRecapScreen
import dev.jeromeswannack.chineselearning.lab.ui.readers.RecapActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.RecapUi
import dev.jeromeswannack.chineselearning.lab.ui.readers.WordRecapTags
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 📝 "N words to recap" of a "💬 Ask Claude" chat: the readers' word recap screen with the chat as
 * its source — the cue is the sentence of Claude's message the word was met in, "from your chat with
 * Claude", the chat's why lines, switches OFF by default, Not yet bringing a word back.
 */
class ChatWordRecapTest : LabScreenshotTest() {
    private val words = listOf(
        CoachAsk.RecapWord("火锅", "成都的菜很有名，特别是火锅。", listOf(CoachAsk.TAPPED), pinyin = "huǒguō", gloss = "hot pot"),
        CoachAsk.RecapWord("麻", "火锅又麻又辣，可是很好吃。", listOf(CoachAsk.TAPPED, CoachAsk.SAID_WRONG), pinyin = "má", gloss = "numbing", reasonLine = "Tone off on 麻 (heard 马)"),
        CoachAsk.RecapWord("担担面", "你可以试试串串和担担面。", listOf(CoachAsk.SAID_WRONG), reasonLine = "Missed 面"),
    )

    private fun run(): WordRecapRun = WordRecap.chatRun("t-1", words, null, "2026-11-03T12:00:00Z")
    private val label = WordRecap.sourceLabel(WordRecap.SOURCE_CHAT)
    private fun ui(r: WordRecapRun, revealed: Boolean = false) = RecapUi("Word recap", r, sourceLabel = label, source = WordRecap.SOURCE_CHAT, owned = setOf("火锅"), revealed = revealed)

    private fun answered(): WordRecapRun {
        var r = run()
        r = WordRecap.answer(r, "火锅", true, "2026-11-03T12:01:01Z", "e1")
        r = WordRecap.answer(r, "麻", false, "2026-11-03T12:01:02Z", "e2")
        r = WordRecap.answer(r, "担担面", true, "2026-11-03T12:01:03Z", "e3")
        r = WordRecap.answer(r, "麻", true, "2026-11-03T12:01:04Z", "e4")
        r = WordRecap.setKeep(r, "火锅", true)
        r = WordRecap.setKeep(r, "担担面", true)
        return r
    }

    @Test fun front() = shoot("chat-recap-01-front") { ReaderRecapScreen(ui(run()), RecapActions()) }
    @Test fun frontDark() = shoot("chat-recap-01-front-dark", dark = true) { ReaderRecapScreen(ui(run()), RecapActions()) }

    private fun onMa(): WordRecapRun = WordRecap.answer(run(), "火锅", true, "2026-11-03T12:01:01Z", "e1")
    @Test fun back() = shoot("chat-recap-02-back") { ReaderRecapScreen(ui(onMa(), revealed = true), RecapActions()) }
    @Test fun backDark() = shoot("chat-recap-02-back-dark", dark = true) { ReaderRecapScreen(ui(onMa(), revealed = true), RecapActions()) }

    @Test fun summary() = shoot("chat-recap-03-summary", settleMs = 3_500) { ReaderRecapScreen(ui(answered()), RecapActions()) }
    @Test fun summaryDark() = shoot("chat-recap-03-summary-dark", dark = true, settleMs = 3_500) { ReaderRecapScreen(ui(answered()), RecapActions()) }

    @Test
    fun aChatsWordsGoThroughThePass() {
        val r0 = run()
        assertEquals(WordRecap.SOURCE_CHAT, WordRecap.source(r0))
        assertEquals("chat:t-1", r0.reader_id)
        assertEquals(listOf("火锅", "麻", "担担面"), r0.words.map { it.hanzi })
        val answers = ArrayList<Pair<String, Boolean>>()
        compose.setContent {
            LabTheme {
                var r by remember { mutableStateOf(r0) }
                ReaderRecapScreen(
                    ui(r),
                    RecapActions(
                        answer = { k, right -> answers += k to right; r = WordRecap.answer(r, k, right, "2026-11-03T12:0${answers.size}:00Z", "e${answers.size}") },
                        keep = { k, on -> r = WordRecap.setKeep(r, k, on) },
                    ),
                )
            }
        }
        compose.onNodeWithTag(WordRecapTags.SOURCE).assertTextEquals("from your chat with Claude")
        fun answer(word: String, right: Boolean, why: String? = null) {
            assertTrue(compose.onAllNodesWithText(word).fetchSemanticsNodes().isNotEmpty(), "card shows $word")
            compose.onNodeWithTag(WordRecapTags.SHOW).performClick()
            compose.waitForIdle()
            why?.let { compose.onNodeWithText(it).assertExists() }
            compose.onNodeWithTag(WordRecapTags.KEEP).assertIsOff()
            compose.onNodeWithTag(if (right) WordRecapTags.GOT_IT else WordRecapTags.NOT_YET).performClick()
            compose.waitForIdle()
        }
        // The cue is Claude's sentence; the why lines are the chat's.
        compose.onNodeWithText("成都的菜很有名，特别是火锅。", substring = true).assertExists()
        answer("火锅", true, "You tapped it in the chat")
        answer("麻", false, "Read it back: Tone off on 麻 (heard 马)")
        answer("担担面", true, "Read it back: Missed 面")
        answer("麻", true)
        compose.onNodeWithText("Recap done 🎉").assertExists()
        compose.onNodeWithText("the rest were just for this chat", substring = true).assertExists()
        assertEquals(3, compose.onAllNodesWithTag(WordRecapTags.KEEP).fetchSemanticsNodes().size)
        compose.onNodeWithText("⚡ Study it today").assertExists()
        assertEquals(listOf("火锅" to true, "麻" to false, "担担面" to true, "麻" to true), answers)
    }

    @Test
    fun choicesFollowTheChatSource() {
        val c = WordRecap.choices(answered()) { it == "火锅" }
        assertEquals(listOf("担担面"), c.add.map { it.hanzi })
        assertEquals(listOf("火锅"), c.bump.map { it.hanzi })
        assertEquals(WordRecap.Deck("From my chats", "Words you chose to keep from your chats with Claude."), WordRecap.deck(WordRecap.SOURCE_CHAT))
        assertEquals("chat_recap", WordRecap.upNextSource(WordRecap.SOURCE_CHAT))
        assertEquals("coach.ask_recap_finish", WordRecap.event(WordRecap.SOURCE_CHAT, "finish"))
        // After Done, only words met since come back.
        val done = WordRecap.markRecapped(answered(), "2026-11-03T12:05:00Z")
        assertEquals(0, WordRecap.chatCount(words, done))
        assertEquals(1, WordRecap.chatCount(words + CoachAsk.RecapWord("串串", "你可以试试串串和担担面。", listOf(CoachAsk.TAPPED)), done))
    }
}
