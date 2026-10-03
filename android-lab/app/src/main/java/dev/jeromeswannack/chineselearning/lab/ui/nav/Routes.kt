package dev.jeromeswannack.chineselearning.lab.ui.nav

import android.net.Uri

/**
 * Typed helpers for every web route. The Lab app navigates with the web app's own paths
 * (`nav.open(Routes.deck(id))` → "/decks/abc"): a path with a native screen opens it, any
 * other path opens a placeholder that hands off to the main app at the same route. So a
 * link written today keeps working when the native screen lands later.
 *
 * Adding a native screen: register its pattern in your feature's `<Feature>Nav.kt`
 * (`composable(route("/decks/{id}")) { … }`), keeping the web's shape; add a helper here
 * only if none exists yet. Keep the list in the web's order (frontend/src/App.tsx).
 */
object Routes {
    const val HOME = "/"
    const val DECKS = "/decks"
    const val MORE = "/more"
    const val SETTINGS = "/settings"
    const val PROGRESS = "/progress"
    const val CONNECTIONS = "/connections"
    const val LIBRARY = "/library"
    /** The Chats tab inbox. */
    const val CHATS = "/chats"

    // ---- study & home (packages A, B) ----
    fun study(deckId: String? = null) = "/study" + query("deck" to deckId)
    fun homework() = "/homework"
    fun homeworkPass(id: String) = "/homework/${seg(id)}"
    /** Lab-only "today split" (no web route): today's mini lessons, one of them, today's story. */
    fun todayLessons() = "/today/lessons"
    fun todayLesson(id: String) = "/today/lessons/${seg(id)}"
    fun todayReader() = "/today/reader"
    fun tutorNotes() = "/tutor-notes"
    /** Practise the cards a tutor left notes on (a focused mini session; ids comma-separated). */
    fun tutorNotesPractice(cardIds: List<String>, noteIds: List<String>) =
        "/tutor-notes/practice" + query("cards" to cardIds.joinToString(","), "notes" to noteIds.joinToString(","))

    // ---- decks (package C) ----
    fun decks(q: String? = null) = DECKS + query("q" to q)
    fun deck(id: String) = "/decks/${seg(id)}"
    fun deckTry(id: String) = "/decks/${seg(id)}/try"
    fun generate() = "/generate"
    fun cardHub(noteId: String) = "/cards/${seg(noteId)}"

    // ---- progress & settings (package D) ----
    fun progressDay(date: String) = "/progress/day/${seg(date)}"
    fun progressCard(date: String, cardId: String) = "/progress/day/${seg(date)}/card/${seg(cardId)}"
    fun sessionReview(id: String) = "/study/review/${seg(id)}"
    fun sentenceCoverage() = "/settings/sentences"
    fun conversationVoices() = "/settings/voices"
    fun profile() = "/profile"
    fun duplicateFinder() = "/duplicate-finder"

    // ---- tutor tab for students (package E) ----
    fun connection(relId: String) = "/connections/${seg(relId)}"
    fun chat(relId: String, convId: String) = "/connections/${seg(relId)}/chat/${seg(convId)}"
    /** THE chat with the person of a relationship (one chat per pair; resolved by `/conversations/open`). */
    fun theChat(relId: String) = "/connections/${seg(relId)}/chat"
    fun claudeChats() = "/claude-chats"
    fun lessonNotes() = "/lesson-notes"

    // ---- teaching (package F) ----
    fun studentProgress(relId: String) = "/connections/${seg(relId)}/progress"
    fun insights(relId: String) = "/connections/${seg(relId)}/insights"
    fun studentHistory(relId: String) = "/connections/${seg(relId)}/history"
    fun recordings(relId: String) = "/connections/${seg(relId)}/recordings"
    fun sessionNotes(relId: String) = "/connections/${seg(relId)}/session-notes"
    fun homeworkDraft(relId: String, jobId: String) = "/connections/${seg(relId)}/homework/${seg(jobId)}"
    fun studentCardHub(relId: String, noteId: String) = "/connections/${seg(relId)}/cards/${seg(noteId)}"
    fun studentClaudeChats(relId: String) = "/connections/${seg(relId)}/claude-chats"
    fun studentLessonAttempts(relId: String, attemptId: String? = null) =
        "/connections/${seg(relId)}/lesson-attempts" + (attemptId?.let { "/${seg(it)}" } ?: "")

