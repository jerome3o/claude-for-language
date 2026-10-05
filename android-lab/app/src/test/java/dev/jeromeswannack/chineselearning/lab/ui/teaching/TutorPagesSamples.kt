package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.api.ActivityLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.ActivityReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.DeckRefDto
import dev.jeromeswannack.chineselearning.lab.data.api.GoingWellDto
import dev.jeromeswannack.chineselearning.lab.data.api.HistoryEventDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightActivityDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightAttemptDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightRangeDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightRecordingDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightTotalsDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightsReportDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonLogEntryDto
import dev.jeromeswannack.chineselearning.lab.data.api.MixUpDto
import dev.jeromeswannack.chineselearning.lab.data.api.MixUpExampleDto
import dev.jeromeswannack.chineselearning.lab.data.api.QueueNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingCheckDto
import dev.jeromeswannack.chineselearning.lab.data.api.WeakCharDto
import dev.jeromeswannack.chineselearning.lab.data.api.QueueFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueCountsDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteRefDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingMarkDto
import dev.jeromeswannack.chineselearning.lab.data.api.StrugglingDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentSummaryDto

/** Realistic data for the Insights / History / Recordings screenshots. */
object TutorPagesSamples {
    private fun n(id: String, h: String, p: String, e: String, deck: String = "第四周作业：交通") = NoteRefDto(id, h, p, e, "d1", deck)

    val dasuan = n("n1", "打算", "dǎsuàn", "to plan; to intend", "HSK 3 · Plans & time")
    val ditiezhan = n("n2", "地铁站", "dìtiězhàn", "subway station")
    val huancheng = n("n3", "换乘", "huànchéng", "to change (trains)")

    val report = InsightsReportDto(
        range = InsightRangeDto("2026-09-23T09:00:00Z", "2026-09-27T09:30:00Z"),
        totals = InsightTotalsDto(reviews = 214, unique_notes = 58, days_active = 4, accuracy = 0.83, again_rate = 0.11, time_ms = 73 * 60_000L, new_words_introduced = 12),
        struggling = listOf(
            StrugglingDto(
                dasuan, attempts = 6, again_count = 3, again_rate = 0.5, forgot_count = 1, avg_time_ms = 8400.0, wrong_answers = listOf("打算了", "大算"),
                events = listOf(
                    InsightAttemptDto("e1", "meaning_to_hanzi", 0, "2026-09-27T07:10:00Z", 12000, "大算"),
                    InsightAttemptDto("e2", "hanzi_to_meaning", 2, "2026-09-26T07:10:00Z", 4200, recording_url = "recordings/e2.webm"),
                    InsightAttemptDto("e3", "audio_to_hanzi", 0, "2026-09-25T07:10:00Z", 9100, "打算了"),
                ),
            ),
            StrugglingDto(ditiezhan, attempts = 4, hard_count = 2, again_rate = 0.0, recordings_count = 2),
            StrugglingDto(huancheng, attempts = 3, again_count = 1, again_rate = 0.33, wrong_answers = listOf("换成")),
        ),
        going_well = listOf(
            GoingWellDto(n("n5", "公共汽车", "gōnggòng qìchē", "bus"), 4, 2, "consistent"),
            GoingWellDto(n("n6", "出租车", "chūzūchē", "taxi"), 3, 1, "graduated", 9),
        ),
        activity = InsightActivityDto(
            lessons = listOf(ActivityLessonDto("l1", "了 for completed actions", 2, "2026-09-25T10:00:00Z")),
            readers = listOf(ActivityReaderDto("r1", "小明在巴黎", "Xiaoming in Paris", 3, "2026-09-26T10:00:00Z")),
        ),
        recordings = listOf(
            InsightRecordingDto("e2", dasuan, "hanzi_to_meaning", 2, "2026-09-26T07:10:00Z", "recordings/e2.webm"),
            InsightRecordingDto("e7", ditiezhan, "hanzi_to_meaning", 1, "2026-09-26T21:00:00Z", "recordings/e7.webm"),
            InsightRecordingDto("e8", huancheng, "hanzi_to_meaning", 1, "2026-09-25T21:00:00Z", "recordings/e8.webm", mark = RecordingMarkDto("e8", "needs_work", "huàn is 4th tone — yours goes up like 2nd.")),
            InsightRecordingDto("e9", n("n5", "公共汽车", "gōnggòng qìchē", "bus"), "hanzi_to_meaning", 3, "2026-09-24T21:00:00Z", "recordings/e9.webm", mark = RecordingMarkDto("e9", "listened")),
        ),
        mix_ups = listOf(
            MixUpDto("买", "卖", 3, "2026-09-27T07:10:00Z", listOf(MixUpExampleDto("买东西", "卖东西", "2026-09-27T07:10:00Z"), MixUpExampleDto("买菜", "卖菜", "2026-09-25T07:10:00Z"))),
            MixUpDto("乘", "成", 2, "2026-09-26T07:10:00Z", listOf(MixUpExampleDto("换乘", "换成", "2026-09-26T07:10:00Z"))),
        ),
    )

    private fun qn(id: String, h: String, p: String, e: String, deck: String = "第四周作业：交通", audio: String? = "generated/$id.mp3") = QueueNoteDto(id, h, p, e, deck, audio)

