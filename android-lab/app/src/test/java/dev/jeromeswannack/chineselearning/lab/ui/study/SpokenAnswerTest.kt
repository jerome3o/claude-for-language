package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config as RoboConfig
import java.io.File
import java.time.Duration
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Say the answer on a typing card (docs/STUDY_SESSION.md; the web's spokenAnswer.test.ts): 🎤 →
 * the live transcript shows while speaking → ⏹ → the final text waits on the REVIEW step (🔁 Retry
 * replaces the take, ✏️ Edit fills the box, ✓ Submit checks it) — or is submitted at once when
 * "Skip the review" is on; the rating's review event carries it as its answer
 * and the take goes up with it (`rec-<eventId>` in the outbox). Live and upload both failing:
 * nothing is submitted, "tap to retry" re-sends the same take. Homophones are right by sound.
 */
@RunWith(RobolectricTestRunner::class)
@RoboConfig(sdk = [34], application = LabApp::class)
class SpokenAnswerTest {
    private lateinit var app: LabApp
    private lateinit var rec: FakeRecorder

    class FakeRecorder(app: LabApp, scope: CoroutineScope) : VoiceRecorder(app, scope) {
        private var on = false
        val log = mutableListOf<String>()
        val files = mutableListOf<File>()
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
            return File.createTempFile("take", ".wav").apply { writeBytes(byteArrayOf(1, 2, 3)) }.also { files += it }
        }
    }

    /** A live stream and an upload the test controls. */
    class FakeTranscription : SpokenTranscription {
        var live: String? = "油" // null = no live key (upload only)
        var liveFails = false
        var upload: () -> String = { "游" }
        var uploads = 0
        var sent = 0
        var update: ((SonioxProtocol.Transcript) -> Unit)? = null
        override fun open(onUpdate: (SonioxProtocol.Transcript) -> Unit): LiveStream? {
            val text = live ?: return null
            update = onUpdate
            return object : LiveStream {
                override fun send(pcm: ByteArray, length: Int) { sent++ }
                override suspend fun finish(timeoutMs: Long): String = if (liveFails) error("Soniox 402: Balance exhausted") else text
                override fun abort() {}
            }
        }
        override suspend fun upload(take: File, mime: String, liveError: String?): String { uploads++; return upload() }
    }

    private val fake = FakeTranscription()

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(5, 0)
        // Most tests here take the old checked-at-once path; the review step has its own tests below.
        StudyPrefs.get(app).spokenSkipReview = true
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        @Suppress("UNCHECKED_CAST")
        (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as MutableStateFlow<Boolean>).value = true
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "Words", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        dao.upsertNotes(listOf(NoteEntity("n1", "d1", "由", "yóu", "from; by", null, null, null, null, null, null, null, null, null)))
        dao.insertCardsIfMissing(listOf(CardEntity("c1", "n1", "d1", "meaning_to_hanzi")))
        Unit
    }

    private fun idleFor(ms: Long) = shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    private fun session(): StudyViewModel {
        val vm = StudyViewModel(app, null, newRecorder = { scope -> FakeRecorder(app, scope).also { rec = it } }, newSpokenTranscription = fake)
        repeat(300) {
            shadowOf(android.os.Looper.getMainLooper()).idle()
            if (vm.ui.value.phase is StudyPhase.Showing) return vm
            Thread.sleep(10)
        }
        error("no card: ${vm.ui.value}")
    }

    private fun waitFor(what: String, cond: () -> Boolean) {
        repeat(300) {
            idleFor(20)
            if (cond()) return
            Thread.sleep(10)
        }
        error("timed out waiting for $what")
    }

    private val spoken get() = sessionVm.ui.value.extras.spoken
    private lateinit var sessionVm: StudyViewModel

    @Test
    fun speakThenStopSubmitsTheTranscriptAndTheReviewKeepsTheTake() {
        sessionVm = session()
        val vm = sessionVm
        vm.startSpokenAnswer()
        assertEquals(SpokenPhase.LISTENING, spoken.phase)
        assertEquals(listOf("startLive"), rec.log)
        assertEquals(1, fake.sent, "the microphone streams to the live transcriber")
        // The words as they come: confirmed + provisional.
        fake.update!!(SonioxProtocol.Transcript(finalText = "", partialText = "油"))
        waitFor("interim text") { spoken.partialText == "油" }

        vm.stopSpokenAnswer()
        waitFor("the answer") { spoken.result != null }
        val r = spoken.result!!
        assertEquals("油", r.text)
        assertTrue(r.submit, "the review is skipped")
        assertTrue(!r.reviewed)
        assertEquals(SpokenPhase.IDLE, spoken.phase)
        assertEquals(0, fake.uploads, "the live text was enough")
        // A homophone is right by sound on the back.
        assertEquals(AnswerKey.Verdict.SOUND, AnswerKey.checkSpoken(r.text, "由", emptyList(), "yóu"))

        // CardStage reveals with the transcript and rates: the review carries it, and the take.
        vm.onRevealed(AnswerKey.Verdict.SOUND)
        assertNull(vm.ui.value.extras.take.transcription, "no read-card \"You said\" on a typing card")
        vm.rate(2, 4_000, r.text)
        waitFor("the review") { runBlocking { app.repo.dao.allEvents().isNotEmpty() } }
        val event = runBlocking { app.repo.dao.allEvents() }.single()
        assertEquals("油", event.userAnswer)
        waitFor("the take queued") { runBlocking { app.outbox.all().any { it.id == "rec-${event.id}" } } }
        val upload = runBlocking { app.outbox.all() }.first { it.id == "rec-${event.id}" }
        assertEquals("/api/audio/upload", upload.path)
    }

    @Test
    fun theReviewIsTheDefaultForAPhoneThatNeverTouchedTheSwitch() {
        // The store StudyPrefs reads ("lab_study"), as the old switch left it.
        val sp = StudyPrefs::class.java.getDeclaredField("sp").apply { isAccessible = true }.get(StudyPrefs.get(app)) as android.content.SharedPreferences
        sp.edit().remove("spoken_auto_submit").commit()
        assertTrue(!StudyPrefs.get(app).spokenSkipReview, "off by default: the review step")
        // A choice made with the old "Submit spoken answers automatically" switch is kept (same key, same meaning).
        sp.edit().putBoolean("spoken_auto_submit", true).commit()
        assertTrue(StudyPrefs.get(app).spokenSkipReview)
        sp.edit().putBoolean("spoken_auto_submit", false).commit()
        assertTrue(!StudyPrefs.get(app).spokenSkipReview)
    }

    @Test
    fun stopGoesToTheReviewAndSubmitChecksIt() {
        StudyPrefs.get(app).spokenSkipReview = false
        sessionVm = session()
        val vm = sessionVm
        vm.startSpokenAnswer()
        vm.stopSpokenAnswer()
        waitFor("the review") { spoken.phase == SpokenPhase.REVIEW }
        assertEquals("油", spoken.finalText)
        assertNull(spoken.result, "nothing checked until Submit")
        assertEquals("yóu", devicePinyinLine(spoken.finalText), "the pinyin shown under it")

        vm.submitSpokenAnswer()
        val r = assertNotNull(spoken.result)
        assertEquals("油", r.text)
        assertEquals("油", r.transcript)
        assertTrue(r.submit && r.reviewed && !r.again)
        assertEquals(SpokenPhase.IDLE, spoken.phase)

        vm.onRevealed(AnswerKey.Verdict.SOUND)
        vm.rate(2, 4_000, r.text)
        waitFor("the review event") { runBlocking { app.repo.dao.allEvents().isNotEmpty() } }
        val event = runBlocking { app.repo.dao.allEvents() }.single()
        assertEquals("油", event.userAnswer)
        waitFor("the take queued") { runBlocking { app.outbox.all().any { it.id == "rec-${event.id}" } } }
    }

    @Test
    fun retryOnTheReviewRecordsANewTakeThatReplacesTheOld() {
        StudyPrefs.get(app).spokenSkipReview = false
        sessionVm = session()
        val vm = sessionVm
        vm.startSpokenAnswer()
        vm.stopSpokenAnswer()
        waitFor("the review") { spoken.phase == SpokenPhase.REVIEW }
        val first = rec.files.single()

        fake.live = "由"
        vm.retakeSpokenAnswer()
        assertEquals(SpokenPhase.LISTENING, spoken.phase)
        assertEquals("", spoken.finalText)
        assertTrue(!first.exists(), "the first take is thrown away")
        vm.stopSpokenAnswer()
        waitFor("the second review") { spoken.phase == SpokenPhase.REVIEW }
        assertEquals("由", spoken.finalText)
        assertEquals(listOf("startLive", "stop", "startLive", "stop"), rec.log)
        vm.submitSpokenAnswer()
        assertEquals("由", spoken.result!!.text)
        assertTrue(rec.files.last().exists(), "the new take rides with the review")
    }

    @Test
    fun editOnTheReviewFillsTheBoxWithoutChecking() {
        StudyPrefs.get(app).spokenSkipReview = false
        sessionVm = session()
        sessionVm.startSpokenAnswer()
        sessionVm.stopSpokenAnswer()
        waitFor("the review") { spoken.phase == SpokenPhase.REVIEW }
        sessionVm.editSpokenAnswer()
        val r = assertNotNull(spoken.result)
        assertEquals("油", r.text)
        assertTrue(!r.submit, "into the box — Check submits it")
        assertTrue(r.reviewed)
        assertEquals(SpokenPhase.IDLE, spoken.phase)
        // Submit / Edit outside the review do nothing.
        val seq = r.seq
        sessionVm.submitSpokenAnswer()
        sessionVm.editSpokenAnswer()
        assertEquals(seq, spoken.result!!.seq)
        assertTrue(rec.files.single().exists(), "the take is kept for the review event")
    }

    @Test
    fun aTakeThatGivesNothingHasNoReview() {
        StudyPrefs.get(app).spokenSkipReview = false
        fake.live = ""
        fake.upload = { "" }
        sessionVm = session()
        sessionVm.startSpokenAnswer()
        sessionVm.stopSpokenAnswer()
        waitFor("the failure") { spoken.phase == SpokenPhase.FAILED }
        assertEquals(SpokenFailure.EMPTY, spoken.failure)
        sessionVm.submitSpokenAnswer()
        assertNull(spoken.result)
        fake.live = "由"
        sessionVm.retakeSpokenAnswer()
        assertEquals(SpokenPhase.LISTENING, spoken.phase)
    }

    @Test
    fun liveFailingFallsBackToTheUpload() {
        fake.liveFails = true
        sessionVm = session()
        sessionVm.startSpokenAnswer()
        sessionVm.stopSpokenAnswer()
        waitFor("the answer") { spoken.result != null }
        assertEquals("游", spoken.result!!.text)
        assertEquals(1, fake.uploads)
    }

    @Test
    fun bothFailingSubmitsNothingAndRetryResendsTheSameTake() {
        fake.liveFails = true
        fake.upload = { error("502") }
        sessionVm = session()
        sessionVm.startSpokenAnswer()
        sessionVm.stopSpokenAnswer()
        waitFor("the failure") { spoken.phase == SpokenPhase.FAILED }
        assertEquals(SpokenFailure.FAILED, spoken.failure)
        assertNull(spoken.result, "never submitted")

        fake.upload = { "由" }
        sessionVm.retrySpokenAnswer()
        waitFor("the retried answer") { spoken.result != null }
        assertEquals("由", spoken.result!!.text)
        assertEquals(2, fake.uploads)
        assertEquals(listOf("startLive", "stop"), rec.log, "the same take, not a new recording")
    }

    @Test
    fun cancelThrowsTheTakeAwayAndFillsNothing() {
        sessionVm = session()
        sessionVm.startSpokenAnswer()
        sessionVm.cancelSpokenAnswer()
        idleFor(500)
        assertEquals(SpokenPhase.IDLE, spoken.phase)
        assertNull(spoken.result)
        sessionVm.rate(2, 1_000, null)
        waitFor("the review") { runBlocking { app.repo.dao.allEvents().isNotEmpty() } }
        assertTrue(runBlocking { app.outbox.all() }.none { it.kind == "recording" }, "no take goes up")
    }

    @Test
    fun offlineTheMicSaysWhyAndNeverRecords() {
        sessionVm = session()
        @Suppress("UNCHECKED_CAST")
        (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as MutableStateFlow<Boolean>).value = false
        waitFor("offline") { !sessionVm.ui.value.aiAvailable }
        sessionVm.startSpokenAnswer()
        assertTrue(spoken.offlineHint)
        assertEquals(SpokenPhase.IDLE, spoken.phase)
        assertTrue(rec.log.isEmpty())
        assertNotNull(sessionVm.ui.value.phase as? StudyPhase.Showing)
    }
}
