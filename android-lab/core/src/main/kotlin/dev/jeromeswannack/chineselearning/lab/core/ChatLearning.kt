package dev.jeromeswannack.chineselearning.lab.core

/*
 * Learning tools in the chat (docs/CHAT.md PR 3) — the pure rules the Lab chat follows,
 * unit-tested in ChatLearningTest. Word chips reuse ReaderWords; the correction diff is
 * LessonAnswers.diffHanzi (parity-tested against shared/lesson/answer-check.ts).
 */
object ChatLearning {
    /** At most this many messages go into one "Make flashcards" request (the worker's MAX_CONTEXT_MESSAGES). */
    const val MAX_SELECTED = 80
    /** The "Last 50 messages" quick pick (the worker's DEFAULT_CONTEXT_MESSAGES). */
    const val LAST_N = 50
    /** `POST /api/messages/:id/words` refuses longer texts (400). */
    const val WORDS_MAX_CHARS = 1500

    /** Learner = a student, or anyone in the Claude practice chat (MessageTools' `isLearner`). */
    fun isLearner(viewerRole: String, isAi: Boolean): Boolean = viewerRole == "student" || isAi

    /** The ✓ "Check my Chinese" in the composer: the learner's draft has Chinese (MessageTools' "check"). */
    fun canCheckDraft(draft: String, viewerRole: String, isAi: Boolean, editing: Boolean = false): Boolean =
        !editing && isLearner(viewerRole, isAi) && MessageTools.looksLikeChinese(draft)

    /**
     * The text a message's words split: `content`, or the voice transcript when
     * `words_source == "transcript"` (null source = content).
     */
    fun wordsText(content: String, transcript: String?, source: String?): String =
        if (source == "transcript") transcript.orEmpty() else content

    /**
     * Should the chat ask `POST /api/messages/:id/words` for this message? Chinese in the text it
     * would split (a voice message once transcribed), no words yet, not deleted, not too long.
     */
    fun needsWords(content: String, attachmentKind: String?, transcriptStatus: String?, transcript: String?, deleted: Boolean, hasWords: Boolean): Boolean {
        if (deleted || hasWords) return false
        val text = when (attachmentKind) {
            "voice" -> if (transcriptStatus == "done") transcript.orEmpty() else return false
            else -> content
        }
        return text.length <= WORDS_MAX_CHARS && MessageTools.looksLikeChinese(text)
    }

    /** A pinyin line from a message's words: each word's pinyin, punctuation as itself. */
    fun pinyinLine(words: List<Pair<String, String>>): String {
        val out = StringBuilder()
        for ((text, pinyin) in words) {
            when {
                pinyin.isNotBlank() -> { if (out.isNotEmpty() && !out.endsWith(" ")) out.append(' '); out.append(pinyin.trim()) }
                text.isBlank() -> if (out.isNotEmpty() && !out.endsWith(" ")) out.append(' ')
                else -> out.append(PUNCT[text] ?: text)
            }
        }
        return out.toString().replace(Regex(" +"), " ").trim()
    }

    private val PUNCT = mapOf("，" to ",", "。" to ".", "！" to "!", "？" to "?", "、" to ",", "：" to ":", "；" to ";", "“" to "\"", "”" to "\"", "\n" to " ")

    // ---------------- Pinyin / Translate toggles (remembered per conversation) ----------------

    /**
     * Which messages show pinyin / their translation. "Show … for all" turns a kind on for every
     * message; a per-message toggle flips that one against the default.
     */
    data class Aids(
        val pinyinAll: Boolean = false,
        val translationAll: Boolean = false,
        /** Messages whose pinyin differs from [pinyinAll]. */
        val pinyinFlipped: Set<String> = emptySet(),
        val translationFlipped: Set<String> = emptySet(),
    ) {
        fun pinyin(id: String): Boolean = pinyinAll != (id in pinyinFlipped)
        fun translation(id: String): Boolean = translationAll != (id in translationFlipped)

        fun togglePinyin(id: String) = copy(pinyinFlipped = pinyinFlipped.flip(id))
        fun toggleTranslation(id: String) = copy(translationFlipped = translationFlipped.flip(id))

        /** The header switch: a clean slate for that kind (every message follows it). */
        fun setPinyinAll(on: Boolean) = copy(pinyinAll = on, pinyinFlipped = emptySet())
        fun setTranslationAll(on: Boolean) = copy(translationAll = on, translationFlipped = emptySet())

        private fun Set<String>.flip(id: String) = if (id in this) this - id else this + id
    }

    // ---------------- "Make flashcards" selection ----------------

    /** A message as the selection sees it. [eligible] = it has something to make cards from. */
    data class Pickable(val id: String, val createdAtMs: Long, val eligible: Boolean)

    /** Has text worth sending (text, a photo's caption, a transcribed voice message) and isn't deleted. */
    fun eligible(content: String, attachmentKind: String?, transcriptStatus: String?, transcript: String?, deleted: Boolean): Boolean {
        if (deleted) return false
        return when (attachmentKind) {
            "voice" -> transcriptStatus == "done" && !transcript.isNullOrBlank()
            else -> content.isNotBlank()
        }
    }

