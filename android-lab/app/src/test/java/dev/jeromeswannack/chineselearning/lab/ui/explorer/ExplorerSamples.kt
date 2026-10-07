package dev.jeromeswannack.chineselearning.lab.ui.explorer

import dev.jeromeswannack.chineselearning.lab.core.CharWordStatus
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.api.CharComponentDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharReadingDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharRecordDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.api.WordRecordDto
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetActions
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetSamples

/** Realistic explorer data: 银 / 行 records, the 银行 word record, the learner's own cards. */
object ExplorerSamples {
    val yin = CharRecordDto(
        char = "银",
        readings = listOf(CharReadingDto("yín", "silver; money")),
        meaning = "silver; money; silver-coloured",
        radical = "钅", radical_meaning = "metal",
        components = listOf(CharComponentDto("钅", "metal"), CharComponentDto("艮", "stopping; tough")),
        etymology = "Phonosemantic: metal 钅 + sound 艮.",
        strokes = 11, rank = 1093,
        words = listOf(
            CharWordDto("银行", "yínháng", "bank"),
            CharWordDto("收银台", "shōuyíntái", "checkout counter"),
            CharWordDto("银色", "yínsè", "silver (colour)"),
            CharWordDto("银子", "yínzi", "silver; money"),
            CharWordDto("银牌", "yínpái", "silver medal"),
            CharWordDto("银行卡", "yínhángkǎ", "bank card"),
        ),
    )
    val xing = CharSheetSamples.xing
    val records = mapOf("银" to yin, "行" to xing)

    val yinhang = WordRecordDto(
        hanzi = "银行", pinyin = "yínháng", syllables = listOf("yín", "háng"), english = "bank",
        senses = listOf("bank", "banking institution"), rank = 1427,
    )

    val ranks = mapOf("银行" to 1427, "自行车" to 2915, "进行" to 210, "不行" to 512, "旅行" to 1830, "流行" to 3310, "银行卡" to 8820, "银色" to 12040, "银子" to 15658, "银牌" to 9960, "行业" to 1675, "行为" to 1210, "执行" to 2020)

    val statuses = mapOf("进行" to CharWordStatus.InDecks, "不行" to CharWordStatus.Known, "自行车" to CharWordStatus.Known, "旅行" to CharWordStatus.Known)

    val mine = MyWord(
        card = MyWordCard("n-yinhang", "HSK 3 · Money & shopping", "yínháng", "bank"),
        examples = listOf(
            MyExample("n1", "我去银行取钱。", "I'm going to the bank to take out money."),
            MyExample("n2", "银行几点开门？", "What time does the bank open?"),
        ),
    )

    val explanation = ReaderWordExplanationDto(
        word = "银行", pinyin = "yínháng", english = "bank",
        explanation = "**银行** is literally the *silver* (银) *trade* (行, háng — a row of shops, a line of business): a bank. " +
            "Here 行 is háng, not xíng — the same háng as 行业 (industry).",
    )

    fun item(sentence: String? = "明天我要去银行办卡。") = ExplorerItem.Word("银行", "yínháng", "bank", sentence)

    fun env(online: Boolean = true, mine: MyWord = MyWord(), word: WordDict.Lookup = WordDict.Lookup.Ok(yinhang)) = ExplorerEnv(
        chars = CharSheetActions(
            lookup = { c -> records[c]?.let { CharDict.Lookup.Ok(it) } ?: CharDict.Lookup.Missing },
            statuses = { words, _ -> words.map { dev.jeromeswannack.chineselearning.lab.core.CharWordRow(it, statuses[it.hanzi] ?: CharWordStatus.None, emptyList(), false) } },
        ),
        wordLookup = { word },
        myWord = { mine },
        rank = { ranks[it] },
        online = { online },
        canWrite = true,
        bump = { h, _ -> "⚡ ${h.first()} is in today's study" },
        openCard = {},
    )

    /** The Word view's data as the host builds it (everything loaded). */
    fun wordUi(mine: MyWord? = this.mine, lookup: WordDict.Lookup = WordDict.Lookup.Ok(yinhang), online: Boolean = true, more: WordMore = WordMore.Idle, item: ExplorerItem.Word = item()) = WordViewUi(
        item = item,
        lookup = lookup,
        charRecords = records,
        mine = mine,
        rank = ranks["银行"],
        more = more,
        online = online,
        statuses = statuses,
        rankOf = { ranks[it] },
    )
}
