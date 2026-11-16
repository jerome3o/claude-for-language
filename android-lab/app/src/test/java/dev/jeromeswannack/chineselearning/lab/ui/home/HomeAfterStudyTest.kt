package dev.jeromeswannack.chineselearning.lab.ui.home

import dev.jeromeswannack.chineselearning.lab.core.ComputedStamp
import dev.jeromeswannack.chineselearning.lab.core.HomeCounts
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.SessionCounts
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.today.TodayHome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Back on Home after a study session (Jerome, Nov 2026: "the home screen still shows the previous
 * cached values … then after a little bit of loading, it shows the zeros"): the session's numbers
 * go on top of Home's last ones while they are newer (core HomeCounts), and the upload sync after
 * the session doesn't turn "All caught up" into "Getting your cards…".
 */
class HomeAfterStudyTest : LabScreenshotTest() {
    private val before = HomeUi(
        loaded = true, userName = "Jerome Swannack", due = QueueCounts(3, 2, 4, 26), reviewedToday = 0, bumped = 1,
        decks = listOf(
            DeckSummary("d1", "HSK 3 · Plans & time", 120, QueueCounts(3, 2, 2, 18)),
            DeckSummary("d2", "Homework · 第八课", 24, QueueCounts(0, 0, 2, 8)),
        ),
        today = TodayHome(cardsDue = 35),
    )
    private val allDone = SessionCounts("2026-11-16", 2_000, null, QueueCounts(0, 0, 0, 0), emptyMap(), 0)

    @Test fun allDoneIsZeroEverywhere() {
        assertTrue(HomeCounts.sessionNewer(allDone, ComputedStamp(1_000, "2026-11-16"), "2026-11-16"))
        val after = withSession(before, allDone)
        assertEquals(0, after.due.total)
        assertTrue(after.decks.all { it.due.total == 0 })
        assertEquals(0, after.bumped)
        assertEquals(0, after.today?.cardsDue)
    }

    @Test fun leftHalfwayFollowsTheSession() {
        val half = SessionCounts(
            "2026-11-16", 2_000, null, QueueCounts(1, 2, 3, 10),
            mapOf("d1" to QueueCounts(1, 2, 1, 4), "d2" to QueueCounts(0, 0, 2, 6)), 1,
        )
        val after = withSession(before, half)
        assertEquals(QueueCounts(1, 2, 3, 10), after.due)
        assertEquals(QueueCounts(1, 2, 1, 4), after.decks[0].due)
        assertEquals(QueueCounts(0, 0, 2, 6), after.decks[1].due)
        assertEquals(16, after.today?.cardsDue)
    }

    @Test fun aRecountAfterTheSessionWins() {
        assertFalse(HomeCounts.sessionNewer(allDone, ComputedStamp(3_000, "2026-11-16"), "2026-11-16"))
    }

    /** Screenshots: Home before the session, and right after "All done" → Done while the upload sync runs. */
    @Test fun screenshots() {
        shoot("home-counts-01-before") {
            HomeScreen(ui = before, sync = SyncStatus(lastSyncAt = System.currentTimeMillis() - 120_000), online = true, actions = HomeActions())
        }
    }

    @Test fun screenshotAfter() {
        shoot("home-counts-02-after-study") {
            HomeScreen(
                ui = withSession(before, allDone).copy(reviewedToday = 35),
                sync = SyncStatus(running = true, lastSyncAt = System.currentTimeMillis() - 600_000),
                online = true,
                actions = HomeActions(),
            )
        }
    }
}
