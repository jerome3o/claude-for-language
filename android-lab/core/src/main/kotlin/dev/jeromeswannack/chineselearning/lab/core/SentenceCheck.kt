package dev.jeromeswannack.chineselearning.lab.core

import java.util.Locale

/**
 * Port of shared/lesson/sentenceCheck.ts — Claude's grade of a sentence the learner MADE (sentence_making;
 * docs/STUDY_SESSION.md "Sentence making: an honest verdict"): right (✓ green) · needs_work (≈ orange: the target words
 * used right, something else off) · wrong (✗ red: a target word misused or missing); the coherence guard (a ✓ whose
 * own words name a problem is needs_work); one headline, at most one reason, More ▸; ✨ Show a fixed version on tap.
 * Parity-tested by parity/fixtures/sentence-check.ts → SentenceCheckParityTest.
 */
object SentenceCheck {
    const val CHECK_VERSION = 2
    const val FIX_VERSION = 1
    val GRADES = listOf("right", "needs_work", "wrong")

    const val TRY_AGAIN_LABEL = "Try again"
    const val SHOW_FIX_LABEL = "Show a fixed version"
    const val FIX_LABEL = "Fixed"
    const val SAY_FIX_LABEL = "Say it"
    const val MORE_LABEL = "More"
    const val EXAMPLE_TOGGLE = "Example sentence"
    const val FIXING_LINE = "Fixing your sentence…"
    const val FIX_OFFLINE = "A fixed version needs a connection — try again when you’re online."
    const val FIX_FAILED = "Claude couldn’t fix this one — try saying it another way."
    const val RETRY_OFFLINE = "Claude can’t check it offline — compare it with the example."
    const val RETRY_NOTE = "Practice — your first answer is the one that counts"
    const val SELF_CHECK = "Is your sentence grammatical, and does it use every word?"
    const val SELF_CHECK_HANDWRITTEN = "Compare with the example — is your sentence right, and does it use every word?"
    const val RIGHT_HEADLINE = "Natural and correct"
    const val MISSING_WORD_HEADLINE = "Use every target word"
    const val WRONG_HEADLINE = "Not quite — check how the target words are used"

    private const val LIMIT_HEADLINE = 100
    private const val LIMIT_LINE = 110

    data class Chip(val icon: String, val tone: String, val label: String)

    fun chip(grade: String): Chip = when (grade) {
        "right" -> Chip("✓", "good", "Right")
        "needs_work" -> Chip("≈", "warn", "Nearly")
        else -> Chip("✗", "bad", "Not quite")
    }

    fun targetWordsPhrase(words: List<String>): String {
        val ws = words.map { NoteSearch.jsTrim(it) }.filter { it.isNotEmpty() }
        if (ws.isEmpty() || ws.size > 3) return "The target words"
        if (ws.size == 1) return ws[0]
        return "${ws.dropLast(1).joinToString(", ")} and ${ws.last()}"
    }

    fun needsWorkHeadline(words: List<String>): String = "${targetWordsPhrase(words)} used right — one thing to fix"

    // ============ The coherence guard ============

    private fun w(words: String) = "(?<![A-Za-z0-9_])(?:$words)(?![A-Za-z0-9_])"
    private const val WS = AnswerKey.JS_WS

    private val PRAISE = Regex(w(listOf(
        "nothing to (?:fix|change|correct)", "no need to (?:fix|change)", "no (?:real )?(?:mistakes?|errors?|problems?|issues?|fix(?:es)?)",
        "not (?:wrong|a mistake|an error)", "without (?:any )?(?:mistakes?|errors?)", "nothing wrong", "can.t fault",
    ).joinToString("|")), RegexOption.IGNORE_CASE)

    private val PROBLEM = Regex(w(listOf(
        "but", "however", "though", "although", "should", "shouldn.t", "instead", "usually", "normally", "typically",
        "rather than", "better", "more natural", "more common", "more idiomatic", "unnatural", "awkward", "odd", "strange",
        "wrong", "incorrect", "mistake", "mistakes", "error", "missing", "typo", "doesn.t", "does not", "isn.t", "is not",
        "not quite", "needs", "need to", "fix", "replace", "change", "confusing", "unclear", "contrived", "illogical",
        "doesn.t follow", "mismatch", "misused", "overused",
    ).joinToString("|")), RegexOption.IGNORE_CASE)

    /** Port of namesProblem(). */
    fun namesProblem(text: String?): Boolean = PROBLEM.containsMatchIn(PRAISE.replace(text ?: "", " "))

    private val LEAD = Regex("^(?:${w("but|however|though|although|yet|and|so")})[ ,，]*", RegexOption.IGNORE_CASE)
    private val CLAUSE_SPLIT = Regex("(?<=[.!?。！？])[$WS]+|[;；][$WS]*")

    /** Port of explanationClauses(). */
    fun explanationClauses(text: String?): List<String> =
        (text ?: "").split(CLAUSE_SPLIT).map { NoteSearch.jsTrim(it) }.filter { it.isNotEmpty() }

