package dev.jeromeswannack.chineselearning.lab.data.auth

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.auth.SessionRules
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.MeDto
import dev.jeromeswannack.chineselearning.lab.data.Repository
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Sign-in never loses work (CLAUDE.md "Sign-in & sessions"): a 401 from our API sets the persistent
 * signed-out flag (the banner) and a working request clears it; Sign out with unsent reviews deletes
 * nothing; Sign out with everything uploaded keeps the audio cache; the same account signing in again
 * keeps the rows + audio and uploads what waited; a different account is asked about first and only
 * then cleared.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class SessionSafetyTest {
    private val app: LabApp = ApplicationProvider.getApplicationContext()
    private lateinit var server: MockWebServer
    private var unauthorized = false
    private val paths = mutableListOf<String>()

    private val audioDir get() = File(app.filesDir, "audio")

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path!!.substringBefore('?')
                synchronized(paths) { paths += "${request.method} $path" }
                fun ok(body: String) = MockResponse().setBody(body).setHeader("Content-Type", "application/json")
                if (path == "/api/auth/logout") return ok("""{"success":true}""")
                if (unauthorized) return MockResponse().setResponseCode(401).setBody("""{"error":"Unauthorized"}""")
                return when (path) {
                    "/api/auth/me" -> ok("""{"id":"u1","email":"jerome@example.com","name":"Jerome"}""")
                    "/api/reviews" -> if (request.method == "POST") ok("""{"orphan_event_ids":[]}""") else ok("""{"events":[],"has_more":false}""")
                    "/api/sync/changes" -> ok("""{"server_time":"2026-10-28T08:00:00.000Z"}""")
                    else -> ok("{}")
                }
            }
        }
        server.start()
        val old = app.repo
        app.prefs.clearEverything()
        app.repo = Repository(app, old.db, Api(server.url("").toString().removeSuffix("/")) { app.prefs.sessionToken }, app.prefs)
        runBlocking(Dispatchers.IO) { app.repo.db.clearAllTables() }
        audioDir.mkdirs()
        audioDir.listFiles()?.forEach { it.delete() }
    }

    @After fun tearDown() = server.shutdown()

    private fun unsyncedReview(id: String = "ev1") = runBlocking(Dispatchers.IO) {
        app.repo.dao.insertEvents(listOf(ReviewEventEntity(id, "c1", 2, "2026-10-28T07:00:00.000Z", 1200, null, synced = false)))
    }

    private fun cachedClip(): File = File(audioDir, "generated_abc.mp3").apply { writeText("ID3") }

    private fun me(id: String, email: String) = MeDto(id = id, email = email)

    @Test fun a401SetsThePersistentSignedOutFlagAndAWorkingRequestClearsIt() = runBlocking(Dispatchers.IO) {
        app.prefs.sessionToken = "tok"
        unauthorized = true
        try { app.repo.api.changes(0); fail("401 expected") } catch (_: UnauthorizedException) { }
        assertTrue(app.repo.session.signedOut.value)
        assertTrue(app.prefs.signedOutSince > 0, "persisted, so a cold start still shows the banner")
        // A fresh SessionHealth (a cold start) reads it back.
        assertTrue(SessionHealth(app.prefs).signedOut.value)
        // Nothing local was touched: the token is still there (the banner signs in again).
        assertEquals("tok", app.prefs.sessionToken)

        unauthorized = false
        app.repo.api.me()
        assertFalse(app.repo.session.signedOut.value)
        assertEquals(0L, app.prefs.signedOutSince)
    }

    @Test fun signingOutNeverCountsAsSignedOut() {
        app.prefs.sessionToken = "tok"
        app.repo.session.unauthorized("/api/auth/logout")
        assertFalse(app.repo.session.signedOut.value)
        // Without a session there is nothing to be signed out of (the sign-in screen shows).
        app.prefs.sessionToken = null
        app.repo.session.unauthorized("/api/sync/changes")
        assertFalse(app.repo.session.signedOut.value)
    }

    @Test fun signOutWithUnsyncedReviewsDeletesNothing() = runBlocking(Dispatchers.IO) {
        app.prefs.sessionToken = "tok"
        app.prefs.accountOwnerId = "u1"
        unsyncedReview()
        val clip = cachedClip()
        val counts = app.repo.unsyncedCounts()
        assertEquals(1, counts.reviews)
        assertEquals("1 review hasn't uploaded yet", SessionRules.unsyncedSummary(counts))

        app.repo.signOut()
        assertNull(app.prefs.sessionToken)
        assertEquals(1, app.repo.dao.unsyncedCount(), "the unsent review is still on this phone")
        assertTrue(clip.exists(), "the audio cache stays")
        assertEquals("u1", app.prefs.accountOwnerId)
    }

    @Test fun signOutWithEverythingUploadedKeepsTheAudioCache() = runBlocking(Dispatchers.IO) {
        app.prefs.sessionToken = "tok"
        app.prefs.accountOwnerId = "u1"
        app.prefs.accountOwnerEmail = "jerome@example.com"
        app.repo.dao.insertEvents(listOf(ReviewEventEntity("ev-up", "c1", 2, "2026-10-28T07:00:00.000Z", 1200, null, synced = true)))
        val clip = cachedClip()

        app.repo.signOut()
        assertNull(app.prefs.sessionToken)
        assertEquals(0, app.repo.dao.unsyncedCount())
        assertTrue(clip.exists(), "~1 GB of clips must not be re-downloaded by the same person")
        assertEquals("u1", app.prefs.accountOwnerId)
        assertEquals("jerome@example.com", app.prefs.accountOwnerEmail)
    }

    @Test fun theSameAccountSigningInAgainKeepsEverythingAndUploadsWhatWaited() = runBlocking(Dispatchers.IO) {
        app.prefs.sessionToken = "dead-token"
        app.prefs.accountOwnerId = "u1"
        unsyncedReview("ev-train")
        val clip = cachedClip()
        app.repo.session.unauthorized("/api/sync/changes") // the expired session found by a sync

        val (decision, _) = app.repo.accountSwitchFor(me("u1", "jerome@example.com"))
        assertEquals(SessionRules.Switch.SAME, decision)
        app.repo.onSignedIn("new-token", me("u1", "jerome@example.com"))
        assertFalse(app.repo.session.signedOut.value)

        app.repo.pushEvents()
        assertTrue(synchronized(paths) { paths.contains("POST /api/reviews") }, "the review made while signed out is uploaded")
        assertEquals(0, app.repo.dao.unsyncedCount())
        assertTrue(clip.exists())
    }

    @Test fun aDifferentAccountIsAskedAboutAndOnlyThenCleared() = runBlocking(Dispatchers.IO) {
        app.prefs.sessionToken = "tok"
        app.prefs.accountOwnerId = "u1"
        app.prefs.accountOwnerEmail = "jerome@example.com"
        unsyncedReview()
        val clip = cachedClip()

        val (decision, unsynced) = app.repo.accountSwitchFor(me("u2", "minghui@example.com"))
        assertEquals(SessionRules.Switch.SWITCH_BLOCKED, decision)
        assertEquals(
            "1 review hasn't uploaded yet — sign back in as jerome@example.com to upload them first, or discard them.",
            SessionRules.switchAccountWarning(unsynced, app.prefs.accountOwnerEmail),
        )
        // Asking deleted nothing.
        assertEquals(1, app.repo.dao.unsyncedCount())
        assertTrue(clip.exists())

        // "Discard": the previous account's data goes, audio too.
        app.repo.clearForNewAccount()
        app.repo.onSignedIn("tok2", me("u2", "minghui@example.com"))
        assertEquals(0, app.repo.dao.unsyncedCount())
        assertFalse(clip.exists())
        assertEquals("u2", app.prefs.accountOwnerId)
    }

    @Test fun aDifferentAccountWithEverythingUploadedIsClearedWithoutAsking() = runBlocking(Dispatchers.IO) {
        app.prefs.accountOwnerId = "u1"
        val (decision, _) = app.repo.accountSwitchFor(me("u2", "minghui@example.com"))
        assertEquals(SessionRules.Switch.SWITCH, decision)
    }
}
