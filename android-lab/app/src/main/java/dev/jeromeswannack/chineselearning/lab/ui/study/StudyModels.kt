package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity

/** One presentation of a card. [presentation] changes even when the same card comes back. */
data class CardView(
    val card: QueueCard,
    val note: NoteEntity,
    val sentences: List<SentenceEntity>,
    val previews: List<IntervalPreview>,
    val alternatives: List<String>,
    val presentation: Int,
    val deckName: String?,
    /** The word's clip is on the device (offline, a missing one falls back to the device voice). */
    val audioCached: Boolean = true,
    /** NEW, and its note already has a reviewed card this session: counts as purple. */
    val isSecondaryNew: Boolean = false,
    /** Where the card starts: fresh, or as it was left (resumed after leaving Study — docs/STUDY_SESSION.md). */
    val start: CardStartState = CardStartState(),
)

/** Today's numbers where the old session recap was: "Today: 23 min · 142 reviews", N% right. */
data class TodaySummary(val activeMs: Long, val reviews: Int, val correct: Int, val celebrate: Boolean) {
    val accuracy: Int? get() = if (reviews == 0) null else Math.round(correct * 100f / reviews)
}

data class SessionStats(
    val reviews: Int = 0,
    val correct: Int = 0,
    val againCount: Int = 0,
    val againByNote: Map<String, Int> = emptyMap(),
    val leeches: List<String> = emptyList(),
    val startedAt: Long = System.currentTimeMillis(),
) {
    val accuracy: Int get() = if (reviews == 0) 0 else Math.round(correct * 100f / reviews)
}

sealed interface StudyPhase {
    data object Loading : StudyPhase
    data class Showing(val view: CardView) : StudyPhase
    // ---- Package B: a mini lesson in the card flow (ui/lessons/StudyExtras.kt) ----
    data class Lesson(val lesson: dev.jeromeswannack.chineselearning.lab.ui.lessons.SessionLesson) : StudyPhase
    data class Reader(val reader: dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader) : StudyPhase
    data object Done : StudyPhase
}

/** Practising the cards a tutor left notes on (/tutor-notes/practice): which cards, which notes to pin. */
data class PracticeSpec(val cardIds: List<String>, val noteIds: List<String>)

/**
 * The practice mini session's state. [counts] = rating the card on screen writes a review (it is
 * due today); otherwise it is practice only (core TutorNotesRules.practiceRatingCounts).
 */
data class PracticeUi(val counts: Boolean = false, val counted: Int = 0, val practiceOnly: Int = 0)

data class StudyUi(
    val phase: StudyPhase = StudyPhase.Loading,
    val counts: QueueCounts = QueueCounts(0, 0, 0, 0),
    val stats: SessionStats = SessionStats(),
    val canUndo: Boolean = false,
    val hasMoreNew: Boolean = false,
    val bonus: Int = 0,
    /** Rating that sent the previous card away — picks the exit animation. */
    val lastRating: Int? = null,
    val online: Boolean = true,
    val deckName: String? = null,
    /** Settings of the web's OfflineModeToggle: forced offline even with a connection. */
    val forcedOffline: Boolean = false,
    /** What the card's online extras know (tutor notes, tutors, busy items, voices). */
    val extras: CardExtras = CardExtras(),
    /** The one-time "Before your first card" explainer (no review events anywhere yet). */
    val showExplainer: Boolean = false,
    /** Today's numbers + whether this finish is celebrated (set when the queue runs dry). */
    val today: TodaySummary? = null,
    /** Non-null in the tutor-notes practice (a focused mini session). */
    val practice: PracticeUi? = null,
) {
    /** The top-bar count the item on screen belongs to (QueueCountsHeader `activeQueue`). */
    val activeBucket: CountBucket? get() = (phase as? StudyPhase.Showing)?.view?.let { CountBucket.of(it.card.queue, it.isSecondaryNew) }

    /** `aiAvailable`: online and not forced offline — every AI / network button needs it. */
    val aiAvailable: Boolean get() = online && !forcedOffline

    val progress: Float get() {
        val total = stats.reviews + counts.total
        return if (total == 0) 1f else stats.reviews.toFloat() / total
    }
}

/** Card-back actions that are running (the web's per-item `busy` flags in the ⋯ menu). */
enum class CardBusy { FUN_FACT, REGEN_AUDIO, NEW_VOICE, ROLEPLAY, SENTENCE_CLUE }

/** Everything the card knows beyond the note itself; reset for every presentation. */
data class CardExtras(
    /** Unseen tutor notes for this card, shown once under the pinyin (TutorNoteLine). */
    val tutorNotes: List<TutorNote> = emptyList(),
    /** Human tutors this card can be flagged for (empty = no "Flag for tutor"). */
    val flagTutors: List<FlagTutor> = emptyList(),
    /** The Claude tutor relationship, for "Roleplay this word". */
    val roleplayRelId: String? = null,
    val busy: Set<CardBusy> = emptySet(),
    /** A failure to show inline on the card back (never a dialog). */
    val notice: String? = null,
    /** The note's audio recordings (primary first) — Play cycles through them. */
    val voices: List<String> = emptyList(),
    val voiceIndex: Int = 0,
    /** My pronunciation take on a read card (per card). */
    val take: TakeUi = TakeUi(),
    /** Multiple choice on the typing cards (per card). */
    val mc: McUi = McUi(),
    /** The Ask Claude conversation about this card (kept while the card is up). */
    val ask: AskUi = AskUi(),
)

/** The web's recorder + useTranscription state for the current card. */
data class TakeUi(
    val recording: Boolean = false,
    /** The first half second of a take: "Recording…" instead of a Stop button (no stray stops). */
    val starting: Boolean = false,
    /** A finished take is waiting (played back, re-recorded, uploaded with the review). */
    val hasTake: Boolean = false,
    val transcription: TranscriptionUi? = null,
)

/** The web StudyCard's multiple-choice state (`showMultipleChoice`, `mcReady`, `skipMcForCard`…). */
data class McUi(
    /** Shuffled rows once loaded. */
    val rows: List<MultipleChoice.Row>? = null,
    /** The grid is up (instead of the typing box). */
    val showing: Boolean = false,
    /** Listen cards: loaded but kept behind "Show options" until asked for. */
    val ready: Boolean = false,
    val loading: Boolean = false,
    /** This card fell back to typing (offline / failed / "Type instead"). */
    val skip: Boolean = false,
    /** The one line above the typing box saying why. */
    val fallbackNote: String? = null,
    /** Options are on the device (usable offline). */
    val cached: Boolean = false,
    /** Auto-show: listen cards, and meaning cards of pinyin-only notes. */
    val auto: Boolean = false,
)

/** Ask Claude on a card (the web's StudyCard `conversation` / `pendingToolResults` state). */
data class AskUi(
    val conversation: List<dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer> = emptyList(),
    val asking: Boolean = false,
    /** The question being asked (shown while Claude thinks). */
    val pendingQuestion: String? = null,
    val error: String? = null,
    /** Tool results of the latest answer waiting for Approve / Reject. */
    val pending: List<dev.jeromeswannack.chineselearning.lab.data.api.AskToolResult>? = null,
    /** Claude deleted this card: the input goes, the session moves on after a moment. */
    val cardDeleted: Boolean = false,
)
