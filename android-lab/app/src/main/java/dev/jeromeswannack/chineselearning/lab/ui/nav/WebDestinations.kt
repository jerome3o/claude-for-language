package dev.jeromeswannack.chineselearning.lab.ui.nav

/**
 * Every screen of the web app (frontend/src/App.tsx), with the words the placeholder and the
 * More tab show for it and the PARITY.md work package that owns its native port.
 * A path is matched against [pattern] (":x" = one segment); the first match wins, so more
 * specific patterns come first.
 */
data class WebDestination(
    val pattern: String,
    val title: String,
    val emoji: String,
    /** One line: what the screen is for (shown on the placeholder). */
    val blurb: String,
    /** PARITY.md work package: A–J. */
    val pkg: Char,
)

object WebDestinations {
    val ALL: List<WebDestination> = listOf(
        // A / B — study
        WebDestination("/study/review/:id", "Session review", "🧾", "Every card of a past session with your answers.", 'D'),
        WebDestination("/study", "Study", "🃏", "Today's cards, lessons and story.", 'A'),
        WebDestination("/homework/:id", "Homework pass", "✅", "Go through one piece of homework once, by its due date.", 'E'),
        WebDestination("/homework", "Homework", "✅", "One-off practice from your tutor, with due dates.", 'E'),
        // C — decks
        WebDestination("/decks/:id/try", "Try it as a student", "▶️", "Go through a deck as a student sees it — nothing is recorded.", 'C'),
        WebDestination("/decks/:id", "Deck", "🗂️", "Words, history, settings, paste a list, send to a student.", 'C'),
        WebDestination("/decks", "Decks", "🗂️", "Your deck queue, search and every word.", 'C'),
        WebDestination("/generate", "Generate with Claude", "✨", "Describe a topic and get a full deck.", 'C'),
        WebDestination("/search", "Search", "🔍", "Find any card across your decks.", 'C'),
        WebDestination("/cards/:noteId", "Card", "🃏", "One word: its cards, flags, Claude chats and reviews.", 'C'),
        // D — progress & settings
        WebDestination("/progress/day/:date/card/:cardId", "Card on a day", "📈", "One card's reviews on one day.", 'D'),
        WebDestination("/progress/day/:date", "Day", "📈", "Everything you reviewed on one day.", 'D'),
        WebDestination("/progress", "Progress", "📈", "Cards mastered, % through each deck, daily reviews.", 'D'),
        WebDestination("/settings/sentences", "Sentence coverage", "💬", "Example-sentence generation status.", 'D'),
        WebDestination("/settings", "Settings", "⚙️", "Study budget, start on, offline audio, backup.", 'D'),
        WebDestination("/duplicate-finder", "Duplicate finder", "🪞", "Words that appear in more than one deck.", 'D'),
        // E / F — tutor & teaching
        WebDestination("/connections/:relId/chat/:convId", "Chat", "💬", "Messages with your tutor or student.", 'E'),
        WebDestination("/connections/:relId/homework/:jobId", "Homework draft", "📝", "Review the homework Claude drafted from your lesson notes.", 'F'),
        WebDestination("/connections/:relId/session-notes", "Session notes", "📝", "Lesson notes turned into homework.", 'F'),
        WebDestination("/connections/:relId/insights", "Insights", "🔎", "Before a lesson: what needs attention, what's going well.", 'F'),
        WebDestination("/connections/:relId/history", "Review history", "🕘", "Every review your student made, with filters.", 'F'),
        WebDestination("/connections/:relId/recordings", "Recordings", "🎤", "Your student's pronunciation, to mark.", 'F'),
        WebDestination("/connections/:relId/progress/day/:date/card/:cardId", "Card on a day", "📈", "One card's reviews on one day.", 'F'),
        WebDestination("/connections/:relId/progress/day/:date", "Student's day", "📈", "Everything your student reviewed on one day.", 'F'),
        WebDestination("/connections/:relId/progress", "Student progress", "📈", "Your student's day-by-day progress.", 'F'),
        WebDestination("/connections/:relId/shared-decks/:id/progress", "Homework deck progress", "📊", "Per-word mastery of a deck you sent.", 'F'),
        WebDestination("/connections/:relId/student-shared-decks/:id/progress", "Shared deck progress", "📊", "Progress on a deck your student shared.", 'F'),
        WebDestination("/connections/:relId/cards/:noteId", "Student's card", "🃏", "One of your student's words: cards, flags, Claude chats.", 'F'),
        WebDestination("/connections/:relId/claude-chats", "Asked Claude", "💬", "What your student asked Claude about their cards.", 'F'),
        WebDestination("/connections/:relId/lesson-attempts/:attemptId", "Lesson attempt", "🎓", "Your student's answers in one lesson.", 'F'),
        WebDestination("/connections/:relId/lesson-attempts", "Lesson attempts", "🎓", "Your student's answers, exercise by exercise.", 'F'),
        WebDestination("/connections/:relId", "Connection", "👤", "Your tutor, or a student's page.", 'E'),
        WebDestination("/connections", "Tutor", "👥", "Your tutor and students, messages and homework.", 'E'),
        WebDestination("/claude-chats", "Claude conversations", "💬", "Everything you asked Claude about your cards.", 'E'),
        WebDestination("/lesson-notes", "Lesson notes", "📝", "Notes from lessons, for readers and sentences.", 'E'),
        // G — library & editors, B — lessons & readers
        WebDestination("/library/catalogue/:sampleId", "Sample lesson", "🧭", "Try one exercise type as a student.", 'G'),
        WebDestination("/library/catalogue", "Exercise catalogue", "🧭", "Every exercise type, with sample lessons to try.", 'G'),
        WebDestination("/library/:id/edit", "Lesson editor", "✏️", "Edit a lesson with Claude beside you.", 'G'),
        WebDestination("/library/:id/print", "Print lesson", "🖨️", "A printable lesson with its answer key.", 'G'),
        WebDestination("/library/:id/try", "Try a lesson", "▶️", "Take a lesson as a student — nothing is recorded.", 'G'),
        WebDestination("/library/:id", "Library lesson", "🗂️", "Assign, push updates, see who did it.", 'G'),
        WebDestination("/library", "Lesson Library", "🗂️", "Mini lessons you assign to students.", 'G'),
        WebDestination("/lessons/:id/edit", "Lesson editor", "✏️", "Edit a lesson.", 'G'),
        WebDestination("/lessons/:id/print", "Print lesson", "🖨️", "A printable lesson.", 'G'),
        WebDestination("/lessons", "Mini Lessons", "🎓", "Lessons made for you, mixed into study.", 'B'),
        WebDestination("/lesson-attempts/:attemptId", "My answers", "🎓", "Your answers in one lesson.", 'B'),
        WebDestination("/lesson-attempts", "My answers", "🎓", "Your lesson answers, exercise by exercise.", 'B'),
        WebDestination("/readers/generate", "New story", "📚", "Have Claude write a story from your words.", 'B'),
        WebDestination("/readers/new/edit", "New reader", "📚", "Write a reader by hand.", 'G'),
        WebDestination("/readers/:id/edit", "Reader editor", "✏️", "Edit a story with Claude beside you.", 'G'),
        WebDestination("/readers/:id/print", "Print reader", "🖨️", "A printable story with its glossary.", 'G'),
        WebDestination("/readers/:id", "Reader", "📖", "A short story at your level.", 'B'),
        WebDestination("/readers", "Readers", "📚", "Short stories at your level.", 'B'),
        // H — practice
        WebDestination("/coach", "Sentence Coach", "🧑‍🏫", "Check a sentence you wrote, or translate one.", 'H'),
        WebDestination("/analyze", "Sentence Breakdown", "🔍", "Split any sentence into words.", 'H'),
        WebDestination("/quests/:id", "Quest", "🎮", "Carry out Chinese instructions in a tiny world.", 'H'),
        WebDestination("/quests", "Quests", "🎮", "Carry out instructions in a tiny world.", 'H'),
        WebDestination("/practice/strokes", "Write characters", "✍️", "Stroke order, checked stroke by stroke.", 'H'),
        // J — calls
        WebDestination("/calls/:id/review", "Call review", "📹", "Transcript, lesson report and flashcards.", 'J'),
        WebDestination("/calls/:id", "Video call", "📹", "A live lesson with a whiteboard.", 'J'),
        WebDestination("/calls", "Video calls", "📹", "Lessons with a whiteboard, then a transcript.", 'J'),
        // web / MCP only
        WebDestination("/admin", "Admin", "🛠️", "Users, invites, feature requests.", '-'),
        WebDestination("/join/:token", "Invite", "✉️", "Accept an invite link.", '-'),
        WebDestination("/more", "More", "☰", "Everything else.", '-'),
        WebDestination("/", "Study", "🃏", "Today's cards.", 'A'),
    )

    /** The destination a concrete path belongs to, or null for an unknown path. */
    fun find(path: String): WebDestination? {
        val parts = split(path)
        return ALL.firstOrNull { d ->
            val pat = split(d.pattern)
            pat.size == parts.size && pat.zip(parts).all { (p, s) -> p.startsWith(":") || p == s }
        }
    }

    private fun split(path: String) = path.substringBefore('?').trim('/').split('/').filter { it.isNotEmpty() }
}
