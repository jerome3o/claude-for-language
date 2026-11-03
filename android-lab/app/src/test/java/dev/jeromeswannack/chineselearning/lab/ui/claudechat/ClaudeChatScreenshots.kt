package dev.jeromeswannack.chineselearning.lab.ui.claudechat

import dev.jeromeswannack.chineselearning.lab.core.CoachAsk
import dev.jeromeswannack.chineselearning.lab.core.ReadAloud
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudHandle
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudUi
import org.junit.After
import org.junit.Before
import org.junit.Test

/** "💬 Ask Claude" on the Coach (ui/claudechat): the chat in simple Chinese, Read it back, ⋯, dark + light. */
class ClaudeChatScreenshots : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    private val answer = "成都的菜很有名，特别是火锅。\n火锅又麻又辣，可是很好吃。\n你可以试试串串和担担面。\n你喜欢吃辣的吗？"
    private val messages = listOf(
        ClaudeChatMsg("u1", "user", "成都有什么好吃的？"),
        ClaudeChatMsg("a1", "assistant", answer, answerLang = "zh", translation = "Chengdu's food is famous, especially hot pot.\nHot pot is numbing and spicy, but it's delicious.\nYou could try chuanchuan and dandan noodles.\nDo you like spicy food?"),
        ClaudeChatMsg("u2", "user", "麻是什么意思？"),
        ClaudeChatMsg("a2", "assistant", "「麻」就是嘴里有一点点不舒服的感觉。\n四川的花椒会让你的嘴麻麻的。", answerLang = "zh"),
    )
    private val ui = ClaudeChatUi(title = "成都有什么好吃的？", messages = messages, recapCount = 3)
    private val readBack = ReadAloud.judge(answer, "成都的菜很有名特别是活过火锅又麻又辣可是很好吃你可以试试串串和担担面你喜欢吃辣的吗")

    @Test fun empty() = shoot("claude-chat-01-empty") { ClaudeChatScreen(ClaudeChatUi(), ClaudeChatActions()) }

    @Test fun chat() = shoot("claude-chat-02-chat") { ClaudeChatScreen(ui, ClaudeChatActions(), pinyinPreview = setOf("a2")) }

    @Test fun chatDark() = shoot("claude-chat-03-chat-dark", dark = true) { ClaudeChatScreen(ui, ClaudeChatActions(), translatePreview = setOf("a1")) }

    @Test fun readBack() = shoot("claude-chat-04-read-back") {
        ClaudeChatScreen(ui, ClaudeChatActions(), readBackPreview = mapOf("a1" to ReadAloudHandle(ReadAloudUi(result = readBack, said = "成都的菜很有名特别是活过"), ReadAloudActions())))
    }

    @Test fun readBackDark() = shoot("claude-chat-05-read-back-dark", dark = true) {
        ClaudeChatScreen(ui, ClaudeChatActions(), readBackPreview = mapOf("a1" to ReadAloudHandle(ReadAloudUi(result = readBack, said = "成都的菜很有名特别是活过"), ReadAloudActions())))
    }

    @Test fun thinking() = shoot("claude-chat-06-thinking", settleMs = 600) {
        ClaudeChatScreen(ClaudeChatUi(title = "成都有什么好吃的？", messages = messages.take(1) + ClaudeChatMsg("p", "assistant", "", status = "pending")), ClaudeChatActions())
    }

    @Test fun menu() = shoot("claude-chat-07-menu") { ClaudeChatScreen(ui, ClaudeChatActions(), menuPreview = true) }

    @Test fun recapLabel() {
        kotlin.test.assertEquals("📝 3 words to recap", CoachAsk.recapCountLabel(ui.recapCount))
    }
}
