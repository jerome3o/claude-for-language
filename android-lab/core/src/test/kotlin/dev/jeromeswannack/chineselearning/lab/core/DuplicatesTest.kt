package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals

class DuplicatesTest {
    private fun n(id: String, hanzi: String, deck: String = "d") = DupNote(id, deck, hanzi, "", "")

    @Test fun keepsTheMostReviewedFirst() {
        val groups = Duplicates.find(
            listOf(n("a", "猫"), n("b", "猫"), n("c", "狗"), n("d", "猫"), n("e", "鱼"), n("f", "鱼")),
            reviewsByNote = mapOf("a" to 2, "b" to 9, "d" to 2),
            repetitionsByNote = mapOf("d" to 5),
        )
        val cat = groups.first { it.hanzi == "猫" }
        assertEquals(listOf("b", "d", "a"), cat.items.map { it.note.id })
        assertEquals(listOf("d", "a"), cat.extras.map { it.note.id })
        assertEquals(setOf("猫", "鱼"), groups.map { it.hanzi }.toSet())
    }

    @Test fun deletedNotesDropOut() {
        val groups = Duplicates.find(listOf(n("a", "猫"), n("b", "猫")), emptyMap(), emptyMap(), deleted = setOf("b"))
        assertEquals(emptyList(), groups)
    }
}
