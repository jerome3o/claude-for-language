package dev.jeromeswannack.chineselearning.lab.core

/**
 * Hard mode in the homework pass — a port of shared/homework/pass-angles.ts, parity-tested
 * (parity/fixtures/pass-angles.ts → PassAnglesParityTest). docs/HOMEWORK.md §3e.
 *
 * The pass honours Hard mode (its own per-device setting, default All: StudyPrefs.passHardMode): the
 * check-first ladder + Sentence round on reading / meaning cards; a give-up locks Got it. A word got
 * right in Hard mode on its first angle is owed ONE more showing on another card type (reading ↔
 * meaning, the listening card with audio) later in the pass — at most [MAX_ANGLES]; it comes back once
 * [ANGLE_GAP] other words were started since (else at the end, with the retries).
 *
 * Events: Not yet = `wrong` on the note id; a first angle's Got it that is owed a second = `right` on the
 * step id `<noteId>#<card type>` ([stepId]); the final Got it = `right` on the note id.
 */
object PassAngles {
    const val READ = CardTypes.HANZI_TO_MEANING
    const val MEANING = CardTypes.MEANING_TO_HANZI
    const val LISTEN = CardTypes.AUDIO_TO_HANZI
    private val LADDER_TYPES = listOf(READ, MEANING)
    private val FIRST_ORDER = listOf(READ, MEANING, LISTEN)

    const val MAX_ANGLES = 2
    const val ANGLE_GAP = 3

    // ---- the setting ----

    const val DEFAULT_MODE = HardMode.ALL

    /** `parsePassHardMode`: anything unknown (never set) = All. */
    fun parseMode(raw: String?): String = when (raw) {
        HardMode.OFF, HardMode.RED, HardMode.ALL -> raw
        else -> DEFAULT_MODE
    }

    /** `passHardApplies`: the setting, a reading / meaning card, and (Red) a word marked Not yet in this pass. */
    fun hardApplies(mode: String, cardType: String, missed: Boolean): Boolean {
        if (mode == HardMode.OFF || cardType !in LADDER_TYPES) return false
        return mode == HardMode.ALL || missed
    }

    // ---- step ids ----

    private const val SEP = '#'

    /** `passStepId` */
    fun stepId(noteId: String, cardType: String): String = "$noteId$SEP$cardType"

    /** `parsePassStepId`: (noteId, cardType), or null for a plain item id. */
    fun parseStepId(itemId: String): Pair<String, String>? {
        val i = itemId.lastIndexOf(SEP)
        if (i <= 0 || i == itemId.length - 1) return null
        return itemId.substring(0, i) to itemId.substring(i + 1)
    }

    // ---- the words ----

    /** `PassWord`: the card types the note has on the device (empty = not here yet), and whether it has audio. */
    data class Word(val id: String, val cardTypes: List<String>, val hasAudio: Boolean)

    /** `firstAngleType` */
    fun firstAngleType(cardTypes: List<String>): String = FIRST_ORDER.firstOrNull { it in cardTypes } ?: READ

    /** `secondAngleType` */
    fun secondAngleType(word: Word, firstType: String, done: List<String> = emptyList()): String? {
        val listen = if (word.hasAudio) listOf(LISTEN) else emptyList()
        val candidates = when (firstType) {
            READ -> listOf(MEANING) + listen
            MEANING -> listOf(READ) + listen
            else -> listOf(READ, MEANING)
        }
        return candidates.firstOrNull { it != firstType && it in word.cardTypes && it !in done }
    }

    // ---- the walk ----

    /** `PassShowing` */
    data class Showing(val noteId: String, val cardType: String, val angle: Int, val retry: Boolean)

    /** `PassAnglePlan` */
    data class Plan(
        val remaining: List<Showing>,
        val next: Showing?,
        val done: Int,
        val total: Int,
        val complete: Boolean,
        val retrying: Int,
        val anglesOwed: Int,
        val bar: RetryBar,
    )

    private class State {
        var final = false
        val steps = mutableListOf<String>()
        var lastStepAt: String? = null
        var lastStepType: String? = null
        var wrongs = 0
        var lastWrongAt: String? = null
        var firstAt: String? = null
        var answered = 0
    }

    private fun states(words: List<Word>, events: List<HomeworkEvent>): Map<String, State> {
        val states = LinkedHashMap<String, State>()
        for (w in words) states[w.id] = State()
        for (e in Homework.livePassEvents(events)) {
            val step = parseStepId(e.item_id)
            val direct = states[e.item_id]
            val s = direct ?: step?.let { states[it.first] } ?: continue
            if (e.result != "right" && e.result != "wrong" && e.result != "done") continue
            if (direct == null && e.result != "right") continue
            if (s.firstAt == null || e.created_at < s.firstAt!!) s.firstAt = e.created_at
            if (direct != null) {
                if (e.result == "wrong") {
                    s.wrongs++
                    s.answered++
                    if (s.lastWrongAt == null || e.created_at > s.lastWrongAt!!) s.lastWrongAt = e.created_at
                } else if (!s.final) {
                    s.final = true
                    s.answered++
                }
            } else if (step != null) {
                if (step.second !in s.steps) {
                    s.steps += step.second
                    s.answered++
                }
                if (s.lastStepAt == null || e.created_at >= s.lastStepAt!!) {
                    s.lastStepAt = e.created_at
                    s.lastStepType = step.second
                }
            }
        }
        return states
    }

