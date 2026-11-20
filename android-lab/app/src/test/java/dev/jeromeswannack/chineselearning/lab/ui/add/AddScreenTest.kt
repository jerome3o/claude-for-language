package dev.jeromeswannack.chineselearning.lab.ui.add

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.jeromeswannack.chineselearning.lab.core.add.AddTab
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.data.api.ChineseCandidateDto
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsComposeActions
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsComposeTags
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsActions
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsSamples
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsScreen
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.core.TakeLock
import dev.jeromeswannack.chineselearning.lab.ui.kit.TakeLocks
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A synthetic "photo of a laptop during a video lesson": tabs, English UI, the 太体面了 subtitle in the middle. */
object AddSamples {
    fun subtitlePhoto(): Bitmap {
        val w = 1280
        val h = 900
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        c.drawColor(0xFF2B2F36.toInt())
        // Browser chrome + a tab title.
        p.color = 0xFFDADCE0.toInt(); c.drawRect(0f, 0f, w.toFloat(), 70f, p)
        p.color = 0xFF3C4043.toInt(); p.textSize = 30f; c.drawText("新标签页 - Google Chrome", 30f, 48f, p)
        // Two "faces" (plain shapes — never real people).
        p.color = 0xFF5F6B7A.toInt(); c.drawRoundRect(60f, 130f, 520f, 560f, 24f, 24f, p)
        p.color = 0xFF6E5F7A.toInt(); c.drawRoundRect(760f, 130f, 1220f, 560f, 24f, 24f, p)
        p.color = 0xFFC9B79C.toInt(); c.drawCircle(290f, 330f, 110f, p); c.drawCircle(990f, 330f, 110f, p)
        // The subtitle on a dark box, a little off-centre like a photo taken at an angle.
        p.color = 0xCC000000.toInt(); c.drawRoundRect(400f, 620f, 880f, 720f, 12f, 12f, p)
        p.color = 0xFFFFFFFF.toInt(); p.textSize = 68f; p.typeface = Typeface.DEFAULT_BOLD
        c.drawText("太体面了", 505f, 695f, p)
        // English UI noise.
        p.typeface = Typeface.DEFAULT; p.textSize = 28f; p.color = 0xFFE8EAED.toInt()
        c.drawText("Mute", 420f, 860f, p); c.drawText("Share screen", 560f, 860f, p); c.drawText("Leave", 800f, 860f, p)
        return bmp
    }

    val lines = AddTab.orderLines(
        listOf(
            AddTab.Line("新标签页 - Google Chrome", listOf(10.0, 20.0, 70.0, 320.0)),
            AddTab.Line("Share screen", listOf(930.0, 430.0, 970.0, 600.0)),
            AddTab.Line("太体面了", listOf(690.0, 312.0, 800.0, 688.0), main = true),
        ),
    )

    val done get() = AddUi(method = AddMethod.PHOTO, photo = PhotoUi(image = subtitlePhoto().asImageBitmap(), status = "done", lines = lines))
    val reading get() = AddUi(method = AddMethod.PHOTO, photo = PhotoUi(image = subtitlePhoto().asImageBitmap(), status = "reading"))
    val candidates = listOf(
        ChineseCandidateDto("体面", "tǐmiàn", "dignified; decent", "about looks / reputation"),
        ChineseCandidateDto("像样", "xiàngyàng", "presentable", "spoken"),
    )
}

