package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.core.SentenceRound
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Natural sentences only (docs/STUDY_SESSION.md "Natural sentences"; core SentenceFocus): the rows once written
 * around a look-alike / homophone (focus shared_character / contrast) come after the natural ones on the card,
 * and the Sentence round never picks them.
 */
class NaturalSentencesTest {
    private val note = Samples.note.copy(hanzi = "银行", sentenceClue = null)
    private fun row(id: String, position: Int, focus: String?) =
        SentenceEntity(id, note.id, position, "银行$id。", "yínháng", "The bank $id.", null, focus, null)

    private val set = listOf(
        row("a", 0, "core"),
        row("b", 1, "shared_character"),
        row("c", 2, "collocation"),
        row("d", 3, "contrast"),
        row("e", 4, null),
        row("f", 5, "complex"),
    )

    @Test
    fun contrivedRowsComeLastOnTheCard() {
        val rows = sentenceRows(note, set.shuffled(java.util.Random(7)))
        assertEquals(listOf("a", "c", "e", "f", "b", "d"), rows.map { it.key })
        assertEquals(listOf("core", "collocation", null, "complex", "shared_character", "contrast"), rows.map { it.focus })
    }

    @Test
    fun theRoundNeverPicksThem() {
        val rows = sentenceRows(note, set)
        val picked = SentenceRound.pick(rows.map { it.toRoundSentence() })
        assertEquals(listOf("a", "c", "e", "f"), picked.map { it.key })
        assertEquals(4, SentenceRound.roundSentenceCount(rows.map { it.toRoundSentence() }))
    }
}
