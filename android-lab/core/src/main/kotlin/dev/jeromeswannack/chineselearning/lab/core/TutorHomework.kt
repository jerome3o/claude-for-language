package dev.jeromeswannack.chineselearning.lab.core

/*
 * Home's "From <tutor>" card: which piece of tutor homework to surface and how to describe
 * its progress. Port of frontend/src/components/home/homework.ts (pickHomework,
 * summarizeHomeworkDeck, describeDeckProgress, stripFromTutorSuffix) — parity-tested
 * (parity/fixtures/homework.ts → homework-tutor-card.json).
 */

data class HwTutor(val relationshipId: String, val tutorId: String, val tutorName: String)
data class HwDeckSource(val relationshipId: String, val targetDeckId: String, val sharedAt: String)
data class HwLessonSource(val id: String, val title: String, val assignedBy: String?, val assignedRelationshipId: String?, val createdAt: String, val status: String)
data class HwMessage(val conversationId: String, val relationshipId: String?, val text: String?, val createdAt: String)

sealed interface HwItem {
    val sentAt: String
    data class Deck(val deckId: String, val name: String, override val sentAt: String) : HwItem
    data class Lesson(val lessonId: String, val title: String, override val sentAt: String) : HwItem
}

data class HwPick(val tutorName: String, val relationshipId: String, val item: HwItem?, val unreadMessage: HwMessage?)

data class DeckProgressSummary(val total: Int, val started: Int, val needWork: List<String>)

object TutorHomework {
    private val FROM_TUTOR = Regex("[\\s\\u00a0\\u2000-\\u200a\\u3000\\ufeff]*\\(from tutor\\)[\\s\\u00a0\\u2000-\\u200a\\u3000\\ufeff]*$", RegexOption.IGNORE_CASE)

    /** "第三周作业：天气 (from tutor)" → "第三周作业：天气". */
    fun stripFromTutorSuffix(name: String): String = name.replace(FROM_TUTOR, "").trim().ifEmpty { name }

    /** Port of pickHomework: newest deck / lesson a tutor sent, plus that tutor's newest unread message. */
    fun pick(
        tutors: List<HwTutor>,
        sharedDecks: List<HwDeckSource>,
        lessons: List<HwLessonSource>,
        unreadMessages: List<HwMessage>,
        localDecks: Map<String, String>,
    ): HwPick? {
        if (tutors.isEmpty()) return null
        val byRelationship = LinkedHashMap<String, HwTutor>().apply { tutors.forEach { put(it.relationshipId, it) } }
        val byTutorId = LinkedHashMap<String, HwTutor>().apply { tutors.forEach { put(it.tutorId, it) } }

        val candidates = mutableListOf<Pair<HwItem, HwTutor>>()
        for (shared in sharedDecks) {
            val tutor = byRelationship[shared.relationshipId] ?: continue
            val localName = localDecks[shared.targetDeckId] ?: continue
            candidates += HwItem.Deck(shared.targetDeckId, stripFromTutorSuffix(localName), shared.sharedAt) to tutor
        }
        for (lesson in lessons) {
            if (lesson.status != "active") continue
            val tutor = lesson.assignedRelationshipId?.let { byRelationship[it] }
                ?: lesson.assignedBy?.let { byTutorId[it] }
                ?: continue
            candidates += HwItem.Lesson(lesson.id, lesson.title, lesson.createdAt) to tutor
        }
        val sorted = candidates.sortedWith { a, b -> b.first.sentAt.compareTo(a.first.sentAt) }
        val unread = unreadMessages
            .filter { it.relationshipId != null && byRelationship.containsKey(it.relationshipId) }
            .sortedWith { a, b -> b.createdAt.compareTo(a.createdAt) }
            .firstOrNull()

        val chosen = sorted.firstOrNull()
        if (chosen == null && unread == null) return null
        val tutor = chosen?.second ?: byRelationship.getValue(unread!!.relationshipId!!)
        val messageForTutor = unread?.takeIf { it.relationshipId == tutor.relationshipId }
        return HwPick(tutor.tutorName, tutor.relationshipId, chosen?.first, messageForTutor)
    }

    data class CardRow(val id: String, val noteId: String, val queue: Int)
    data class NoteRow(val id: String, val hanzi: String)
    data class EventRow(val cardId: String, val rating: Int)

    /** Port of summarizeHomeworkDeck: cards started + the (up to 2) words with the most Again ratings. */
    fun summarizeDeck(cards: List<CardRow>, notes: List<NoteRow>, events: List<EventRow>, needWorkLimit: Int = 2): DeckProgressSummary {
        val noteByCard = cards.associate { it.id to it.noteId }
        val hanziByNote = notes.associate { it.id to it.hanzi }
        val agains = LinkedHashMap<String, Int>()
        for (e in events) {
            if (e.rating != 0) continue
            val noteId = noteByCard[e.cardId] ?: continue
            if (!hanziByNote.containsKey(noteId)) continue
            agains[noteId] = (agains[noteId] ?: 0) + 1
        }
        val needWork = agains.entries.sortedByDescending { it.value }.take(needWorkLimit).map { hanziByNote.getValue(it.key) }
        return DeckProgressSummary(cards.size, cards.count { it.queue != 0 }, needWork)
    }

    /** Port of describeDeckProgress: "7 of 18 cards started · 刮风 and 晴天 need work". */
    fun describe(summary: DeckProgressSummary): String {
        val (total, started, needWork) = summary
        val head = when {
            total == 0 -> "No cards yet"
            started == 0 -> "Not started yet · $total ${if (total == 1) "card" else "cards"}"
            started >= total -> "All $total cards started"
            else -> "$started of $total cards started"
        }
        if (needWork.isEmpty()) return head
        val words = if (needWork.size == 1) needWork[0] else "${needWork[0]} and ${needWork[1]}"
        return "$head · $words ${if (needWork.size == 1) "needs" else "need"} work"
    }
}
