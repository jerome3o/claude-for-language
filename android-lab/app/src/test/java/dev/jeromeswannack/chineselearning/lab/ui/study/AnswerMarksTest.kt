package dev.jeromeswannack.chineselearning.lab.ui.study

import org.junit.Assert.assertEquals
import org.junit.Test

/** Port of frontend/src/utils/answerDiff.ts, against the same cases as answerDiff.test.ts. */
class AnswerMarksTest {
    private fun marks(user: String, target: String) =
        AnswerMarks.typedDiff(user, target).typed.map { "${it.char.ifEmpty { "?" }}:${it.mark.name.lowercase()}" }

    @Test fun wrongCharacter() {
        assertEquals(listOf("打:correct", "蒜:wrong"), marks("打蒜", "打算"))
        assertEquals(
            listOf(AnswerMarks.Expected("打", true), AnswerMarks.Expected("算", false)),
            AnswerMarks.typedDiff("打蒜", "打算").expected,
        )
    }

    @Test fun missingPositions() {
        assertEquals(listOf("你:correct", "好:correct", "?:missing"), marks("你好", "你好吗"))
        assertEquals(listOf(true, true, false), AnswerMarks.typedDiff("你好", "你好吗").expected.map { it.matched })
    }

    @Test fun extraCharactersAreWrong() {
        assertEquals(listOf("谢:correct", "谢:correct", "你:wrong"), marks("谢谢你", "谢谢"))
        assertEquals(2, AnswerMarks.typedDiff("谢谢你", "谢谢").expected.size)
    }

    @Test fun byCodePoint() {
        assertEquals(listOf("𠀀:correct", "好:correct"), marks("𠀀好", "𠀀好"))
    }

    @Test fun emptyAnswerIsAllMissing() {
        assertEquals(listOf("?:missing"), marks("", "好"))
    }

    @Test fun multipleChoiceSlots() {
        val rows = listOf(
            MultipleChoice.Row("打", listOf("找", "打")),
            MultipleChoice.Row("算", listOf("蒜", "算")),
            MultipleChoice.Row("。", listOf("。")),
        )
        val cells = MultipleChoice.answerSlots(rows, listOf("找", null, "。")).map(AnswerMarks::forSlot)
        assertEquals(AnswerMarks.Cell("找", AnswerMarks.Mark.WRONG), cells[0])
        assertEquals(AnswerMarks.Mark.MISSING, cells[1].mark)
        assertEquals(AnswerMarks.Mark.CORRECT, cells[2].mark)
    }

    /** Same vectors as frontend/src/utils/answerDiff.test.ts `spokenAnswerDiff`. */
    @Test fun spokenAnswersAreLinedUpNotPositional() {
        val d = AnswerMarks.spokenDiff("他长的很高", "长得")
        assertEquals(listOf("他:wrong", "长:correct", "的:wrong", "很:wrong", "高:wrong"), d.typed.map { "${it.char}:${it.mark.name.lowercase()}" })
        assertEquals(listOf(AnswerMarks.Expected("长", true), AnswerMarks.Expected("得", false)), d.expected)
        assertEquals(listOf("猫:wrong"), AnswerMarks.spokenDiff("猫", "狗").typed.map { "${it.char}:${it.mark.name.lowercase()}" })
        assertEquals(emptyList<AnswerMarks.Cell>(), AnswerMarks.spokenDiff("", "好").typed)
        assertEquals(listOf(AnswerMarks.Expected("好", false)), AnswerMarks.spokenDiff("", "好").expected)
    }

    @Test fun punctuationNeverStartsAWrapUnit() {
        val chars = "早饭、聊天了，聊了两个小时。".codePoints().toArray().map { String(Character.toChars(it)) }
        val groups = AnswerMarks.wrapGroups(chars).map { g -> g.joinToString("") { chars[it] } }
        assertEquals(listOf("早", "饭、", "聊", "天", "了，", "聊", "了", "两", "个", "小", "时。"), groups)
        assertEquals("早饭、聊天了，聊了两个小时。", groups.joinToString(""))
        // A missing cell ("") is its own unit; a leading mark has nothing to join.
        assertEquals(listOf(listOf(0), listOf(1, 2)), AnswerMarks.wrapGroups(listOf("，", "好", "。")))
        assertEquals(listOf(listOf(0), listOf(1)), AnswerMarks.wrapGroups(listOf("好", "")))
    }
}
