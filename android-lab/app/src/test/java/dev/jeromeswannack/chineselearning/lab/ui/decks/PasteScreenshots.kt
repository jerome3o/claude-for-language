package dev.jeromeswannack.chineselearning.lab.ui.decks

import dev.jeromeswannack.chineselearning.lab.core.ImportPlanner
import dev.jeromeswannack.chineselearning.lab.data.NoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentShareDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/** Package C: Paste a list and Generate with Claude. */
class PasteScreenshots : LabScreenshotTest() {
    private val pinyin: (String) -> String = { h ->
        mapOf("葡萄" to "pú táo", "西瓜" to "xī guā", "草莓" to "cǎo méi", "我喜欢吃葡萄。" to "wǒ xǐ huan chī pú tao 。").getOrDefault(h, "")
    }
    private val existing = listOf(ImportPlanner.Existing("n1", "苹果", "píngguǒ", "apple"), ImportPlanner.Existing("n2", "香蕉", "xiāngjiāo", "banana", "Long and yellow", "我吃香蕉。"))
    private val TEXT = "苹果\tpíng guǒ\tan apple\n香蕉\txiāngjiāo\tbanana\n葡萄\n西瓜\txī guā\twatermelon\n草莓\tcǎoméi\tstrawberry\thello\nhello world"

    private fun ui(inputs: PasteInputs, extra: (PasteUi) -> PasteUi = { it }) =
        extra(PasteUi(inputs = inputs, derived = PasteWordsModel.derive(inputs, existing, pinyin), deckName = "Fruit 水果"))

    @Test fun empty() = shoot("decks-22-paste-empty") { PasteWordsScreen(ui(PasteInputs()), PasteActions()) }

    @Test fun checkTheReading() = shoot("decks-39-paste-check-the-reading") {
        val inputs = PasteInputs(text = "行\t\tto walk; OK\n乐\t\thappy\n苹果\tpíngguǒ\tapple")
        PasteWordsScreen(PasteUi(inputs = inputs, derived = PasteWordsModel.derive(inputs, existing, dev.jeromeswannack.chineselearning.lab.core.Pinyin::toPinyin), deckName = "Fruit 水果"), PasteActions())
    }

    @Test fun preview() = shoot("decks-23-paste-preview") { PasteWordsScreen(ui(PasteInputs(text = TEXT)), PasteActions()) }

    @Test fun enriched() = shoot("decks-24-paste-filled-by-claude") {
        val sug = mapOf(
            "葡萄" to Suggestion(english = "grape", funFacts = "葡 + 萄 — one word, never split", sentence = "我喜欢吃葡萄。", sentencePinyin = "Wǒ xǐhuan chī pútao."),
            "西瓜" to Suggestion(funFacts = "西 west + 瓜 melon", sentence = "夏天吃西瓜很舒服。"),
        )
        PasteWordsScreen(ui(PasteInputs(text = TEXT, suggested = sug)) { it.copy(glossedText = TEXT, editing = "葡萄") }, PasteActions())
    }

    @Test fun running() = shoot("decks-25-paste-saving") {
        PasteWordsScreen(ui(PasteInputs(text = TEXT)) { it.copy(stage = PasteStage.RUNNING, progressDone = 3, progressTotal = 5, current = "西瓜") }, PasteActions())
    }

    @Test fun done() = shoot("decks-26-paste-done-update-their-copy") {
        PasteWordsScreen(
            ui(PasteInputs(text = TEXT)) {
                it.copy(
                    stage = PasteStage.DONE,
                    outcome = ImportOutcome(3, 1, listOf("草莓" to "hanzi \"草莓/士多啤梨\" contains \"/\": the card shows ONE clean form")),
                    savedBare = 2,
                    shares = listOf(StudentShareDto("s1", "r1", student_name = "小明", notes_missing = 3), StudentShareDto("s2", "r2", student_name = "Anna", target_deleted = true)),
                    shareState = mapOf("s1" to ShareState(note = null)),
                )
            },
            PasteActions(),
        )
    }

    @Test fun generate() = shoot("decks-27-generate") {
        GenerateDeckScreen(GenerateUi(prompt = "Words for ordering at a hotpot restaurant", deckName = ""), GenerateActions())
    }

    @Test fun generated() = shoot("decks-28-generated") {
        GenerateDeckScreen(
            GenerateUi(
                result = GeneratedUi(
                    "g1", "火锅 Hotpot",
                    listOf(
                        NoteDto("a", "g1", "火锅", "huǒguō", "hotpot", fun_facts = "火 fire + 锅 pot"),
                        NoteDto("b", "g1", "鸳鸯锅", "yuānyangguō", "split hotpot (spicy + mild)", fun_facts = "鸳鸯 mandarin ducks — always in pairs"),
                        NoteDto("c", "g1", "麻辣", "málà", "numbing and spicy"),
                        NoteDto("d", "g1", "蘸料", "zhànliào", "dipping sauce"),
                    ),
                ),
            ),
            GenerateActions(),
        )
    }
}
