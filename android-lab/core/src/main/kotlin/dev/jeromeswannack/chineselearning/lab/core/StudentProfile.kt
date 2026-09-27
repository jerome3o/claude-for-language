package dev.jeromeswannack.chineselearning.lab.core

/*
 * The tutor's private profile of a student: what kind of learner they are and what homework
 * suits them. One per tutor relationship, written by the tutor, never shown to the student;
 * every agent that makes homework / lessons / readers / cards for the student reads it.
 * Port of shared/students/profile.ts (validation, chips, examples, "use / insert an example")
 * — parity-tested (parity/fixtures/student-profile.ts → student-profile.json).
 */

/** What the tutor writes (web: StudentProfileFields). [level] is one of [StudentProfile.LEVELS] or null. */
data class StudentProfileFields(
    val body: String = "",
    val level: String? = null,
    /** Writes characters by hand? null = not said. */
    val handwriting: Boolean? = null,
    /** New words (cards) a lesson's homework aims for. null = not said. */
    val wordsPerLesson: Int? = null,
)

data class StudentProfileExample(val id: String, val title: String, val summary: String, val profile: StudentProfileFields)

object StudentProfile {
    const val MAX_CHARS = 8000
    const val MAX_WORDS_PER_LESSON = 100

    val LEVELS = listOf("beginner", "elementary", "intermediate", "advanced")
    val LEVEL_LABELS = mapOf("beginner" to "Beginner", "elementary" to "Elementary", "intermediate" to "Intermediate", "advanced" to "Advanced")

    val EMPTY = StudentProfileFields()

    fun isLevel(v: String?): Boolean = v != null && v in LEVELS

    /** Port of normalizeProfileBody: CRLF / CR → LF, then JS trim. */
    fun normalizeBody(body: String): String = NoteSearch.jsTrim(body.replace(Regex("\r\n?"), "\n"))

    /** Port of isStudentProfileEmpty. */
    fun isEmpty(p: StudentProfileFields?): Boolean =
        p == null || (NoteSearch.jsTrim(p.body).isEmpty() && p.level == null && p.handwriting == null && p.wordsPerLesson == null)

    /**
     * Port of parseStudentProfileInput for what the editor can produce (typed fields): the
     * normalised value, or the problems (same wording as the server's 400).
     */
    fun validate(p: StudentProfileFields): Pair<StudentProfileFields?, List<String>> {
        val problems = mutableListOf<String>()
        val body = normalizeBody(p.body)
        if (body.length > MAX_CHARS) problems += "body is ${thousands(body.length)} characters — the limit is ${thousands(MAX_CHARS)}"
        val level = p.level?.takeIf { it.isNotEmpty() }
        if (level != null && !isLevel(level)) problems += "level must be one of ${LEVELS.joinToString(", ")}"
        val words = p.wordsPerLesson
        if (words != null && (words < 1 || words > MAX_WORDS_PER_LESSON)) problems += "words_per_lesson must be a whole number from 1 to $MAX_WORDS_PER_LESSON"
        if (problems.isNotEmpty()) return null to problems
        return StudentProfileFields(body, level, p.handwriting, words) to problems
    }

    private fun thousands(n: Int): String = "%,d".format(java.util.Locale.US, n)

    /** Port of studentProfileChips: the short form on the profile card. */
    fun chips(p: StudentProfileFields): List<String> = buildList {
        p.level?.let { LEVEL_LABELS[it] }?.let { add(it) }
        if (p.handwriting == true) add("Writes by hand")
        if (p.handwriting == false) add("No handwriting")
        p.wordsPerLesson?.let { add("~$it new words / lesson") }
    }

    /** Port of applyStudentProfileExample: empty → the example whole; else append the text, fill unset fields. */
    fun applyExample(current: StudentProfileFields, example: StudentProfileFields): StudentProfileFields {
        if (isEmpty(current)) return example
        val body = normalizeBody(current.body)
        return StudentProfileFields(
            body = if (body.isNotEmpty()) "$body\n\n${example.body}" else example.body,
            level = current.level ?: example.level,
            handwriting = current.handwriting ?: example.handwriting,
            wordsPerLesson = current.wordsPerLesson ?: example.wordsPerLesson,
        )
    }

