package dev.jeromeswannack.chineselearning.lab.ui.decks

import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.api.CardFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubReviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.QuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.SearchHitDto
import dev.jeromeswannack.chineselearning.lab.data.decks.NoteFields
import dev.jeromeswannack.chineselearning.lab.ui.cards.CardHubUi
import dev.jeromeswannack.chineselearning.lab.ui.cards.HubNoteUi
import dev.jeromeswannack.chineselearning.lab.ui.cards.HubTutor
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditUi

/** Package C sample data (real hanzi) for screenshots. */
object DecksSamples {
    private const val H = "hanzi_to_meaning"
    private const val M = "meaning_to_hanzi"
    private const val A = "audio_to_hanzi"

    val decks = listOf(
        DeckCardUi("d1", "Homework — 周末的活动", 24, QueueCounts(3, 2, 1, 9), hasMoreNew = true, totalCards = 72, mastered = 12, learning = 20),
        DeckCardUi("d2", "HSK 3 · Plans & time", 120, QueueCounts(0, 0, 0, 6), hasMoreNew = true, totalCards = 360, mastered = 150, learning = 60),
        DeckCardUi("d3", "Food & ordering", 58, QueueCounts(0, 0, 0, 0), hasMoreNew = true, totalCards = 174, mastered = 90, learning = 14),
        DeckCardUi("d4", "Starter Chinese", 15, QueueCounts(0, 0, 0, 0), hasMoreNew = false, totalCards = 45, mastered = 45, learning = 0),
        DeckCardUi("d5", "Measure words 量词", 32, QueueCounts(0, 0, 2, 4), hasMoreNew = false, totalCards = 96, mastered = 30, learning = 40),
    )

    val list = DecksUi(loaded = true, decks = decks, newPerDay = 3)

    private fun r(vararg xs: Int) = xs.toList()

    val search = list.copy(
        query = "yinh",
        search = SearchUi(
            query = "yinh",
            total = 3,
            localNotes = 3012,
            results = listOf(
                SearchRowUi("n1", "d2", "HSK 3 · Plans & time", "银行", "yínháng", "bank", "我去银行取钱。", mapOf(H to r(2, 2, 0, 1), M to r(3, 2), A to r(2)), 64),
                SearchRowUi("n2", "d3", "Food & ordering", "银行卡", "yínhángkǎ", "bank card", "可以刷银行卡吗？", mapOf(H to r(1, 0)), 12),
                SearchRowUi("n3", "d1", "Homework — 周末的活动", "银河", "yínhé", "the Milky Way", null, emptyMap(), 0),
            ),
        ),
    )

    val searchServer = list.copy(
        query = "hǎixiān",
        search = SearchUi(
            query = "hǎixiān", total = 0, localNotes = 812, results = emptyList(),
            server = ServerSearchUi(
                hits = listOf(
                    SearchHitDto("s1", "d9", "海鲜", "hǎixiān", "seafood", "我对海鲜过敏。", "Restaurant 餐厅"),
                    SearchHitDto("s2", "d9", "海鲜面", "hǎixiānmiàn", "seafood noodles", null, "Restaurant 餐厅"),
                ),
                totalNotes = 3012,
            ),
        ),
    )

    val deck = DeckUi(
        loaded = true,
        deck = DeckHeaderUi("d1", "Homework — 周末的活动", "Words from Tuesday's lesson with 王老师", 3, 6),
        due = 15,
        completion = DeckStats.Completion(72, 40, 12, 20),
        breakdown = mapOf(
            H to DeckStats.TypeBreakdown(24, 4, 8, 6, 6),
            M to DeckStats.TypeBreakdown(24, 12, 6, 2, 4),
            A to DeckStats.TypeBreakdown(24, 16, 6, 0, 2),
        ),
        notes = listOf(
            NoteRowUi("n1", "打算", "dǎsuàn", "to plan; to intend", "你周末打算做什么？", "a.mp3", mapOf(H to r(2, 2, 3), M to r(2, 1), A to r(3)), 88),
            NoteRowUi("n2", "爬山", "páshān", "to climb a mountain; to hike", "我们周六去爬山吧。", "b.mp3", mapOf(H to r(2, 0, 2), M to r(1)), 41),
            NoteRowUi("n3", "逛街", "guàngjiē", "to go shopping; to stroll the streets", "她喜欢和朋友逛街。", "c.mp3", mapOf(H to r(0, 0)), 9),
            NoteRowUi("n4", "睡懒觉", "shuì lǎnjiào", "to sleep in", null, null, emptyMap(), 0),
            NoteRowUi("n5", "看电影", "kàn diànyǐng", "to watch a film", "周末我常常看电影。", "e.mp3", emptyMap(), 0),
        ),
    )

