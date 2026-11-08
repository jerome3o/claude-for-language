package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/study/sentenceAnswerCheck.ts — sentence answers checked by Claude (docs/STUDY_SESSION.md
 * "Sentence answers checked by Claude"): in Hard mode's check on the question, a meaning → hanzi card whose
 * answer is a SENTENCE and whose typed / spoken answer the device didn't accept is asked of the lesson answer
 * check (`POST /api/lessons/answer-check`, translate); correct / acceptable = right, almost = ≈ Nearly, wrong =
 * wrong. Parity-tested (parity/fixtures/sentence-answer-check.ts → SentenceAnswerCheckParityTest).
 */
object SentenceAnswerCheck {
    /** English → Chinese only (audio → hanzi is dictation: another wording isn't right there). */
    val CARD_TYPES = listOf(CardTypes.MEANING_TO_HANZI)

    /** Port of isSentenceAnswer(): more than 4 Han characters, or punctuated. */
    fun isSentenceAnswer(hanzi: String): Boolean = Known.noteKind(hanzi) == NoteKind.Sentence

    /** Port of sentenceAnswerCheckApplies(). */
    fun applies(cardType: String, hanzi: String, answer: String?, verdict: AnswerKey.Verdict?, multipleChoice: Boolean = false): Boolean {
        if (cardType !in CARD_TYPES || multipleChoice) return false
        if (verdict == null || AnswerKey.isAccepted(verdict)) return false
        val a = (answer ?: "").trim()
        return a.isNotEmpty() && LessonAnswerCheck.hasHan(a) && isSentenceAnswer(hanzi)
    }

    /** Port of sentenceAnswerCheckInput(): the card's English is the prompt, its hanzi + pinyin the model answer. */
    fun input(english: String, hanzi: String, pinyin: String?, answer: String, spoken: Boolean): AnswerCheckInput =
        AnswerCheckInput(
            promptEn = english.trim(),
            modelAnswer = hanzi.trim(),
            modelPinyin = pinyin?.trim()?.ifEmpty { null },
            answer = answer.trim(),
            exerciseType = "translate",
            input = if (spoken) "spoken" else "typed",
        )

    /** Port of sentenceCheckedVerdict(): the device's when accepted / no check; else Claude's. */
    fun checkedVerdict(local: AnswerKey.Verdict, claude: String?): AnswerKey.Verdict {
        if (claude == null || AnswerKey.isAccepted(local)) return local
        if (claude == "correct" || claude == "acceptable") return AnswerKey.Verdict.EQUIVALENT
        return if (claude == "almost") AnswerKey.Verdict.CLOSE else AnswerKey.Verdict.WRONG
    }

    /** What Claude's verdict means on the card: [question] right | close | wrong, [pass] right | wrong. */
    data class Outcome(val answerVerdict: AnswerKey.Verdict, val question: String, val pass: String, val right: Boolean)

    /** Port of sentenceCheckOutcome(). */
    fun outcome(claude: String): Outcome {
        val v = checkedVerdict(AnswerKey.Verdict.WRONG, claude)
        val question = HardMode.questionResult(v)!!
        val pass = Homework.passSuggestion(v)!!
        return Outcome(v, question, pass, question == "right")
    }

    /** Port of sentenceCheckDifference(): right per Claude but not the card's words → why the check holds. */
    fun difference(said: String, model: String, claude: String?): String? =
        AnswerDifference.roundTake("translate", said, model, SpokenAnswerResult.State.WRONG, claude)

    /**
     * What the question shows for a sentence answer that goes to Claude (port of SentenceCheckView; Jerome: "we see
     * the correct answer straight away and we see the differences straight away, and then it loads the delta" —
     * and "it also corrects my sentence instead of giving me the model answer"): [answerFirst] = the CARD'S answer
     * (hanzi, pinyin, English) + "You said" vs it at once; [accepted] = the comparison's marks yellow (else red);
     * [checking] = the slim "Checking your sentence…" row under them; [corrected] = Claude's fix of HIS wording as a
     * small labelled line (≈ Nearly only, never the card's answer or what he said).
     */
    data class View(val answerFirst: Boolean, val accepted: Boolean, val checking: Boolean, val corrected: String?)

    /** Port of sentenceCheckView(). */
    fun view(applies: Boolean, checking: Boolean, claude: String?, said: String, model: String, corrected: String? = null): View {
        if (!applies) return View(answerFirst = false, accepted = false, checking = false, corrected = null)
        val verdict = if (checking) null else claude
        val fix = (corrected ?: "").trim()
        val shown = if (verdict == "almost" && fix.isNotEmpty() && LessonAnswerCheck.hasHan(fix) &&
            !AnswerDifference.sameWords(fix, model) && !AnswerDifference.sameWords(fix, said)) fix else null
        return View(answerFirst = true, accepted = verdict == "correct" || verdict == "acceptable", checking = checking, corrected = shown)
    }

    const val CHECKING = "Checking your sentence…"
    const val TYPE_INSTEAD = "Type it"
    /** The label over the card's answer on the question. */
    const val ANSWER = "The answer"
    /** The small line with Claude's fix of his own wording (≈ Nearly only). */
    const val YOUR_FIX = "Your wording, fixed:"
    /** Under a miss once the answer is on screen: moving on counts as a miss. */
    const val MOVE_ON_NOTE = "Moving on counts as a miss — Again or Hard suggested."
}
