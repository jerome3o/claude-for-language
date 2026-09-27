package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.data.api.CallDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallInfoDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallListItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallPieceDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

class CallsFormatTest {
    private val t0 = 1_790_000_000_000L

    @Test fun listMetaFollowsTheWeb() {
        val base = CallListItemDto("c", status = "ended", started_at = t0, ended_at = t0 + 25 * 60_000 + 20_000)
        val w = CallsFormat.whenText(t0, ZoneOffset.UTC, Locale.US)
        assertEquals("$w · 25 min · notes ready", CallsFormat.meta(base.copy(has_summary = true), ZoneOffset.UTC, Locale.US))
        assertEquals("$w · 25 min · transcript ready", CallsFormat.meta(base.copy(processing_status = "done"), ZoneOffset.UTC, Locale.US))
        assertEquals("$w · 25 min · processing…", CallsFormat.meta(base.copy(processing_status = "transcribing"), ZoneOffset.UTC, Locale.US))
        assertEquals("$w · 25 min", CallsFormat.meta(base, ZoneOffset.UTC, Locale.US))
        assertEquals(w, CallsFormat.meta(base.copy(status = "live"), ZoneOffset.UTC, Locale.US))
        assertEquals("$w · 1 min", CallsFormat.meta(base.copy(ended_at = t0 + 5_000), ZoneOffset.UTC, Locale.US))
        assertEquals("Test call", CallsFormat.listTitle(base))
        assertEquals("Lesson with 王老师", CallsFormat.listTitle(base.copy(other_user_name = "王老师")))
        assertEquals("📝", CallsFormat.listIcon(base.copy(has_summary = true)))
        assertEquals("🔴", CallsFormat.listIcon(base.copy(status = "live")))
    }

    @Test fun busyWhileLiveOrProcessing() {
        fun d(status: String, ps: String, pieces: List<String> = emptyList()) =
            CallDetailDto(CallInfoDto("c", status = status, processing_status = ps), pieces = pieces.mapIndexed { i, s -> CallPieceDto("p$i", status = s) })
        assertTrue(CallsFormat.isBusy(d("live", "none")))
        assertTrue(CallsFormat.isBusy(d("ended", "transcribing")))
        assertTrue(CallsFormat.isBusy(d("ended", "none", listOf("done", "recording"))))
        assertFalse(CallsFormat.isBusy(d("ended", "none", listOf("done", "failed"))))
        assertFalse(CallsFormat.isBusy(d("ended", "done")))
        assertFalse(CallsFormat.isBusy(null))
    }

    @Test fun pinyinFromTheTranscriberElseMadeOnThePhone() {
        assertEquals("nǐ hǎo", CallsFormat.segPinyin("你好", "nǐ hǎo"))
        assertEquals(null, CallsFormat.segPinyin("Hello there", null))
        assertTrue(CallsFormat.segPinyin("你好", null)!!.contains("nǐ"))
        assertEquals("Oh, wēi là is a little spicy?", CallsFormat.segPinyin("Oh, 微辣 is a little spicy?", null))
        assertEquals("Lesson 2026-09-21", CallsFormat.defaultDeckName(1_790_000_000_000L))
    }

    @Test fun peopleAreActiveHumansOnly() {
        fun rel(id: String, other: String, status: String = "active") = RelationshipDto(id, requester_id = "me", recipient_id = other, requester_role = "tutor", status = status, recipient = UserSummaryDto(other, email = "$other@x.com", name = if (other == "u2") "李明" else null))
        val people = callPeople(MyRelationshipsDto(students = listOf(rel("r1", "u2"), rel("r2", "claude-ai"), rel("r3", "u3", "removed"), rel("r4", "u4"))), "me")
        assertEquals(listOf(CallPerson("r1", "李明"), CallPerson("r4", "u4@x.com")), people)
    }
}
