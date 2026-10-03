package dev.jeromeswannack.chineselearning.lab.core

/*
 * Taking homework back: the words of the confirm sheet and the toast, shared with the web app.
 * Port of shared/homework/removal.ts — parity-tested (parity/fixtures/homework-removal.ts →
 * homework-removal.json, HomeworkRemovalParityTest).
 */

/** What the removal preview endpoint answers, reduced to what the words need (web: RemovalFacts). */
data class RemovalFacts(
    /** "deck" | "lesson" | "reader". */
    val kind: String,
    /** Deck / lesson / reader title as the tutor knows it. */
    val title: String,
    /** Deck: words met / words in the copy. */
    val wordsMet: Int? = null,
    val wordsTotal: Int? = null,
    /** Lesson: completions; reader: readings. */
    val times: Int? = null,
    /** The student already deleted their copy. */
    val copyGone: Boolean = false,
    /** Deck: "Also delete my copy" may be offered. */
    val canDeleteSource: Boolean = false,
)

/** Web: RemovalCopy. */
data class RemovalCopy(
    val menuLabel: String,
    val title: String,
    val body: String,
    val detail: String,
    /** "Also delete my copy" when it applies, else null. */
    val sourceOption: String?,
    val confirmLabel: String,
)

object HomeworkRemoval {
    const val DECK = "deck"
    const val LESSON = "lesson"
    const val READER = "reader"

    private fun place(kind: String): String = when (kind) {
        DECK -> "decks"
        LESSON -> "lessons"
        READER -> "readers"
        else -> "undefined" // JS: PLACE[unknown] interpolates as "undefined"
    }

    private fun times(n: Int): String = when (n) {
        1 -> "once"
        2 -> "twice"
        else -> "$n times"
    }

    /** Port of studentFirstName(): "Jerome Swannack" → "Jerome"; empty → "your student". */
    fun studentFirstName(name: String?): String {
        val trimmed = NoteSearch.jsTrim(name ?: "")
        val end = trimmed.indexOfFirst { NoteSearch.isJsWhitespace(it) }
        val first = if (end < 0) trimmed else trimmed.substring(0, end)
        return first.ifEmpty { "your student" }
    }

    /** Port of removalMenuLabel(), e.g. "Remove from Jerome's decks". */
    fun removalMenuLabel(kind: String, studentName: String?): String =
        "Remove from ${studentFirstName(studentName)}'s ${place(kind)}"

    /** Port of removalUndoLabel(): "Undo — remove from Jerome". */
    fun removalUndoLabel(studentName: String?): String = "Undo — remove from ${studentFirstName(studentName)}"

    /** Port of removalCopy(). */
    fun removalCopy(facts: RemovalFacts, studentName: String?): RemovalCopy {
        val name = studentFirstName(studentName)
        val place = place(facts.kind)
        val title = "Remove “${facts.title}” from $name's $place?"
        val body: String
        val detail: String
        if (facts.copyGone) {
            body = "$name already deleted their copy — nothing is lost."
            detail = "It just leaves your Homework list."
        } else if (facts.kind == DECK) {
            val met = facts.wordsMet ?: 0
            val total = facts.wordsTotal ?: 0
            body = if (met == 0) {
                "$name hasn't started this — nothing is lost."
            } else {
                "$name has met $met of $total words; their progress on these words will be deleted."
            }
            detail = "It disappears from $name's phone on their next sync."
        } else {
            val n = facts.times ?: 0
            val verb = if (facts.kind == LESSON) "done this lesson" else "read this"
            body = if (n == 0) "$name hasn't $verb yet — nothing is lost." else "$name has $verb ${times(n)}; that history will be deleted."
            detail = if (facts.kind == LESSON) {
                "It disappears from $name's phone on their next sync. The lesson stays in your library."
            } else {
                "It disappears from $name's phone on their next sync. Your reader stays."
            }
        }
        return RemovalCopy(
            menuLabel = removalMenuLabel(facts.kind, studentName),
            title = title,
            body = body,
            detail = detail,
            sourceOption = if (facts.kind == DECK && facts.canDeleteSource) "Also delete my copy" else null,
            confirmLabel = "Remove",
        )
    }

    /** Port of removalToast(), e.g. "Removed “HSK 1” from Jerome's decks". */
    fun removalToast(kind: String, title: String, studentName: String?, sourceDeleted: Boolean = false): String {
        val base = "Removed “$title” from ${studentFirstName(studentName)}'s ${place(kind)}"
        return if (sourceDeleted) "$base and deleted your copy" else base
    }
}
