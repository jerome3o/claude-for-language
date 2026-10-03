package dev.jeromeswannack.chineselearning.lab.ui.study

import android.media.MediaPlayer
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.api.EnsureAudioResult
import dev.jeromeswannack.chineselearning.lab.data.api.StudyNoteDto
import dev.jeromeswannack.chineselearning.lab.data.audio.NoteAudioFixer
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config as RoboConfig
import org.robolectric.shadows.ShadowMediaPlayer
import org.robolectric.shadows.util.DataSource
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The session with a silent card: the listening card's auto-play waits while its clip is
 * made, then plays the new clip; the note is mirrored onto the card. A failure falls back to
 * the device voice and offers the retry.
 */
@RunWith(RobolectricTestRunner::class)
@RoboConfig(sdk = [34], application = LabApp::class)
class AutoAudioSessionTest {
    private lateinit var app: LabApp
    private val gate = CompletableDeferred<Boolean>()
    private val asked = mutableListOf<String>()

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(5, 0)
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        // Online, whatever the test device's network says.
        @Suppress("UNCHECKED_CAST")
        (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as MutableStateFlow<Boolean>).value = true
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "Weather", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        dao.upsertNotes(listOf(NoteEntity("n1", "d1", "刮风", "guā fēng", "to be windy", null, "f", null, null, null, null, null, null, null)))
        dao.insertCardsIfMissing(listOf(CardEntity("c1", "n1", "d1", "audio_to_hanzi")))
        ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(Config.audioUrl("generated/n1.mp3", app.repo.api.baseUrl)), ShadowMediaPlayer.MediaInfo(1_000, 0))
    }

    private fun fixer(ok: Boolean) = NoteAudioFixer(app.repo, online = { true }, request = { id, _ ->
        asked += id
        gate.await()
        if (ok) EnsureAudioResult(StudyNoteDto(id, "d1", "刮风", "guā fēng", "to be windy", audio_url = "generated/n1.mp3", fun_facts = "f"), "generated", "none")
        else EnsureAudioResult(null, "failed", "none")
    })

    private fun idle() = shadowOf(android.os.Looper.getMainLooper()).idle()

    private fun awaitUi(vm: StudyViewModel, what: String, ok: (StudyUi) -> Boolean): StudyUi {
        repeat(300) {
            idle()
            val u = vm.ui.value
            if (ok(u)) return u
            Thread.sleep(10)
        }
        error("timed out waiting for $what: ${vm.ui.value}")
    }

    @Test
    fun theListeningCardWaitsForItsClipThenPlaysIt() {
        app.noteAudio = fixer(ok = true)
        val vm = StudyViewModel(app, null)
        awaitUi(vm, "generating") { it.cardAudio.word == ClipState.GENERATING && it.phase is StudyPhase.Showing }
        // The card's auto-play: nothing to play yet, and no device voice either — it waits.
        vm.playWord(false)
        idle()
        assertNull(app.audio.playingKey.value)
        gate.complete(true)
        val ui = awaitUi(vm, "the clip") { it.cardAudio.word == ClipState.READY && app.audio.playingKey.value != null }
        assertEquals("generated/n1.mp3", (ui.phase as StudyPhase.Showing).view.note.audioUrl)
        assertEquals("generated/n1.mp3", app.audio.playingKey.value)
        assertEquals("generated/n1.mp3", app.repo.dao.let { runBlocking { it.note("n1") } }?.audioUrl)
        assertEquals(listOf("n1"), asked)
        app.audio.stop()
    }

    @Test
    fun aFailureFallsBackToTheDeviceVoiceAndOffersTheRetry() {
        app.noteAudio = fixer(ok = false)
        val vm = StudyViewModel(app, null)
        awaitUi(vm, "generating") { it.cardAudio.word == ClipState.GENERATING && it.phase is StudyPhase.Showing }
        vm.playWord(false)
        gate.complete(true)
        awaitUi(vm, "failed") { it.cardAudio.word == ClipState.FAILED }
        awaitUi(vm, "the device voice") { app.audio.playingKey.value == "tts:刮风" }
        vm.retryAudio()
        awaitUi(vm, "retried") { asked.size == 2 }
        app.audio.stop()
    }

    @Test
    fun aQueuedClipIsComingTheRevealWaitsForItAndItPlaysWhenItLands() {
        var now = 1_000_000L
        val answers = ArrayDeque(listOf(
            EnsureAudioResult(null, "queued", "none"),
            EnsureAudioResult(StudyNoteDto("n1", "d1", "刮风", "guā fēng", "to be windy", audio_url = "generated/n1.mp3", fun_facts = "f"), "generated", "none"),
        ))
        app.noteAudio = NoteAudioFixer(app.repo, online = { true }, clock = { now }, request = { id, _ ->
            asked += id
            // The second answer waits until the clock advance below is over, so the clip can't play out inside it.
            if (asked.size > 1) gate.await()
            answers.removeFirst()
        })
        val vm = StudyViewModel(app, null)
        awaitUi(vm, "coming") { it.cardAudio.word == ClipState.COMING && it.phase is StudyPhase.Showing }
        // Not a failure: no retry line, no backoff.
        assertEquals(dev.jeromeswannack.chineselearning.lab.core.NoteAudio.Status.Coming(1, now + 20_000), app.noteAudio.statuses.value["n1"])
        // Revealed: the auto-play waits for the real clip instead of the device voice.
        vm.onRevealed(null)
        vm.playWord(false)
        idle()
        assertNull(app.audio.playingKey.value)
        // ~20 s later the card asks again; the clip has landed and plays on its own.
        now += 20_000
        shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(21))
        gate.complete(true)
        val ui = awaitUi(vm, "the clip") { it.cardAudio.word == ClipState.READY && app.audio.playingKey.value != null }
        assertEquals("generated/n1.mp3", app.audio.playingKey.value)
        assertEquals("generated/n1.mp3", (ui.phase as StudyPhase.Showing).view.note.audioUrl)
        assertEquals(listOf("n1", "n1"), asked)
        app.audio.stop()
    }

    @Test
    fun aTapWhileComingPlaysTheDeviceVoiceMeanwhile() {
        app.noteAudio = NoteAudioFixer(app.repo, online = { true }, request = { id, _ -> asked += id; EnsureAudioResult(null, "queued", "none") })
        val vm = StudyViewModel(app, null)
        awaitUi(vm, "coming") { it.cardAudio.word == ClipState.COMING && it.phase is StudyPhase.Showing }
        vm.onRevealed(null)
        vm.playWord(true)
        awaitUi(vm, "the device voice") { app.audio.playingKey.value == "tts:刮风" }
        app.audio.stop()
    }
}
