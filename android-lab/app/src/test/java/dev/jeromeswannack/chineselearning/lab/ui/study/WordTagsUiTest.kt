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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.WordFrequency
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTags
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTagsAi
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorerSamples
import dev.jeromeswannack.chineselearning.lab.ui.explorer.WordViewActions
import dev.jeromeswannack.chineselearning.lab.ui.explorer.WordViewContent
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

/**
 * Word tags on the answer side (web components/wordTags/WordTagPills.tsx): the pills under the
 * meaning from the shipped lexicon, a tap opens the explanation sheet and never peeks the card,
 * Settings → Study switches them off, the Word view of the explorer shows them too. AI word tags
 * (notes.word_tags, core WordTagsAi) add ✨ pills where the lexicon has nothing; their sheet says
 * "Suggested by AI — may be wrong" with the register note; low confidence shows nothing.
 * Screenshots: word-tags-*.png.
 */
class WordTagsUiTest : LabScreenshotTest() {
    private var peeks = 0

    private fun note(hanzi: String, pinyin: String, english: String) = Samples.note.copy(id = "n-$hanzi", hanzi = hanzi, pinyin = pinyin, english = english, funFacts = null)

    private val shuijiao = note("睡觉", "shuìjiào", "to sleep; to go to bed")
    private val shu = note("书", "shū", "book")
    private val nin = note("您", "nín", "you (polite)")
    private val gaozhi = note("告知", "gàozhī", "to inform").copy(
        wordTags = """{"v":1,"transitivity":"transitive","register":"formal","register_note":"formal written; in speech use 告诉","confidence":"high"}""",
    )
    private val xiuxi = note("休息", "xiūxi", "to rest").copy(wordTags = """{"v":1,"transitivity":"intransitive","register":"neutral","confidence":"medium"}""")
    private val jiezhang = note("结账", "jiézhàng", "to settle the bill")
    private val jiezhangEveryday = jiezhang.copy(
        wordTags = """{"v":2,"transitivity":"intransitive","register":"neutral","spoken":"everyday","spoken_confidence":"high","confidence":"high"}""",
    )
    /** HSK 1, but ranked ~16,000 by the written-text list. */
    private val yikuair = note("一块儿", "yíkuàir", "together")

    @Before fun load() {
        // Read once like the app does after the first card (the UI then has them at once).
        assertNotNull(WordTags.shipped)
        assertNotNull(WordFrequency.shipped)
        StudyPrefs.get(ApplicationProvider.getApplicationContext()).setWordTagsOn(true)
    }

