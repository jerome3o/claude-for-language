package dev.jeromeswannack.chineselearning.lab.core

/*
 * Create, then send: what a session-notes job made waits in the tutor's account until she presses
 * "Send to <student>". Port of shared/homework/send.ts — parity-tested (parity/fixtures/homework-send.ts →
 * homework-send.json, HomeworkSendParityTest).
 */

/** The fields of a job result the rule reads (web: JobResultLike). A JS-falsy id ("" or null) counts as absent. */
data class SendJobResult(
    val deck: SendJobDeck? = null,
    val lessons: List<SendJobLesson> = emptyList(),
    val reader: SendJobReader? = null,
)

data class SendJobDeck(val id: String, val name: String, val noteCount: Int, val targetDeckId: String? = null, val removedAt: String? = null)

data class SendJobLesson(val libraryItemId: String, val title: String, val lessonId: String? = null, val removedAt: String? = null)

data class SendJobReader(val id: String, val titleEnglish: String, val targetReaderId: String? = null, val removedAt: String? = null)

/** Web: UnsentItem. */
data class UnsentItem(
    /** "deck" | "lesson:<library_item_id>" | "reader" — what POST …/session-notes/:id/send takes. */
    val key: String,
    /** "deck" | "lesson" | "reader". */
    val kind: String,
    val sourceId: String,
    val title: String,
)

object HomeworkSend {
    /** Port of unsentJobItems(): items still only in the tutor's account — not sent, not taken back, not empty. */
    fun unsentJobItems(result: SendJobResult?): List<UnsentItem> {
        val out = mutableListOf<UnsentItem>()
        val d = result?.deck
        if (d != null && d.noteCount > 0 && d.targetDeckId.isNullOrEmpty() && d.removedAt.isNullOrEmpty()) {
            out += UnsentItem("deck", "deck", d.id, d.name)
        }
        for (l in result?.lessons.orEmpty()) {
            if (l.lessonId.isNullOrEmpty() && l.removedAt.isNullOrEmpty()) {
                out += UnsentItem("lesson:${l.libraryItemId}", "lesson", l.libraryItemId, l.title)
            }
        }
        val r = result?.reader
        if (r != null && r.targetReaderId.isNullOrEmpty() && r.removedAt.isNullOrEmpty()) {
            out += UnsentItem("reader", "reader", r.id, r.titleEnglish)
        }
        return out
    }

    /** Port of sendToLabel(): "Send to Jerome". */
    fun sendToLabel(studentName: String?): String = "Send to ${HomeworkRemoval.studentFirstName(studentName)}"

    /** Port of sendAllLabel(): "Send all 3 to Jerome". */
    fun sendAllLabel(count: Int, studentName: String?): String = "Send all $count to ${HomeworkRemoval.studentFirstName(studentName)}"

    /** Port of sendConfirmText(): the confirm line before a send. */
    fun sendConfirmText(titles: List<String>, studentName: String?): String {
        val name = HomeworkRemoval.studentFirstName(studentName)
        val what = if (titles.size == 1) "\"${titles[0]}\"" else "${titles.size} items (${titles.joinToString(", ") { "\"$it\"" }})"
        return "Send $what to $name as homework? It shows up in their app on their next sync."
    }

    /** Port of sentToast(): the toast after a send. */
    fun sentToast(titles: List<String>, studentName: String?): String {
        val name = HomeworkRemoval.studentFirstName(studentName)
        return if (titles.size == 1) "Sent \"${titles[0]}\" to $name" else "Sent ${titles.size} items to $name"
    }
}
