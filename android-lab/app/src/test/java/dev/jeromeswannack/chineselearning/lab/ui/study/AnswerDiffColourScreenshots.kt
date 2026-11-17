package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/**
 * The answer diff's marks, colour only (docs/STUDY_SESSION.md "Answer feedback: one line and a diff"; Jerome, Nov 2026:
 * "we don't need the outlines and the color and the underlines … make the colors a little bit more subtle"). One take
 * with every kind — 他 wrong, 豆 tone off (都 dōu said dòu), 很 extra, 吗 missing — on the read card's "You said", the
 * typed answer and the bare diff, plus Jerome's own 院子 / 测试测试您好. Uses only APIs that exist before the change
 * too, so the same class renders the before / after pair.
 */
class AnswerDiffColourScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-11-17T09:30:00.000Z")
    private val note = Samples.note.copy(
        hanzi = "我们都去北京了吗", pinyin = "wǒmen dōu qù Běijīng le ma", english = "Have we all been to Beijing?",
        funFacts = "", sentenceClue = null, sentenceCluePinyin = null, sentenceClueTranslation = null,
    )
    private val yard = Samples.note.copy(
        hanzi = "院子", pinyin = "yuànzi", english = "courtyard; yard",
        funFacts = "", sentenceClue = null, sentenceCluePinyin = null, sentenceClueTranslation = null,
    )
    private val take = "他们豆去北京很了"

    private fun view(n: dev.jeromeswannack.chineselearning.lab.data.NoteEntity, type: String): CardView {
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-11-01T08:00:00.000Z")
        state = CardScheduler.applyReview(state, 2, "2026-11-01T08:12:00.000Z")
        val card = QueueCard("c1", n.id, "d1", type, state)
        return CardView(card, n, emptyList(), CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Core Homework", true)
    }

    private fun ui(v: CardView, extras: CardExtras = CardExtras()) =
        StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = true, forcedOffline = false, extras = extras)

    private fun said(hanzi: String, pinyin: String) =
        CardExtras(take = TakeUi(hasTake = true, transcription = TranscriptionUi.Done(TranscriptionComparison(hanzi, pinyin, isMatch = false, containsExpected = false, tonesOff = false))))

    private fun readBack(n: dev.jeromeswannack.chineselearning.lab.data.NoteEntity, hanzi: String, pinyin: String) = @androidx.compose.runtime.Composable {
        StudyScreen(ui(view(n, CardTypes.HANZI_TO_MEANING), said(hanzi, pinyin)), playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = true), autoplay = false, pendingReviews = 0)
    }

    @Test fun readYouSaidDark() = shoot("adiff-01-read-you-said-dark", dark = true) { readBack(note, take, "tāmen dòu qù Běijīng hěn le")() }

    @Test fun readYouSaidLight() = shoot("adiff-02-read-you-said-light") { readBack(note, take, "tāmen dòu qù Běijīng hěn le")() }

    /** Jerome's screenshot: 院子 read as 测试测试您好. */
    @Test fun jeromeYardDark() = shoot("adiff-03-yard-dark", dark = true) { readBack(yard, "测试测试您好", "cèshì cèshì nín hǎo")() }

    @Test fun typedAnswerDark() = shoot("adiff-04-typed-dark", dark = true) {
        StudyScreen(ui(view(note, CardTypes.MEANING_TO_HANZI)), playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = true, answer = take), autoplay = false, pendingReviews = 0)
    }

    /** The bare diff (Hard mode's check, the sentence check, a lesson's answer) in both themes. */
    private val panel = @androidx.compose.runtime.Composable {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(20.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
            Text("Hard mode's check", color = Lab.colors.muted, fontSize = 12.sp)
            AnswerDiffView(said = take, expected = note.hanzi, expectedPinyin = note.pinyin, onPlayExpected = {})
            AnswerDiffView(said = "他们都去北京了吗", expected = note.hanzi, expectedPinyin = note.pinyin, onPlayExpected = {})
            AnswerDiffView(said = "我们斗去北京了吗", expected = note.hanzi, expectedPinyin = note.pinyin, onPlayExpected = {})
            AnswerDiffView(said = "我们都去北京吗", expected = note.hanzi, expectedPinyin = note.pinyin, onPlayExpected = {})
        }
    }

    @Test fun panelDark() = shoot("adiff-05-panel-dark", dark = true) { panel() }

    @Test fun panelLight() = shoot("adiff-06-panel-light") { panel() }
}
