package dev.jeromeswannack.chineselearning.lab.core

/**
 * Sentence Coach "🎤 Practise saying it" — a port of shared/coach/practise.ts, parity-tested
 * (parity/fixtures/coach.ts → CoachParityTest): beside a coach answer's big sentence the learner says
 * it; the take is checked like a spoken answer on a typing card — [AnswerKey.tidySpokenTranscript],
 * then [AnswerKey.checkSpoken] (punctuation ignored, homophones by sound, other tones = close) — and
 * shown in the compact "You said" row ([SpokenAnswerResult]). Nothing is stored.
 */
object CoachPractise {
    /** The follow-up composer's 🎤 (was "Say it" — read as "practise the sentence above"). */
    const val RESPOND_LABEL = "Respond"
    const val LABEL = "Practise saying it"
    const val STOP = "Stop"
    const val AGAIN = "Try again"
    const val LISTEN = "Listen"
    const val LISTENING = "Listening… say the sentence"
    const val CHECKING = "Checking…"
    const val OFFLINE = "Practising needs a connection."
    const val EMPTY = "Didn’t catch that — try again."

    data class Practised(val said: String, val verdict: AnswerKey.Verdict, val result: SpokenAnswerResult.Result)

    /** `practiseSentence`: a take of the learner saying [target], checked like a spoken answer. */
    fun practise(transcript: String, target: String): Practised {
        val said = AnswerKey.tidySpokenTranscript(transcript, target)
        val verdict = AnswerKey.checkSpoken(said, target)
        return Practised(said, verdict, SpokenAnswerResult.of(said, target, verdict))
    }

    /** `practiseOutcome`: `coach.practise_say { result }` — the row's state, or why there was none. */
    fun outcome(p: Practised?, failure: String?): String =
        p?.let { SpokenAnswerResult.stateName(it.result.state) } ?: if (failure == "empty") "empty" else "failed"

    /** `practiseBlockNote`: why 🎤 can't record right now (null = it can). */
    fun blockNote(blocked: String?): String? = when (blocked) {
        "offline" -> OFFLINE
        "denied" -> "Microphone blocked — allow the microphone and tap 🎤."
        "no_mic" -> "No microphone found."
        "unsupported" -> "Speaking isn’t available here."
        "mic_error" -> "Couldn’t open the microphone — tap 🎤 to try again."
        else -> null
    }

    /** `practiseMicEnabled`: 🎤 stays tappable unless recording can't work at all. */
    fun micEnabled(blocked: String?): Boolean = blocked != "offline" && blocked != "unsupported"
}