    /** "Needs your ear": what was heard, a tone, a flag, a low score, a self-rated Again. */
    val queue = RecordingQueueDto(
        range = InsightRangeDto("2026-08-28T09:00:00Z", "2026-09-27T23:59:59Z"),
        view = "queue",
        items = listOf(
            RecordingQueueItemDto(
                "q1", qn("n7", "银行", "yínháng", "bank"), rating = 2, reviewed_at = "2026-09-27T07:12:00Z", recording_url = "recordings/q1.webm",
                check = RecordingCheckDto("done", "音行", false, 64.0, listOf(WeakCharDto("银", 52.0, "tone"))),
                reasons = listOf("heard_different", "low_score", "sounded_off"), labels = listOf("Heard: 音行", "Pronunciation score 64", "Sounded off: 银 (tone)"), in_queue = true,
            ),
            RecordingQueueItemDto(
                "q2", qn("n2", "地铁站", "dìtiězhàn", "subway station"), rating = 1, reviewed_at = "2026-09-26T21:00:00Z", recording_url = "recordings/q2.webm",
                check = RecordingCheckDto("done", "地铁站", true, 78.0, listOf(WeakCharDto("铁", 61.0, "sound"), WeakCharDto("站", null, "missing"))),
                reasons = listOf("rated_hard", "low_score", "sounded_off"), labels = listOf("Rated Hard", "Pronunciation score 78", "Sounded off: 铁 (sound), 站 (missed)"), in_queue = true,
            ),
            RecordingQueueItemDto(
                "q3", qn("n3", "换乘", "huànchéng", "to change (trains)", audio = null), rating = 2, reviewed_at = "2026-09-25T21:00:00Z", recording_url = "recordings/q3.webm",
                check = RecordingCheckDto("done", "换乘", true, 91.0, score_note = "Scored on a short clip — treat as a hint."),
                flag = QueueFlagDto("f1", "Is the tone on 换 right? It sounds odd to me."),
                reasons = listOf("flagged"), labels = listOf("Flagged for you"), in_queue = true,
            ),
            RecordingQueueItemDto(
                "q4", qn("n1", "打算", "dǎsuàn", "to plan; to intend", "HSK 3 · Plans & time"), rating = 0, reviewed_at = "2026-09-25T07:10:00Z", recording_url = "recordings/q4.webm",
                reasons = listOf("rated_again"), labels = listOf("Rated Again"), in_queue = true,
            ),
        ),
        counts = RecordingQueueCountsDto(queue = 4, all = 11, checking = 2),
        scoring = true,
    )

    val queueAll = queue.copy(
        view = "all",
        items = queue.items.take(2) + listOf(
            RecordingQueueItemDto(
                "q5", qn("n5", "公共汽车", "gōnggòng qìchē", "bus"), rating = 3, reviewed_at = "2026-09-24T21:00:00Z", recording_url = "recordings/q5.webm",
                mark = RecordingMarkDto("q5", "listened"), check = RecordingCheckDto("done", "公共汽车", true, 95.0),
            ),
            RecordingQueueItemDto(
                "q6", qn("n6", "出租车", "chūzūchē", "taxi"), rating = 2, reviewed_at = "2026-09-24T07:00:00Z", recording_url = "recordings/q6.webm",
                mark = RecordingMarkDto("q6", "needs_work", "chū is 1st tone — keep it high and flat."), check = RecordingCheckDto("done", "出租车", true, 88.0),
            ),
        ),
        counts = RecordingQueueCountsDto(queue = 4, all = 11, checking = 0),
    )

    val queueEmpty = RecordingQueueDto(range = queue.range, view = "queue", counts = RecordingQueueCountsDto(queue = 0, all = 9, checking = 0), scoring = false)

    val lessonLog = listOf(
        LessonLogEntryDto("ll1", "2026-09-23T09:00:00Z", "Transport: 地铁, 换乘, 出租车. Homework: the 交通 deck over 3 days."),
        LessonLogEntryDto("ll2", "2026-09-16T09:00:00Z", null),
    )

    val summary = StudentSummaryDto(
        "s1", "2026-09-23T09:00:00Z", "2026-09-27T09:30:00Z",
        "Jerome studied on 4 of the last 5 days (214 attempts, 83% right). The new transport words are mostly in place; 打算 keeps coming back as 大算 when typed, and 换乘 is being confused with 换成. Worth a minute on both next lesson.",
        "Jerome 最近五天里学习了四天（214 次练习，正确率 83%）。新的交通词汇基本掌握了；打算 打字时常写成 大算，换乘 和 换成 容易混淆。下次上课可以花一点时间讲讲这两个词。",
        "2026-09-27T09:20:00Z",
    )

    private fun h(id: String, note: NoteRefDto, type: String, rating: Int, at: String, answer: String? = null, ms: Long? = 5200, rec: String? = null) =
        HistoryEventDto(id, type, note.id, note.hanzi, note.pinyin, note.english, note.deck_name ?: "", rating, ms, answer, rec, at)

    val history = listOf(
        h("h1", dasuan, "meaning_to_hanzi", 0, "2026-09-27T07:10:00Z", "大算", 12000),
        h("h2", huancheng, "audio_to_hanzi", 2, "2026-09-27T07:09:00Z", "换乘"),
        h("h3", ditiezhan, "hanzi_to_meaning", 1, "2026-09-27T07:08:00Z", rec = "recordings/h3.webm"),
        h("h4", dasuan, "audio_to_hanzi", 0, "2026-09-26T07:10:00Z", "打算了", 9100),
        h("h5", huancheng, "meaning_to_hanzi", 0, "2026-09-26T07:05:00Z", "换成"),
        h("h6", dasuan, "hanzi_to_meaning", 3, "2026-09-25T07:10:00Z", ms = 2100),
    )

    val decks = listOf(DeckRefDto("d1", "第四周作业：交通"), DeckRefDto("d2", "HSK 3 · Plans & time"))
}
