package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
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
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * "🎤 Say it again" on a typing card answered by speaking (docs/STUDY_SESSION.md; the web's
 * spokenAnswer.test.ts "Say it again"): say → checked → Say it again → the new take is said from
 * the question → its NEW answer is checked (whatever the auto-submit switch), it replaces the take
 * before it, and the card's own clip plays once as the card turns back. Cancel (also from a failed
 * take) keeps the previous answer and take, and plays nothing.
 */
@RunWith(RobolectricTestRunner::class)
@RoboConfig(sdk = [34], application = LabApp::class)
class SayItAgainTest {
    private lateinit var app: LabApp
    private lateinit var rec: FakeRecorder
    private lateinit var vm: StudyViewModel
    private val plays = mutableListOf<String>()
    private val watcher = MainScope()
    private val clip = "generated/n1.mp3"

    /** Every take is a real little file (so "kept" / "deleted" can be checked). */
    class FakeRecorder(app: LabApp, scope: CoroutineScope) : VoiceRecorder(app, scope) {
        private var on = false
        val log = mutableListOf<String>()
        val takes = mutableListOf<File>()
        override val recording: Boolean get() = on
        override fun start(): Boolean { on = true; log += "start"; return true }
        override fun startLive(onAudio: (ByteArray, Int) -> Unit): Boolean {
            on = true
            log += "startLive"
            onAudio(ByteArray(3200), 3200)
            return true
        }
        override fun stop(): File? {
            if (!on) return null
            on = false
            log += "stop"
            return File.createTempFile("take", ".wav").apply { writeBytes(byteArrayOf(1, 2, 3)) }.also { takes += it }
        }
        override fun play(take: File, onDone: () -> Unit) { log += "play-mine" }
        override fun stopPlayback() { log += "stop-mine" }
    }

    /** Each take in turn hears the next of [heard] (the last repeats); [failFrom] = takes from this index fail both ways. */
    class FakeTranscription(private val heard: List<String>) : SpokenTranscription {
        var takes = 0
        var failFrom = Int.MAX_VALUE
        var uploads = 0
        override fun open(onUpdate: (SonioxProtocol.Transcript) -> Unit): LiveStream {
            val i = takes++
            val text = heard[minOf(i, heard.size - 1)]
            return object : LiveStream {
                override fun send(pcm: ByteArray, length: Int) {}
                override suspend fun finish(timeoutMs: Long): String = if (i >= failFrom) error("Soniox 402: Balance exhausted") else text
                override fun abort() {}
            }
        }
        override suspend fun upload(take: File, mime: String, liveError: String?): String {
            uploads++
            if (takes - 1 >= failFrom) error("502")
            return heard.last()
        }
    }

