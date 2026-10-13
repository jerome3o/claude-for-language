package dev.jeromeswannack.chineselearning.lab.ui.study

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.noteimages.DeckIllustrateDto
import dev.jeromeswannack.chineselearning.lab.data.noteimages.IllustrateEstimateDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.cards.NOTE_PICTURE_DRAWING_TAG
import dev.jeromeswannack.chineselearning.lab.ui.cards.NOTE_PICTURE_EMPTY_TAG
import dev.jeromeswannack.chineselearning.lab.ui.cards.NOTE_PICTURE_GENERATE_TAG
import dev.jeromeswannack.chineselearning.lab.ui.cards.NotePictureActions
import dev.jeromeswannack.chineselearning.lab.ui.cards.NotePicturePanel
import dev.jeromeswannack.chineselearning.lab.ui.cards.NotePictureUi
import dev.jeromeswannack.chineselearning.lab.ui.decks.ILLUSTRATE_ESTIMATE_TAG
import dev.jeromeswannack.chineselearning.lab.ui.decks.ILLUSTRATE_PROGRESS_TAG
import dev.jeromeswannack.chineselearning.lab.ui.decks.IllustrateDeckContent
import dev.jeromeswannack.chineselearning.lab.ui.decks.IllustrateUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * Pictures on cards (web components/noteImage/, shared/cards/note-image.ts): the picture goes WITH
 * the English on the meaning → hanzi question, and only on the answer side of hanzi → meaning;
 * Settings → Study → "Show pictures on cards" off hides it; the editor's Picture section and the
 * "Illustrate this deck" sheet. Screenshots: card-pictures-*.png.
 */
class NotePicturesUiTest : LabScreenshotTest() {
    private val apple: NoteEntity = Samples.note.copy(
        id = "n-apple", hanzi = "苹果", pinyin = "píngguǒ", english = "apple", funFacts = "苹 (píng) apple · 果 (guǒ) fruit",
        sentenceClue = "我每天吃一个苹果。", sentenceCluePinyin = "wǒ měitiān chī yí gè píngguǒ.", sentenceClueTranslation = "I eat an apple every day.",
        imageKey = "note-images/apple.png", imageSource = "generated",
    )

    /** A small drawn apple — the screenshots' stand-in for a generated picture. */
    private val picture: ImageBitmap by lazy {
        val b = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        c.drawColor(0xFFFFF3E0.toInt())
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = 0xFFB7E4A8.toInt(); c.drawOval(RectF(28f, 196f, 228f, 236f), p)
        p.color = 0xFFE53935.toInt(); c.drawCircle(104f, 140f, 62f, p); c.drawCircle(152f, 140f, 62f, p)
        p.color = 0xFFFF8A80.toInt(); c.drawCircle(96f, 118f, 16f, p)
        p.color = 0xFF6D4C41.toInt(); c.drawRoundRect(RectF(122f, 50f, 134f, 92f), 6f, 6f, p)
        p.color = 0xFF43A047.toInt(); c.drawOval(RectF(134f, 52f, 190f, 80f), p)
        b.asImageBitmap()
    }

    @Before fun on() = StudyPrefs.get(ApplicationProvider.getApplicationContext()).setPicturesOn(true)