    // ---- library, editors, lessons, readers (packages B, G) ----
    fun libraryItem(id: String) = "/library/${seg(id)}"
    fun libraryEdit(id: String) = "/library/${seg(id)}/edit"
    fun libraryTry(id: String) = "/library/${seg(id)}/try"
    fun catalogue() = "/library/catalogue"
    fun catalogueTrial(sampleId: String) = "/library/catalogue/${seg(sampleId)}"
    fun lessons() = "/lessons"
    fun lessonEdit(id: String) = "/lessons/${seg(id)}/edit"
    fun lessonAttempts(attemptId: String? = null) = "/lesson-attempts" + (attemptId?.let { "/${seg(it)}" } ?: "")
    fun readers() = "/readers"
    fun reader(id: String) = "/readers/${seg(id)}"
    fun readerEdit(id: String) = "/readers/${seg(id)}/edit"

    // ---- practice (package H) ----
    /** [focus] (`?focus=1`): open with the sentence box focused and the keyboard up (the widget's ✏️). */
    /** [draft] (`?draft=`): fill the sentence box without sending it (study card ⋯ → Sentence coach). */
    fun coach(text: String? = null, focus: Boolean = false, draft: String? = null) =
        "/coach" + query("text" to text, "draft" to draft, "focus" to (if (focus) "1" else null))
    fun analyze() = "/analyze"
    fun quests() = "/quests"
    fun quest(id: String) = "/quests/${seg(id)}"
    fun pictureHunts() = "/picture-hunt"
    fun pictureHunt(id: String) = "/picture-hunt/${seg(id)}"
    fun strokes(text: String? = null) = "/practice/strokes" + query("text" to text)

    // ---- calls (package J) ----
    fun calls() = "/calls"
    fun call(id: String) = "/calls/${seg(id)}"
    fun callReview(id: String) = "/calls/${seg(id)}/review"
    /** The relationship's lesson board outside a call (board pages, read-only). */
    fun lessonBoard(relId: String) = "/connections/${seg(relId)}/board"
    /** Lesson materials (calls round 4 PR 5): the list and one material page by page. */
    fun materials() = "/materials"
    fun material(id: String) = "/materials/${seg(id)}"

    fun admin() = "/admin"

    // ---------------- path ↔ navigation route ----------------

    /**
     * The Navigation-Compose route pattern for a web path pattern: "/decks/{id}" → "decks/{id}",
     * "/" → "home". Use it when registering: `composable(route("/decks/{id}")) { … }`.
     */
    fun route(webPattern: String): String = if (webPattern == "/" || webPattern.isEmpty()) HOME_ROUTE else webPattern.removePrefix("/")

    /** The concrete navigation route for a concrete web path ("/decks/abc?x=1" → "decks/abc?x=1"). */
    fun routeForPath(path: String): String = when {
        path.isEmpty() || path == "/" -> HOME_ROUTE
        path.startsWith("/?") -> HOME_ROUTE
        else -> path.removePrefix("/")
    }

    /** The Navigation route of the "not native yet" screen (package-free: see ui/placeholder). */
    const val PLACEHOLDER_ROUTE = "lab-placeholder?path={path}"
    fun placeholder(path: String) = "lab-placeholder?path=${Uri.encode(path)}"
    const val HOME_ROUTE = "home"
    /** The study session's navigation route (single-instance: LabNav.openStudy). */
    const val STUDY_ROUTE = "study?deck={deck}"

    /** Path segment encoder (keeps ids with odd characters routable). */
    fun seg(s: String): String = Uri.encode(s)

    private fun query(vararg pairs: Pair<String, String?>): String {
        val present = pairs.filter { it.second != null }
        if (present.isEmpty()) return ""
        return "?" + present.joinToString("&") { (k, v) -> "$k=${Uri.encode(v)}" }
    }
}
