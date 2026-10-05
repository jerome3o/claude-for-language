package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.core.HomeworkLibrary
import dev.jeromeswannack.chineselearning.lab.core.LibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.PillsDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** docs/HOMEWORK.md §11: the one-off headline the server sends, rendered by the Lab (pill, sections, library). */
class HomeworkOneOffTest {
    private val json = Json { ignoreUnknownKeys = true }

    private val overviewJson = """
        {"relationship_id":"rel","student":{"id":"s","email":"j@example.com","name":"Jerome"},
         "pills":{"struggling_words":0,"homework_percent":100,
                  "homework":{"state":"all_done","total":3,"done":3,"open":0,"overdue":0,"due_today":0,"percent":100,
                              "label":"✓ All done this week","pill":"Homework ✓ all done this week"}},
         "homework":{"percent":100,
                     "one_off":{"state":"all_done","total":3,"done":3,"open":0,"overdue":0,"due_today":0,"percent":100,"label":"✓ All done this week","pill":"Homework ✓ all done this week"},
                     "decks":[{"shared_deck_id":"a","mode":"fsrs","long_term":true},{"shared_deck_id":"b","mode":"one_off","long_term":false},{"shared_deck_id":"c"}],
                     "lessons":[]}}
    """.trimIndent()

    @Test fun decodesTheOneOffSummaryAndDeckModes() {
        val o = json.decodeFromString(StudentOverviewDto.serializer(), overviewJson)
        assertEquals("all_done", o.pills.homework?.state)
        assertEquals("✓ All done this week", o.homework.one_off?.label)
        assertEquals(listOf(true, false, true), o.homework.decks.map { it.isLongTerm }) // no field (older server) = long-term
        assertEquals("fsrs", o.homework.decks[0].mode)
        assertNull(o.homework.decks[2].mode)
    }

    @Test fun pillFollowsTheServerSummary() {
        assertEquals("Homework ✓ all done this week" to PillTone.HomeworkDone, homeworkPill(json.decodeFromString(StudentOverviewDto.serializer(), overviewJson).pills))
        assertEquals("Homework 1 overdue" to PillTone.HomeworkOverdue, homeworkPill(PillsDto(homework = TeachingSamples.oneOff)))
        assertEquals("Homework 2 of 3 done" to PillTone.Homework, homeworkPill(PillsDto(homework = TeachingSamples.oneOffOpen)))
        // Nothing one-off ever set → no pill (never "Homework 0%").
        assertNull(homeworkPill(PillsDto(homework_percent = null, homework = TeachingSamples.oneOff.copy(state = "none", pill = "No homework set"))))
        // An older server without the summary → the old "Homework N%".
        assertEquals("Homework 58%" to PillTone.Homework, homeworkPill(PillsDto(homework_percent = 58)))
        assertNull(homeworkPill(PillsDto()))
    }

    @Test fun longTermLibraryRowsShowWordsNotPercent() {
        val lt = LibraryItem(key = "deck:x", kind = "deck", title = "HSK 3", sent_at = "2026-09-29T18:00:00Z", status = HomeworkLibrary.LONG_TERM, percent = 35, progress = "14 / 40 words met", mode = "fsrs")
        assertFalse(showsPercent(lt))
        assertTrue(showsPercent(lt.copy(status = HomeworkLibrary.IN_PROGRESS)))
        val meta = libraryMeta(lt, "2026-10-03", showStudent = false, now = java.time.Instant.parse("2026-10-03T09:00:00Z"))
        assertTrue(meta, meta.startsWith("Sent ") && meta.endsWith(" · 14 / 40 words met"))
        assertEquals("In long-term review", HomeworkLibrary.statusLabel(lt.status))
    }

    @Test fun longTermIntroUsesTheFirstName() {
        assertEquals("Decks in Jerome’s daily review, introduced at their daily new-card budget. Not counted as homework.", longTermIntro("Jerome Swannack"))
        assertEquals("Decks in their’s daily review, introduced at their daily new-card budget. Not counted as homework.", longTermIntro(""))
    }
}