    fun toggle(selected: Set<String>, id: String, messages: List<Pickable>): Set<String> {
        if (id in selected) return selected - id
        if (messages.none { it.id == id && it.eligible } || selected.size >= MAX_SELECTED) return selected
        return selected + id
    }

    /** "Today": every eligible message since local midnight ([dayStartMs]), the newest [MAX_SELECTED]. */
    fun today(messages: List<Pickable>, dayStartMs: Long): Set<String> =
        messages.filter { it.eligible && it.createdAtMs >= dayStartMs }.sortedBy { it.createdAtMs }.takeLast(MAX_SELECTED).mapTo(LinkedHashSet()) { it.id }

    /** "Last 50 messages": the newest [n] eligible ones. */
    fun lastN(messages: List<Pickable>, n: Int = LAST_N): Set<String> =
        messages.filter { it.eligible }.sortedBy { it.createdAtMs }.takeLast(n).mapTo(LinkedHashSet()) { it.id }

    /** The request's `message_ids`: the selection oldest first (the transcript order), capped. */
    fun requestIds(selected: Set<String>, messages: List<Pickable>): List<String> =
        messages.filter { it.id in selected }.sortedBy { it.createdAtMs }.map { it.id }.takeLast(MAX_SELECTED)

    // ---------------- correction diff ----------------

    /** A run of characters that are the same / changed between the original and the correction. */
    data class Run(val text: String, val same: Boolean)

    data class CorrectionDiff(
        /** The learner's text: changed runs are what the tutor took out / replaced. */
        val original: List<Run>,
        /** The tutor's text: changed runs are what the tutor put in. */
        val corrected: List<Run>,
        /** Nothing but punctuation / spacing changed. */
        val identical: Boolean,
    )

    /** `diffHanzi(original, corrected)` (punctuation and spaces ignored), as runs for rendering. */
    fun correctionDiff(original: String, corrected: String): CorrectionDiff {
        val d = LessonAnswers.diffHanzi(original, corrected)
        return CorrectionDiff(runs(d.typed), runs(d.expected), d.correct || (LessonAnswers.normalizeHanzi(original).isEmpty() && LessonAnswers.normalizeHanzi(corrected).isEmpty()))
    }

    fun runs(marks: List<LessonAnswers.CharMark>): List<Run> {
        val out = ArrayList<Run>()
        for (m in marks) {
            val last = out.lastOrNull()
            if (last != null && last.same == m.hit) out[out.size - 1] = last.copy(text = last.text + m.ch) else out += Run(m.ch, m.hit)
        }
        return out
    }
}

/**
 * The review sheet of "Make flashcards" (docs/CHAT.md PR 3): Claude's proposals, each editable
 * and checkable — one already in the learner's decks starts unchecked.
 */
data class ProposedCard(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val funFacts: String = "",
    val sentenceClue: String = "",
    val sentenceCluePinyin: String = "",
    val sentenceClueTranslation: String = "",
    val alreadyHave: Boolean = false,
    val sourceMessageId: String? = null,
)

data class FlashcardReview(
    val cards: List<ProposedCard>,
    val checked: Set<Int>,
    /** A card the server (or the card standard on the phone) refused: index → why. */
    val problems: Map<Int, String> = emptyMap(),
) {
    val count: Int get() = checked.size

    fun toggle(i: Int) = copy(checked = if (i in checked) checked - i else checked + i)

    fun edit(i: Int, card: ProposedCard) = copy(cards = cards.mapIndexed { j, c -> if (j == i) card else c }, problems = problems - i)

    /** The checked cards, in order, with their index (for problems by index). */
    fun chosen(): List<Pair<Int, ProposedCard>> = cards.withIndex().filter { it.index in checked }.map { it.index to it.value }

    /** The card standard's HARD rules, checked before anything leaves the phone. */
    fun localProblems(): Map<Int, String> = chosen().mapNotNull { (i, c) ->
        CardStandard.newNoteProblem(c.hanzi, c.pinyin, c.english, c.sentenceClue)?.let { i to it }
    }.toMap()

    /**
     * After `POST /api/decks/:id/notes/batch`: the created cards leave the sheet; the failed ones stay
     * checked with the server's reason (`failed[].index` is the position in the request).
     */
    fun afterBatch(sent: List<Int>, failed: Map<Int, String>): FlashcardReview {
        val failedCards = failed.keys.mapNotNull { sent.getOrNull(it) }.toSet()
        val keep = cards.indices.filter { it !in sent || it in failedCards }
        val remap = keep.withIndex().associate { (newI, oldI) -> oldI to newI }
        return FlashcardReview(
            cards = keep.map { cards[it] },
            checked = keep.filter { it in checked && (it !in sent || it in failedCards) }.mapTo(HashSet()) { remap.getValue(it) },
            problems = failed.mapNotNull { (reqI, msg) -> sent.getOrNull(reqI)?.let { remap[it]?.to(msg) } }.toMap(),
        )
    }

    companion object {
        /** Everything checked except what's already in the decks. */
        fun of(cards: List<ProposedCard>) = FlashcardReview(cards, cards.indices.filter { !cards[it].alreadyHave }.toSet())
    }
}
