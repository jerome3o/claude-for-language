package dev.jeromeswannack.chineselearning.lab.data.study

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.ActiveTime
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.StudyResume
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Active study time (idle cut-off, background pause), the resume point and the celebration mark on the device. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class StudyDayStoreTest {
    private val zone = ZoneId.of("Europe/London")
    private val t = Js.parseDate("2026-09-29T09:00:00.000Z")
    private lateinit var store: StudyDayStore

    @Before
    fun setUp() {
        store = StudyDayStore.forTest(ApplicationProvider.getApplicationContext(), zone)
    }

    @Test
    fun countsInteractionsWithTheIdleCutOffAndStopsInTheBackground() {
        store.interact(t)
        store.interact(t + 30_000)
        assertEquals(40_000, store.deviceToday(t + 40_000))
        // Walked away from the card: only the idle allowance after the last touch counts.
        assertEquals(30_000 + ActiveTime.IDLE_MS, store.deviceToday(t + 30_000 + 10 * 60_000))
        store.pause(t + 50_000) // screen off / app in the background
        assertEquals(50_000, store.deviceToday(t + 3_600_000))
        store.interact(t + 3_600_000) // back: nothing counted while away
        assertEquals(50_000, store.deviceToday(t + 3_600_000))
    }

    @Test
    fun survivesAProcessDeath() {
        store.interact(t)
        store.pause(t + 20_000)
        val fresh = StudyDayStore.forTestKeeping(ApplicationProvider.getApplicationContext(), zone)
        assertEquals(20_000, fresh.deviceToday(t + 99_000))
    }

    @Test
    fun reportsItsDaysAndAddsOtherDevices() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"days":[{"date":"2026-09-29","active_ms":900000,"device_ms":60000}]}"""))
        server.start()
        try {
            store.interact(t)
            store.pause(t + 60_000)
            val api = Api(tokenProvider = { "tok" }, baseUrl = server.url("/").toString().trimEnd('/'))
            store.report(api, force = true, now = t + 60_000)
            val req = server.takeRequest()
            assertEquals("PUT", req.method)
            assertEquals("/api/me/study-time", req.path)
            val body = req.body.readUtf8()
            assertTrue(body.contains("\"device_id\":\"lab-"), body)
            assertTrue(body.contains("{\"date\":\"2026-09-29\",\"active_ms\":60000}"), body)
            // 900 000 over every device, 60 000 of it this one's + this one's own 60 000.
            assertEquals(900_000, store.activeToday(t + 60_000))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun resumePointAndCelebration() {
        val day = store.today(t)
        store.saveResumePoint(StudyResume.Point(day, "all", "c1", true, "你好", 5_000))
        store.clearResumePoint("other")
        assertEquals("c1", store.resumePoint()?.cardId)
        store.clearResumePoint("c1")
        assertNull(store.resumePoint())

        assertFalse(store.claimCelebration(0, queueEmpty = true, now = t))
        assertTrue(store.claimCelebration(30, queueEmpty = true, now = t))
        assertFalse(store.claimCelebration(30, queueEmpty = true, now = t)) // back later: quiet
        assertTrue(store.claimCelebration(34, queueEmpty = true, now = t)) // more were cleared
    }
}