class AddScreenTest : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    private fun inShell(name: String, dark: Boolean = false, content: @androidx.compose.runtime.Composable () -> Unit) = shootInShell(name, TabId.ADD, dark = dark) { content() }

    @Test fun shotTab() = inShell("add-01-tab") { AddScreen(AddUi(), AddActions()) }
    @Test fun shotTabDark() = inShell("add-02-tab-dark", dark = true) { AddScreen(AddUi(), AddActions()) }
    @Test fun shotReading() = inShell("add-03-photo-reading-dark", dark = true) { AddScreen(AddSamples.reading, AddActions()) }
    @Test fun shotPhotoWords() = inShell("add-04-photo-words-dark", dark = true) { AddScreen(AddSamples.done, AddActions()) }
    @Test fun shotPhotoWordsLight() = inShell("add-05-photo-words") { AddScreen(AddSamples.done, AddActions()) }

    private val listeningEn = VoiceDictationUi(phase = "listening", finalText = "dignified", partialText = "")
    @Test fun shotSayEnglish() = inShell("add-06-say-english-candidates-dark", dark = true) {
        AddScreen(AddUi(method = AddMethod.SAY_EN, candidates = AddSamples.candidates), AddActions(), voicePreview = VoiceDictationUi(mode = "type"))
    }
    @Test fun shotSayListening() = inShell("add-07-say-listening-dark", dark = true) {
        AddScreen(AddUi(method = AddMethod.SAY_EN), AddActions(), voicePreview = listeningEn)
    }
    /** Back on the tab with 🎤 Say it still picked: BEFORE it was already listening (drawn here); now it waits for a tap. */
    @Test fun shotBackOnTabBefore() = inShell("add-14-back-on-tab-before-dark", dark = true) {
        AddScreen(AddUi(method = AddMethod.SAY_ZH, boxKey = 1), AddActions(), voicePreview = VoiceDictationUi(phase = "listening"))
    }
    @Test fun shotBackOnTabAfter() = inShell("add-15-back-on-tab-after-dark", dark = true) {
        AddScreen(AddUi(method = AddMethod.SAY_ZH, boxKey = 1), AddActions(), voicePreview = VoiceDictationUi())
    }
    @Test fun shotTypedSentence() = inShell("add-08-typed-sentence-dark", dark = true) {
        AddScreen(AddUi(method = AddMethod.TYPE, typedLine = "这件衣服穿起来太体面了"), AddActions(), voicePreview = VoiceDictationUi(mode = "type"))
    }
    @Test fun shotSheet() = shoot("add-09-reader-sheet-dark", dark = true) {
        ContentSheetContent(ContentSheetUi(AddTab.READER, text = "去北京旅行"), AddActions(), VoiceDictationUi(mode = "type"), offline = false)
    }
    @Test fun shotAudioSheet() = shoot("add-10-audio-sheet-dark", dark = true) {
        ContentSheetContent(ContentSheetUi(AddTab.AUDIO, format = "dialogue"), AddActions(), VoiceDictationUi(), offline = false)
    }
    @Test fun shotResults() = inShell("add-11-results-dark", dark = true) {
        AddScreen(
            AddUi(results = listOf(
                AddResult("1", AddTab.READER, "去北京旅行", "making", "/readers/r1"),
                AddResult("2", AddTab.LESSON, "了 vs 过", "ready", "/lessons/l1/play"),
            )),
            AddActions(),
        )
    }

    /** The Chats tab with the Claude box (its chips) pinned at the bottom, the list above. */
    @Test fun shotChatsBox() = shootInShell("add-12-chats-claude-box-dark", TabId.CHATS, dark = true) {
        ChatsScreen(ChatsSamples.loaded, ChatsActions(compose = ChatsComposeActions(onChip = {})))
    }
    @Test fun shotChatsBoxLight() = shootInShell("add-13-chats-claude-box", TabId.CHATS) {
        ChatsScreen(ChatsSamples.loaded, ChatsActions(compose = ChatsComposeActions(onChip = {})))
    }

    // ---------------- behaviour ----------------

    @Test fun aWordChipOpensTheExplorerWithItsLine() {
        var looked: List<String?>? = null
        compose.setContent { LabTheme { AddScreen(AddSamples.done, AddActions(onLookUp = { w, p, g, s -> looked = listOf(w, p, g, s) })) } }
        compose.waitForIdle()
        // The subtitle comes first; the tab title's line is there too, the English isn't.
        compose.onAllNodesWithTag(AddTags.LINE).assertCountEquals(2)
        compose.onNodeWithText("Share screen").assertDoesNotExist()
        compose.onNodeWithText("体面").performClick()
        assertEquals("体面", looked?.get(0))
        assertEquals("太体面了", looked?.get(3))
    }

    @Test fun pickingCharactersLooksUpThatSpan() {
        var looked: String? = null
        compose.setContent { LabTheme { AddScreen(AddSamples.done, AddActions(onLookUp = { w, _, _, _ -> looked = w })) } }
        compose.waitForIdle()
        compose.onAllNodesWithTag(AddTags.PICK).onFirst().performClick()
        val chars = compose.onAllNodesWithTag(AddTags.CHAR)
        chars[0].performClick() // 太
        chars[1].performClick() // 体
        compose.onNodeWithTag(AddTags.SPAN_OPEN).performClick()
        assertEquals("太体", looked)
    }

    @Test fun photoIsOneTapAndTilesOpenTheirBox() {
        var photo = 0
        var tile: String? = null
        var method: String? = null
        compose.setContent { LabTheme { AddScreen(AddUi(), AddActions(onTakePhoto = { photo++ }, onTile = { tile = it }, onMethod = { method = it })) } }
        compose.waitForIdle()
        compose.onNodeWithTag(AddTags.method(AddMethod.PHOTO)).performClick()
        assertEquals(1, photo)
        compose.onNodeWithTag(AddTags.method(AddMethod.TYPE)).performClick()
        assertEquals(AddMethod.TYPE, method)
        compose.onNodeWithTag(AddTags.tile(AddTab.READER)).performScrollTo().performClick()
        assertEquals(AddTab.READER, tile)
        // ONE title: "Add" (the page) — never doubled.
        assertTrue(compose.onAllNodesWithText("Add").fetchSemanticsNodes().size == 1)
    }

    @Test fun aResultOpensWhatWasMade() {
        var opened: AddResult? = null
        val r = AddResult("1", AddTab.READER, "去北京旅行", "making", "/readers/r1")
        compose.setContent { LabTheme { AddScreen(AddUi(results = listOf(r)), AddActions(onResult = { opened = it })) } }
        compose.onNodeWithText("✓ Making your reader…  去北京旅行").assertIsDisplayed()
        compose.onNodeWithTag(AddTags.RESULT_OPEN).performClick()
        assertEquals("/readers/r1", opened?.path)
    }

    // ---------------- nothing records until he taps 🎤 (Jerome, Nov 2026) ----------------

    /** Opening the tab: no word box, no take, the take lock free (the tab bar navigates). */
    @Test fun openingTheTabNeverRecords() {
        TakeLocks.reset()
        var listened = 0
        compose.setContent { LabTheme { AddScreen(AddUi(), AddActions(onListened = { listened++ })) } }
        compose.waitForIdle()
        compose.onNodeWithTag(AddTags.WORD_BOX).assertDoesNotExist()
        assertEquals(0, listened)
        assertEquals(TakeLock.IDLE, TakeLocks.phase)
        assertEquals("run", TakeLocks.tap())
    }

    /**
     * Coming back to the tab with 🎤 Say it still picked (the ViewModel outlives the tab switch): the box is idle and
     * waits for a tap on its 🎤 — it used to start listening again by itself, and the running take then turned every
     * tab-bar tap into "stop the take".
     */
    @Test fun comingBackWithSayItPickedWaitsForATap() {
        TakeLocks.reset()
        var listened = 0
        var shown by mutableStateOf(true)
        val back = AddUi(method = AddMethod.SAY_ZH, boxKey = 1, listenBox = null)
        compose.setContent { LabTheme { if (shown) AddScreen(back, AddActions(onListened = { listened++ })) } }
        compose.waitForIdle()
        shown = false
        compose.waitForIdle()
        shown = true
        compose.waitForIdle()
        compose.onNodeWithTag(AddTags.WORD_BOX).assertExists()
        compose.onNodeWithTag(VoiceTextFieldTags.SAY).assertExists()
        compose.onNodeWithTag(VoiceTextFieldTags.STOP).assertDoesNotExist()
        assertEquals(0, listened)
        assertEquals(TakeLock.IDLE, TakeLocks.phase)
        assertEquals("run", TakeLocks.tap())
    }

    /** The tap on 🎤 Say it opens the box listening — once, for that tap only. */
    @Test fun theSayItTapStartsListeningOnce() {
        TakeLocks.reset()
        var listened = 0
        compose.setContent { LabTheme { AddScreen(AddUi(method = AddMethod.SAY_ZH, boxKey = 1, listenBox = 1), AddActions(onListened = { listened++ })) } }
        compose.waitForIdle()
        assertEquals(1, listened)
        TakeLocks.reset()
    }

    @Test fun theChatsBoxCarriesTheSuggestionChips() {
        var chip: String? = null
        compose.setContent { LabTheme { ChatsScreen(ChatsSamples.loaded, ChatsActions(compose = ChatsComposeActions(onChip = { chip = it.id }))) } }
        compose.waitForIdle()
        compose.onNodeWithTag(ChatsComposeTags.CHIPS).assertIsDisplayed()
        compose.onNodeWithTag(ChatsComposeTags.chip("quiz")).performClick()
        assertEquals("quiz", chip)
        // The tutor's compact box has none.
    }
}
