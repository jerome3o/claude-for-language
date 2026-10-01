package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.NoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.CardDayCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.CardDayDto
import dev.jeromeswannack.chineselearning.lab.data.api.CardDayNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.CardDayReviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.CardFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.CompletionDto
import dev.jeromeswannack.chineselearning.lab.data.api.DailyProgressDto
import dev.jeromeswannack.chineselearning.lab.data.api.KnownCountsDto
import dev.jeromeswannack.chineselearning.lab.data.api.KnownSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.DayCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.DayCardsDto
import dev.jeromeswannack.chineselearning.lab.data.api.DaySummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.DeckActivityDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubOwnerDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubReviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteHubDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteProgressDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteRefDto
import dev.jeromeswannack.chineselearning.lab.data.api.ProgressDayDto
import dev.jeromeswannack.chineselearning.lab.data.api.ProgressSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.QuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecentRatingsDto
import dev.jeromeswannack.chineselearning.lab.data.api.SharedDeckProgressDto
import dev.jeromeswannack.chineselearning.lab.data.api.TypeBreakdownDto
import dev.jeromeswannack.chineselearning.lab.data.api.TypeStatsDto

/** The tutor's card hub and the student progress pages. */
object ProgressSamples {
    val hub = NoteHubDto(
        note = NoteDto(
            "n2", "d1", "地铁站", "dìtiězhàn", "subway station", audio_url = "generated/n2.mp3",
            fun_facts = "**地铁** (dìtiě) subway · **站** (zhàn) station, stop\n- 站 is also \"to stand\" (站起来), same character.",
            sentence_clue = "最近的地铁站在哪儿？", sentence_clue_pinyin = "Zuìjìn de dìtiězhàn zài nǎr?", sentence_clue_translation = "Where is the nearest subway station?",
        ),
        deck = HubDeckDto("t1", "第四周作业：交通"),
        owner = HubOwnerDto("u-jerome", "Jerome"),
        cards = listOf(
            HubCardDto("c1", "hanzi_to_meaning", 2, next_review_at = "2026-10-03T09:00:00Z"),
            HubCardDto("c2", "meaning_to_hanzi", 1, next_review_at = "2026-09-27T09:40:00Z"),
            HubCardDto("c3", "audio_to_hanzi", 0),
        ),
        recent_reviews = listOf(
            HubReviewDto("r1", "c2", "meaning_to_hanzi", 0, "2026-09-27T07:08:00Z", 9000, "地铁占"),
            HubReviewDto("r2", "c1", "hanzi_to_meaning", 1, "2026-09-26T21:00:00Z", 5200, recording_url = "recordings/e7.webm"),
        ),
        review_count = 7,
        questions = listOf(QuestionDto("q9", "n2", "Is 站 here the same as in 站起来?", "Yes — the same character. As a noun it's a stop or station; as a verb, to stand.", "2026-09-26T21:02:00Z")),
        flags = listOf(CardFlagDto("f1", "rel-jerome", "n2", message = "Is 站 here the same as in 站起来? The audio sounds different to me.", created_at = "2026-09-26T21:05:00Z", student_name = "Jerome")),
    )

    val daily = DailyProgressDto(
        summary = ProgressSummaryDto(642, 21, 84.0, 5 * 3_600_000L + 12 * 60_000L),
        days = listOf(
            ProgressDayDto("2026-09-27", 42, 30, 86.0, 11 * 60_000L),
            ProgressDayDto("2026-09-26", 57, 41, 79.0, 16 * 60_000L),
            ProgressDayDto("2026-09-24", 35, 28, 91.0, 9 * 60_000L),
        ),
        known = KnownSummaryDto(KnownCountsDto(1184, 213), KnownCountsDto(1342, 377), KnownCountsDto(128, 96)),
    )

    private fun ref(id: String, h: String, p: String, e: String) = NoteRefDto(id, h, p, e)

    val day = DayCardsDto(
        "2026-09-26", DaySummaryDto(57, 41, 79.0, 16 * 60_000L),
        listOf(
            DayCardDto("c2", "meaning_to_hanzi", ref("n2", "地铁站", "dìtiězhàn", "subway station"), 3, listOf(0, 0, 2), has_answers = true),
            DayCardDto("c9", "hanzi_to_meaning", ref("n3", "换乘", "huànchéng", "to change (trains)"), 2, listOf(1, 2), has_recordings = true),
            DayCardDto("c7", "audio_to_hanzi", ref("n5", "公共汽车", "gōnggòng qìchē", "bus"), 1, listOf(3), has_answers = true),
        ),
    )

    val cardDay = CardDayDto(
        CardDayCardDto("c2", "meaning_to_hanzi", CardDayNoteDto("n2", "地铁站", "dìtiězhàn", "subway station", "generated/n2.mp3")),
        listOf(
            CardDayReviewDto("r1", "2026-09-26T07:08:00Z", 0, 9000, "地铁占"),
            CardDayReviewDto("r2", "2026-09-26T07:12:00Z", 0, 6100, "地跌站"),
            CardDayReviewDto("r3", "2026-09-26T07:20:00Z", 2, 4300, "地铁站"),
        ),
    )

    val sharedDeck = SharedDeckProgressDto(
        "第四周作业：交通", "2026-09-20T10:00:00Z", TeachingSamples.jerome,
        CompletionDto(72, 45, 18, 63, 25),
        TypeBreakdownDto(TypeStatsDto(24, 6, 5, 7, 6), TypeStatsDto(24, 10, 6, 4, 4), TypeStatsDto(24, 11, 5, 4, 4)),
        listOf(
            NoteProgressDto("公共汽车", "gōnggòng qìchē", "bus", 72, RecentRatingsDto(listOf(3, 2, 2), listOf(2, 2), listOf(2))),
            NoteProgressDto("换乘", "huànchéng", "to change (trains)", 31, RecentRatingsDto(listOf(2, 1), listOf(0, 1), emptyList())),
            NoteProgressDto("地铁站", "dìtiězhàn", "subway station", 12, RecentRatingsDto(listOf(1), listOf(2, 0, 0), emptyList())),
            NoteProgressDto("出租车", "chūzūchē", "taxi", 0),
        ),
        DeckActivityDto("2026-09-27T07:12:00Z", 94 * 60_000L, 136),
    )
}
