package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.api.ChatLineDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftPlanDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftPlanItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftViewDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobStepDto
import dev.jeromeswannack.chineselearning.lab.data.api.KnownDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonNotesEntryDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonNotesJobBriefDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionJobDto
import kotlinx.serialization.json.JsonPrimitive

/** A homework draft made from lesson notes, lesson-notes entries and session-notes jobs. */
object DraftSamples {
    private val result = JobResultDto(
        deck = JobDeckDto("dd1", "点菜 · Ordering food", 8),
        lessons = listOf(JobLessonDto("lib9", "把 + object + 放在…", exercise_count = 7)),
        summary = "8 words from the ordering role-play, a short 把 lesson from your examples. Left out 菜单 and 服务员 — Jerome already has them in review.",
    )

    val job = SessionJobDto(
        "job1", title = "Restaurant ordering", notes = "今天复习了点菜。新词：菜单 càidān menu, 服务员 fúwùyuán waiter…", notes_chars = 412,
        lesson_at = "2026-09-26T09:00:00Z", status = "done", result = result, created_at = "2026-09-26T10:00:00Z", review = JsonPrimitive(1),
        chat = listOf(
            ChatLineDto("assistant", "I drafted 8 words and a mini lesson on 把 from your notes. 菜单 and 服务员 are left out — Jerome has them already."),
            ChatLineDto("tutor", "Split the words over two days"),
            ChatLineDto("assistant", "Done — the words are now spread over 2 days, due Tue and Wed."),
        ),
        steps = listOf(JobStepDto(text = "Checked 10 words against Jerome's cards", kind = "tool"), JobStepDto(text = "Made 8 cards", kind = "tool"), JobStepDto(text = "Wrote a mini lesson: 把 + object + 放在…", kind = "tool")),
    )

    private fun w(id: String, h: String, p: String, e: String, known: KnownDto? = null, skipped: Boolean = false) = DraftWordDto(id, h, p, e, known, skipped)

    val view = DraftViewDto(
        student_name = "Jerome",
        job = job,
        plan = DraftPlanDto(
            split_days = 2, priority = "core",
            items = listOf(
                DraftPlanItemDto("deck", "deck", "dd1", "点菜 · Ordering food", true, "both", "2026-09-29"),
                DraftPlanItemDto("lesson:lib9", "lesson", "lib9", "把 + object + 放在…", true, "one_off", "2026-09-29"),
            ),
        ),
        words = listOf(
            w("w1", "点菜", "diǎn cài", "to order food"), w("w2", "买单", "mǎi dān", "to pay the bill"),
            w("w3", "打包", "dǎ bāo", "to take away (leftovers)"), w("w4", "辣", "là", "spicy"),
            w("w5", "不要放香菜", "bú yào fàng xiāngcài", "no coriander, please"), w("w6", "推荐", "tuījiàn", "to recommend"),
            w("w7", "菜单", "càidān", "menu", KnownDto("HSK 3 · Plans & time", "in review"), skipped = true),
            w("w8", "服务员", "fúwùyuán", "waiter", KnownDto("Food & ordering", "learning"), skipped = true),
        ),
        kept_count = 6, skipped_count = 2,
        load = TeachingSamples.load,
        load_after = TeachingSamples.load.copy(level = "heavy", summary = "5 one-off items pending (24 words, 2 lessons / readers) · 1 overdue", one_off = TeachingSamples.load.one_off.copy(by_day = TeachingSamples.load.one_off.by_day.mapIndexed { i, d -> if (i == 2 || i == 3) d.copy(words = d.words + 3, items = d.items + 1) else d })),
    )

    val working = view.copy(job = job.copy(status = "running", progress = "Checking the words against Jerome's cards…"))

    val entries = listOf(
        LessonNotesEntryDto("le1", "2026-09-26T09:00:00Z", "Restaurant ordering", "今天复习了点菜。", LessonNotesJobBriefDto("job1", "done", review = true)),
        LessonNotesEntryDto("le2", "2026-09-23T09:00:00Z", null, "Transport: 地铁, 换乘, 出租车…", LessonNotesJobBriefDto("job0", "running", "Making cards (4 of 9)…", review = true)),
        LessonNotesEntryDto("le3", "2026-09-19T09:00:00Z", "Weekend plans", "打算, 周末, 爬山", LessonNotesJobBriefDto("job-1", "done", review = true, assigned_at = "2026-09-19T12:00:00Z")),
        LessonNotesEntryDto("le4", "2026-09-16T09:00:00Z", null, "Tones on 一 and 不", null),
    )

    val jobs = listOf(
        job.copy(id = "sj1", review = null, result = result.copy(deck = result.deck!!.copy(target_deck_id = "t9"), lessons = listOf(result.lessons[0].copy(lesson_id = "l9")))),
        job.copy(id = "sj2", title = null, notes = "Transport: 地铁, 换乘, 出租车…", status = "running", progress = "Making cards (4 of 9)…", review = null),
        job.copy(id = "sj3", title = "Weather", status = "failed", error = "The assistant was overloaded — try again in a minute.", review = null),
    )
}