    private fun ui(n: NoteEntity): StudyUi {
        val now = Js.parseDate("2026-10-11T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", n.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, n, emptyList(), CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 1 · Daily life", true)
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 12, correct = 11), canUndo = true, online = true, forcedOffline = false)
    }

    private fun showAnswer(n: NoteEntity) {
        compose.setContent { LabTheme { StudyScreen(ui(n), playingKey = null, actions = StudyActions(onPeek = { peeks++ }), autoplay = false) } }
        compose.onNodeWithText("Show answer").performClick()
        compose.mainClock.advanceTimeBy(600)
    }

    @Test fun theAnswerShowsTheTagsAndATapExplainsWithoutPeeking() {
        showAnswer(shuijiao)
        compose.onNodeWithTag(WORD_TAGS_TAG).assertIsDisplayed()
        compose.onNodeWithText("Verb").assertIsDisplayed()
        compose.onNodeWithText("Separable verb").assertIsDisplayed()
        compose.onNodeWithText("HSK 1").assertIsDisplayed()

        compose.onNodeWithTag(wordTagTestTag("separable")).performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag(WORD_TAG_SHEET_TAG).assertExists()
        compose.onNodeWithText("Separable verb 离合词").assertExists()
        compose.onNodeWithText("睡了一个好觉").assertExists()
        assertEquals("a tag never peeks the card", 0, peeks)

        compose.onNodeWithText("Got it").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(0, compose.onAllNodes(hasTestTag(WORD_TAG_SHEET_TAG)).fetchSemanticsNodes().size)
        compose.onNodeWithText(shuijiao.pinyin).assertExists()
    }

    @Test fun theQuestionSideHasNoTags() {
        compose.setContent { LabTheme { StudyScreen(ui(shu), playingKey = null, actions = StudyActions(), autoplay = false) } }
        compose.mainClock.advanceTimeBy(600)
        assertEquals(0, compose.onAllNodes(hasTestTag(WORD_TAGS_TAG)).fetchSemanticsNodes().size)
    }

    @Test fun measureWordAndRegister() {
        showAnswer(shu)
        compose.onNodeWithText("Noun").assertIsDisplayed()
        compose.onNodeWithText("Measure: 本 běn, 册 cè").assertIsDisplayed()
        compose.onNodeWithTag(wordTagTestTag("measure")).performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithText("一本书").assertExists()
    }

    @Test fun settingsSwitchesThemOff() {
        StudyPrefs.get(ApplicationProvider.getApplicationContext()).setWordTagsOn(false)
        showAnswer(nin)
        compose.onNodeWithText(nin.english).assertExists()
        assertEquals(0, compose.onAllNodes(hasTestTag(WORD_TAGS_TAG)).fetchSemanticsNodes().size)
        StudyPrefs.get(ApplicationProvider.getApplicationContext()).setWordTagsOn(true)
        compose.mainClock.advanceTimeBy(300)
        compose.onNodeWithText("Polite").assertIsDisplayed()
    }

    @Test fun aiTagsAddSparkledPillsAndTheSheetSaysSo() {
        showAnswer(gaozhi)
        compose.onNodeWithText("Takes an object").assertIsDisplayed()
        compose.onNodeWithText("Formal").assertIsDisplayed()
        compose.onNodeWithTag(wordTagTestTag("register:F")).performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag(WORD_TAG_SHEET_AI_TAG).assertExists()
        compose.onNodeWithText("✨ Suggested by AI — may be wrong").assertExists()
        compose.onNodeWithTag(WORD_TAG_SHEET_NOTE_TAG).assertExists()
        compose.onNodeWithText("formal written; in speech use 告诉").assertExists()
        assertEquals(0, peeks)
    }

    @Test fun aLexiconPillHasNoAiNotice() {
        showAnswer(shuijiao.copy(wordTags = """{"v":1,"transitivity":"intransitive","confidence":"high"}"""))
        compose.onNodeWithText("No object").assertIsDisplayed()
        compose.onNodeWithTag(wordTagTestTag("separable")).performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag(WORD_TAG_SHEET_TAG).assertExists()
        assertEquals(0, compose.onAllNodes(hasTestTag(WORD_TAG_SHEET_AI_TAG)).fetchSemanticsNodes().size)
    }

    @Test fun lowConfidenceShowsNothingExtra() {
        showAnswer(gaozhi.copy(wordTags = """{"v":1,"transitivity":"transitive","register":"formal","confidence":"low"}"""))
        compose.onNodeWithText("Verb").assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasTestTag(wordTagTestTag("transitivity:transitive"))).fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodes(hasTestTag(wordTagTestTag("register:F"))).fetchSemanticsNodes().size)
    }

    @Test fun withoutAVerdictItIsRare() {
        showAnswer(jiezhang)
        compose.onNodeWithText("Rare").assertIsDisplayed()
    }

    @Test fun everydaySpeechReplacesRare() {
        showAnswer(jiezhangEveryday)
        compose.onNodeWithText("Everyday speech").assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasTestTag(wordTagTestTag("frequency"))).fetchSemanticsNodes().size)
        compose.onNodeWithTag(wordTagTestTag("spoken:everyday")).performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag(WORD_TAG_SHEET_AI_TAG).assertExists()
        compose.onNodeWithText("✨ Suggested by AI — may be wrong").assertExists()
        assertEquals(0, peeks)
    }

    @Test fun anHskWordIsNeverRare() {
        showAnswer(yikuair)
        compose.onNodeWithText("HSK 1").assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasTestTag(wordTagTestTag("frequency"))).fetchSemanticsNodes().size)
    }

    @Test fun theSettingsRowFlipsThePref() {
        var on = true
        compose.setContent { LabTheme { SpokenAnswerSection(on = false, wordTagsOn = true, onWordTagsChange = { on = it }) {} } }
        compose.onNodeWithText(WORD_TAGS_LABEL).assertIsDisplayed().performClick()
        assertEquals(false, on)
    }

    // ---------------- screenshots ----------------

    /** Renders the card, presses Show answer, saves the answer side. */
    private fun shootAnswer(name: String, n: NoteEntity, dark: Boolean = false) {
        compose.setContent { LabTheme(dark = dark) { StudyScreen(ui(n), playingKey = null, actions = StudyActions(), autoplay = false) } }
        compose.onNodeWithText("Show answer").performClick()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun shotSeparable() = shootAnswer("word-tags-01-answer-separable", shuijiao)
    @Test fun shotSeparableDark() = shootAnswer("word-tags-02-answer-separable-dark", shuijiao, dark = true)
    @Test fun shotMeasure() = shootAnswer("word-tags-03-answer-measure", shu)
    @Test fun shotPoliteDark() = shootAnswer("word-tags-04-answer-polite-dark", nin, dark = true)
    @Test fun shotSheet() = shoot("word-tags-05-sheet") { overCard(shuijiao) { sheetFor("睡觉", "separable") } }
    @Test fun shotSheetDark() = shoot("word-tags-06-sheet-dark", dark = true) { overCard(shu) { sheetFor("书", "measure") } }
    @Test fun shotExplorer() = shoot("word-tags-07-explorer-word") { Box(Modifier.fillMaxSize().background(Lab.colors.card).padding(top = 24.dp)) { WordViewContent(ExplorerSamples.wordUi(), WordViewActions()) } }
    @Test fun shotAiAnswer() = shootAnswer("word-tags-10-answer-ai", gaozhi)
    @Test fun shotAiAnswerDark() = shootAnswer("word-tags-11-answer-ai-dark", xiuxi, dark = true)
    @Test fun shotAiSheet() = shoot("word-tags-12-sheet-ai") { overCard(gaozhi) { aiSheetFor(gaozhi, "register:F") } }
    @Test fun shotAiSheetDark() = shoot("word-tags-13-sheet-ai-dark", dark = true) { overCard(gaozhi) { aiSheetFor(gaozhi, "transitivity:transitive") } }
    @Test fun shotRareBefore() = shootAnswer("word-tags-14-answer-rare-before", jiezhang)
    @Test fun shotEveryday() = shootAnswer("word-tags-15-answer-everyday", jiezhangEveryday)
    @Test fun shotEverydayDark() = shootAnswer("word-tags-16-answer-everyday-dark", jiezhangEveryday, dark = true)
    @Test fun shotEverydaySheet() = shoot("word-tags-17-sheet-everyday") { overCard(jiezhangEveryday) { aiSheetFor(jiezhangEveryday, "spoken:everyday") } }
    @Test fun shotHskNotRare() = shootAnswer("word-tags-18-answer-hsk-not-rare", yikuair)
    @Test fun shotSettings() = shoot("word-tags-08-settings") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) { SpokenAnswerSection(on = false, wordTagsOn = true) {} }
    }
    @Test fun shotSettingsDark() = shoot("word-tags-09-settings-dark", dark = true) {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) { SpokenAnswerSection(on = false, wordTagsOn = true) {} }
    }

    @Composable
    private fun sheetFor(hanzi: String, id: String) {
        val lex = WordTags.shipped!!
        val freq = WordFrequency.shipped
        val tag = WordTags.tags(hanzi, lex, rankLoaded = freq != null, rank = freq?.words?.get(hanzi)).first { it.id == id }
        WordTagSheetContent(tag, WordTags.explanation(tag, hanzi, lex)) {}
    }

    @Composable
    private fun aiSheetFor(n: NoteEntity, id: String) {
        val lex = WordTags.shipped!!
        val ai = WordTagsAi.parse(n.wordTags)
        val tag = WordTagsAi.tags(n.hanzi, lex, ai).first { it.id == id }
        WordTagSheetContent(tag, WordTagsAi.explanation(tag, n.hanzi, lex, ai)) {}
    }

    /** A card behind (dimmed), the sheet over it — the way it looks on the phone. */
    @Composable
    private fun overCard(n: NoteEntity, content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Column(Modifier.fillMaxWidth().padding(top = 80.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(n.hanzi, fontSize = 56.sp, color = Lab.colors.ink)
                Text(n.pinyin, color = Lab.colors.accent, fontSize = 22.sp)
                Text(n.english, color = Lab.colors.ink, fontSize = 18.sp, textAlign = TextAlign.Center)
            }
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 12.dp, bottom = 24.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.muted.copy(alpha = 0.4f)))
                Spacer(Modifier.height(16.dp))
                content()
            }
        }
    }
}
