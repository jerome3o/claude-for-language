package dev.jeromeswannack.chineselearning.lab.ui.progress

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Mastery
import dev.jeromeswannack.chineselearning.lab.core.MasteryCard
import dev.jeromeswannack.chineselearning.lab.core.Progress
import dev.jeromeswannack.chineselearning.lab.core.ProgressCardInfo
import dev.jeromeswannack.chineselearning.lab.core.ProgressEvent
import dev.jeromeswannack.chineselearning.lab.core.Streak
import dev.jeromeswannack.chineselearning.lab.data.progress.CardDay
import dev.jeromeswannack.chineselearning.lab.data.progress.CardDayReview
import dev.jeromeswannack.chineselearning.lab.data.progress.DeckProgressRow
import dev.jeromeswannack.chineselearning.lab.data.progress.ProgressSnapshot
import java.time.LocalDate
import java.time.ZoneId
import kotlin.random.Random

/** A month of realistic study (real words, a 12-day streak with a gap before it) for the Progress screenshots. */
object ProgressSamples {
    val zone: ZoneId = ZoneId.of("Pacific/Auckland")
    const val NOW = 1_790_000_000_000L // 2026-09-21 (a Monday evening in Auckland)

    private val words = listOf(
        Triple("打算", "dǎsuàn", "to plan"), Triple("周末", "zhōumò", "weekend"), Triple("已经", "yǐjīng", "already"),
        Triple("比较", "bǐjiào", "relatively"), Triple("办法", "bànfǎ", "method; way"), Triple("担心", "dānxīn", "to worry"),
        Triple("决定", "juédìng", "to decide"), Triple("环境", "huánjìng", "environment"), Triple("附近", "fùjìn", "nearby"),
    )
    private val types = Mastery.CARD_TYPES

    val cards: List<ProgressCardInfo> = words.flatMapIndexed { i, (h, p, e) ->
        types.mapIndexed { j, t -> ProgressCardInfo("c$i-$j", t, "n$i", h, p, e) }
    }

    val events: List<ProgressEvent> = buildList {
        val r = Random(7)
        for (daysAgo in 0..34) {
            if (daysAgo in 13..14 || daysAgo == 20 || daysAgo == 27) continue // a few days off
            val n = if (daysAgo == 0) 38 else 18 + r.nextInt(70)
            repeat(n) {
                val at = NOW - daysAgo * 86_400_000L - r.nextLong(9 * 3_600_000L)
                val card = cards[r.nextInt(cards.size)]
                add(ProgressEvent(card.cardId, listOf(0, 1, 2, 2, 2, 3, 3, 2)[r.nextInt(8)], Js.toIsoString(at), 4_000L + r.nextLong(14_000), if (card.cardType != "hanzi_to_meaning") card.hanzi else null))
            }
        }
    }

    private fun counts(seed: Int, total: Int) = Random(seed).let { r ->
        List(total) { MasteryCard(types[it % 3], listOf(0, 0, 1, 2, 2, 2, 2)[r.nextInt(7)], listOf(3.0, 12.0, 30.0, 60.0)[r.nextInt(4)]) }
    }

    private fun deck(id: String, name: String, seed: Int, total: Int) = Mastery.progress(counts(seed, total)).let { DeckProgressRow(id, name, it.completion, it.counts) }

    val decks = listOf(
        deck("d1", "HSK 3 · Plans & time", 1, 360),
        deck("d2", "Homework — 周末的活动", 2, 72),
        deck("d3", "Food & ordering", 3, 174),
        deck("d4", "Starter Chinese", 4, 45),
    )

    val snapshot = ProgressSnapshot(
        daily = Progress.dailyProgress(events, NOW),
        streak = Streak.studyStreak(events, NOW, zone),
        overall = Mastery.progress(decks.indices.flatMap { counts(it + 1, listOf(360, 72, 174, 45)[it]) }),
        decks = decks,
        totalReviews = events.size + 4_210,
    )

    val ui = ProgressUi(true, snapshot, LocalDate.ofInstant(java.time.Instant.ofEpochMilli(NOW), zone), barsFor(snapshot, NOW))

    val day = Progress.dayCards(events, cards, snapshot.daily.days[1].date)

    val cardDay = CardDay(
        cards[1], null,
        listOf(
            CardDayReview("e1", Js.toIsoString(NOW - 5 * 3_600_000L), 0, 14_200, "打蒜"),
            CardDayReview("e2", Js.toIsoString(NOW - 5 * 3_600_000L + 80_000), 2, 6_100, "打算"),
            CardDayReview("e3", Js.toIsoString(NOW - 2 * 3_600_000L), 3, 3_400, "打算"),
        ),
    )
}
