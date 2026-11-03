package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/chats/personLinks.ts — the chat is the way in to the person on the other side
 * since the learner's Tutor tab went (Nov 2026): the header's name opens their page, the chat ⋯
 * menu lists its parts, and Home announces connection requests. Parity-tested by
 * parity/fixtures/chat-person-links.ts → ChatPersonLinksParityTest.
 */
object ChatPersonLinks {
    data class Link(
        val id: String,
        val icon: String,
        val label: String,
        val desc: String,
        /** An app path without the section (the Lab adds `?section=`, the web `#`). */
        val path: String,
        /** A section of the person's page to scroll to (`homework`, `flags`), or null. */
        val section: String?,
    ) {
        /** The Lab app's path: `/connections/r1?section=homework`. */
        val labPath: String get() = if (section != null) "$path?section=$section" else path
    }

    data class Request(val name: String?, val requesterRole: String?)

    const val CONNECTIONS_TITLE = "Tutors & connections"

    /** Port of personFirstName(): "Minghui Li" → "Minghui"; blank → null. */
    fun firstName(name: String?): String? {
        val first = (name ?: "").trim().split(Regex("(?U)\\s+")).firstOrNull().orEmpty()
        return first.ifEmpty { null }
    }

    /** Port of chatPersonPath(). */
    fun personPath(relationshipId: String?, isAi: Boolean): String? =
        if (isAi || relationshipId.isNullOrEmpty()) null else "/connections/$relationshipId"

    /** Port of chatPersonLinks(). */
    fun links(relationshipId: String?, otherName: String?, viewerRole: String?, isAi: Boolean): List<Link> {
        val page = personPath(relationshipId, isAi) ?: return emptyList()
        val first = firstName(otherName)
        val board = Link("lesson_board", "📝", "Lesson board", "What you wrote together in video lessons", "$page/board", null)
        if (viewerRole == "tutor") {
            return listOf(
                Link("person", "👤", if (first != null) "${first}’s page" else "Student page", "Progress, homework, needs attention", page, null),
                board,
            )
        }
        val who = first ?: "your tutor"
        return listOf(
            Link("person", "👤", "About $who", "Their profile, local time and everything you share", page, null),
            board,
            Link("homework", "📚", "Homework from $who", "What they sent you, to do and done", page, "homework"),
            Link("flags", "🚩", "Cards you flagged", "Cards you asked $who about, with their replies", page, "flags"),
            Link("tutor_notes", "🗒", "Notes from $who", "Comments on your recordings and flagged cards", "/tutor-notes", null),
        )
    }

    /** Port of connectionRequestsLine(). */
    fun requestsLine(requests: List<Request>): String? {
        if (requests.isEmpty()) return null
        if (requests.size > 1) return "🤝 ${requests.size} connection requests"
        val r = requests[0]
        val name = (r.name ?: "").trim().ifEmpty { "Someone" }
        return if (r.requesterRole == "tutor") "🤝 $name wants to be your tutor" else "🤝 $name wants you to be their tutor"
    }
}
