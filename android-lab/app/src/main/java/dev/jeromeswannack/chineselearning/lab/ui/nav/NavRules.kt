package dev.jeromeswannack.chineselearning.lab.ui.nav

import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto

/*
 * Pure port of the web's navigation rules — keep in step with
 *   frontend/src/components/nav/navRole.ts   (deriveNavRole)
 *   frontend/src/components/nav/tabs.ts      (tabsFor, activeTab, isImmersiveRoute)
 *   frontend/src/components/nav/landing.ts   (resolveLanding, LANDING_PATHS)
 * NavRulesTest mirrors navRole.test.ts / landing.test.ts case by case.
 *
 * The Lab app's navigation speaks the web's paths ("/decks/abc", "/connections/1/chat/2"),
 * so these rules apply to it unchanged (see LabNav.pathOf).
 */

/** What the navigation needs to know about the account. Derived, never stored. */
data class NavRole(
    /** At least one active student → Students tab, Lesson Library, tutor landing. */
    val hasStudents: Boolean = false,
    /** At least one active tutor → Lesson Notes is worth showing. */
    val hasTutor: Boolean = false,
    /** Has students, owns no decks and has nothing due (or is a tutor account). */
    val isTutorOnly: Boolean = false,
    /** False until the relationships have been fetched (or read from the cache). */
    val loaded: Boolean = false,
    /** users.role = 'tutor': the tutor-first app (Students · Chats · Decks · Library · More). */
    val isTutorAccount: Boolean = false,
)

object NavRules {
    val STUDENT_ROLE = NavRole()

    fun deriveNavRole(
        relationships: MyRelationshipsDto?,
        deckCount: Int,
        dueCount: Int,
        countsLoading: Boolean = false,
        accountRole: String? = null,
    ): NavRole {
        val isTutorAccount = accountRole == "tutor"
        if (relationships == null) return STUDENT_ROLE.copy(isTutorAccount = isTutorAccount)
        val hasStudents = relationships.students.any { it.status == "active" }
        val hasTutor = relationships.tutors.any { it.status == "active" }
        return NavRole(
            hasStudents = hasStudents,
            hasTutor = hasTutor,
            isTutorOnly = isTutorAccount || (hasStudents && !countsLoading && deckCount == 0 && dueCount == 0),
            loaded = true,
            isTutorAccount = isTutorAccount,
        )
    }

    // ---------------- tabs ----------------

    // "/today" = the Lab-only "today split" screens (today's lessons / reader; no web route).
    val STUDY = TabSpec(TabId.STUDY, "Study", "/", listOf("/", "/study", "/today"))
    /** The Chats inbox (every conversation, Signal style) — took the Decks tab's place. */
    val CHATS = TabSpec(TabId.CHATS, "Chats", "/chats", listOf("/chats"))
    /** Tutor accounts only (Minghui asked for Decks one tap away); everyone else finds Decks first in More. */
    val DECKS = TabSpec(TabId.DECKS, "Decks", "/decks", listOf("/decks", "/generate", "/search"))
    val STUDENTS = TabSpec(TabId.STUDENTS, "Students", "/connections", listOf("/connections"))
    val LIBRARY = TabSpec(TabId.LIBRARY, "Library", "/library", listOf("/library"))
    val PROGRESS = TabSpec(TabId.PROGRESS, "Progress", "/progress", listOf("/progress"))
    /**
     * A learner's ✦ Claude tab (Jerome, Nov 2026: "it's not obvious enough that you can just ask any
     * question"): a new chat with Claude, 🎤 listening at once. The thread it starts lives in Chats.
     */
    val CLAUDE = TabSpec(TabId.CLAUDE, "Claude", "/claude", listOf("/claude"))
    val MORE = TabSpec(
        TabId.MORE, "More", "/more",
        listOf(
            // The learner's Tutor tab went (Nov 2026): the tutor page is the chat header's name and
            // connections are More → "Tutors & connections", so /connections lights More — except
            // where a Students tab comes first in tabsFor and wins the tie.
            "/more", "/connections", "/settings", "/profile", "/coach", "/analyze", "/readers", "/lessons", "/lesson-notes",
            "/quests", "/picture-hunt", "/idioms", "/meme-review", "/clips", "/audio-lessons", "/podcasts", "/library", "/duplicate-finder", "/admin",
            // Decks live under More since the Chats tab took their tab — except for a tutor
            // account, whose Decks tab comes first in tabsFor and wins the tie.
            "/decks", "/generate", "/search",
        ),
    )