    /** Port of problemClause(). */
    fun problemClause(text: String?): String? {
        for (c in explanationClauses(text)) {
            if (!namesProblem(c)) continue
            val s = NoteSearch.jsTrim(LEAD.replace(c, ""))
            if (s.isEmpty()) continue
            return s.substring(0, 1).uppercase(Locale.ROOT) + s.substring(1)
        }
        return null
    }

    /** Port of guardSentenceGrade(). */
    fun guardGrade(grade: String, lines: List<String?>, usesAllWords: Boolean): String {
        if (!usesAllWords) return "wrong"
        if (grade == "right" && lines.any { namesProblem(it) }) return "needs_work"
        return grade
    }

    /** Port of legacyGrade(). */
    fun legacyGrade(verdict: String?, usesAllWords: Boolean): String = when {
        !usesAllWords -> "wrong"
        verdict == "correct" -> "right"
        verdict == "minor" -> "needs_work"
        else -> "wrong"
    }

    private val COLLAPSE = Regex("[$WS]+")
    private val FIRST_SENTENCE = Regex("^.+?[.!?。！？](?=[$WS]|$)")
    private val TAIL = Regex("[$WS,，;；:：—-]+$")
    private fun cps(s: String): Int = s.codePointCount(0, s.length)
    private fun cpTake(s: String, n: Int): String = s.substring(0, s.offsetByCodePoints(0, minOf(n, cps(s))))

    /** Port of sentenceLine(): the first sentence, cut at a comma / space when too long. */
    fun sentenceLine(text: String?, max: Int = LIMIT_LINE): String {
        val t = NoteSearch.jsTrim(COLLAPSE.replace(text ?: "", " "))
        if (t.isEmpty()) return ""
        val s = NoteSearch.jsTrim(FIRST_SENTENCE.find(t)?.value ?: t)
        if (cps(s) <= max) return s
        val head = cpTake(s, max - 1)
        val comma = maxOf(head.lastIndexOf(", "), head.lastIndexOf('，'))
        val space = head.lastIndexOf(' ')
        val at = if (comma * 2 >= head.length) comma else if (space > 0) space else head.length
        return TAIL.replace(head.substring(0, at), "") + "…"
    }

    data class View(
        val grade: String,
        val icon: String,
        val tone: String,
        val label: String,
        val headline: String,
        val reason: String,
        val more: String,
        val fixable: Boolean,
        val right: Boolean,
        val downgraded: Boolean,
    )

    private fun same(a: String, b: String) =
        NoteSearch.jsTrim(COLLAPSE.replace(a, " ")).lowercase(Locale.ROOT) == NoteSearch.jsTrim(COLLAPSE.replace(b, " ")).lowercase(Locale.ROOT)

    /** Port of sentenceCheckView(): a check (v2, or v1) → what to show. Idempotent on a normalised check. */
    fun view(f: SentenceFeedback, words: List<String>): View {
        val legacy = f.grade.isNullOrEmpty()
        val given = if (!legacy && f.grade in GRADES) f.grade!! else legacyGrade(f.verdict, f.usesAllWords)
        val headline0 = NoteSearch.jsTrim(f.headline ?: "")
        val reason0 = NoteSearch.jsTrim(if (legacy) f.comment else f.reason ?: "")
        val more0 = NoteSearch.jsTrim(f.more ?: "")
        val grade = guardGrade(given, listOf(headline0, reason0, more0), f.usesAllWords)
        val downgraded = grade != given
        var headline = headline0
        var reason = reason0
        if (!f.usesAllWords && (given != "wrong" || headline0.isEmpty())) {
            headline = MISSING_WORD_HEADLINE
        } else if (downgraded || headline.isEmpty()) {
            headline = when (grade) {
                "right" -> RIGHT_HEADLINE
                "needs_work" -> if (headline0.isNotEmpty() && namesProblem(headline0)) headline0 else needsWorkHeadline(words)
                else -> headline0.ifEmpty { WRONG_HEADLINE }
            }
        }
        if (downgraded && grade == "needs_work") reason = problemClause(reason0) ?: problemClause(more0) ?: reason0
        val headLine = sentenceLine(headline, LIMIT_HEADLINE)
        val reasonLine = sentenceLine(reason)
        val fuller = mutableListOf<String>()
        fun pushMore(t: String) {
            if (t.isNotEmpty() && !same(t, headLine) && !same(t, reasonLine) && fuller.none { same(it, t) }) fuller += t
        }
        if (reason0.isNotEmpty() && !same(reason0, reasonLine)) pushMore(reason0)
        pushMore(more0)
        val c = chip(grade)
        return View(
            grade = grade, icon = c.icon, tone = c.tone, label = c.label,
            headline = headLine,
            reason = if (same(reasonLine, headLine)) "" else reasonLine,
            more = fuller.joinToString(" "),
            fixable = grade != "right" && f.fixable != false,
            right = grade == "right",
            downgraded = downgraded,
        )
    }
}
