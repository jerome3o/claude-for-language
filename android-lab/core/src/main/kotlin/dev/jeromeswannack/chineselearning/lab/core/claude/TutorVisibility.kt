package dev.jeromeswannack.chineselearning.lab.core.claude

/**
 * Which of a learner's Claude chats his tutor can read (docs/CHAT.md "Claude threads" → "What your
 * tutor sees"): port of shared/claude/visibility.ts. Parity-tested
 * (parity/fixtures/claude-tutor-visibility.ts → TutorVisibilityParityTest).
 *
 * The account's choice (`users.claude_tutor_visibility`): "card_only" (default) · "all" · "none";
 * one chat's own choice (`tutor_visible`: true / false wins, null = the account's).
 */
object TutorVisibility {
    const val CARD_ONLY = "card_only"
    const val ALL = "all"
    const val NONE = "none"

    /** Port of CLAUDE_TUTOR_VISIBILITIES. */
    val VALUES = listOf(CARD_ONLY, ALL, NONE)

    const val DEFAULT = CARD_ONLY

    /** Port of parseTutorVisibility: null / unknown → the default. */
    fun parse(v: String?): String = if (v != null && v in VALUES) v else DEFAULT

    /** Port of visibleByDefault. */
    fun visibleByDefault(kind: String?, setting: String): Boolean = when (setting) {
        ALL -> true
        NONE -> false
        else -> kind == "card"
    }

    /** Port of tutorCanSee: THE rule. `kind` null = general. */
    fun tutorCanSee(kind: String?, tutorVisible: Boolean?, setting: String): Boolean = when (tutorVisible) {
        true -> true
        false -> false
        null -> visibleByDefault(kind ?: "general", setting)
    }

    /** Port of nextTutorVisible: the value to store when the thread ⋯ toggle is flipped. */
    fun nextTutorVisible(kind: String?, tutorVisible: Boolean?, setting: String): Boolean? {
        val want = !tutorCanSee(kind, tutorVisible, setting)
        return if (want == visibleByDefault(kind ?: "general", setting)) null else want
    }

    /** Port of shareMenuLabel. */
    fun shareMenuLabel(kind: String?, tutorVisible: Boolean?, setting: String): String =
        if (tutorCanSee(kind, tutorVisible, setting)) "🙈 Hide from my tutor" else "👁 Share with my tutor"

    /** Port of sharedLine ("" = she can't read it). */
    fun sharedLine(kind: String?, tutorVisible: Boolean?, setting: String, tutorName: String? = null): String {
        if (!tutorCanSee(kind, tutorVisible, setting)) return ""
        val who = tutorName?.trim()?.ifEmpty { null } ?: "Your tutor"
        return "👁 $who can read this chat"
    }

    data class Option(val id: String, val label: String, val hint: String)

    /** Port of TUTOR_VISIBILITY_OPTIONS. */
    val OPTIONS = listOf(
        Option(CARD_ONLY, "Card questions", "What you ask Claude on a study card. Your other chats with Claude stay private."),
        Option(ALL, "All Claude chats", "Every chat with Claude — card questions, practice role-plays, readers, exercises and plain chats."),
        Option(NONE, "None", "Nothing, unless you share one chat (⋯ → Share with my tutor)."),
    )

    /** Port of TUTOR_VISIBILITY_EXPLAINER. */
    const val EXPLAINER = "Your tutor can read the chats you share, never write in them. A single chat can be shared or hidden from its ⋯ menu."

    /** Port of askedClaudeTodayLabel ("" for none). */
    fun askedClaudeTodayLabel(count: Int): String = if (count <= 0) "" else "✦ Asked Claude ${count}× today"

    /** Port of tutorReadOnlyLine. */
    fun tutorReadOnlyLine(studentName: String?): String {
        val who = studentName?.trim()?.ifEmpty { null } ?: "Your student"
        return "Read only · $who’s chat with Claude — only $who can write in it."
    }

    /** Port of tutorEmptyText: what the student shares — never what he keeps. */
    fun tutorEmptyText(studentName: String?, visibility: String?): String {
        val who = studentName?.trim()?.ifEmpty { null } ?: "The student"
        return when (visibility) {
            ALL -> "$who has not chatted with Claude yet."
            NONE -> "$who keeps their chats with Claude private. They can share a chat with you from its ⋯ menu."
            else -> "$who has not asked Claude about a card yet. Other chats with Claude are private unless they share them."
        }
    }
}
