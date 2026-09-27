package dev.jeromeswannack.chineselearning.lab.ui.settings

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageJobs
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetDto
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.saveLandingPage
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudyBudget
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SettingsLogicTest {
    @Test fun pollerFollowsTheWebRule() {
        var now = 0L
        val p = CoveragePoller { now }
        assertNull(p.next(CoverageJobs(queued = 3, stale_queued = 3))) // only stuck jobs → stop
        repeat(CoveragePoller.MAX_POLLS) { assertEquals(5_000L, p.next(CoverageJobs(queued = 2))) }
        assertNull(p.next(CoverageJobs(queued = 2))) // capped at ~10 minutes
        assertNull(p.next(CoverageJobs(queued = 0)))
        assertEquals(0, p.polls) // reset once nothing is queued
        p.pollUntil = 1_000
        assertEquals(5_000L, p.next(CoverageJobs())) // a clue-audio backfill keeps it going
        now = 2_000
        assertNull(p.next(CoverageJobs()))
    }

    @Test fun budgetAndLandingHitTheWebEndpoints() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        server.enqueue(MockResponse().setBody("""{"new_cards_per_day":5,"secondary_cards_per_day":6}"""))
        assertEquals(StudyBudgetDto(5, 6), api.saveStudyBudget(StudyBudgetDto(5, 6)))
        val req = server.takeRequest()
        assertEquals("PUT /api/profile/study-budget", "${req.method} ${req.path}")
        assertEquals("""{"new_cards_per_day":5,"secondary_cards_per_day":6}""", req.body.readUtf8())

        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"x","problems":["new_cards_per_day must be between 0 and 200"]}"""))
        try {
            api.saveStudyBudget(StudyBudgetDto(500, 6))
            fail("expected a 400")
        } catch (e: HttpException) {
            assertEquals(listOf("new_cards_per_day must be between 0 and 200"), e.problems())
        }
        server.takeRequest()

        server.enqueue(MockResponse().setBody("""{"landing_page":null}"""))
        assertNull(api.saveLandingPage(null))
        assertEquals("""{"landing_page":null}""", server.takeRequest().body.readUtf8())
        server.shutdown()
    }

    @Test fun formatting() {
        assertEquals("512 B", formatBytes(512))
        assertEquals("2.3 MB", formatBytes(2_431_000))
        assertEquals("just now", timeAgo("2026-09-27T10:00:00.000Z", nowMs = 1_790_503_230_000))
    }
}