    /**
     * A learner's tabs (web LEARNER_TABS). The Tutor tab went (Jerome, Nov 2026: "it seems like a dud
     * page"); its slot is now ✦ Claude — ask anything, by voice, one tap away.
     */
    val LEARNER_TABS: List<TabSpec> get() = listOf(STUDY, CHATS, CLAUDE, PROGRESS, MORE)

    /**
     * Tutor account (role):   Students · Chats · Decks · Library · More
     * Student account:        Study · Chats · ✦ Claude · Progress · More (LEARNER_TABS)
     * Account with students:  Students · Chats · Study · More (+ Progress if they also study)
     * Decks are also one tap away for everyone: More → Decks, and Home's deck list.
     */
    fun tabsFor(role: NavRole): List<TabSpec> = when {
        role.isTutorAccount -> listOf(STUDENTS, CHATS, DECKS, LIBRARY, MORE)
        !role.hasStudents -> LEARNER_TABS
        role.isTutorOnly -> listOf(STUDENTS, CHATS, STUDY, MORE)
        else -> listOf(STUDENTS, CHATS, STUDY, PROGRESS, MORE)
    }

    /** Which tab is active for a path (the longest matching prefix wins); query strings are ignored. */
    fun activeTab(tabs: List<TabSpec>, path: String): TabId? {
        val pathname = path.substringBefore('?')
        var best: TabId? = null
        var bestLen = -1
        for (tab in tabs) for (prefix in tab.match) {
            val hit = if (prefix == "/") pathname == "/" else pathname == prefix || pathname.startsWith("$prefix/")
            if (hit && prefix.length > bestLen) { best = tab.id; bestLen = prefix.length }
        }
        return best
    }

    /** Routes that take over the whole screen: no tab bar. */
    private val IMMERSIVE = listOf(
        Regex("^/study/?$"),
        Regex("^/quests/[^/]+/?$"),
        Regex("^/picture-hunt/[^/]+/?$"),
        Regex("^/phone/[^/]+/?$"),
        Regex("^/coach/chat/[^/]+(/recap)?/?$"),
        Regex("^/chats/claude/[^/]+(/recap)?/?$"),
        Regex("^/connections/[^/]+/claude/[^/]+/?$"),
        Regex("^/audio-lessons/[^/]+/?$"),
        Regex("^/podcasts/episodes/[^/]+/?$"),
        Regex("^/readers/(?!generate$)[^/]+(/(edit|print|recap))?/?$"),
        Regex("^/library/[^/]+/(edit|print|try)/?$"),
        Regex("^/library/catalogue/[^/]+/?$"),
        Regex("^/decks/[^/]+/try/?$"),
        Regex("^/lessons/[^/]+/(edit|print|play)/?$"),
        Regex("^/coach/[^/]+/lesson/[^/]+/?$"),
        Regex("^/connections/[^/]+/chat(/|$)"),
        Regex("^/join/"),
        Regex("^/calls/[^/]+/?$"),
        Regex("^/homework/[^/]+/?$"),
        Regex("^/tutor-notes/practice/?$"),
        Regex("^/clips(/[^/]+)?/?$"),
        Regex("^/today/(lessons/[^/]+|reader)/?$"), // Lab-only "today split": a lesson / the story from Home
    )

    fun isImmersiveRoute(path: String): Boolean {
        val pathname = path.substringBefore('?')
        return IMMERSIVE.any { it.containsMatchIn(pathname) }
    }

    // ---------------- landing ----------------

    val LANDING_PATHS = mapOf(LandingPage.STUDY to "/", LandingPage.STUDENTS to "/connections", LandingPage.DECKS to "/decks")

    /**
     * Which tab the app opens on: an explicit preference (Settings → "Start on") wins; a tutor
     * account opens on Students; otherwise Students when there are active students and nothing
     * is due, else Study. While counts are loading the answer is Study (no flash).
     */
    fun resolveLanding(pref: LandingPage?, hasStudents: Boolean, dueCount: Int, countsLoading: Boolean, isTutorAccount: Boolean = false): LandingPage {
        if (pref != null) return pref
        if (isTutorAccount) return LandingPage.STUDENTS
        if (countsLoading) return LandingPage.STUDY
        if (hasStudents && dueCount == 0) return LandingPage.STUDENTS
        return LandingPage.STUDY
    }
}

enum class TabId { STUDY, CHATS, CLAUDE, DECKS, STUDENTS, LIBRARY, PROGRESS, MORE }

data class TabSpec(val id: TabId, val label: String, val to: String, val match: List<String>)

enum class LandingPage(val wire: String) {
    STUDY("study"), STUDENTS("students"), DECKS("decks");

    companion object {
        /** `users.landing_page` from /api/auth/me; anything else (null) = automatic. */
        fun fromWire(s: String?): LandingPage? = entries.firstOrNull { it.wire == s }
    }
}
