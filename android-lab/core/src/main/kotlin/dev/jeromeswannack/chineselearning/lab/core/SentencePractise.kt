package dev.jeromeswannack.chineselearning.lab.core

/**
 * 🎤 on the study card's example sentence rows and "Get two sentences right before Good / Easy" — a
 * port of shared/study/sentencePractise.ts, parity-tested (parity/fixtures/sentence-practise.ts →
 * SentencePractiseParityTest). docs/STUDY_SESSION.md "Practise a sentence aloud".
 *
 * read = the row shows its Chinese: said aloud, judged like the Coach's practise ([CoachPractise]).
 * translate = English-first, Chinese hidden: "Say it in Chinese" — the row's sentence (or a homophone)
 * is right on the phone; anything else in Chinese goes to Claude's lesson answer check (translate,
 * spoken) when online. Practice only: nothing stored; the gate only holds back Good / Easy.
 */
object SentencePractise {
    const val READ = "read"
    const val TRANSLATE = "translate"

    val LABEL = mapOf(READ to "Read it aloud", TRANSLATE to "Say it in Chinese")
    val LISTENING = mapOf(READ to "Listening… read the sentence", TRANSLATE to "Listening… say it in Chinese")
    const val STOP = "Stop — check what I said"
    const val CHECKING = "Checking your translation…"
    const val CHECK_ONLINE = "Check online for other ways to say it"

    /** `sentencePractiseMode`: which test a 🎤 on this row runs; null = no 🎤 (nothing open yet). */
    fun mode(englishFirst: Boolean, hanziShown: Boolean, translation: String?): String? = when {
        hanziShown -> READ
        englishFirst && NoteSearch.jsTrim(translation ?: "").isNotEmpty() -> TRANSLATE
        else -> null
    }

    /** `isLocalRight`: said as written, or the same sounds. */
    fun isLocalRight(state: SpokenAnswerResult.State): Boolean =
        state == SpokenAnswerResult.State.MATCH || state == SpokenAnswerResult.State.SOUND

    data class Take(val practised: CoachPractise.Practised, val askClaude: Boolean)

    /** `sentenceTake`. */
    fun take(mode: String, transcript: String, hanzi: String): Take {
        val p = CoachPractise.practise(transcript, hanzi)
        return Take(p, mode == TRANSLATE && !isLocalRight(p.result.state) && LessonAnswerCheck.hasHan(p.said))
    }

    /** `sentenceAnswerCheckInput`: Claude's check of a translate take. */
    fun checkInput(hanzi: String, pinyin: String?, translation: String?, said: String): AnswerCheckInput =
        AnswerCheckInput(
            promptEn = NoteSearch.jsTrim(translation ?: ""),
            modelAnswer = hanzi,
            modelPinyin = NoteSearch.jsTrim(pinyin ?: "").ifEmpty { null },
            answer = said,
            exerciseType = "translate",
            input = "spoken",
        )

    /** `sentencePractiseResult`: right | close | wrong | failed | empty. */
    fun result(practised: CoachPractise.Practised?, claude: String?, failure: String? = null): String {
        if (practised == null) return if (failure == "empty") "empty" else "failed"
        if (claude != null) return when (claude) {
            "correct", "acceptable" -> "right"
            "almost" -> "close"
            else -> "wrong"
        }
        val state = practised.result.state
        return when {
            isLocalRight(state) -> "right"
            state == SpokenAnswerResult.State.WRONG -> "wrong"
            else -> "close"
        }
    }

    /** `sentencePractiseVia`: local | claude | offline. */
    fun via(take: Take, claudeAnswered: Boolean): String = when {
        !take.askClaude -> "local"
        claudeAnswered -> "claude"
        else -> "offline"
    }

    /** `showCheckOnline`. */
    fun showCheckOnline(take: Take, claudeAnswered: Boolean, checking: Boolean): Boolean = take.askClaude && !claudeAnswered && !checking

    /** `sentenceStopBar`: "stop" while recording, "checking" while judged, null — a tap elsewhere never stops a take. */
    fun stopBar(listening: Boolean, finishing: Boolean): String? = when {
        listening -> "stop"
        finishing -> "checking"
        else -> null
    }
    const val STOP_RECORDING = "Stop recording"
    const val CHECKING_TAKE = "Checking what you said…"

    // --- the gate ---------------------------------------------------------------------------------

    const val GATE_TARGET = 2
    /** `SENTENCE_GATE_CARD_TYPES`: Hard mode's reading, meaning and listening cards. */
    val GATE_CARD_TYPES = listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi")

    data class Gate(val needed: Int, val got: Int, val locked: Boolean)

    /** `sentenceGate`: [sentenceCount] null = still loading (the full target). */
    fun gate(enabled: Boolean, cardType: String, sentenceCount: Int?, rightKeys: Collection<String>): Gate {
        val applies = enabled && cardType in GATE_CARD_TYPES
        val count = sentenceCount?.coerceAtLeast(0) ?: GATE_TARGET
        val needed = if (applies) minOf(GATE_TARGET, count) else 0
        val got = minOf(needed, rightKeys.toSet().size)
        return Gate(needed, got, got < needed)
    }

    /** `sentenceGateLabel`. */
    fun label(gate: Gate): String? = when {
        gate.needed == 0 -> null
        gate.locked -> "🎤 Try the sentences first · ${gate.got}/${gate.needed} right"
        else -> "✓ ${gate.got}/${gate.needed} right — Good and Easy unlocked"
    }
}
