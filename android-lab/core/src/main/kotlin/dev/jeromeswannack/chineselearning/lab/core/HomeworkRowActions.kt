package dev.jeromeswannack.chineselearning.lab.core

/**
 * The long-press / ⋯ menu on a homework or mini lesson row — port of shared/homework/row-actions.ts,
 * parity-tested (parity/fixtures/row-actions.ts → HomeworkRowActionsParityTest; docs/HOMEWORK.md §3d).
 *
 * Jerome (Oct 2026): "long click on any revision or homework and then opt to remove it or ignore it".
 *  - a revision / his own lesson: Stop revising — done for good (a revisit_events retire, Undo = restore),
 *    Delete lesson (confirmed);
 *  - the tutor's homework: Skip this homework (a `skip` pass event; confirmed — she sees "Skipped by
 *    <student>"; Undo; her item never deleted);
 *  - a lesson with handwriting while the setting is off: Skip handwriting exercises.
 */
object HomeworkRowActions {
    const val DONE_FOR_GOOD = "done_for_good"
    const val DELETE_LESSON = "delete_lesson"
    const val SKIP_HOMEWORK = "skip_homework"
    const val SKIP_HANDWRITING = "skip_handwriting"

    /** Row kinds: "assignment" | "tutor_lesson" | "revision" | "lesson". */
    const val ASSIGNMENT = "assignment"
    const val TUTOR_LESSON = "tutor_lesson"
    const val REVISION = "revision"
    const val LESSON = "lesson"

    /** Port of homeworkRowActions: the menu's actions, in order (empty = no menu). */
    fun actions(kind: String, assignmentId: String?, lessonId: String?, hasHandwriting: Boolean, skipHandwriting: Boolean): List<String> {
        val out = ArrayList<String>()
        if (kind == ASSIGNMENT || kind == TUTOR_LESSON) {
            if (!assignmentId.isNullOrEmpty()) out += SKIP_HOMEWORK
            else if (kind == TUTOR_LESSON && !lessonId.isNullOrEmpty()) { out += DONE_FOR_GOOD; out += DELETE_LESSON }
        } else if (!lessonId.isNullOrEmpty()) {
            out += DONE_FOR_GOOD
            out += DELETE_LESSON
        }
        if (!lessonId.isNullOrEmpty() && hasHandwriting && !skipHandwriting) out += SKIP_HANDWRITING
        return out
    }

    /** Port of homeRowKind: a Home / homework card row's kind by its key. */
    fun homeRowKind(key: String): String = when {
        key.startsWith("revision:") -> REVISION
        key.startsWith("lesson:") -> TUTOR_LESSON
        else -> ASSIGNMENT
    }

    /** Port of homeworkRowActionLabel. */
    fun label(action: String, kind: String): String = when (action) {
        DONE_FOR_GOOD -> if (kind == REVISION) "Stop revising — done for good" else "Done for good — stop showing it"
        DELETE_LESSON -> "Delete lesson"
        SKIP_HOMEWORK -> "Skip this homework"
        SKIP_HANDWRITING -> "Skip handwriting exercises"
        else -> action
    }

    /** Port of homeworkRowActionIcon. */
    fun icon(action: String): String = when (action) {
        DONE_FOR_GOOD -> "✓"
        DELETE_LESSON -> "🗑"
        SKIP_HOMEWORK -> "⏭"
        SKIP_HANDWRITING -> "✍️"
        else -> ""
    }

    /** Port of homeworkRowActionConfirm: the confirm before it happens; null = none. */
    fun confirm(action: String, title: String, tutorName: String?): String? = when (action) {
        SKIP_HOMEWORK -> "Skip “$title”? ${if (tutorName.isNullOrEmpty()) "Your tutor" else tutorName} will see it as skipped. You can undo this."
        DELETE_LESSON -> "Delete “$title”? This can't be undone."
        else -> null
    }

    /** Port of homeworkRowActionToast. */
    fun toast(action: String, tutorName: String?): String = when (action) {
        DONE_FOR_GOOD -> "Done for good — it won't come back"
        DELETE_LESSON -> "Lesson deleted"
        SKIP_HOMEWORK -> "Skipped — ${if (tutorName.isNullOrEmpty()) "your tutor" else tutorName} will see it"
        SKIP_HANDWRITING -> "Handwriting exercises skipped from now on"
        else -> ""
    }

    /** Port of homeworkRowActionUndoable. */
    fun undoable(action: String): Boolean = action != DELETE_LESSON
}
