package dev.jeromeswannack.chineselearning.lab.data.audiolessons

import android.os.Looper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonChapter
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonFeedback
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonFeedbackEvent
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTranscriptLine
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/**
 * Feedback while listening (docs/AUDIO_LESSONS.md): the engine's back / next a section and "Too hard" — from
 * the player and through the media session's previous / next (the lock screen, notification, headset) — seek
 * by transcript row and record one event each; the store queues it in the Outbox and remembers too-hard rows.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AudioLessonFeedbackTest {
    private class SilentTrack : MusicTrack {
        override fun play() {}
        override fun pause() {}
        override fun setVolume(volume: Float) {}
        override fun release() {}
    }

    private val context = ApplicationProvider.getApplicationContext<android.app.Application>()
    private lateinit var engine: AudioLessonEngine
    private val events = mutableListOf<AudioLessonFeedbackEvent>()

    private val lesson = AudioLessonDto(
        id = "al-1",
        format = "story",
        title = "At the noodle shop",
        status = "ready",
        duration_ms = 60_000,
        audio_version = "v2",
        chapters = listOf(AudioLessonChapter("One", 0), AudioLessonChapter("Two", 20_000)),
        transcript = listOf(
            AudioLessonTranscriptLine(0, "zh", "teacher", "小明起床了。", "Xiǎomíng qǐchuáng le.", "Xiaoming got up."),
            AudioLessonTranscriptLine(10_000, "zh", "teacher", "他很累。", "tā hěn lèi.", "He is tired."),
            AudioLessonTranscriptLine(20_000, "zh", "teacher", "他去公司。", "tā qù gōngsī.", "He goes to the office.", chapter = 1),
        ),
    )

    @Before fun setUp() {
        engine = AudioLessonEngine(context, SilentTrack())
        engine.onFeedback = { events += it }
        val f = File(context.filesDir, "al-1-v2.mp3").apply { writeBytes(ByteArray(0)) }
        engine.load(lesson, f)
    }

    @After fun tearDown() {
        engine.release()
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    @Test fun tooHardIsNotedWhereTheAudioIs() {
        engine.seekTo(15_000)
        val e = engine.tooHard(AudioLessonFeedback.PLAYER)!!
        assertEquals("too_hard", e.kind)
        assertEquals("player", e.where)
        assertEquals(15_000L, e.positionMs)
        assertEquals(1, e.rowIndex)
        assertEquals("他很累。", e.row?.text)
        assertEquals("小明起床了。", e.previousRow?.text)
        assertEquals("v2", e.audioVersion)
        assertEquals(listOf(e), events)
        assertEquals(1, engine.state.value.tooHardCount)
        assertEquals(1, engine.state.value.tooHardRow)
        assertEquals("playing carries on where it was", 15_000L, engine.exo.currentPosition)
    }

    @Test fun backASectionReplaysTheLineThenTheOneBefore() {
        engine.seekTo(15_000)
        assertEquals("again", engine.backSection(AudioLessonFeedback.PLAYER)!!.kind)
        assertEquals(10_000L, engine.exo.currentPosition)
        // Pressed again straight away (within 2 s of the line's start): the line before.
        assertEquals("back_section", engine.backSection(AudioLessonFeedback.PLAYER)!!.kind)
        assertEquals(0L, engine.exo.currentPosition)
        assertEquals(listOf(1, 1), events.map { it.rowIndex })
    }

    @Test fun theLockScreensPreviousAndNextStepSections() {
        engine.sessionWhere = { AudioLessonFeedback.LOCK_SCREEN }
        engine.seekTo(5_000)
        engine.sessionPlayer.seekToNext()
        idle()
        assertEquals(10_000L, engine.exo.currentPosition)
        engine.seekTo(14_000)
        engine.sessionPlayer.seekToPrevious()
        idle()
        assertEquals(10_000L, engine.exo.currentPosition)
        assertEquals(listOf("skip" to "lock_screen", "again" to "lock_screen"), events.map { it.kind to it.where })
        // Nothing after the last line: no jump, nothing recorded.
        engine.seekTo(25_000)
        assertNull(engine.nextSection(AudioLessonFeedback.HEADSET))
        assertEquals(2, events.size)
    }

    @Test fun withoutATranscriptPreviousIsTheChapterAndNothingIsRecorded() {
        engine.load(lesson.copy(transcript = emptyList()), File(context.filesDir, "al-1-v2.mp3"))
        engine.seekTo(25_000)
        assertNull(engine.backSection(AudioLessonFeedback.PLAYER))
        assertEquals(20_000L, engine.exo.currentPosition)
        assertTrue(events.isEmpty())
    }

    @Test fun theStoreQueuesTheEventAndRemembersTooHardRows() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, LabDatabase::class.java).allowMainThreadQueries().build()
        try {
            val api = Api("http://localhost") { "token" }
            val outbox = Outbox(db.platform(), api, File(context.filesDir, "outbox-feedback").apply { deleteRecursively() })
            val cache = JsonCache(db.platform(), api.json)
            engine.seekTo(15_000)
            val hard = engine.tooHard(AudioLessonFeedback.LOCK_SCREEN)!!
            engine.seekTo(11_000) // within 2 s of the line: "Too hard" is about the line before
            val lag = engine.tooHard(AudioLessonFeedback.LOCK_SCREEN)!!
            val back = engine.backSection(AudioLessonFeedback.LOCK_SCREEN)!!
            for (e in listOf(hard, lag, back, hard)) AudioLessonFeedbackStore.record(outbox, cache, e)
            val queued = outbox.all()
            assertEquals("idempotent by the event id", 3, queued.size)
            assertEquals(setOf(AudioLessonFeedbackStore.OUTBOX_KIND), queued.map { it.kind }.toSet())
            assertEquals(setOf("/api/audio-lessons/al-1/feedback"), queued.map { it.path }.toSet())
            val body = Json.parseToJsonElement(queued.first { it.id == hard.id }.bodyJson!!).jsonObject["events"]!!.jsonArray.single().jsonObject
            assertEquals(hard.id, body["id"]!!.jsonPrimitive.content)
            assertEquals("too_hard", body["kind"]!!.jsonPrimitive.content)
            assertEquals("lock_screen", body["where"]!!.jsonPrimitive.content)
            assertEquals("他很累。", body["row"]!!.jsonObject["text"]!!.jsonPrimitive.content)
            assertEquals(listOf(0, 1), cache.get<AudioLessonFeedbackStore.Flagged>(AudioLessonFeedbackStore.cacheKey("al-1"))!!.rows)
        } finally {
            db.close()
        }
    }
}
