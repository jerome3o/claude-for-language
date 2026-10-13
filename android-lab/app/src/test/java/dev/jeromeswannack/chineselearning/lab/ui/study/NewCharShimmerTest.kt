package dev.jeromeswannack.chineselearning.lab.ui.study

import android.provider.Settings
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NewCharacters
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * "New characters shimmer" on the study card (NewCharShimmer.kt, core NewCharacters): 银行 with 银
 * already seen — only 行 shimmers, on the read card's question and on the answer side (its own
 * test tag + "New character" for screen readers), a card of known characters doesn't, the Settings
 * switch turns it off, and with the system's animations off it is the static tint (no animation).
 * Screenshots (mid-sweep): study-newchar-*.png.
 */
class NewCharShimmerTest : LabScreenshotTest() {
    private val now = Js.parseDate("2026-10-13T09:30:00.000Z")
    private val note = Samples.note.copy(
        id = "n-bank", hanzi = "银行", pinyin = "yínháng", english = "bank",
        funFacts = "**银** (yín) silver · **行** (háng) a firm, a trade\nTogether: a \"silver firm\" — a bank.\n- 行 is háng here, not xíng (to walk; OK).",
        sentenceClue = "我去银行取钱。", sentenceCluePinyin = "Wǒ qù yínháng qǔ qián.", sentenceClueTranslation = "I'm going to the bank to take out money.",
    )
    private val context get() = ApplicationProvider.getApplicationContext<android.app.Application>()

    @Before fun shimmerOn() = StudyPrefs.get(context).setNewCharShimmerOn(true)

    @After fun reset() {
        StudyPrefs.get(context).setNewCharShimmerOn(true)
        Settings.Global.putFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    }

    private fun view(flipped: Boolean = false, hanzi: String = note.hanzi, seen: Set<String> = setOf("银")): CardView {
        val state = CardScheduler.initialCardState()
        val n = note.copy(hanzi = hanzi)
        val card = QueueCard("c-bank", n.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        return CardView(
            card, n, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Money",
            start = CardStartState(flipped = flipped),
            newChars = NewCharacters.newCharactersIn(hanzi, seen),
        )
    }

    private fun ui(v: CardView) = StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(reviews = 6, correct = 5), canUndo = true)

    private fun render(v: CardView, dark: Boolean = false, phase: Float? = 0.5f) {
        compose.setContent {
            LabTheme(dark = dark) {
                CompositionLocalProvider(LocalNewCharShimmerPhase provides phase) {
                    StudyScreen(ui(v), playingKey = null, actions = StudyActions(), autoplay = false)
                }
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private val shimmering get() = compose.onAllNodesWithTag(NEW_CHAR_TAG, useUnmergedTree = true)

    @Test fun readCardQuestion() {
        render(view())
        shimmering.assertCountEquals(1)
        shimmering[0].assertTextEquals("行")
        shimmering[0].assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, NEW_CHAR_STATE))
        compose.onRoot().captureRoboImage("screenshots/study-newchar-01-front.png")
    }

    @Test fun readCardQuestionDark() {
        render(view(), dark = true)
        shimmering.assertCountEquals(1)
        compose.onRoot().captureRoboImage("screenshots/study-newchar-02-front-dark.png")
    }

    @Test fun answerSide() {
        render(view(flipped = true))
        // The flip card keeps the question face composed behind the answer: 行 once on each face.
        shimmering.assertCountEquals(2)
        shimmering[0].assertTextEquals("行")
        shimmering[1].assertTextEquals("行")
        compose.onRoot().captureRoboImage("screenshots/study-newchar-03-back.png")
    }

    @Test fun knownCharactersDoNotShimmer() {
        render(view(seen = setOf("银", "行")))
        shimmering.assertCountEquals(0)
    }

    @Test fun switchedOffInSettings() {
        StudyPrefs.get(context).setNewCharShimmerOn(false)
        render(view())
        shimmering.assertCountEquals(0)
    }

    /** "Remove animations" (animator duration scale 0): the static tint, still marked for screen readers. */
    @Test fun staticWithAnimationsOff() {
        Settings.Global.putFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        render(view(), phase = null)
        shimmering.assertCountEquals(1)
        shimmering[0].assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, NEW_CHAR_STATE))
        compose.onRoot().captureRoboImage("screenshots/study-newchar-04-static.png")
    }

    @Test fun settingsRow() {
        compose.setContent { LabTheme { SpokenAnswerSection(false, wordTagsOn = true, newCharShimmerOn = true) {} } }
        compose.onRoot().captureRoboImage("screenshots/study-newchar-05-settings.png")
    }
}