    private fun ui(type: String, n: NoteEntity = apple): StudyUi {
        val now = Js.parseDate("2026-10-13T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c-$type", n.id, "d1", type, state)
        val view = CardView(card, n, emptyList(), CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Fruit 水果", true, picturePreview = picture)
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 12, correct = 11), canUndo = true, online = true, forcedOffline = false)
    }

    private fun show(type: String, n: NoteEntity = apple) {
        compose.setContent { LabTheme { StudyScreen(ui(type, n), playingKey = null, actions = StudyActions(), autoplay = false) } }
        compose.mainClock.advanceTimeBy(600)
    }

    private fun count(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().size

    @Test fun meaningToHanziShowsThePictureWithTheEnglish() {
        show(CardTypes.MEANING_TO_HANZI)
        compose.onNodeWithTag(PICTURE_FRONT_TAG).assertIsDisplayed()
        compose.onNodeWithText("apple").assertIsDisplayed()
    }

    @Test fun hanziToMeaningKeepsItForTheAnswer() {
        show(CardTypes.HANZI_TO_MEANING)
        assertEquals("never on the question of a card that tests the meaning", 0, count(PICTURE_FRONT_TAG))
        compose.onNodeWithText(SHOW_ANSWER_LABEL).performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag(PICTURE_BACK_TAG).assertExists()
    }

    @Test fun listenCardHasNoPictureOnTheQuestion() {
        show(CardTypes.AUDIO_TO_HANZI)
        assertEquals(0, count(PICTURE_FRONT_TAG))
    }

    @Test fun settingsOffHidesIt() {
        StudyPrefs.get(ApplicationProvider.getApplicationContext()).setPicturesOn(false)
        show(CardTypes.MEANING_TO_HANZI)
        assertEquals(0, count(PICTURE_FRONT_TAG))
        compose.onNodeWithText("apple").assertIsDisplayed()
    }

    @Test fun noPictureNoSpace() {
        show(CardTypes.MEANING_TO_HANZI, apple.copy(imageKey = null))
        assertEquals(0, count(PICTURE_FRONT_TAG))
    }

    @Test fun theEditorSectionSaysWhatItHas() {
        var generated = 0
        compose.setContent { LabTheme { NotePicturePanel(NotePictureUi(), NotePictureActions(onGenerate = { generated++ })) } }
        compose.onNodeWithTag(NOTE_PICTURE_EMPTY_TAG).assertIsDisplayed()
        compose.onNodeWithText("✨ Generate picture").performClick()
        assertEquals(1, generated)
    }

    @Test fun theEditorSectionSaysItIsDrawing() {
        compose.setContent { LabTheme { NotePicturePanel(NotePictureUi(status = "pending"), NotePictureActions()) } }
        compose.onNodeWithTag(NOTE_PICTURE_DRAWING_TAG).assertIsDisplayed()
    }

    @Test fun theEditorSectionShowsAnUpload() {
        compose.setContent { LabTheme { NotePicturePanel(NotePictureUi(imageKey = "k", source = "upload"), NotePictureActions(), preview = picture) } }
        compose.onNodeWithText("↻ Regenerate").assertIsDisplayed()
        compose.onNodeWithText("Your own picture").assertIsDisplayed()
        compose.onNodeWithTag(NOTE_PICTURE_GENERATE_TAG).assertIsDisplayed()
    }

    private val deckStatus = DeckIllustrateDto(
        deck_id = "d1", deck_name = "Fruit 水果", total = 24, with_image = 6, pending = 0, failed = 0, missing = 18,
        estimate = IllustrateEstimateDto(18, 1.26, "18 pictures · about $1.26"), illustrate_new = false, available = true,
    )

    @Test fun theIllustrateSheetShowsTheCostFirst() {
        compose.setContent { LabTheme { IllustrateDeckContent(IllustrateUi(deckStatus), {}, {}, {}) } }
        compose.onNodeWithTag(ILLUSTRATE_ESTIMATE_TAG).assertIsDisplayed()
        compose.onNodeWithText("18 pictures · about $1.26").assertIsDisplayed()
        compose.onNodeWithText("6 of 24 cards have a picture").assertIsDisplayed()
        compose.onNodeWithText("🖼 Draw 18 pictures").assertIsDisplayed()
        compose.onNodeWithTag(ILLUSTRATE_PROGRESS_TAG).assertIsDisplayed()
    }

    // ---- Screenshots ----

    @Test fun shotMeaningFront() = shoot("card-pictures-01-meaning-to-hanzi-question") {
        StudyScreen(ui(CardTypes.MEANING_TO_HANZI), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotReadFront() = shoot("card-pictures-02-hanzi-to-meaning-question") {
        StudyScreen(ui(CardTypes.HANZI_TO_MEANING), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotReadBack() {
        compose.setContent { LabTheme { StudyScreen(ui(CardTypes.HANZI_TO_MEANING), playingKey = null, actions = StudyActions(), autoplay = false) } }
        compose.onNodeWithText(SHOW_ANSWER_LABEL).performClick()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/card-pictures-03-hanzi-to-meaning-answer.png")
    }

    @Test fun shotEditor() = shoot("card-pictures-04-editor-section") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
            NotePicturePanel(NotePictureUi(imageKey = "k", source = "generated"), NotePictureActions(), preview = picture)
        }
    }

    @Test fun shotIllustrate() = shoot("card-pictures-05-illustrate-deck") {
        Box(Modifier.fillMaxSize().background(Lab.colors.card)) { IllustrateDeckContent(IllustrateUi(deckStatus), {}, {}, {}) }
    }

    @Test fun shotIllustrateDrawing() = shoot("card-pictures-06-illustrate-drawing") {
        Box(Modifier.fillMaxSize().background(Lab.colors.card)) {
            IllustrateDeckContent(IllustrateUi(deckStatus.copy(with_image = 15, pending = 9, missing = 0, estimate = IllustrateEstimateDto(0, 0.0, "Every card already has a picture"), illustrate_new = true)), {}, {}, {})
        }
    }
}