    private class Pending(val showing: Showing, val at: String, val index: Int, val due: Boolean)

    /** `passAnglePlan`: [mode] only sizes the bar's owed steps. */
    fun plan(words: List<Word>, events: List<HomeworkEvent>, mode: String): Plan {
        val seen = HashSet<String>()
        val unique = words.filter { seen.add(it.id) }
        val states = states(unique, events)
        val unseen = mutableListOf<Showing>()
        val pending = mutableListOf<Pending>()
        var done = 0
        var answered = 0
        var fresh = 0
        var retries = 0
        var anglesOwed = 0
        val starts = unique.mapNotNull { states.getValue(it.id).firstAt }
        unique.forEachIndexed { index, w ->
            val s = states.getValue(w.id)
            answered += s.answered
            if (s.final) {
                done++
                return@forEachIndexed
            }
            val first = firstAngleType(w.cardTypes)
            if (s.steps.isNotEmpty()) {
                val stepType = s.lastStepType ?: first
                val cardType = secondAngleType(w, stepType, s.steps) ?: stepType
                val retry = s.lastWrongAt != null && s.lastStepAt != null && s.lastWrongAt!! > s.lastStepAt!!
                val at = if (retry) s.lastWrongAt!! else s.lastStepAt!!
                val due = !retry && starts.count { it > s.lastStepAt!! } >= ANGLE_GAP
                pending += Pending(Showing(w.id, cardType, 2, retry), at, index, due)
                if (retry) retries++ else { fresh++; anglesOwed++ }
                return@forEachIndexed
            }
            val planned = if (hardApplies(mode, first, s.wrongs > 0) && secondAngleType(w, first) != null) 1 else 0
            if (s.wrongs > 0) {
                pending += Pending(Showing(w.id, first, 1, true), s.lastWrongAt!!, index, false)
                retries++
                fresh += planned
                return@forEachIndexed
            }
            unseen += Showing(w.id, first, 1, false)
            fresh += 1 + planned
        }
        val byTime = Comparator<Pending> { a, b -> if (a.at < b.at) -1 else if (a.at > b.at) 1 else a.index - b.index }
        val dueAngles = pending.filter { it.due }.sortedWith(byTime).map { it.showing }
        val rest = pending.filter { !it.due }.sortedWith(byTime).map { it.showing }
        val remaining = dueAngles + unseen + rest
        return Plan(
            remaining = remaining,
            next = remaining.firstOrNull(),
            done = done,
            total = unique.size,
            complete = unique.isNotEmpty() && done == unique.size,
            retrying = retries,
            anglesOwed = anglesOwed,
            bar = RetryBars.retryBar(answered, fresh, retries, done, unique.size),
        )
    }

    /** `passWordMissed`: any live `wrong` on the word. */
    fun wordMissed(noteId: String, events: List<HomeworkEvent>): Boolean =
        Homework.livePassEvents(events).any { it.item_id == noteId && it.result == "wrong" }

    /** `passAnswerItemId` */
    fun answerItemId(showing: Showing, word: Word, right: Boolean, hard: Boolean): String {
        if (!right || !hard || showing.angle != 1) return showing.noteId
        return if (secondAngleType(word, showing.cardType) != null) stepId(showing.noteId, showing.cardType) else showing.noteId
    }

    // ---- words (both apps) ----

    val OPTION = mapOf(HardMode.OFF to "Off", HardMode.RED to "Words I miss", HardMode.ALL to "All words")
    val OPTION_HINT = mapOf(
        HardMode.OFF to "Each word once, straight to the answer",
        HardMode.RED to "Words you mark Not yet: checked first, sentences, then a second angle",
        HardMode.ALL to "Every word: checked first, sentences, then a second angle later",
    )
    const val TITLE = "Hard mode in homework"
    const val DESCRIPTION =
        "One-off homework is the only time you see those words for a while, so it uses Hard mode by default: your answer is checked first, then a few sentences, and each word comes back once more from another angle."

    /** `passHardModeChipLabel` */
    fun chipLabel(mode: String): String = "$TITLE: ${OPTION[mode]}"

    /** `passAnglesLabel` */
    fun anglesLabel(mode: String): String? = when (mode) {
        HardMode.ALL -> "🎯 2 angles per word"
        HardMode.RED -> "🎯 2 angles for words you miss"
        else -> null
    }

    private val ANGLE_CARD = mapOf(READ to "Chinese → meaning", MEANING to "English → Chinese", LISTEN to "Listen → Chinese")

    /** `passAngleLine` */
    fun angleLine(angle: Int, cardType: String): String? =
        if (angle != 2) null else "🔄 Second angle · ${ANGLE_CARD[cardType] ?: cardType}"

    const val ROUND_SKIP_NOTE = "Skipping is fine — Got it stays open, and the word still comes back from another angle."
    /** `passRoundDoneCheer`: the round's cheer once enough are right, in the pass. */
    fun roundDoneCheer(got: Int, needed: Int): String = "🎉 $got / $needed — Got it unlocked"
    const val GAVE_UP_LINE = "👁 You looked at the answer — Not yet this time"
    const val GAVE_UP_BLOCKED =
        "You looked at the answer before getting it right, so Got it stays locked — the word comes back later in the pass."
}
