package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.ZoneId
import java.util.Locale

/** The card extras' rules, against the web's (StudyPage.tsx, services/cardFlags.ts, recording-notes.ts). */
class CardExtrasLogicTest {
    private val me = UserSummaryDto("u-me", name = "Jerome")

    private fun rel(id: String, requesterRole: String, other: UserSummaryDto, status: String = "active", otherIsRequester: Boolean = true) =
        if (otherIsRequester) RelationshipDto(id, requester_id = other.id, recipient_id = me.id, requester_role = requesterRole, status = status, requester = other, recipient = me)
        else RelationshipDto(id, requester_id = me.id, recipient_id = other.id, requester_role = requesterRole, status = status, requester = me, recipient = other)

    @Test fun humanTutorsSkipsClaudeAndInactiveAndFindsTheOtherSide() {
        val wang = UserSummaryDto("u-wang", name = "Wang Laoshi")
        val li = UserSummaryDto("u-li", email = "li@example.com")
        val claude = UserSummaryDto(CLAUDE_AI_USER_ID, name = "Claude")
        val rels = MyRelationshipsDto(
            tutors = listOf(
                rel("r1", "tutor", wang), // she asked, as the tutor
                rel("r2", "student", li, otherIsRequester = false), // I asked, as the student
                rel("r3", "tutor", claude),
                rel("r4", "tutor", UserSummaryDto("u-old", name = "Old"), status = "removed"),
            ),
        )
        assertEquals(listOf(FlagTutor("r1", "Wang Laoshi"), FlagTutor("r2", "li@example.com")), CardExtrasLogic.humanTutors(rels))
        assertEquals("r3", CardExtrasLogic.claudeRelationshipId(rels))
        assertEquals(emptyList<FlagTutor>(), CardExtrasLogic.humanTutors(null))
        assertNull(CardExtrasLogic.claudeRelationshipId(MyRelationshipsDto()))
    }

    @Test fun unseenNotesForCardMatchesTheWeb() {
        fun n(id: String, kind: String, card: String?, note: String, at: String) = TutorNote(id, kind, card, note, "打算", "c-$id", "Wang", at)
        val all = listOf(
            n("e1", "recording", "c1", "n1", "2026-09-01T10:00:00Z"),
            n("f1", "flag", null, "n1", "2026-09-03T10:00:00Z"), // flag reply without a card: matched on the note
            n("e2", "recording", "c2", "n1", "2026-09-04T10:00:00Z"), // a recording note on another card of the note: not shown
            n("f2", "flag", "c1", "n1", "2026-09-02T10:00:00Z"),
            n("e3", "recording", "c1", "n1", "2026-09-05T10:00:00Z"),
        )
        assertEquals(listOf("f1", "f2", "e1"), CardExtrasLogic.unseenNotesForCard(all, setOf("e3"), "c1", "n1").map { it.id })
    }

    @Test fun tutorNoteLabels() {
        val base = TutorNote("e", "recording", "c", "n", "打算", "second tone", null, "")
        assertEquals("From your tutor:", CardExtrasLogic.tutorNoteFrom(base))
        assertEquals("From Wang:", CardExtrasLogic.tutorNoteFrom(base.copy(tutorName = "Wang")))
        assertEquals("Your tutor replied to your flag:", CardExtrasLogic.tutorNoteFrom(base.copy(kind = "flag")))
        assertEquals("Wang replied to your flag:", CardExtrasLogic.tutorNoteFrom(base.copy(kind = "flag", tutorName = "Wang")))
    }

    @Test fun addedDateReadsSqlAndIso() {
        val utc = ZoneId.of("UTC")
        assertEquals("Added Sep 1, 2026", CardExtrasLogic.formatAddedDate("2026-09-01 10:00:00", utc, Locale.US))
        assertEquals("Added Sep 1, 2026", CardExtrasLogic.formatAddedDate("2026-09-01T23:30:00Z", utc, Locale.US))
        assertEquals("Added Sep 2, 2026", CardExtrasLogic.formatAddedDate("2026-09-01T23:30:00Z", ZoneId.of("Pacific/Auckland"), Locale.US))
        assertNull(CardExtrasLogic.formatAddedDate(null))
        assertNull(CardExtrasLogic.formatAddedDate("not a date"))
    }

