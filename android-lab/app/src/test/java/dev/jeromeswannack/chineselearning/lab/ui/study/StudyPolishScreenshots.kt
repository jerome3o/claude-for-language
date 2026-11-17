package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.robolectric.annotation.Config

/**
 * The study card, second polish round (docs/STUDY_SESSION.md "The study card's layout"): room above the hanzi, no ▶ on
 * "You said" (⋯ → Play my recording), outlined Ask Claude · Edit card · ⋯, the sentences' one outline and one-line
 * rows, the standard gap around the frame, the one result look and the "right" moment. Uses only APIs that exist before
 * the change too, so the same class renders the before / after pair.
 */
class StudyPolishScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-11-17T09:30:00.000Z")
    private val note = Samples.note.copy(
        hanzi = "虾饺", pinyin = "xiā jiǎo", english = "shrimp dumpling (har gow)",
        funFacts = "**虾** (xiā) shrimp · **饺** (jiǎo) dumpling. A Cantonese dim sum classic with a translucent wheat-starch skin.",
        sentenceClue = "我最喜欢吃虾饺。", sentenceCluePinyin = "Wǒ zuì xǐhuan chī xiājiǎo.", sentenceClueTranslation = "I like shrimp dumplings best.",
    )
    private val sentences = listOf(
        SentenceEntity("s1", "n1", 0, "这家店的虾饺很好吃。", "Zhè jiā diàn de xiājiǎo hěn hǎochī.", "The har gow at this place is delicious.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "我们点一笼虾饺吧。", "Wǒmen diǎn yì lóng xiājiǎo ba.", "Let’s order a basket of har gow.", null, "core", null),
        SentenceEntity("s3", "n1", 2, "早茶一定要吃虾饺。", "Zǎochá yídìng yào chī xiājiǎo.", "You have to eat har gow at dim sum.", null, "core", null),
        SentenceEntity("s4", "n1", 3, "虾饺的皮是透明的。", "Xiājiǎo de pí shì tòumíng de.", "The skin of har gow is see-through.", null, "core", null),
    )

    private fun view(type: String): CardView {
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-11-01T08:00:00.000Z")
        state = CardScheduler.applyReview(state, 2, "2026-11-01T08:12:00.000Z")
        val card = QueueCard("c1", note.id, "d1", type, state)
        return CardView(card, note, sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Core Homework", true)
    }

    private fun ui(v: CardView, extras: CardExtras = CardExtras()) =
        StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = true, forcedOffline = false, extras = extras)

    @Composable
    private fun study(ui: StudyUi, start: CardStartState = CardStartState()) =
        StudyScreen(ui, playingKey = null, actions = StudyActions(), cardStart = start, autoplay = false, pendingReviews = 0)

    private fun said(hanzi: String, pinyin: String, match: Boolean = false, contains: Boolean = false, tonesOff: Boolean = false) =
        CardExtras(take = TakeUi(hasTake = true, transcription = TranscriptionUi.Done(TranscriptionComparison(hanzi, pinyin, isMatch = match, containsExpected = contains, tonesOff = tonesOff))))

    private val match = said("虾饺", "xiā jiǎo", match = true)

    @Test fun readQuestionDark() = shoot("polish2-01-read-question-dark", dark = true) { study(ui(view(CardTypes.HANZI_TO_MEANING))) }

    @Test fun readBackDark() = shoot("polish2-02-read-back-dark", dark = true) {
        study(ui(view(CardTypes.HANZI_TO_MEANING), match), CardStartState(flipped = true))
    }

    @Test fun readBackLight() = shoot("polish2-03-read-back-light") {
        study(ui(view(CardTypes.HANZI_TO_MEANING), match), CardStartState(flipped = true))
    }

    @Test fun meaningBackTypedRightDark() = shoot("polish2-04-meaning-back-typed-right-dark", dark = true) {
        study(ui(view(CardTypes.MEANING_TO_HANZI)), CardStartState(flipped = true, answer = "虾饺"))
    }

    @Test fun moreSheetDark() = shoot("polish2-05-more-sheet-dark", dark = true) {
        val v = view(CardTypes.HANZI_TO_MEANING)
        val u = ui(v, match)
        Box(Modifier.fillMaxSize()) {
            study(u, CardStartState(flipped = true))
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.32f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 12.dp, bottom = 20.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.muted.copy(alpha = 0.4f)))
                Spacer(Modifier.height(14.dp))
                StudyMoreList(studyMenuItems(v, u, StudyActions(), hasRecording = true, onFlag = {}), "Added 1 Sep 2026", onDismiss = {})
            }
        }
    }

    /** The answer side scrolled to the example sentences: every row collapsed. */
    @Test fun sentencesCollapsedDark() = shoot("polish2-06-sentences-collapsed-dark", dark = true) {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(horizontal = 12.dp, vertical = 16.dp)) {
            SentenceList(view(CardTypes.HANZI_TO_MEANING), ui(view(CardTypes.HANZI_TO_MEANING)), null, StudyActions())
        }
    }

    /** Row 2 showing its Chinese, row 3 its Chinese + pinyin: they grow downward under the same first line. */
    @Test fun sentencesHalfRevealedDark() = shoot("polish2-07-sentences-half-revealed-dark", dark = true) {
        val v = view(CardTypes.HANZI_TO_MEANING)
        val rows = sentenceRows(v)
        val state = SentenceRowsState()
        state.steps[rows[1].key] = 1
        state.steps[rows[2].key] = 2
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(horizontal = 12.dp, vertical = 16.dp)) {
            for (r in rows) SentenceRowView(r, state, true, null, StudyActions().sentences, onPlay = { _, _ -> }, onAdd = {})
        }
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun readBackUnfoldedDark() = shoot("polish2-08-read-back-unfolded-dark", dark = true) {
        study(ui(view(CardTypes.HANZI_TO_MEANING), match), CardStartState(flipped = true))
    }

    private val mcRows = listOf(
        MultipleChoice.Row("虾", listOf("虾", "蛇", "蚊", "蛙", "蜗")),
        MultipleChoice.Row("饺", listOf("铰", "饺", "校", "绞", "皎")),
        MultipleChoice.Row("子", listOf("字", "了", "子", "孑", "孔")),
    )

    /** The listening card with "Listen in context" and the 8-second multiple choice: nothing touches the frame. */
    @Test fun listeningMcDark() = shoot("polish2-09-listening-mc-dark", dark = true) {
        study(ui(view(CardTypes.AUDIO_TO_HANZI), CardExtras(mc = McUi(rows = mcRows, showing = true, cached = true, auto = true))))
    }

    /** Every result state on the same card (match · contains · close · didn't match · checking). */
    @Test fun resultStatesDark() = shoot("polish2-10-result-states-dark", dark = true) {
        Column(
            Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("虾饺 · read aloud", color = Lab.colors.muted, fontSize = 13.sp)
            YouSaidBox(TranscriptionComparison("虾饺", "xiā jiǎo", isMatch = true, containsExpected = false), expected = "虾饺")
            YouSaidBox(TranscriptionComparison("我想吃虾饺", "wǒ xiǎng chī xiā jiǎo", isMatch = false, containsExpected = true), onCoach = {}, expected = "虾饺")
            YouSaidBox(TranscriptionComparison("下脚", "xià jiǎo", isMatch = false, containsExpected = false, tonesOff = true), expected = "虾饺")
            YouSaidBox(TranscriptionComparison("小姐", "xiǎo jiě", isMatch = false, containsExpected = false), expected = "虾饺")
            YouSaidBox(TranscriptionComparison("下脚", "xià jiǎo", isMatch = false, containsExpected = false), checking = true, expected = "虾饺")
            SpokenResultRow("虾饺", "虾饺", dev.jeromeswannack.chineselearning.lab.core.AnswerKey.Verdict.EXACT)
            SpokenResultRow("我想吃虾饺", "虾饺", dev.jeromeswannack.chineselearning.lab.core.AnswerKey.Verdict.CONTAINS)
        }
    }

    /** A frame mid-animation: the test clock stopped ([shoot] would let it run to the end before capturing). */
    private fun shootMidMoment(name: String, atMs: Long, content: @Composable () -> Unit) {
        val ctx = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        android.provider.Settings.Global.putFloat(ctx.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        compose.mainClock.autoAdvance = false
        compose.setContent { dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme(dark = true) { content() } }
        compose.mainClock.advanceTimeBy(atMs)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    /** Hard mode's question, right: a frame mid-burst (the wash bright, the confetti flying). */
    @Test fun hardRightMomentDark() = shootMidMoment("polish2-11-hard-right-moment-dark", 240) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(8.dp), contentAlignment = Alignment.BottomCenter) {
            HardModeFeedbackPanel(result = "right", said = "虾饺", spoken = true, roundFollows = true, onTryAgain = {}, onShowAnswer = {}, onNext = {})
        }
    }

    /** A typed answer right on the back, mid-burst. */
    @Test fun typedRightMomentDark() = shootMidMoment("polish2-12-typed-right-moment-dark", 240) {
        study(ui(view(CardTypes.MEANING_TO_HANZI)), CardStartState(flipped = true, answer = "虾饺"))
    }
}