    private val fake = FakeTranscription(listOf("油", "由", "有"))

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(5, 0)
        // The checked-at-once path ("Skip the review" on); the review step has its own tests below.
        StudyPrefs.get(app).spokenSkipReview = true
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        @Suppress("UNCHECKED_CAST")
        (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as MutableStateFlow<Boolean>).value = true
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "Words", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        dao.upsertNotes(listOf(NoteEntity("n1", "d1", "由", "yóu", "from; by", clip, null, null, null, null, null, null, null, null)))
        dao.insertCardsIfMissing(listOf(CardEntity("c1", "n1", "d1", "meaning_to_hanzi")))
        ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(Config.audioUrl(clip, app.repo.api.baseUrl)), ShadowMediaPlayer.MediaInfo(1_000, 0))
        watcher.launch(Dispatchers.Unconfined) { app.audio.playingKey.collect { k -> if (k != null) plays += k } }
        Unit
    }

    @After
    fun tearDown() {
        app.audio.stop()
        watcher.cancel()
    }

    private fun idleFor(ms: Long) = shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    private fun waitFor(what: String, cond: () -> Boolean) {
        repeat(300) {
            idleFor(20)
            if (cond()) return
            Thread.sleep(10)
        }
        error("timed out waiting for $what")
    }

    private val spoken get() = vm.ui.value.extras.spoken

    private fun session() {
        vm = StudyViewModel(app, null, newRecorder = { scope -> FakeRecorder(app, scope).also { rec = it } }, newSpokenTranscription = fake)
        repeat(300) {
            shadowOf(android.os.Looper.getMainLooper()).idle()
            if (vm.ui.value.phase is StudyPhase.Showing) return
            Thread.sleep(10)
        }
        error("no card: ${vm.ui.value}")
    }

    /** 🎤 → ⏹ → 油 auto-submitted; CardStage's reveal and its auto-play. */
    private fun firstSpokenAnswerRevealed() {
        vm.startSpokenAnswer()
        vm.stopSpokenAnswer()
        waitFor("the first answer") { spoken.result?.seq == 1 }
        assertEquals("油", spoken.result!!.text)
        vm.onRevealed(AnswerKey.Verdict.SOUND)
        vm.playWord(false) // CardStage.reveal()'s auto-play
        idleFor(1_500)
        assertEquals(listOf(clip), plays)
        plays.clear()
    }

    @Test
    fun sayItAgainChecksTheNewAnswerReplacesTheTakeAndPlaysTheClipOnce() {
        session()
        firstSpokenAnswerRevealed()
        val first = rec.takes.single()

        vm.sayAgain()
        assertEquals(SpokenPhase.LISTENING, spoken.phase)
        assertTrue(spoken.again, "the card shows the question while the new take is said")
        assertTrue(first.exists(), "the take before it is kept until the new answer lands")
        idleFor(800)
        assertEquals(emptyList(), plays, "nothing plays while he speaks")

        vm.stopSpokenAnswer()
        waitFor("the new answer") { spoken.result?.seq == 2 }
        val r = spoken.result!!
        assertEquals("由", r.text)
        assertTrue(r.again && r.submit, "checked anew")
        assertFalse(spoken.again, "back to the answer")
        assertEquals(AnswerKey.Verdict.EXACT, AnswerKey.checkSpoken(r.text, "由", emptyList(), "yóu"))
        assertFalse(first.exists(), "the new take replaces the one before it")
        assertEquals(emptyList(), plays, "not before the card has turned back")

        idleFor(RECORD_AGAIN_PLAY_DELAY_MS + 50)
        assertEquals(listOf(clip), plays)
        assertTrue(rec.log.lastIndexOf("stop-mine") > rec.log.lastIndexOf("stop"), "his own take's playback stopped first: ${rec.log}")
        idleFor(3_000)
        assertEquals(listOf(clip), plays, "exactly once")

        // CardStage checks it (no extra play from the ViewModel) and he rates: the latest answer and take go up.
        vm.onRevealed(AnswerKey.Verdict.EXACT)
        idleFor(1_000)
        assertEquals(listOf(clip), plays)
        vm.rate(2, 6_000, r.text)
        waitFor("the review") { runBlocking { app.repo.dao.allEvents().isNotEmpty() } }
        val event = runBlocking { app.repo.dao.allEvents() }.single()
        assertEquals("由", event.userAnswer)
        waitFor("the take queued") { runBlocking { app.outbox.all().any { it.id == "rec-${event.id}" } } }
        assertFalse(rec.takes[1].exists(), "the second take is the one that went up (moved into the outbox)")
    }

    @Test
    fun aSayItAgainGoesThroughTheSameReviewRetryReplacesItsTakeAndSubmitChecksIt() {
        StudyPrefs.get(app).spokenSkipReview = false
        session()
        vm.startSpokenAnswer()
        vm.stopSpokenAnswer()
        waitFor("the first review") { spoken.phase == SpokenPhase.REVIEW }
        vm.submitSpokenAnswer()
        assertEquals(1, spoken.result?.seq)
        vm.onRevealed(AnswerKey.Verdict.SOUND)
        vm.playWord(false)
        idleFor(1_500)
        plays.clear()
        val first = rec.takes.single()

        vm.sayAgain()
        vm.stopSpokenAnswer()
        waitFor("the say-again review") { spoken.phase == SpokenPhase.REVIEW }
        assertTrue(spoken.again, "still on the question side")
        assertEquals("由", spoken.finalText)
        assertEquals(1, spoken.result?.seq, "nothing new answered yet")
        assertTrue(first.exists(), "the take before it is kept until the new answer is submitted")
        idleFor(1_000)
        assertEquals(emptyList(), plays, "nothing plays on the review")

        // 🔁 Retry: a new take (still a say-again) replaces the reviewed one.
        val reviewed = rec.takes.last()
        vm.retakeSpokenAnswer()
        assertEquals(SpokenPhase.LISTENING, spoken.phase)
        assertTrue(spoken.again)
        assertFalse(reviewed.exists(), "the reviewed take is thrown away")
        assertTrue(first.exists())
        vm.stopSpokenAnswer()
        waitFor("the second say-again review") { spoken.phase == SpokenPhase.REVIEW }
        assertEquals("有", spoken.finalText)

        vm.submitSpokenAnswer()
        val r = spoken.result!!
        assertEquals(2, r.seq)
        assertEquals("有", r.text)
        assertTrue(r.again && r.submit && r.reviewed)
        assertFalse(spoken.again, "back to the answer")
        assertFalse(first.exists(), "the new take replaces the one before it")
        idleFor(RECORD_AGAIN_PLAY_DELAY_MS + 50)
        assertEquals(listOf(clip), plays, "the card's clip once after it")
    }

    @Test
    fun editOnASayItAgainReviewIsCheckedAsTypedAndCancelWhileEditingKeepsTheFirstAnswer() {
        StudyPrefs.get(app).spokenSkipReview = false
        session()
        vm.startSpokenAnswer()
        vm.stopSpokenAnswer()
        waitFor("the first review") { spoken.phase == SpokenPhase.REVIEW }
        vm.submitSpokenAnswer()
        vm.onRevealed(AnswerKey.Verdict.SOUND)
        val first = rec.takes.single()

        vm.sayAgain()
        vm.stopSpokenAnswer()
        waitFor("the say-again review") { spoken.phase == SpokenPhase.REVIEW }
        vm.editSpokenAnswer()
        assertEquals(SpokenPhase.EDITING, spoken.phase)
        assertTrue(spoken.again)
        assertEquals("由", spoken.finalText)
        // Cancel while editing: back to the answer with the first answer and take.
        vm.cancelSpokenAnswer()
        assertEquals(SpokenPhase.IDLE, spoken.phase)
        assertEquals(1, spoken.result?.seq)
        assertTrue(first.exists())

        vm.sayAgain()
        vm.stopSpokenAnswer()
        waitFor("another say-again review") { spoken.phase == SpokenPhase.REVIEW }
        vm.editSpokenAnswer()
        vm.submitEditedSpokenAnswer("   ")
        assertEquals(1, spoken.result?.seq, "nothing to check")
        vm.submitEditedSpokenAnswer(" 由 ")
        val r = spoken.result!!
        assertEquals("由", r.text)
        assertEquals("有", r.transcript, "as heard — the answer was edited, so it is checked as typed")
        assertTrue(r.again && r.submit && r.reviewed)
        assertFalse(first.exists())
    }

    @Test
    fun cancelKeepsThePreviousAnswerAndTakeAndPlaysNothing() {
        session()
        firstSpokenAnswerRevealed()
        val first = rec.takes.single()
        vm.sayAgain()
        idleFor(500)
        vm.cancelSpokenAnswer()
        assertEquals(SpokenPhase.IDLE, spoken.phase)
        assertFalse(spoken.again)
        assertEquals(1, spoken.result?.seq, "the previous answer stays")
        idleFor(2_000)
        assertEquals(emptyList(), plays)
        assertTrue(first.exists())
        assertFalse(rec.takes.last().exists(), "the cancelled take is thrown away")

        vm.rate(2, 5_000, "油")
        waitFor("the review") { runBlocking { app.repo.dao.allEvents().isNotEmpty() } }
        val event = runBlocking { app.repo.dao.allEvents() }.single()
        assertEquals("油", event.userAnswer)
        waitFor("the take queued") { runBlocking { app.outbox.all().any { it.id == "rec-${event.id}" } } }
        assertFalse(first.exists(), "the first take went up with the review")
    }

    @Test
    fun aFailedSayItAgainStaysOnTheQuestionAndCancelBringsThePreviousTakeBack() {
        session()
        firstSpokenAnswerRevealed()
        val first = rec.takes.single()
        fake.failFrom = 1
        vm.sayAgain()
        vm.stopSpokenAnswer()
        waitFor("the failure") { spoken.phase == SpokenPhase.FAILED }
        assertTrue(spoken.again, "still on the question, with tap to retry")
        assertEquals(SpokenFailure.FAILED, spoken.failure)
        assertEquals(1, spoken.result?.seq, "nothing new answered")
        val failed = rec.takes.last()

        vm.cancelSpokenAnswer()
        assertFalse(spoken.again)
        assertTrue(first.exists())
        assertFalse(failed.exists())
        idleFor(2_000)
        assertEquals(emptyList(), plays)
    }

    @Test
    fun ratingDuringASayItAgainKeepsTheAnswerBeforeIt() {
        session()
        firstSpokenAnswerRevealed()
        vm.sayAgain()
        idleFor(300)
        vm.rate(2, 5_000, "油")
        waitFor("the review") { runBlocking { app.repo.dao.allEvents().isNotEmpty() } }
        val event = runBlocking { app.repo.dao.allEvents() }.single()
        assertEquals("油", event.userAnswer)
        waitFor("the take queued") { runBlocking { app.outbox.all().any { it.id == "rec-${event.id}" } } }
        assertEquals(2, rec.takes.size)
        assertFalse(rec.takes[1].exists(), "the say-again's take is thrown away")
        assertFalse(rec.takes[0].exists(), "the first take went up with the review")
    }
}