    @Test fun writeItOnlyForShortWords() {
        assertTrue(CardExtrasLogic.canWriteHanzi("打算"))
        assertTrue(CardExtrasLogic.canWriteHanzi("你好！"))
        assertFalse(CardExtrasLogic.canWriteHanzi("hello"))
        assertFalse(CardExtrasLogic.canWriteHanzi("我明年打算去中国学习"))
        assertEquals(listOf("你", "好"), CardExtrasLogic.writableCharacters("你好，"))
    }

    @Test fun lookupCharactersAreHanziOnly() {
        assertTrue(CardExtrasLogic.isLookupCharacter("算"))
        assertTrue(CardExtrasLogic.isLookupCharacter("㐀"))
        assertFalse(CardExtrasLogic.isLookupCharacter("。"))
        assertFalse(CardExtrasLogic.isLookupCharacter("a"))
        assertFalse(CardExtrasLogic.isLookupCharacter(" "))
    }

    // The quick-question chips moved to core AskClaude.quickActions (parity-tested against shared/study/askClaude.ts).
    @Test fun quickActionsFollowTheCardAndTheLanguage() {
        val read = dev.jeromeswannack.chineselearning.lab.core.AskClaude.quickActions("en", typedAnswer = false, hasSentence = false).map { it.label }
        assertEquals(listOf("Use in sentence", "Explain characters", "Related words", "Explain grammar", "Add a fun fact"), read)
        val typed = dev.jeromeswannack.chineselearning.lab.core.AskClaude.quickActions("en", typedAnswer = true, hasSentence = true).map { it.label }
        assertEquals(listOf("Use in sentence", "Explain characters", "Related words", "Check my answer", "Explain grammar", "Add a fun fact", "Explain sentence"), typed)
        assertEquals("请用这个词造几个简单的句子。", dev.jeromeswannack.chineselearning.lab.core.AskClaude.quickActions("zh", false, false).first().question)
    }

    @Test fun askErrorsAreSentences() {
        assertEquals("Ask Claude needs an internet connection — you're offline right now.", CardExtrasLogic.describeAskError(IOException("x"), aiAvailable = false))
        assertEquals("Couldn't reach Claude — check your connection and try again.", CardExtrasLogic.describeAskError(IOException("reset"), aiAvailable = true))
        assertEquals("Claude couldn't answer: Note not found", CardExtrasLogic.describeAskError(HttpException(404, "", """{"error":"Note not found"}"""), aiAvailable = true))
        assertEquals("Claude couldn't answer that. Try again in a moment.", CardExtrasLogic.describeAskError(RuntimeException(), aiAvailable = true))
    }

    @Test fun alternativesRoundTripLikeTheEditModal() {
        assertEquals("我很高兴\n我很开心", CardExtrasLogic.alternativesText("""["我很高兴","我很开心"]"""))
        assertEquals("", CardExtrasLogic.alternativesText(null))
        assertEquals("", CardExtrasLogic.alternativesText("not json"))
        assertEquals("""["我很高兴","我很开心"]""", CardExtrasLogic.alternativesJson(" 我很高兴 \n\n我很开心\n"))
        assertNull(CardExtrasLogic.alternativesJson("  \n "))
    }

    @Test fun newVoiceDropsTheBracketFromTheSpeakerName() {
        val names = (0 until 200).map { CardExtrasLogic.randomVoice(kotlin.random.Random(it)).second }.toSet()
        assertTrue("Sweet Lady" in names || "Gentleman" in names)
        assertTrue(names.none { it.contains("(") })
    }
}
