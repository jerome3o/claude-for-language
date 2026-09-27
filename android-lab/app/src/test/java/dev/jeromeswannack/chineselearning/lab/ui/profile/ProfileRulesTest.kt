package dev.jeromeswannack.chineselearning.lab.ui.profile

import dev.jeromeswannack.chineselearning.lab.data.api.ProfileDto
import dev.jeromeswannack.chineselearning.lab.data.api.ProfileField
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** The same cases as shared/profile/validate.test.ts and frontend/src/services/profilePicture.test.ts. */
class ProfileRulesTest {
    @Test fun normalisesNames() {
        assertEquals("王老师 (Minghui)", ProfileRules.normalizeName("  王​老师 \n (Minghui)  "))
        assertEquals("AB C", ProfileRules.normalizeName("A\u0000B\nC"))
    }

    @Test fun normalisesText() {
        assertEquals("Hi!\n\nI teach HSK 1–4.", ProfileRules.normalizeText("Hi!\r\n\r\n\r\n\r\nI teach HSK 1–4.  "))
    }

    @Test fun problemsMatchTheServer() {
        assertEquals(emptyList<String>(), ProfileRules.problems("王".repeat(60), null, null))
        assertEquals(emptyList<String>(), ProfileRules.problems("😀".repeat(60), null, null))
        assertEquals(listOf("Name must be at most 60 characters"), ProfileRules.problems("a".repeat(61), null, null))
        assertTrue(ProfileRules.problems("", null, null).single().contains("empty"))
        assertEquals(
            listOf("Bio must be at most 500 characters", "About me must be at most 500 characters"),
            ProfileRules.problems(null, "y".repeat(501), "x".repeat(501)),
        )
    }

    @Test fun localTime() {
        val now = Instant.parse("2026-09-27T13:04:00Z")
        assertEquals("9:04 pm in Shanghai", ProfileRules.localTimeLabel("Asia/Shanghai", now))
        assertEquals("1:04 pm in UTC", ProfileRules.localTimeLabel("UTC", now))
        assertEquals("Buenos Aires", ProfileRules.timeZoneCity("America/Argentina/Buenos_Aires"))
        assertNull(ProfileRules.localTimeLabel(null, now))
        assertNull(ProfileRules.localTimeLabel("Bogus/Zone", now))
    }

    @Test fun cropStartsCentred() {
        val s = ProfileRules.initial(4000, 3000, 300f)
        assertEquals(1f, s.zoom)
        assertEquals(ProfileRules.SourceRect(500, 0, 3000), ProfileRules.sourceRect(s))
    }

    @Test fun cropStaysCovered() {
        val far = ProfileRules.pan(ProfileRules.initial(3000, 4000, 300f), 500f, -9999f)
        assertEquals(0f, far.ox)
        assertEquals(ProfileRules.SourceRect(0, 1000, 3000), ProfileRules.sourceRect(far))
    }

    @Test fun cropZoomsAroundAnchor() {
        val s = ProfileRules.initial(1000, 1000, 250f)
        assertEquals(ProfileRules.SourceRect(250, 250, 500), ProfileRules.sourceRect(ProfileRules.zoom(s, 2f)))
        assertEquals(ProfileRules.SourceRect(0, 0, 500), ProfileRules.sourceRect(ProfileRules.zoom(s, 2f, 0f, 0f)))
        assertEquals(ProfileRules.MAX_ZOOM, ProfileRules.zoom(s, 99f).zoom)
        assertEquals(1f, ProfileRules.zoom(s, 0.2f).zoom)
    }

    @Test fun outputSize() {
        assertEquals(512, ProfileRules.outputSize(3000))
        assertEquals(240, ProfileRules.outputSize(120))
        assertEquals(64, ProfileRules.outputSize(10))
    }

    private val saved = ProfileDto(id = "u1", name = "Minghui Zhang", google_name = "Minghui Zhang", about = "Hi")

    @Test fun changesOnlyWhatChanged() {
        assertFalse(ProfileChanges.of(saved, ProfileDraft.from(saved).copy(name = "  Minghui   Zhang ", about = "Hi  ")).any)
        val c = ProfileChanges.of(saved, ProfileDraft(name = "明慧老师", about = "", timeZone = "Asia/Shanghai", bio = ""))
        assertEquals("明慧老师", c.name)
        assertEquals(ProfileField(null), c.about)
        assertEquals(ProfileField("Asia/Shanghai"), c.timeZone)
        assertNull(c.bio)
        assertEquals("", ProfileChanges.of(saved, ProfileDraft.from(saved).copy(name = " ")).name)
    }
}
