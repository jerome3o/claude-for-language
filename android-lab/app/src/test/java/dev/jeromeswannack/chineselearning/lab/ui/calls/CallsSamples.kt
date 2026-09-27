package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardOp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPoint
import dev.jeromeswannack.chineselearning.lab.data.api.CallChatDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallCorrectionDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallInfoDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallListItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallParticipantDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallPieceDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallReportDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallReportWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobStepDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionJobDto
import dev.jeromeswannack.chineselearning.lab.data.api.TranscriptSegmentDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import kotlinx.serialization.json.JsonArray
import kotlin.math.cos
import kotlin.math.sin

object CallsSamples {
    const val ME = "u-jerome"
    const val TUTOR = "u-wang"
    const val T0 = 1_790_000_000_000L

    val list = listOf(
        CallListItemDto("c-live", relationship_id = "r1", created_by = TUTOR, status = "live", started_at = T0 + 86_400_000, other_user_name = "王老师"),
        CallListItemDto("c1", relationship_id = "r1", created_by = TUTOR, status = "ended", processing_status = "done", started_at = T0, ended_at = T0 + 48 * 60_000, other_user_name = "王老师", segment_count = 212, has_summary = true),
        CallListItemDto("c2", relationship_id = "r1", created_by = ME, status = "ended", processing_status = "transcribing", started_at = T0 - 3 * 86_400_000, ended_at = T0 - 3 * 86_400_000 + 31 * 60_000, other_user_name = "王老师"),
        CallListItemDto("c3", created_by = ME, status = "ended", processing_status = "none", started_at = T0 - 6 * 86_400_000, ended_at = T0 - 6 * 86_400_000 + 3 * 60_000),
    )

    val people = listOf(CallPerson("r1", "王老师 (Wang Fang)"), CallPerson("r2", "Lucy Chen"))

    private fun seg(id: String, who: String, at: Long, len: Long, text: String, py: String?, en: String?) =
        TranscriptSegmentDto(id, who, if (who == ME) "p-me" else "p-wang", T0 + at, T0 + at + len, text, "zh", py, en)

    val transcript = listOf(
        seg("s01", TUTOR, 4_000, 3_000, "你好！今天我们练习点菜。", "nǐ hǎo! jīntiān wǒmen liànxí diǎn cài.", "Hi! Today we'll practise ordering food."),
        seg("s02", TUTOR, 7_600, 2_600, "你想吃什么？", "nǐ xiǎng chī shénme?", "What would you like to eat?"),
        seg("s03", ME, 12_000, 3_500, "我想要一碗牛肉面，不要辣。", "wǒ xiǎng yào yī wǎn niúròu miàn, bú yào là.", "I'd like a bowl of beef noodles, not spicy."),
        seg("s04", TUTOR, 17_000, 4_000, "很好！“不要辣”也可以说“微辣”。", null, "Great! Instead of “not spicy” you can also say “mildly spicy”."),
        seg("s05", ME, 23_000, 2_500, "Oh, 微辣 is a little spicy?", null, "Oh, 微辣 is a little spicy?"),
        seg("s06", TUTOR, 26_000, 2_000, "对，一点点辣。", "duì, yī diǎndiǎn là.", "Right, just a little spicy."),
    )

    val report = CallReportDto(
        summary = "Jerome practised **ordering at a noodle shop**: asking for dishes, saying how spicy, and paying. Tones on 碗 and 辣 improved during the call.",
        topics = listOf("Ordering food", "Measure words", "Spiciness"),
        vocabulary = listOf(
            CallReportWordDto("牛肉面", "niúròu miàn", "beef noodles", from_call = "我想要一碗牛肉面"),
            CallReportWordDto("微辣", "wēi là", "mildly spicy", from_call = "也可以说微辣"),
            CallReportWordDto("买单", "mǎi dān", "to pay the bill"),
            CallReportWordDto("打包", "dǎ bāo", "to take away (food)"),
        ),
        corrections = listOf(
            CallCorrectionDto("我要一个面", "我要一碗面", "wǒ yào yī wǎn miàn", "Noodles in a bowl take the measure word 碗, not 个."),
        ),
        follow_ups = listOf("Practise 碗 vs 杯 vs 盘 with five dishes", "Review the pay-the-bill phrases"),
    )

    private fun circle(cx: Double, cy: Double, r: Double) = List(40) { i -> val a = i / 39.0 * 2 * Math.PI; BoardPoint(cx + r * cos(a) * 0.62, cy + r * sin(a)) }

    val board: List<BoardItem> = listOf(
        BoardItem.Text("t1", TUTOR, "#1f2937", 0.06, 0.08, 110.0, "一碗面"),
        BoardItem.Text("t2", TUTOR, "#2563eb", 0.06, 0.3, 70.0, "yī wǎn miàn"),
        BoardItem.Stroke("k1", TUTOR, "#dc2626", 10.0, circle(0.15, 0.17, 0.13)),
        BoardItem.Text("t3", ME, "#16a34a", 0.55, 0.6, 90.0, "微辣 ✓"),
        BoardItem.Stroke("k2", ME, "#d97706", 12.0, List(30) { i -> BoardPoint(0.5 + i * 0.012, 0.85 - sin(i / 29.0 * Math.PI) * 0.12) }),
    )

    val detail = CallDetailDto(
        call = CallInfoDto("c1", relationship_id = "r1", created_by = TUTOR, status = "ended", processing_status = "done", started_at = T0, ended_at = T0 + 48 * 60_000),
        participants = listOf(CallParticipantDto(ME, "Jerome", "jerome@example.com"), CallParticipantDto(TUTOR, "王老师", "wang@example.com")),
        board = JsonArray(board.map { (it as BoardOp).toJson() }),
        chat = listOf(CallChatDto("m1", TUTOR, "王老师", "微辣 wēi là = a little spicy", T0 + 20_000), CallChatDto("m2", ME, "Jerome", "谢谢！", T0 + 31_000)),
        report = report,
        pieces = listOf(CallPieceDto("p-me", ME, status = "done", provider = "gemini", audio_url = "/api/audio/calls/c1/p-me.ogg", started_at = T0), CallPieceDto("p-wang", TUTOR, status = "done", provider = "gemini", audio_url = "/api/audio/calls/c1/p-wang.webm", started_at = T0)),
        transcript = transcript,
        transcriber = "gemini",
    )

    val processing = detail.copy(
        call = detail.call.copy(processing_status = "transcribing"),
        report = null, transcript = emptyList(),
        pieces = detail.pieces.map { it.copy(status = "transcribing") },
    )

    val homeworkJob = SessionJobDto(
        id = "j1", title = "Video lesson · ordering food", notes = "…", notes_chars = 5_240, status = "running", progress = "Adding cards (6 so far)…",
        steps = listOf(JobStepDto(kind = "info", text = "Read the transcript (212 lines)"), JobStepDto(kind = "tool", text = "Checked 14 words against 李明's cards"), JobStepDto(kind = "tool", text = "Created deck “Ordering food”")),
        result = JobResultDto(), source_call_id = "c1", created_at = "2026-09-21T10:30:00Z",
    )

    fun reviewUi(d: CallDetailDto = detail, homework: CallHomeworkUi? = null, pending: Int = 0) = CallReviewUi(
        callId = d.call.id, detail = Loadable(d, updatedAt = T0), myId = ME, pendingLocal = pending,
        decks = listOf(DeckChoice("d1", "HSK 3"), DeckChoice("d2", "Restaurant words")), homework = homework,
    )
}