    /** Port of sameStudentProfile (the editor's "unsaved changes"). */
    fun same(a: StudentProfileFields, b: StudentProfileFields): Boolean =
        normalizeBody(a.body) == normalizeBody(b.body) && a.level == b.level && a.handwriting == b.handwriting && a.wordsPerLesson == b.wordsPerLesson

    /** STUDENT_PROFILE_HINTS: what else is worth writing down. */
    val HINTS = listOf(
        "Level and goals (an exam, work, family, travel)",
        "Which kinds of homework work — and which don't",
        "How much per lesson, and their pace",
        "Writes characters by hand or not",
        "Interests, for reader topics",
        "Weak spots (tones, measure words, 了…)",
    )

    /** STUDENT_PROFILE_EXAMPLES — Minghui's three kinds of student, as profile text to start from. */
    val EXAMPLES = listOf(
        StudentProfileExample(
            id = "adult-beginner",
            title = "Adult beginner, no handwriting",
            summary = "Listening first, 10–30 cards a lesson, radicals, own sentences, grammar, readers",
            profile = StudentProfileFields(
                level = "beginner",
                handwriting = false,
                wordsPerLesson = 15,
                body = """Adult, complete beginner. Learning for travel and to talk with his partner's family. Doesn't want to write characters by hand — reading and typing only.

**Homework that works for him**
- Listening first: audio for every new word, so he hears the tones before he reads them.
- 10–30 flashcards per lesson, never more. Mastery over volume — he gets discouraged when the pile grows, so keep the most useful words and leave the rest for next time.
- Reading with the correct tones: example sentences with audio.
- Radicals: point out the radical and what it hints at (氵 water, 口 mouth) — that is how he remembers characters.
- Making his own sentences with the new words (typed).
- A short grammar mini lesson when we covered a structure.
- Graded readers at his level. Likes food, travel and football.

**Weak spots**: 2nd vs 3rd tone; measure words.
**Pace**: about 20 minutes a day, on the train.""",
            ),
        ),
        StudentProfileExample(
            id = "child-writer",
            title = "Child beginner, learning to write",
            summary = "Everything above plus stroke-order writing and dictation next class",
            profile = StudentProfileFields(
                level = "beginner",
                handwriting = true,
                wordsPerLesson = 10,
                body = """9 years old, beginner. Studies with a parent next to her. She is learning to write characters, so writing practice is part of every week.

**Homework that works for her**
- Audio for every new word — she copies the pronunciation well.
- About 10 flashcards per lesson: short sessions, lots of encouragement.
- Stroke-order writing practice: she writes each new character 5–10 times. We do a dictation of those characters at the start of the next class.
- Radicals, explained simply ("氵 means water").
- Make one sentence with each new word.
- A very short grammar mini lesson when we learned a pattern.
- Graded readers with pictures — she loves animals, school stories and her cat 小白.

**Keep in mind**: instructions in simple English; no more than 10 minutes of writing at a time.""",
            ),
        ),
        StudentProfileExample(
            id = "intermediate-writing",
            title = "Intermediate / advanced",
            summary = "Writing in real formats, oral recordings, listening practice",
            profile = StudentProfileFields(
                level = "intermediate",
                handwriting = true,
                wordsPerLesson = 20,
                body = """Upper-intermediate (around HSK 4). Works for a Chinese company and needs formal written and spoken Chinese.

**Homework that works for him**
- Writing assignments in real formats: letters, emails, invitations, short speeches (150–300 characters). He handwrites and uploads a photo, or types.
- Oral expression: record a 1–2 minute answer on the topic of the lesson so I can listen and correct it.
- Listening practice: conversations at natural speed with comprehension questions.
- Flashcards only for new, useful vocabulary and set phrases (成语 when they come up) — 15–20 per lesson.
- Graded readers at intermediate level: business, current affairs, Chinese history.

**Weak spots**: 了 vs 过; formal register (您, 贵公司, 此致敬礼).
**Goal**: HSK 5 next spring.""",
            ),
        ),
    )
}