    val edit = NoteEditUi(
        noteId = "n1",
        initial = NoteFields(
            "打算", "dǎsuàn", "to plan; to intend",
            funFacts = "**打** (dǎ) to do · **算** (suàn) to calculate\nTogether: to reckon on doing something.",
            sentenceClue = "你周末打算做什么？", sentenceCluePinyin = "Nǐ zhōumò dǎsuàn zuò shénme?", sentenceClueTranslation = "What are you planning to do this weekend?",
            alternatives = "准备",
        ),
        hasAudio = true,
    )

    val hub = CardHubUi(
        loaded = true,
        note = HubNoteUi(
            "打算", "dǎsuàn", "to plan; to intend",
            "**打** (dǎ) to do · **算** (suàn) to calculate\n- 打算 + verb: 我打算明年去中国。\n- Softer than 计划 (jìhuà), a formal plan.",
            "你周末打算做什么？", "Nǐ zhōumò dǎsuàn zuò shénme?", "What are you planning to do this weekend?", "a.mp3", "d1", "Homework — 周末的活动",
        ),
        cards = listOf(
            HubCardDto("c1", H, 2, 24.0, 4.1, 0, 5, "2026-10-12T08:00:00Z"),
            HubCardDto("c2", M, 1, 0.8, 6.5, 1, 3, "2026-09-27T12:10:00Z"),
            HubCardDto("c3", A, 0, 0.0, 0.0, 0, 0, null),
        ),
        flags = listOf(
            CardFlagDto("f1", "rel1", "n1", null, "Is it dǎsuàn or dǎsuan? The audio sounds neutral.", "resolved", "Both are heard — in speech 算 is often light. The card's dǎsuàn is the dictionary form.", "2026-09-24T10:00:00Z", "2026-09-23T19:00:00Z", "2026-09-24T10:00:00Z", "王老师"),
        ),
        threads = listOf(
            listOf(
                QuestionDto("q1", "n1", "What's the difference between 打算 and 计划?", "**打算** is everyday — what you intend to do.\n**计划** is a plan you've laid out, often formal: 旅行计划.", "2026-09-25 09:00:00"),
                QuestionDto("q2", "n1", "Can I say 我打算了?", "Not on its own — 打算 needs what you plan: 我打算去北京。", "2026-09-25 09:03:00"),
            ),
        ),
        reviews = listOf(
            HubReviewDto("r1", "c2", M, 0, "2026-09-27T08:00:00Z", 12000, "打算", null),
            HubReviewDto("r2", "c1", H, 2, "2026-09-26T08:00:00Z", 4000, null, "recordings/r2.webm"),
            HubReviewDto("r3", "c2", M, 2, "2026-09-22T08:00:00Z", 6000, "大算", null),
        ),
        reviewCount = 9,
        fromServer = true,
        tutors = listOf(HubTutor("rel1", "王老师")),
    )

    val tutorShares = listOf(
        TutorShareUi("rel-1", "王老师", "wang@example.com", "2026-09-20 08:12:00"),
        TutorShareUi("rel-2", "Li Na", "lina@example.com", "2026-09-25T10:00:00.000Z"),
    )
    val tutors = listOf(
        TutorOptionUi("rel-1", "王老师", "wang@example.com"),
        TutorOptionUi("rel-3", "Chen Jing", "chen@example.com"),
    )
    val tryUi = DeckTryUi(
        loaded = true,
        deckName = "Homework — 周末的活动",
        notes = listOf(
            TryNoteUi("n1", "打算", "dǎsuàn", "to plan; to intend", "a.mp3", "你周末打算做什么？", "nǐ zhōumò dǎsuàn zuò shénme?", "What are you planning to do at the weekend?", "**打** (dǎ) to strike · **算** (suàn) to calculate → to plan.\nUsed before a verb: 我打算去北京。"),
            TryNoteUi("n2", "爬山", "páshān", "to climb a mountain; to hike", "b.mp3", "我们周六去爬山吧。", "wǒmen zhōuliù qù páshān ba.", "Let's go hiking on Saturday.", "**爬** (pá) to climb · **山** (shān) mountain.\nA verb-object word: 爬了一次山."),
            TryNoteUi("n3", "有意思", "yǒu yìsi", "interesting", null),
        ),
    )
}
