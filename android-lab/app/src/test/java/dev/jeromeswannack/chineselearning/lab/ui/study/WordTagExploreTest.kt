package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.WordFrequency
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTags
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTagsAi
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorerController
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalInExplorer
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Chinese in a word tag's explanation sheet opens the language explorer (Jerome: "when a card
 * has the Formal pill and it suggests less formal words, I'd love to click those words"): the
 * register note "use 人品 or 脾气 in casual speech" is tappable by WORD (the device segmenter);
 * a tap opens the explorer on 人品, the sheet steps aside and comes back when the explorer
 * closes; inside the explorer (the Word view's pills) a tap pushes. Web: WordTagPills.test.tsx.
 * Screenshots: word-tags-19/20-sheet-links*.png.
 */
class WordTagExploreTest : LabScreenshotTest() {
    private val note = "Formal/literary; use 人品 or 脾气 in casual speech"
    private val renxing: NoteEntity = Samples.note.copy(
        id = "n-renxing", hanzi = "人性", pinyin = "rénxìng", english = "human nature", funFacts = null,
        wordTags = """{"v":1,"register":"formal","register_note":"$note","confidence":"high"}""",
    )
    private val events = ArrayList<Pair<String, Map<String, Any?>>>()

    @Before fun load() {
        assertNotNull(WordTags.shipped)
        assertNotNull(WordFrequency.shipped)
        DeviceWords.setForTests(Segmenter.shipped)
        StudyPrefs.get(ApplicationProvider.getApplicationContext()).setWordTagsOn(true)
    }

    @After fun unload() = DeviceWords.setForTests(null)

    private fun ui(n: NoteEntity): StudyUi {
        val now = Js.parseDate("2026-10-11T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", n.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, n, emptyList(), CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 7–9", true)
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 12, correct = 11), canUndo = true, online = true, forcedOffline = false)
    }

    /** Taps [word] inside the text of [node] (where the link is, not the middle of the line). */
    private fun tapWord(node: SemanticsNodeInteraction, text: String, word: String) {
        val layouts = ArrayList<TextLayoutResult>()
        node.fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)
        val start = text.indexOf(word)
        assertTrue("'$word' in '$text'", start >= 0)
        val box = layouts.first().getBoundingBox(start)
        node.performTouchInput { click(Offset(box.center.x, box.center.y)) }
        compose.mainClock.advanceTimeBy(600)
    }

    private fun sheetCount() = compose.onAllNodes(hasTestTag(WORD_TAG_SHEET_TAG)).fetchSemanticsNodes().size

    @Test fun aWordInTheRegisterNoteOpensTheExplorerAndTheSheetComesBack() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalExplorer provides controller) {
                    StudyScreen(ui(renxing), playingKey = null, actions = StudyActions(), autoplay = false)
                }
            }
        }
        compose.onNodeWithText("Show answer").performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag(wordTagTestTag("register:F")).performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag(WORD_TAG_SHEET_HINT_TAG).assertExists()

        tapWord(compose.onNodeWithText(note), note, "人品")
        val opened = controller.stack.single()
        assertTrue("a word view, not a character: $opened", opened is ExplorerItem.Word && opened.hanzi == "人品")
        assertEquals("the sheet stepped aside", 0, sheetCount())
        assertTrue(events.any { it.first == "explorer.open" && it.second["source"] == "word_tag" })

        // ✕ in the explorer → back to the Formal sheet, ready for 脾气.
        compose.runOnIdle { controller.close() }
        compose.mainClock.advanceTimeBy(600)
        assertEquals("the sheet came back", 1, sheetCount())
        tapWord(compose.onNodeWithText(note), note, "脾气")
        assertEquals("脾气", (controller.stack.single() as ExplorerItem.Word).hanzi)
    }

    @Test fun insideTheExplorerATapPushesAndTheSheetStaysClosed() {
        val controller = ExplorerController()
        compose.runOnIdle { controller.open(ExplorerItem.Word("人性"), "study") }
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalExplorer provides controller, LocalInExplorer provides true) {
                    WordTagsFor("人性", source = "explorer", aiTags = renxing.wordTags)
                }
            }
        }
        compose.onNodeWithTag(wordTagTestTag("register:F")).performClick()
        compose.mainClock.advanceTimeBy(600)
        tapWord(compose.onNodeWithText(note), note, "脾气")
        assertEquals(listOf("人性", "脾气"), controller.stack.map { (it as ExplorerItem.Word).hanzi })
        assertEquals(0, sheetCount())
        compose.runOnIdle { controller.pop() }
        compose.mainClock.advanceTimeBy(600)
        assertEquals("pushed from inside: the sheet does not come back on its own", 0, sheetCount())
    }

    // ---------------- screenshots ----------------

    private fun shootSheet(name: String, dark: Boolean) = shoot(name, dark = dark) {
        val lex = WordTags.shipped!!
        val ai = WordTagsAi.parse(renxing.wordTags)
        val tag = WordTagsAi.tags(renxing.hanzi, lex, ai).first { it.id == "register:F" }
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 28.dp, bottom = 24.dp),
            ) {
                // In the app the explorer is in reach, so the Chinese is tappable (underlined).
                CompositionLocalProvider(LocalExplorer provides ExplorerController()) {
                    WordTagSheetContent(tag, WordTagsAi.explanation(tag, renxing.hanzi, lex, ai)) {}
                }
            }
        }
    }

    @Test fun shotSheetLinks() = shootSheet("word-tags-19-sheet-links", dark = false)
    @Test fun shotSheetLinksDark() = shootSheet("word-tags-20-sheet-links-dark", dark = true)
}
