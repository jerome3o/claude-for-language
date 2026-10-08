package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.api.AskToolResult
import dev.jeromeswannack.chineselearning.lab.data.api.ReadOnlyToolCall
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test
import org.robolectric.annotation.Config

/** Package A: the study card's extras (`./gradlew :app:recordRoborazziDebug` → app/screenshots/study-*.png). */
class StudyCardScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-09-27T09:30:00.000Z")

    private fun view(type: String, queue: Int = CardQueue.REVIEW, note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity = Samples.note, audioCached: Boolean = true): CardView {
        var state = CardScheduler.initialCardState()
        if (queue == CardQueue.REVIEW) {
            state = CardScheduler.applyReview(state, 2, "2026-09-10T08:00:00.000Z")
            state = CardScheduler.applyReview(state, 2, "2026-09-10T08:12:00.000Z")
            state = CardScheduler.applyReview(state, 2, "2026-09-13T08:00:00.000Z")
        }
        val card = QueueCard("c1", note.id, "d1", type, state)
        return CardView(card, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Plans & time", audioCached)
    }

    private val tutors = listOf(FlagTutor("r1", "Wang Laoshi"))
    private val notes = listOf(
        TutorNote("e1", "recording", "c1", "n1", "打算", "Second syllable is fourth tone — suàn, drop it sharply.", "Wang Laoshi", "2026-09-26T10:00:00Z"),
    )

    private fun ui(v: CardView, extras: CardExtras = CardExtras(flagTutors = tutors, roleplayRelId = "r-claude"), online: Boolean = true, forced: Boolean = false, explainer: Boolean = false) =
        StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = online, forcedOffline = forced, extras = extras, showExplainer = explainer)

    @Composable
    private fun study(ui: StudyUi, start: CardStartState = CardStartState()) =
        StudyScreen(ui, playingKey = null, actions = StudyActions(), cardStart = start, autoplay = false, pendingReviews = 3)

    /** A sheet drawn over the dimmed card, the way the ModalBottomSheet shows it on the phone. */
    @Composable
    private fun overCard(ui: StudyUi, start: CardStartState, sheet: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize()) {
            study(ui, start)
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.32f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(Lab.colors.card)
                    .padding(top = 12.dp, bottom = 20.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.muted.copy(alpha = 0.4f)))
                Spacer(Modifier.height(14.dp))
                sheet()
            }
        }
    }

    @Test fun backWithActionRowAndTutorNote() = shoot("study-a01-back-actions-tutor-note") {
        study(ui(view(CardTypes.HANZI_TO_MEANING), CardExtras(tutorNotes = notes, flagTutors = tutors, voices = listOf("a", "b", "c"))), CardStartState(flipped = true))
    }

    @Test fun typedAnswerWithPinyin() = shoot("study-a02-typed-pinyin") {
        study(ui(view(CardTypes.MEANING_TO_HANZI)), CardStartState(flipped = true, answer = "打蒜"))
    }

    @Test fun moreSheet() = shoot("study-a03-more-sheet") {
        val v = view(CardTypes.HANZI_TO_MEANING, note = Samples.note.copy(funFacts = null))
        val u = ui(v, CardExtras(flagTutors = tutors, roleplayRelId = "r-claude", busy = setOf(CardBusy.NEW_VOICE)))
        overCard(u, CardStartState(flipped = true)) {
            StudyMoreList(studyMenuItems(v, u, StudyActions(), hasRecording = true, onFlag = {}), CardExtrasLogic.formatAddedDate(v.note.createdAt, java.time.ZoneId.of("UTC"), java.util.Locale.US), onDismiss = {})
        }
    }

    @Test fun moreSheetOffline() = shoot("study-a04-more-sheet-offline") {
        val v = view(CardTypes.HANZI_TO_MEANING)
        val u = ui(v, online = false)
        overCard(u, CardStartState(flipped = true)) {
            StudyMoreList(studyMenuItems(v, u, StudyActions(), hasRecording = false, onFlag = {}), CardExtrasLogic.formatAddedDate(v.note.createdAt, java.time.ZoneId.of("UTC"), java.util.Locale.US), onDismiss = {})
        }
    }

    @Test fun flagSheet() = shoot("study-a05-flag") {
        overCard(ui(view(CardTypes.HANZI_TO_MEANING)), CardStartState(flipped = true)) {
            FlagCardForm(tutors, "打算", send = { _, _ -> true }, onDismiss = {}, startMessage = "I keep mixing this up with 算了 — when do I use which?")
        }
    }

    @Test fun flagSaved() = shoot("study-a06-flag-saved-offline") {
        overCard(ui(view(CardTypes.HANZI_TO_MEANING), online = false), CardStartState(flipped = true)) {
            FlagCardForm(tutors, "打算", send = { _, _ -> false }, onDismiss = {}, startDone = "Saved — it goes to Wang Laoshi when you're back online")
        }
    }

    @Test fun editSheet() = shoot("study-a07-edit") {
        overCard(ui(view(CardTypes.HANZI_TO_MEANING)), CardStartState(flipped = true)) {
            EditCardForm(Samples.note.copy(alternatives = """["计划"]"""), aiAvailable = true, actions = EditCardActions(), onDismiss = {}, loadRecordings = false)
        }
    }

    @Test fun characterSheet() = shoot("study-a08-char-sheet") {
        overCard(ui(view(CardTypes.HANZI_TO_MEANING)), CardStartState(flipped = true)) {
            dev.jeromeswannack.chineselearning.lab.ui.chars.CharacterSheetContent(dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetSamples.loaded("打算"))
        }
    }

    private val askConversation = AskUi(
        conversation = listOf(
            AskAnswer(
                id = "q1",
                question = "What's the difference between 打算 and 计划?",
                answer = "**打算** is everyday: what you *intend* to do — 我打算明天去。\n**计划** is a planned-out *plan*, often formal or written — 公司的五年计划.\nAs a verb both work, but 打算 sounds natural in conversation.",
                readOnlyToolCalls = listOf(ReadOnlyToolCall("search_cards", buildJsonObject { put("query", "计划") })),
                toolResults = listOf(
                    AskToolResult(
                        "create_flashcards",
                        success = true,
                        data = buildJsonObject {
                            put("count", 1)
                            put("created", buildJsonArray { add(buildJsonObject { put("hanzi", "计划"); put("pinyin", "jìhuà"); put("english", "plan; to plan (formal)") }) })
                        },
                    ),
                ),
            ),
        ),
        pending = listOf(AskToolResult("create_flashcards", success = true, data = buildJsonObject { put("count", JsonPrimitive(1)) })),
    )

    @Test fun askClaude() = shoot("study-a09-ask-claude") {
        val v = view(CardTypes.MEANING_TO_HANZI)
        overCard(ui(v, CardExtras(ask = askConversation)), CardStartState(flipped = true, answer = "打算")) {
            AskClaudeBody(v, askConversation, "en", "打算", true, AskActions())
        }
    }

    @Test fun askClaudeStart() = shoot("study-a10-ask-claude-start") {
        val v = view(CardTypes.MEANING_TO_HANZI)
        overCard(ui(v), CardStartState(flipped = true, answer = "打蒜")) {
            AskClaudeBody(v, AskUi(), "en", "打蒜", true, AskActions())
        }
    }

    @Test fun frontNeedsSentenceOffline() = shoot("study-a11-front-offline-forced") {
        val v = view(CardTypes.AUDIO_TO_HANZI, note = Samples.note.copy(sentenceClue = null, audioUrl = "/api/audio/generated/n1.mp3"), audioCached = false)
        study(ui(v, online = true, forced = true))
    }

    @Test fun frontSentenceShown() = shoot("study-a12-front-sentence") {
        study(ui(view(CardTypes.HANZI_TO_MEANING)), CardStartState(showClue = true))
    }

    @Test fun firstCardExplainer() = shoot("study-a13-first-card-explainer") {
        study(ui(view(CardTypes.HANZI_TO_MEANING, CardQueue.NEW), explainer = true))
    }

    @Test fun noticeOnBack() = shoot("study-a14-back-notice") {
        study(ui(view(CardTypes.HANZI_TO_MEANING), CardExtras(notice = "The server had a problem (502). Try again in a moment.")), CardStartState(flipped = true))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfoldedBack() = shoot("study-a15-unfolded-back") {
        study(ui(view(CardTypes.HANZI_TO_MEANING), CardExtras(tutorNotes = notes, flagTutors = tutors)), CardStartState(flipped = true))
    }

    @Test fun darkBack() = shoot("study-a16-dark-back", dark = true) {
        study(ui(view(CardTypes.MEANING_TO_HANZI), CardExtras(tutorNotes = notes)), CardStartState(flipped = true, answer = "打算"))
    }

    // ---------------- part 2: multiple choice, recording, sentence tools ----------------

    private val mcRows = listOf(
        MultipleChoice.Row("打", listOf("找", "打", "灯", "扛")),
        MultipleChoice.Row("算", listOf("笔", "蒜", "算", "篮")),
    )

    @Test fun mcGrid() = shoot("study-b01-mc-grid") {
        study(ui(view(CardTypes.AUDIO_TO_HANZI), CardExtras(mc = McUi(rows = mcRows, showing = true, cached = true, auto = true))))
    }

    /** One pick made: the button reads "Submit" (with nothing picked it reads "Show answer"). */
    @Test fun mcPartial() = shoot("study-b02-mc-partial") {
        val v = view(CardTypes.MEANING_TO_HANZI)
        Box(Modifier.fillMaxSize()) {
            study(ui(v, CardExtras(mc = McUi(rows = mcRows, showing = true))))
            Box(Modifier.align(Alignment.BottomCenter).background(Lab.colors.background).padding(16.dp)) {
                McGrid(mcRows, aiAvailable = true, regenerating = false, onSubmit = { _, _ -> }, onTypeInstead = {}, onRegenerate = {}, startSelections = listOf("找", null))
            }
        }
    }

    /** One tap later: the back, row by row — the wrong pick in red, the blank row dashed. */
    @Test fun mcBackPartial() = shoot("study-b06-mc-back-partial") {
        val slots = MultipleChoice.answerSlots(mcRows, listOf("找", null))
        study(ui(view(CardTypes.MEANING_TO_HANZI)), CardStartState(flipped = true, answer = MultipleChoice.submittedAnswer(mcRows, listOf("找", null)), mcSlots = slots))
    }

    @Test fun mcShowOptions() = shoot("study-b03-listen-show-options") {
        study(ui(view(CardTypes.AUDIO_TO_HANZI), CardExtras(mc = McUi(rows = mcRows, ready = true, auto = true, cached = true), voices = listOf("a", "b"))))
    }

    @Test fun mcLoading() = shoot("study-b04-mc-loading", settleMs = 300) {
        study(ui(view(CardTypes.AUDIO_TO_HANZI), CardExtras(mc = McUi(loading = true, auto = true))))
    }

    @Test fun mcFallback() = shoot("study-b05-mc-fallback") {
        study(ui(view(CardTypes.AUDIO_TO_HANZI), CardExtras(mc = McUi(skip = true, auto = true, fallbackNote = MultipleChoice.Fallback.TIMEOUT.message))), CardStartState(answer = "打"))
    }

    @Test fun readFrontRecord() = shoot("study-b06-read-front-record") {
        study(ui(view(CardTypes.HANZI_TO_MEANING)))
    }

    @Test fun readFrontRecording() = shoot("study-b07-read-front-recording") {
        study(ui(view(CardTypes.HANZI_TO_MEANING), CardExtras(take = TakeUi(recording = true))))
    }

    @Test fun readFrontTake() = shoot("study-b08-read-front-take") {
        study(ui(view(CardTypes.HANZI_TO_MEANING), CardExtras(take = TakeUi(hasTake = true))))
    }

    @Test fun readBackTranscribed() = shoot("study-b09-read-back-you-said") {
        val said = TranscriptionComparison("我打算明天去", "wǒ dǎ suàn míng tiān qù", isMatch = false, containsExpected = true)
        study(ui(view(CardTypes.HANZI_TO_MEANING), CardExtras(take = TakeUi(hasTake = true, transcription = TranscriptionUi.Done(said)))), CardStartState(flipped = true))
    }

    @Test fun readBackOfflineTake() = shoot("study-b10-read-back-offline-take") {
        study(ui(view(CardTypes.HANZI_TO_MEANING), CardExtras(take = TakeUi(hasTake = true, transcription = TranscriptionUi.Offline)), online = false), CardStartState(flipped = true))
    }

    /** Live and upload both failed: never nothing any more — a retry on the saved take. */
    @Test fun readBackTranscriptionFailed() = shoot("study-b10b-read-back-transcribe-failed") {
        study(ui(view(CardTypes.HANZI_TO_MEANING), CardExtras(take = TakeUi(hasTake = true, transcription = TranscriptionUi.Failed))), CardStartState(flipped = true))
    }

    private val breakdown = dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation(
        words = listOf(
            dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord("你", "nǐ", "you"),
            dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord("周末", "zhōumò", "weekend"),
            dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord("打算", "dǎsuàn", "plan to"),
            dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord("做", "zuò", "do"),
            dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord("什么", "shénme", "what"),
        ),
        construction = "Time word (周末) goes before the verb; 打算 + verb phrase = plan to do.",
    )

    @Test fun sentenceTools() = shoot("study-b11-sentence-tools") {
        val v = view(CardTypes.HANZI_TO_MEANING)
        Column(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(20.dp)) {
            // The clue row fully open with its breakdown; the set rows closed.
            SentenceListOpen(v, breakdown)
        }
    }

    @Composable
    private fun SentenceListOpen(v: CardView, ex: dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation) {
        val u = ui(v)
        // "Show all" opens every row; the clue row has its explanation cached.
        SentenceList(v, u, null, StudyActions(), startExplained = mapOf("clue:n1" to ex), startShowAll = true)
    }

    @Test fun addChunk() = shoot("study-b12-add-as-card") {
        overCard(ui(view(CardTypes.HANZI_TO_MEANING)), CardStartState(flipped = true)) {
            AddChunkBody(
                Chunk("周末", "zhōumò", "weekend"), "d1",
                SentenceActions(decks = { listOf("d1" to "HSK 3 · Plans & time", "d2" to "Homework — 周末的活动", "d3" to "Food & ordering") }, deckHas = { d, _ -> d == "d2" }),
                onDismiss = {},
            )
        }
    }

    @Test fun sentencesEmpty() = shoot("study-b13-sentences-empty") {
        val v = view(CardTypes.HANZI_TO_MEANING, note = Samples.note.copy(sentenceClue = null)).copy(sentences = emptyList())
        study(ui(v), CardStartState(flipped = true))
    }

    // ---------------- answer marks: wrong = red + solid underline, missing = "?" + dashed underline ----------------

    private val sentenceNote = Samples.note.copy(hanzi = "我打算明年去中国", pinyin = "wǒ dǎsuàn míngnián qù Zhōngguó", english = "I plan to go to China next year")

    /** A typed sentence: two wrong characters, and one character short at the end. */
    @Test fun typedWrongMarks() = shoot("study-c01-typed-wrong-underlined") {
        study(ui(view(CardTypes.MEANING_TO_HANZI, note = sentenceNote)), CardStartState(flipped = true, answer = "我大算明天去中"))
    }

    @Test fun typedWrongMarksDark() = shoot("study-c02-typed-wrong-underlined-dark", dark = true) {
        study(ui(view(CardTypes.MEANING_TO_HANZI, note = sentenceNote)), CardStartState(flipped = true, answer = "我大算明天去中"))
    }

    /** One character too many: the extra one is wrong (red + underlined). */
    @Test fun typedExtra() = shoot("study-c03-typed-extra") {
        study(ui(view(CardTypes.AUDIO_TO_HANZI)), CardStartState(flipped = true, answer = "打蒜了"))
    }

    /** Multiple choice, both rows picked wrong. */
    @Test fun mcBackWrong() = shoot("study-c04-mc-back-wrong") {
        val picks = listOf("找", "蒜")
        study(ui(view(CardTypes.MEANING_TO_HANZI)), CardStartState(flipped = true, answer = MultipleChoice.submittedAnswer(mcRows, picks), mcSlots = MultipleChoice.answerSlots(mcRows, picks)))
    }

    /** Multiple choice, partial (one wrong, one blank), in dark mode. */
    @Test fun mcBackPartialDark() = shoot("study-c05-mc-back-partial-dark", dark = true) {
        val picks = listOf("找", null)
        study(ui(view(CardTypes.MEANING_TO_HANZI)), CardStartState(flipped = true, answer = MultipleChoice.submittedAnswer(mcRows, picks), mcSlots = MultipleChoice.answerSlots(mcRows, picks)))
    }

    // ---------------- peek: tap empty space on the answer → the question, ratings still up ----------------

    /** A typed card peeked back at its question after the check: the prompt, a quiet hint, the ratings. */
    @Test fun peekTyped() = shoot("study-d01-peek-question") {
        study(ui(view(CardTypes.MEANING_TO_HANZI)), CardStartState(peeking = true, answer = "打蒜"))
    }

    /** A read card peeked back at its hanzi, in dark mode. */
    @Test fun peekReadDark() = shoot("study-d02-peek-question-read-dark", dark = true) {
        study(ui(view(CardTypes.HANZI_TO_MEANING)), CardStartState(peeking = true))
    }
}
