package dev.jeromeswannack.chineselearning.lab.testing

import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary

/** Realistic sample data for screenshots (real hanzi, never lorem ipsum). Add what your feature needs. */
object Samples {
    val note = NoteEntity(
        id = "n1", deckId = "d1", hanzi = "打算", pinyin = "dǎsuàn", english = "to plan; to intend",
        audioUrl = null,
        funFacts = "**打** (dǎ) to hit, to do · **算** (suàn) to calculate\nTogether: to reckon on doing something — a plan you've thought through.\n- 打算 + verb: 我打算明年去中国。\n- Softer than 计划 (jìhuà), which is a formal plan.",
        context = null,
        sentenceClue = "你周末打算做什么？", sentenceCluePinyin = "Nǐ zhōumò dǎsuàn zuò shénme?", sentenceClueTranslation = "What are you planning to do this weekend?",
        sentenceClueAudioUrl = null, alternatives = null, createdAt = "2026-09-01 10:00:00",
    )

    val sentences = listOf(
        SentenceEntity("s1", "n1", 0, "我打算学中文。", "Wǒ dǎsuàn xué Zhōngwén.", "I plan to study Chinese.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "你打算什么时候回家？", "Nǐ dǎsuàn shénme shíhou huí jiā?", "When do you plan to go home?", null, "core", null),
        SentenceEntity("s3", "n1", 2, "他算了算钱，打算买那辆车。", "Tā suànle suàn qián, dǎsuàn mǎi nà liàng chē.", "He counted his money and decided to buy that car.", null, "shared_character", null),
    )

    val decks = listOf(
        DeckSummary("d1", "HSK 3 · Plans & time", 120, QueueCounts(3, 2, 1, 9)),
        DeckSummary("d2", "Homework — 周末的活动", 24, QueueCounts(0, 0, 0, 6)),
        DeckSummary("d3", "Food & ordering", 58, QueueCounts(0, 0, 0, 3)),
        DeckSummary("d4", "Starter Chinese", 15, QueueCounts(0, 0, 0, 0)),
    )

    val counts = QueueCounts(new = 3, secondaryNew = 2, learning = 1, review = 18)

    fun sync(nowMs: Long = System.currentTimeMillis()) = SyncStatus(lastSyncAt = nowMs - 4 * 60_000, audioTotal = 830, audioCached = 812)
}
