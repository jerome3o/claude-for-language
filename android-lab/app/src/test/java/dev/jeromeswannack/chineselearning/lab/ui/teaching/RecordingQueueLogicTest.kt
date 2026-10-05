package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.api.InsightsReportDto
import dev.jeromeswannack.chineselearning.lab.data.api.PillsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingMarkDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueCountsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueDto
import dev.jeromeswannack.chineselearning.lab.data.api.WeakCharDto
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Needs your ear": the server's JSON decodes, and the presentation rules on top of it. */
class RecordingQueueLogicTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val P = TutorPagesSamples

    /** The shape GET /api/relationships/:relId/recordings/queue sends (shared/recordings/queue.ts RecordingQueueResponse). */
    @Test fun decodesTheQueueResponse() {
        val body = """
            {"range":{"from":"2026-09-05T00:00:00.000Z","to":"2026-10-05T23:59:59.999Z"},"view":"queue",
             "items":[{"event_id":"ev1",
               "note":{"id":"n1","hanzi":"银行","pinyin":"yínháng","english":"bank","deck_name":"HSK 1","audio_url":"generated/n1.mp3"},
               "card_type":"hanzi_to_meaning","rating":2,"reviewed_at":"2026-10-04T08:00:00.000Z","recording_url":"recordings/u/ev1.webm",
               "user_answer":null,"mark":null,
               "check":{"status":"done","transcript":"音行","transcript_match":false,"score":64,
                 "char_scores":[{"char":"银","score":52,"error":"Mispronunciation","tone_suspect":true},{"char":"行","score":90,"error":"None"}],
                 "weak_chars":[{"char":"银","score":52,"kind":"tone"}],"score_note":null},
               "flag":{"id":"f1","message":"Is this right?","created_at":"2026-10-04T08:01:00.000Z"},
               "reasons":["heard_different","low_score","sounded_off","flagged"],
               "labels":["Heard: 音行","Pronunciation score 64","Sounded off: 银 (tone)","Flagged for you"],"in_queue":true},
              {"event_id":"ev2","note":{"id":"n2","hanzi":"你好","pinyin":"nǐ hǎo","english":"hello","deck_name":"HSK 1","audio_url":null},
               "card_type":"hanzi_to_meaning","rating":3,"reviewed_at":"2026-10-03T08:00:00.000Z","recording_url":"recordings/u/ev2.webm",
               "mark":{"status":"listened","comment":null,"updated_at":"2026-10-04T09:00:00.000Z"},"check":null,"flag":null,
               "reasons":[],"labels":[],"in_queue":false}],
             "counts":{"queue":1,"all":2,"checking":1},"scoring":true}
        """.trimIndent()
        val dto = json.decodeFromString(RecordingQueueDto.serializer(), body)
        assertEquals(2, dto.items.size)
        val a = dto.items[0]
        assertEquals("generated/n1.mp3", a.note.audio_url)
        assertEquals(64.0, a.check!!.score!!, 0.0)
        assertEquals(listOf(WeakCharDto("银", 52.0, "tone")), a.check!!.weak_chars)
        assertEquals("Is this right?", a.flag!!.message)
        assertEquals("Flagged for you", a.labels.last())
        assertTrue(a.in_queue)
        assertNull(dto.items[1].note.audio_url)
        assertEquals("listened", dto.items[1].mark!!.status)
        assertEquals(RecordingQueueCountsDto(1, 2, 1), dto.counts)
        assertTrue(dto.scoring)
    }

    @Test fun decodesMixUpsAndTheNeedEarPill() {
        val report = json.decodeFromString(
            InsightsReportDto.serializer(),
            """{"mix_ups":[{"a":"买","b":"卖","count":3,"last_at":"2026-10-01T00:00:00Z","examples":[{"expected":"买东西","answer":"卖东西","reviewed_at":"2026-10-01T00:00:00Z"}]}]}""",
        )
        assertEquals("买 ↔ 卖", RecordingQueueRules.mixUpPair(report.mix_ups.single()))
        assertEquals("买东西 → 卖东西", RecordingQueueRules.mixUpWords(report.mix_ups.single()))
        assertEquals(emptyList<Any>(), json.decodeFromString(InsightsReportDto.serializer(), "{}").mix_ups)
        assertEquals(3, json.decodeFromString(PillsDto.serializer(), """{"recordings_to_hear":5,"recordings_need_ear":3}""").recordings_need_ear)
        assertEquals(0, json.decodeFromString(PillsDto.serializer(), """{"recordings_to_hear":5}""").recordings_need_ear) // older server
        assertEquals("🎤 1 needs your ear", needEarLabel(1))
        assertEquals("🎤 3 need your ear", needEarLabel(3))
    }

    @Test fun expectedMarksEachWeakCharacterOnceByKind() {
        val marks = RecordingQueueRules.expectedMarks("地铁站", listOf(WeakCharDto("铁", 61.0, "sound"), WeakCharDto("站", null, "missing"), WeakCharDto("了", 40.0, "extra")))
        assertEquals(listOf("地" to null, "铁" to "sound", "站" to "missing"), marks)
        // A repeated character: only as many marked as were weak, in order.
        assertEquals(listOf("看" to "tone", "一" to null, "看" to null), RecordingQueueRules.expectedMarks("看一看", listOf(WeakCharDto("看", 50.0, "tone"))))
    }

    @Test fun heardMarksWhatIsNotInTheCard() {
        assertEquals(listOf("音" to false, "行" to true), RecordingQueueRules.heardMarks("银行", "音行"))
        assertEquals(listOf("银" to true, "行" to true), RecordingQueueRules.heardMarks("银行", "银行。"))
    }

    @Test fun showsExpectedAndHeardOnlyWhenThereIsSomethingToSee() {
        val (q1, q2, q3, q4) = P.queue.items
        assertTrue(RecordingQueueRules.showExpected(q1) && RecordingQueueRules.showHeard(q1))
        assertTrue(RecordingQueueRules.showExpected(q2)); assertFalse(RecordingQueueRules.showHeard(q2)) // heard right, sounded off
        assertFalse(RecordingQueueRules.showExpected(q3)) // flag only
        assertFalse(RecordingQueueRules.showExpected(q4)) // no check
    }

    @Test fun copy() {
        assertEquals("Needs your ear (4)", RecordingQueueRules.tabLabel("queue", P.queue.counts))
        assertEquals("All recordings (11)", RecordingQueueRules.tabLabel("all", P.queue.counts))
        assertEquals("Needs your ear", RecordingQueueRules.tabLabel("queue", null))
        assertEquals("Nothing needs your ear 🎧 — 9 recordings in this range sound fine.", RecordingQueueRules.emptyText("queue", RecordingQueueCountsDto(0, 9, 0)))
        assertEquals("Nothing needs your ear 🎧 — 1 recording in this range sounds fine.", RecordingQueueRules.emptyText("queue", RecordingQueueCountsDto(0, 1, 0)))
        assertTrue(RecordingQueueRules.emptyText("queue", RecordingQueueCountsDto()).startsWith("No recordings in this period."))
        assertEquals("2 recordings still being checked…", RecordingQueueRules.checkingText(2))
        assertEquals(PillTone.Flags, RecordingQueueRules.reasonTone("flagged"))
        assertEquals(PillTone.Struggling, RecordingQueueRules.reasonTone("sounded_off"))
    }

    @Test fun markingSpringsOutOfTheQueueAndKeepsItsPlaceUnderAll() {
        val mark = RecordingMarkDto("q1", "listened")
        val queue = RecordingQueueRules.afterMark(P.queue, "q1", mark)
        assertEquals(listOf("q2", "q3", "q4"), queue.items.map { it.event_id })
        assertEquals(3, queue.counts.queue)
        assertEquals(11, queue.counts.all)

        val all = RecordingQueueRules.afterMark(P.queueAll, "q2", RecordingMarkDto("q2", "needs_work", "铁 is 3rd tone"))
        assertEquals(P.queueAll.items.map { it.event_id }, all.items.map { it.event_id })
        val q2 = all.items.first { it.event_id == "q2" }
        assertEquals("needs_work", q2.mark!!.status)
        assertFalse(q2.in_queue)
        assertEquals(3, all.counts.queue)

        // Re-marking one already out of the queue changes no count; clearing under All keeps it listed.
        val again = RecordingQueueRules.afterMark(all, "q5", RecordingMarkDto("q5", "needs_work"))
        assertEquals(3, again.counts.queue)
        val cleared = RecordingQueueRules.afterMark(again, "q5", null)
        assertNull(cleared.items.first { it.event_id == "q5" }.mark)
        assertEquals(P.queueAll.items.size, cleared.items.size)
        // Unknown id: unchanged.
        assertEquals(P.queue, RecordingQueueRules.afterMark(P.queue, "nope", mark))
    }
}
