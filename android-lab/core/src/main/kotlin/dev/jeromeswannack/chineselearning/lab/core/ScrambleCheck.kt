package dev.jeromeswannack.chineselearning.lab.core

/*
 * Port of shared/lesson/scrambleCheck.ts — a word order (scramble) built in an order the lesson didn't list
 * is checked by Claude (docs/STUDY_SESSION.md "Claude checks your answer" → "Word order"): the correct order /
 * an alt_orders entry is right on the device; every tile in ANOTHER order goes to the lesson answer check
 * (exercise type `scramble`) while the banner says "Checking…" in place; correct / acceptable → "✓ Also right"
 * (scored right), almost / wrong → "✗ Not quite" + Claude's line; offline / failed → "✗ Not quite" at once.
 * Parity-tested by LessonAnswerCheckParityTest (parity/fixtures/lesson-answer-check.ts).
 */
object ScrambleCheck {
    const val CHECKING_BANNER = "Checking…"
    const val CORRECT_BANNER = "✓ Correct"
    const val ALSO_RIGHT_BANNER = "✓ Also right"
    const val NOT_QUITE_BANNER = "✗ Not quite"
    const val EXPECTED_LABEL = "The expected order:"
    const val ALSO_LABEL = "Also:"
    const val RIGHT_ORDER_LABEL = "The right order:"

    // JS `\s` (the web's /\s/g): ASCII whitespace plus the Unicode space separators.
    private const val WS = "\\t\\n\\u000B\\u000C\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private val WS_ONE = Regex("[$WS]")
    private val WS_RUN = Regex("[$WS]+")
    private val HAN = Regex("\\p{IsHan}")

    /** Port of scrambleSentence(): the tiles as one sentence, whitespace dropped. */
    fun sentence(order: List<String>): String = WS_ONE.replace(order.joinToString(""), "")

    /** Port of scrambleOrderText(): the tiles joined with single spaces, each tile's own spaces folded. */
    fun orderText(order: List<String>): String = order.map { WS_RUN.replace(it, "") }.filter { it.isNotEmpty() }.joinToString(" ")

    /** Port of scrambleLocalVerdict(): right | unexpected | incomplete. */
    fun localVerdict(picked: List<String>, tiles: List<String>, correctOrder: List<String>, altOrders: List<List<String>>? = null): String {
        if (picked.size != tiles.size) return "incomplete"
        val mine = sentence(picked)
        if (mine == sentence(correctOrder)) return "right"
        if (altOrders.orEmpty().any { mine == sentence(it) }) return "right"
        return "unexpected"
    }

    private val JS_TRIM = Regex("^[$WS]+|[$WS]+$")

    /** Port of scrambleCheckInput(): the check of an unexpected order, or null. */
    fun checkInput(english: String?, correctOrder: List<String>, picked: List<String>, focus: String? = null): AnswerCheckInput? {
        val e = JS_TRIM.replace(english ?: "", "")
        val answer = orderText(picked)
        val model = orderText(correctOrder)
        if (e.isEmpty() || answer.isEmpty() || model.isEmpty() || !HAN.containsMatchIn(answer)) return null
        val f = JS_TRIM.replace(focus ?: "", "")
        return AnswerCheckInput(
            promptEn = e, modelAnswer = model, answer = answer, exerciseType = LessonAnswerCheck.SCRAMBLE_TYPE, input = "typed",
            focus = f.ifEmpty { null },
        )
    }

    /** Port of ScrambleCheckStatus: null = no check (yet) for a `right` order. */
    sealed interface Status {
        data object Checking : Status
        data class Done(val check: AnswerCheck) : Status
        data object Unavailable : Status
    }

    /** Port of ScrambleOutcome — kind right | checking | also_right | not_quite; tone good | bad | neutral. */
    data class Outcome(
        val kind: String,
        val banner: String,
        val tone: String,
        val correct: Boolean,
        val expectedLabel: String?,
        val note: String?,
        val checking: Boolean,
        val moment: String?,
    )

    /** Port of scrambleOutcome(). */
    fun outcome(local: String, status: Status?, sameAsExpected: Boolean = local == "right"): Outcome {
        if (local == "right") {
            return Outcome("right", CORRECT_BANNER, "good", true, if (sameAsExpected) null else ALSO_LABEL, null, false, LessonFeedback.CHECKED_RIGHT)
        }
        if (status is Status.Checking) {
            return Outcome("checking", CHECKING_BANNER, "neutral", false, EXPECTED_LABEL, null, true, null)
        }
        if (status is Status.Done && (status.check.verdict == "correct" || status.check.verdict == "acceptable")) {
            return Outcome("also_right", ALSO_RIGHT_BANNER, "good", true, ALSO_LABEL, status.check.headline.ifEmpty { null }, false, LessonFeedback.CLAUDE_RIGHT)
        }
        val note = (status as? Status.Done)?.check?.headline?.ifEmpty { null }
        return Outcome("not_quite", NOT_QUITE_BANNER, "bad", false, RIGHT_ORDER_LABEL, note, false, null)
    }

    /** Port of scrambleSpokenSentence(): his own order when right, the expected one when not, null while checking. */
    fun spokenSentence(kind: String, picked: List<String>, correctOrder: List<String>): String? = when (kind) {
        "checking" -> null
        "not_quite" -> correctOrder.joinToString("")
        else -> picked.joinToString("")
    }
}
