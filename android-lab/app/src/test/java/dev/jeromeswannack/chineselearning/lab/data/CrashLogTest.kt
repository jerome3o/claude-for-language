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
}
