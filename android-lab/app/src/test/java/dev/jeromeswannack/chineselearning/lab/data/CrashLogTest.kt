package dev.jeromeswannack.chineselearning.lab.data

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Crash reporting (CrashLog.kt) and the start-up guards that keep a background failure from crashing the app. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class CrashLogTest {
    private lateinit var app: LabApp

    @Before
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        CrashLog.clear(app)
    }

    @After
    fun tearDown() = CrashLog.clear(app)

    @Test
    fun anUncaughtExceptionIsWrittenThenHandedOnThenReportedOnce() {
        val seen = ArrayList<Throwable>()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        try {
            Thread.setDefaultUncaughtExceptionHandler { _, e -> seen += e }
            CrashLog.install(app, "0.999")
            CrashLog.install(app, "0.999") // idempotent: one handler, not two
            val boom = IllegalStateException("boom at start-up")
            val t = Thread { throw boom }.apply { name = "main-ish"; start(); join() }
            assertEquals(listOf<Throwable>(boom), seen, "the platform's handler still runs (the app still dies as before)")
            assertTrue(CrashLog.hasPendingUncaught(app))
            val pending = CrashLog.pending(app)
            assertEquals(1, pending.size)
            val c = pending[0].jsonObject
            assertEquals("uncaught", c["source"]!!.jsonPrimitive.content)
            assertEquals("0.999", c["app_version"]!!.jsonPrimitive.content)
            assertEquals(t.name, c["thread"]!!.jsonPrimitive.content)
            assertTrue(c["trace"]!!.jsonPrimitive.content.startsWith("java.lang.IllegalStateException: boom at start-up"))
            CrashLog.clear(app)
            assertFalse(CrashLog.hasPendingUncaught(app))
            assertTrue(CrashLog.pending(app).isEmpty())
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(previous)
        }
    }

    @Test
    fun aCrashLoopKeepsOnlyTheFirstFew() {
        repeat(8) { CrashLog.recordNonFatal(app, "0.999", RuntimeException("again $it")) }
        assertEquals(5, CrashLog.pending(app).size)
    }

    @Test
    fun safelyTurnsAnyFailureIntoNullAndAReportButLetsCancellationThrough() = runBlocking {
        assertNull(app.safely("test") { throw IllegalArgumentException("Requested element count -1 is less than zero.") })
        assertNull(app.safely("test") { throw StackOverflowError() })
        assertEquals(2, CrashLog.pending(app).size)
        assertTrue(CrashLog.pending(app)[0].jsonObject["thread"]!!.jsonPrimitive.content.startsWith("non-fatal"))
        assertEquals(7, app.safely("test") { 7 })
        assertFailsWith<CancellationException> { app.safely("test") { throw CancellationException("left the screen") } }
        Unit
    }

    @Test
    fun aFailingBackgroundJobOnTheAppScopeIsRecordedNotFatal() = runBlocking {
        app.scope.launch { error("widget refresh blew up") }.join()
        val pending = CrashLog.pending(app)
        assertEquals(1, pending.size)
        assertTrue(pending[0].jsonObject["trace"]!!.jsonPrimitive.content.contains("widget refresh blew up"))
        // The scope survives a failed child (SupervisorJob): the next job runs.
        var ran = false
        app.scope.launch { ran = true }.join()
        assertTrue(ran)
    }

    @Test
    fun theUncaughtHandlerPostsTheTraceBeforeHandingOnThenTheScreenShowsItOnce() {
        val server = okhttp3.mockwebserver.MockWebServer()
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(201).setBody("{\"stored\":1}"))
        server.start()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        val base = CrashLog.apiBase
        try {
            CrashLog.apiBase = server.url("").toString().trimEnd('/')
            app.getSharedPreferences("lab", android.content.Context.MODE_PRIVATE).edit().putString("session_token", "tok-123").commit()
            var handedOnAfterUpload = false
            Thread.setDefaultUncaughtExceptionHandler { _, _ -> handedOnAfterUpload = server.requestCount == 1 }
            CrashLog.install(app, "0.999")
            Thread { throw IllegalStateException("Key 42 was already used") }.apply { name = "main"; start(); join() }

            val req = server.takeRequest(5, java.util.concurrent.TimeUnit.SECONDS)!!
            assertEquals("/api/debug/crash", req.path)
            assertEquals("Bearer tok-123", req.getHeader("Authorization"))
            val body = kotlinx.serialization.json.Json.parseToJsonElement(req.body.readUtf8()).jsonObject
            assertEquals("lab", body["client"]!!.jsonPrimitive.content)
            val crash = body["crashes"]!!.let { it as kotlinx.serialization.json.JsonArray }[0].jsonObject
            assertEquals("uncaught", crash["source"]!!.jsonPrimitive.content)
            assertTrue(crash["trace"]!!.jsonPrimitive.content.contains("Key 42 was already used"))
            assertTrue(handedOnAfterUpload, "the POST finished before the platform handler ran")
            assertFalse(CrashLog.hasPendingUncaught(app), "accepted → forgotten")

            // The next open shows it once (LastCrashActivity), until Continue.
            assertTrue(CrashLog.hasUnseenCrash(app))
            assertTrue(CrashLog.lastCrashText(app).contains("Key 42 was already used"))
            CrashLog.markCrashSeen(app)
            assertFalse(CrashLog.hasUnseenCrash(app))
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(previous)
            CrashLog.apiBase = base
            server.shutdown()
        }
    }

    @Test
    fun aFailedUploadKeepsTheCrashForLater() {
        val server = okhttp3.mockwebserver.MockWebServer()
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(500))
        server.start()
        val base = CrashLog.apiBase
        try {
            CrashLog.apiBase = server.url("").toString().trimEnd('/')
            app.getSharedPreferences("lab", android.content.Context.MODE_PRIVATE).edit().putString("session_token", "tok").commit()
            CrashLog.recordNonFatal(app, "0.999", RuntimeException("x"))
            assertFalse(CrashLog.uploadNow(app, "0.999"))
            assertEquals(1, CrashLog.pending(app).size)
        } finally {
            CrashLog.apiBase = base
            server.shutdown()
        }
    }

    private fun fakeServer(vararg codes: Int): okhttp3.mockwebserver.MockWebServer {
        val server = okhttp3.mockwebserver.MockWebServer()
        codes.forEach { server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(it).setBody("{}")) }
        server.start()
        CrashLog.apiBase = server.url("").toString().trimEnd('/')
        app.getSharedPreferences("lab", android.content.Context.MODE_PRIVATE).edit().putString("session_token", "tok").commit()
        return server
    }

    private fun crashFiles() = java.io.File(app.filesDir, "crash").listFiles().orEmpty().toList()

    @Test
    fun theStartUpUploadRetriesWithBackoffAndDeletesOnlyAfterA2xx() {
        val base = CrashLog.apiBase
        val sleeper = CrashLog.sleeper
        val server = fakeServer(500, 503, 201)
        try {
            CrashLog.write(java.io.File(app.filesDir, "crash"), "0.999", "main", IllegalStateException("start-up crash"))
            val waits = ArrayList<Long>()
            val filesDuringRetries = ArrayList<Int>()
            CrashLog.sleeper = { waits += it; filesDuringRetries += crashFiles().size }
            assertEquals(CrashLog.Upload.SENT, CrashLog.uploadWithRetries(app, "0.999"))
            assertEquals(3, server.requestCount, "failed twice, accepted the third time")
            assertEquals(listOf(2_000L, 4_000L), waits, "backoff between attempts")
            assertEquals(listOf(1, 1), filesDuringRetries, "the file stays until the server accepted it")
            assertTrue(crashFiles().isEmpty())
            // Every attempt carried the same crash id.
            val ids = (1..3).map {
                val body = kotlinx.serialization.json.Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
                (body["crashes"] as kotlinx.serialization.json.JsonArray).single().jsonObject["id"]!!.jsonPrimitive.content
            }
            assertEquals(1, ids.toSet().size)
        } finally {
            CrashLog.apiBase = base
            CrashLog.sleeper = sleeper
            server.shutdown()
        }
    }

    @Test
    fun theUploadWorkerSucceedsAfterTwoFailuresAndRetriesTheJobWhenEveryAttemptFails() {
        val base = CrashLog.apiBase
        val sleeper = CrashLog.sleeper
        CrashLog.sleeper = {}
        val input = androidx.work.workDataOf(CrashUploadWorker.KEY_VERSION to "0.999")
        fun worker() = androidx.work.testing.TestWorkerBuilder.from(app, CrashUploadWorker::class.java, java.util.concurrent.Executors.newSingleThreadExecutor())
            .setInputData(input).build()
        var server = fakeServer(500, 500, 201)
        try {
            CrashLog.recordNonFatal(app, "0.999", RuntimeException("x"))
            assertEquals(androidx.work.ListenableWorker.Result.success(), worker().doWork())
            assertEquals(3, server.requestCount)
            assertTrue(crashFiles().isEmpty())
            server.shutdown()

            server = fakeServer(500, 500, 500, 500)
            CrashLog.recordNonFatal(app, "0.999", RuntimeException("y"))
            assertEquals(androidx.work.ListenableWorker.Result.retry(), worker().doWork(), "WorkManager tries again later")
            assertEquals(4, server.requestCount, "1 + 3 retries")
            assertEquals(1, crashFiles().size, "kept for the next try")
        } finally {
            CrashLog.apiBase = base
            CrashLog.sleeper = sleeper
            server.shutdown()
        }
    }

    @Test
    fun anIdTheServerAcceptedIsNeverSentAgain() {
        val base = CrashLog.apiBase
        val server = fakeServer(201)
        try {
            CrashLog.recordNonFatal(app, "0.999", RuntimeException("once"))
            val file = crashFiles().single()
            val text = file.readText()
            assertTrue(CrashLog.uploadNow(app, "0.999"))
            // The delete "failed": the same file is back.
            file.writeText(text)
            assertTrue(CrashLog.unsent(app).isEmpty())
            assertTrue(crashFiles().isEmpty(), "the leftover is removed, not posted")
            assertEquals(1, server.requestCount)
        } finally {
            CrashLog.apiBase = base
            server.shutdown()
        }
    }

    @Test
    fun startUpQueuesTheUploadJobOnlyWhenSomethingIsPending() {
        val wm = androidx.work.WorkManager.getInstance(app)
        fun queued() = wm.getWorkInfosForUniqueWork(CrashUploadWorker.NAME).get()
        CrashLog.uploadInBackground(app, "0.999")
        Thread.sleep(500)
        assertTrue(queued().isEmpty(), "nothing pending, nothing queued")
        // No session token here: the job finds nothing it can send and ends without any network.
        CrashLog.recordNonFatal(app, "0.999", RuntimeException("pending"))
        CrashLog.uploadInBackground(app, "0.999")
        val deadline = System.currentTimeMillis() + 5_000
        while (queued().isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(50)
        assertTrue(queued().isNotEmpty(), "a one-shot job was queued")
    }

    private fun addExit(reason: Int, at: Long, description: String) {
        val am = app.getSystemService(android.app.ActivityManager::class.java)
        org.robolectric.Shadows.shadowOf(am).addApplicationExitInfo(
            org.robolectric.shadows.ShadowActivityManager.ApplicationExitInfoBuilder.newBuilder()
                .setProcessName(app.packageName).setPid(4242).setReason(reason).setTimestamp(at).setDescription(description).build(),
        )
    }

    @Test
    fun theScreenShowsTheJavaStackNotTheSystemsBareCrashRecord() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        try {
            Thread.setDefaultUncaughtExceptionHandler { _, _ -> }
            CrashLog.install(app, "0.999")
            Thread { throw IllegalStateException("Key 42 was already used") }.apply { name = "main"; start(); join() }
            // The system writes its own record of the same death a moment later.
            addExit(android.app.ApplicationExitInfo.REASON_CRASH, System.currentTimeMillis() + 800, "crash")

            assertTrue(CrashLog.hasUnseenCrash(app))
            val text = CrashLog.lastCrashText(app)
            assertTrue(text.contains("Thread: main"), text)
            assertTrue(text.contains("Key 42 was already used"), text)
            assertTrue(text.contains("\tat "), "the Java stack is shown: $text")
            assertFalse(text.contains("system: crash"), text)
            // …and stays: the system record did not overwrite the screen file.
            CrashLog.clear(app) // the crash files went up meanwhile
            assertTrue(CrashLog.lastCrashText(app).contains("Key 42 was already used"))
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(previous)
        }
    }

    @Test
    fun theScreenPrefersTheNewestEntryWithAStackAndMentionsANewerBareRecord() {
        val now = System.currentTimeMillis()
        // A crash file with a stack, then a newer bare system record in the screen file (as older versions wrote it).
        CrashLog.write(java.io.File(app.filesDir, "crash"), "0.999", "main", IllegalArgumentException("count -1"))
        CrashLog.writeLast(app, "${now + 90_000}\n(previous run)\nsystem: crash\ncrash\n")
        val text = CrashLog.lastCrashText(app)
        assertTrue(text.startsWith("When: "), text)
        assertTrue(text.indexOf("count -1") in 0 until text.indexOf("system: crash"), "stack first, then the bare record: $text")
        assertTrue(text.contains("Also recorded (no stack)"), text)
    }

    @Test
    fun aCrashRecordIsCoveredOnlyByAStackWrittenShortlyBeforeIt() {
        assertTrue(CrashLog.coveredByStack(100_000, listOf(99_500)))
        assertTrue(CrashLog.coveredByStack(100_000, listOf(40_000)))
        assertFalse(CrashLog.coveredByStack(100_000, listOf(39_999)), "over 60 s before: another death")
        assertFalse(CrashLog.coveredByStack(100_000, listOf(100_001)), "written after the exit: a later crash")
        assertFalse(CrashLog.coveredByStack(100_000, emptyList()))
        assertFalse(CrashLog.hasStack("1\n(previous run)\nsystem: crash\ncrash\n"))
        assertTrue(CrashLog.hasStack("1\n0.9\nmain\njava.lang.X: y\n\tat a.b.C.d(C.kt:1)\n"))
    }

    @Test
    fun aFreezeDumpLeadsWithTheMainThread() {
        val dump = CrashLog.freezeDump()
        assertTrue(dump.startsWith("FROZEN main thread"))
        assertTrue(dump.contains("Other threads:"))
    }
}
