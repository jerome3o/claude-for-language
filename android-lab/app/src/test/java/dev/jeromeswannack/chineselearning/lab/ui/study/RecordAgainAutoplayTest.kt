package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config as RoboConfig
import org.robolectric.shadows.ShadowMediaPlayer
import org.robolectric.shadows.util.DataSource
import java.io.File
import java.time.Duration
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Record again on the answer side of a read card: once the new take is saved and the card turns
 * back to the answer, the card's own clip plays (the reveal's auto-play), exactly once, and his
 * own take's playback stops. A cancelled Record again, or one that came out empty, plays nothing;
 * the first (front-side) take and a reveal that stops a recording leave the auto-play to the
 * reveal (CardStage) — never twice. The new take is still transcribed.
 */
@RunWith(RobolectricTestRunner::class)
@RoboConfig(sdk = [34], application = LabApp::class)
class RecordAgainAutoplayTest {
    private lateinit var app: LabApp
    private lateinit var rec: FakeRecorder
    private val plays = mutableListOf<String>()
    private val watcher = MainScope()
    private val clip = "generated/n1.mp3"

    /** Robolectric's MediaRecorder writes nothing: a take is a few bytes, or nothing when [empty]. */
    class FakeRecorder(app: LabApp, scope: CoroutineScope) : VoiceRecorder(app, scope) {
        private var on = false
        var empty = false
        val log = mutableListOf<String>()
        override val recording: Boolean get() = on
        override fun start(): Boolean { on = true; log += "start"; return true }
        override fun startLive(onAudio: (ByteArray, Int) -> Unit): Boolean = start()
        override fun stop(): File? {
            if (!on) return null
            on = false
            log += "stop"
            if (empty) return null
            return File.createTempFile("take", ".webm").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        }
        override fun play(take: File, onDone: () -> Unit) { log += "play-mine" }
        override fun stopPlayback() { log += "stop-mine" }
    }

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(5, 0)
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        @Suppress("UNCHECKED_CAST")
        (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as MutableStateFlow<Boolean>).value = true
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "Weather", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        dao.upsertNotes(listOf(NoteEntity("n1", "d1", "刮风", "guā fēng", "to be windy", clip, "f", null, null, null, null, null, null, null)))
        dao.insertCardsIfMissing(listOf(CardEntity("c1", "n1", "d1", "hanzi_to_meaning")))
        ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(Config.audioUrl(clip, app.repo.api.baseUrl)), ShadowMediaPlayer.MediaInfo(1_000, 0))
        // Every time the card's player starts something.
        watcher.launch(Dispatchers.Unconfined) { app.audio.playingKey.collect { k -> if (k != null) plays += k } }
        Unit
    }

    @After
    fun tearDown() {
        app.audio.stop()
        watcher.cancel()
    }

    private fun idleFor(ms: Long) = shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    private fun session(): StudyViewModel {
        val vm = StudyViewModel(app, null, newRecorder = { scope -> FakeRecorder(app, scope).also { rec = it } })
        repeat(300) {
            shadowOf(android.os.Looper.getMainLooper()).idle()
            if (vm.ui.value.phase is StudyPhase.Showing) return vm
            Thread.sleep(10)
        }
        error("no card: ${vm.ui.value}")
    }

    /** Record → Stop on the question → Check answer, and the reveal's own auto-play (CardStage). */
    private fun firstTakeRevealed(vm: StudyViewModel) {
        vm.startRecording()
        idleFor(600)
        vm.stopRecording(false)
        idleFor(1_000)
        assertEquals(emptyList(), plays, "the front take plays nothing by itself")
        vm.onRevealed(null)
        vm.playWord(false) // CardStage.reveal()'s auto-play
        idleFor(1_500) // the clip plays out
        assertEquals(listOf(clip), plays)
        plays.clear()
    }

    @Test
    fun recordAgainThenStopPlaysTheCardsClipOnce() {
        val vm = session()
        firstTakeRevealed(vm)
        vm.playMyRecording()
        vm.startRecording(skipDelay = true)
        assertTrue(vm.ui.value.extras.take.recording)
        idleFor(1_200)
        assertEquals(emptyList(), plays, "nothing plays while he records")

        vm.stopRecording(true)
        assertEquals(emptyList(), plays, "not before the card has turned back")
        idleFor(RECORD_AGAIN_PLAY_DELAY_MS + 50)
        assertEquals(listOf(clip), plays)
        // His own take's playback was stopped for it.
        assertTrue(rec.log.lastIndexOf("stop-mine") > rec.log.lastIndexOf("stop"), rec.log.toString())
        idleFor(3_000)
        assertEquals(listOf(clip), plays, "exactly once")
        // The new take is still transcribed ("You said" — offline in the test: Failed / Working, never nothing).
        val take = vm.ui.value.extras.take
        assertTrue(take.hasTake && !take.recording && take.transcription != null, take.toString())
    }

    @Test
    fun aCancelledRecordAgainPlaysNothing() {
        val vm = session()
        firstTakeRevealed(vm)
        vm.startRecording(skipDelay = true)
        idleFor(800)
        vm.cancelRecording()
        idleFor(2_000)
        assertEquals(emptyList(), plays)
        assertTrue(vm.ui.value.extras.take.hasTake, "the previous take is kept")
    }

    @Test
    fun aRecordAgainThatCameOutEmptyPlaysNothing() {
        val vm = session()
        firstTakeRevealed(vm)
        rec.empty = true
        vm.startRecording(skipDelay = true)
        idleFor(800)
        vm.stopRecording(true)
        idleFor(2_000)
        assertEquals(emptyList(), plays)
    }

    @Test
    fun revealingWhileRecordingOnTheQuestionLeavesTheAutoPlayToTheReveal() {
        val vm = session()
        vm.startRecording()
        idleFor(800)
        // "Check answer" while recording: the reveal stops the take; CardStage's reveal plays.
        vm.onRevealed(null)
        idleFor(2_000)
        assertEquals(emptyList(), plays, "the ViewModel adds no second play")
        assertTrue(vm.ui.value.extras.take.hasTake)
    }
}
