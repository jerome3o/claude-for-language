package dev.jeromeswannack.chineselearning.lab.ui.homework

import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.data.api.OnboardingDto
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkStore
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.formatStudyEstimate
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.onboardingRelativeTime
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.showFirstOpen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class HomeworkLogicTest {
    private fun e(id: String) = HomeworkEvent(id, "a", "n", "right", "2026-09-27T10:00:00Z")

    @Test
    fun syncKeepsOnlyLocalEventsStillWaitingInTheOutbox() {
        val merged = HomeworkStore.mergeEvents(server = listOf(e("s1"), e("l1")), local = listOf(e("l1"), e("l2"), e("gone")), pendingIds = setOf("l2"))
        assertEquals(listOf("s1", "l1", "l2"), merged.map { it.id })
    }

    @Test
    fun firstOpenOnlyForTutorInviteesWithNoReviews() {
        val s = OnboardingDto(invited = true, inviter_role = "tutor")
        assertTrue(showFirstOpen(s, dismissed = false, localReviews = 0))
        assertFalse(showFirstOpen(s, dismissed = true, localReviews = 0))
        assertFalse(showFirstOpen(s, dismissed = false, localReviews = 1))
        assertFalse(showFirstOpen(s, dismissed = false, localReviews = null))
        assertFalse(showFirstOpen(s.copy(has_reviewed = true), false, 0))
        assertFalse(showFirstOpen(s.copy(inviter_role = "student"), false, 0))
        assertFalse(showFirstOpen(s.copy(invited = false), false, 0))
        assertFalse(showFirstOpen(null, false, 0))
    }

    @Test
    fun estimatesAndTimesReadLikeTheWeb() {
        assertEquals("under a minute", formatStudyEstimate(2))
        assertEquals("about 1 min", formatStudyEstimate(3))
        assertEquals("about 8 min", formatStudyEstimate(24))
        val now = Instant.parse("2026-09-27T18:00:00Z").toEpochMilli()
        assertEquals("10 h ago", onboardingRelativeTime("2026-09-27 08:00:00", now))
        assertEquals("yesterday", onboardingRelativeTime("2026-09-26T18:00:00Z", now))
        assertEquals("just now", onboardingRelativeTime("2026-09-27T17:59:00Z", now))
    }
}
