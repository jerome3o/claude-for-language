package dev.jeromeswannack.chineselearning.lab.ui.progress

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.KnownCounts
import dev.jeromeswannack.chineselearning.lab.core.KnownPoint
import dev.jeromeswannack.chineselearning.lab.core.KnownPace
import dev.jeromeswannack.chineselearning.lab.core.KnownProgress
import dev.jeromeswannack.chineselearning.lab.core.KnownRate
import dev.jeromeswannack.chineselearning.lab.core.KnownRates
import dev.jeromeswannack.chineselearning.lab.core.SeriesPace
import dev.jeromeswannack.chineselearning.lab.core.WeekGain
import dev.jeromeswannack.chineselearning.lab.core.RecentCharacter
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

    /** Thirteen months of steady study: weekly points, a summer lull, a lapse dip in spring. */
    val known: KnownProgress = run {
        val weeks = 57
        fun curve(t: Double, total: Int): Int {
            val lull = if (t > 0.62 && t < 0.72) (t - 0.62) * 0.9 else if (t >= 0.72) 0.09 else 0.0
            val dip = if (t > 0.4 && t < 0.46) Math.sin((t - 0.4) / 0.06 * Math.PI) * 0.02 else 0.0
            val base = Math.pow(t, 1.15) - lull * 0.5 - dip
            return Math.max(0, Math.round(total * base.coerceIn(0.0, 1.0) / (1 - 0.045)).toInt().coerceAtMost(total))
        }
        val history = (0..weeks).map { k ->
            val t = k.toDouble() / weeks
            KnownPoint(NOW - (weeks - k) * 7 * 86_400_000L, KnownCounts(curve(t, 1184), 0), KnownCounts(curve(t, 1342), 0))
        }
        val recent = listOf("郊", "辣", "慧", "抱", "歉", "恤", "瑞", "典", "璃", "签", "订", "阅")
            .mapIndexed { i, c -> RecentCharacter(c, Js.toIsoString(NOW - i * 20 * 3_600_000L)) }
        KnownProgress(KnownCounts(1184, 213), KnownCounts(1342, 377), KnownCounts(128, 96), recent, history)
    }

    /** Per week from the same curve: one bar per week (the last 52), this week partial, the spring dip below zero. */
    val knownRate: KnownRate = run {
        val h = known.history
        val tz = zone.rules.getOffset(java.time.Instant.ofEpochMilli(NOW)).totalSeconds / 60
        val thisWeek = KnownRates.weekStart(NOW, tz)
        val weeks = (1 until h.size).map { k ->
            val partial = k == h.size - 1
            val start = thisWeek - (h.size - 1 - k) * KnownRates.WEEK_MS
            WeekGain(
                start, if (partial) NOW else start + KnownRates.WEEK_MS, partial,
                h[k].characters.known - h[k - 1].characters.known - (if (partial) 9 else 0),
                h[k].words.known - h[k - 1].words.known - (if (partial) 12 else 0),
            )
        }.takeLast(KnownRates.MAX_WEEKS).mapIndexed { i, w ->
            // A rough week in spring: more cards lapsed than matured (below the zero line).
            if (i == 22) w.copy(characters = -7, words = -12) else w
        }
        fun pace(now: Int, a4: Int, a8: Int): SeriesPace {
            val per = Math.floor((now - a4) / 4.0 + 0.5).toInt()
            val prev = Math.floor((a4 - a8) / 4.0 + 0.5).toInt()
            return SeriesPace(per, prev, if (per > prev) "up" else if (per < prev) "down" else "same")
        }
        val n = h.size - 1
        KnownRate(
            weeks,
            KnownPace(
                pace(h[n].characters.known, h[n - 4].characters.known, h[n - 8].characters.known),
                pace(h[n].words.known, h[n - 4].words.known, h[n - 8].words.known),
            ),
        )
    }

    val ui = ProgressUi(true, snapshot, LocalDate.ofInstant(java.time.Instant.ofEpochMilli(NOW), zone), barsFor(snapshot, NOW), known = known, knownRate = knownRate)

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
