package dev.jeromeswannack.chineselearning.lab.ui.chars

import dev.jeromeswannack.chineselearning.lab.core.CharStatusCard
import dev.jeromeswannack.chineselearning.lab.core.CharStatusNote
import dev.jeromeswannack.chineselearning.lab.core.CharWords
import dev.jeromeswannack.chineselearning.lab.data.api.CharComponentDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharReadingDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharRecordDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharWordDto
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict

/** Realistic dictionary records for the character sheet's screenshots and tests. */
object CharSheetSamples {
    val xing = CharRecordDto(
        char = "行",
        readings = listOf(CharReadingDto("xíng", "to walk; to go; OK, capable"), CharReadingDto("háng", "row, line; profession; business")),
        meaning = "to walk; to go; OK; row; profession",
        radical = "行", radical_meaning = "walk",
        decomposition = "⿰彳亍",
        components = listOf(CharComponentDto("彳", "step"), CharComponentDto("亍", "step with the right foot")),
        etymology = "Pictographic: a crossroads.",
        strokes = 6, rank = 32,
        words = listOf(
            CharWordDto("进行", "jìnxíng", "to carry out; to be in progress"),
            CharWordDto("银行", "yínháng", "bank"),
            CharWordDto("不行", "bùxíng", "won't do; no good"),
            CharWordDto("行业", "hángyè", "industry; profession"),
            CharWordDto("旅行", "lǚxíng", "to travel; journey"),
            CharWordDto("自行车", "zìxíngchē", "bicycle"),
            CharWordDto("流行", "liúxíng", "popular; fashionable"),
            CharWordDto("行为", "xíngwéi", "behaviour; conduct"),
            CharWordDto("执行", "zhíxíng", "to carry out; to execute"),
            CharWordDto("银行卡", "yínhángkǎ", "bank card"),
        ),
    )

    val suan = CharRecordDto(
        char = "算",
        readings = listOf(CharReadingDto("suàn", "to calculate; to count; to consider")),
        meaning = "to calculate; to count; to plan",
        radical = "竹", radical_meaning = "bamboo",
        components = listOf(CharComponentDto("竹", "bamboo"), CharComponentDto("目", "eye"), CharComponentDto("廾", "two hands")),
        etymology = "Bamboo counting sticks handled with both hands.",
        strokes = 14, rank = 412,
        words = listOf(
            CharWordDto("打算", "dǎsuàn", "to plan; to intend"),
            CharWordDto("算了", "suànle", "forget it; let it be"),
            CharWordDto("计算", "jìsuàn", "to calculate"),
            CharWordDto("就算", "jiùsuàn", "even if"),
            CharWordDto("预算", "yùsuàn", "budget"),
            CharWordDto("算是", "suànshì", "can be considered"),
            CharWordDto("计算机", "jìsuànjī", "computer"),
        ),
    )

    private val notes = listOf(
        CharStatusNote("n-yinhang", "银行"), CharStatusNote("n-buxing", "不行"), CharStatusNote("n-zixingche", "自行车"),
        CharStatusNote("n-lvxing", "旅行"), CharStatusNote("n-jinxing", "进行"),
        CharStatusNote("n-dasuan", "打算"), CharStatusNote("n-suanle", "算了"), CharStatusNote("n-jisuan", "计算"),
    )
    private val cards = listOf(
        CharStatusCard("n-yinhang", 1, 0.4), CharStatusCard("n-buxing", 2, 46.0), CharStatusCard("n-zixingche", 2, 30.5),
        CharStatusCard("n-lvxing", 2, 25.0), CharStatusCard("n-jinxing", 2, 9.0),
        CharStatusCard("n-dasuan", 2, 12.0), CharStatusCard("n-suanle", 2, 40.0), CharStatusCard("n-jisuan", 0, 0.0),
    )

    fun record(card: String) = if ("算" in card) suan else xing

    /** The sheet for a character of [card] with the statuses worked out like the app does (core CharWords). */
    fun loaded(card: String = "银行", more: CharMore = CharMore.Idle): CharSheetUi {
        val r = record(card)
        val rows = CharWords.rows(r.words, notes, cards, card) { it.hanzi }
        return CharSheetUi(r.char, CharDict.Lookup.Ok(r), rows, more)
    }

    const val EXPLANATION = "行 began as a picture of a crossroads, so its first meaning is \"road\" → \"to walk, to go\" (xíng). " +
        "Streets of shops lined up in rows gave the second reading, háng — \"row\", then \"trade, business\": 银行 is the silver (银) trade, a bank.\n" +
        "Tip: xíng for going and doing (旅行, 进行, 不行); háng for rows and trades (行业, 银行)."
}
