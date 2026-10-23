package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertContentDescriptionContains
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorerController
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Jerome's own Coach conversation (Oct 2026): English → the translation 他在沙发上占了很多地方。 */
object PractiseSamples {
    const val SENTENCE = "他在沙发上占了很多地方。"
    const val ANALYSIS = """{"kind":"english","translation":{"originalInput":"he took up a lot of room on the couch",
"primary":{"hanzi":"他在沙发上占了很多地方。","pinyin":"Tā zài shāfā shang zhàn le hěn duō dìfang.","english":"He took up a lot of room on the couch.","note":"占地方 = to take up room."},
"alternatives":[{"hanzi":"他占了半个沙发。","pinyin":"Tā zhàn le bàn gè shāfā.","english":"He took up half the couch.","note":"More vivid."}],
"words":[],"grammar_points":[],"usage_note":"占 (zhàn) is \"to occupy\"; 在沙发上 says where."}}"""
    val thread = CoachThreadDto(
        CoachConversationDto("c7", "he took up a lot of room on the couch", "en", action = "translate", updated_at = "2026-10-22 09:00:00", message_count = 3),
        listOf(
            CoachMessageDto("p1", "c7", "user", "text", "he took up a lot of room on the couch"),
            CoachMessageDto("p2", "c7", "assistant", "analysis", ANALYSIS),
            CoachMessageDto("p3", "c7", "assistant", "text", "**占地方** means *to take up room* — 这个沙发很占地方。"),
        ),
    )
    val ui = CoachChatUi(thread = Loadable(thread))

    fun result(transcript: String) = CoachPractise.practise(transcript, SENTENCE)
}

/**
 * The Coach conversation (docs/CHAT.md "Chat ↔ Coach"): no quick-action chips, no "Cards go to";
 * the follow-up's 🎤 says Respond; the answer's Chinese opens the explorer by word; "🎤 Practise
 * saying it" beside each sentence (listening → the You said row → Try again; failed / empty / offline).
 */
class CoachPractiseTest : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    @Test fun noChipsAndTheFollowUpSaysRespond() {
        compose.setContent { LabTheme { CoachChatScreen(PractiseSamples.ui, CoachChatActions()) } }
        compose.onNodeWithText("He took up a lot of room on the couch.").assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasText("Cards go to"), useUnmergedTree = true).fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodes(hasText("💬 More examples"), useUnmergedTree = true).fetchSemanticsNodes().size)
        compose.onNodeWithTag(VoiceTextFieldTags.SAY).assertContentDescriptionContains("Respond", substring = true)
        assertEquals(0, compose.onAllNodes(hasText("Say it", substring = true), useUnmergedTree = true).fetchSemanticsNodes().size)
        // A practise row beside the sentence and each alternative.
        compose.onNodeWithTag(CoachPractiseTags.mic(CoachPractiseTags.ROOT), useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(CoachPractiseTags.mic("${CoachPractiseTags.ROOT}-alt-0"), useUnmergedTree = true).assertExists()
    }

    @Test fun theSentencesWordsOpenTheExplorer() {
        val controller = ExplorerController()
        compose.setContent {
            LabTheme { CompositionLocalProvider(LocalExplorer provides controller) { CoachChatScreen(PractiseSamples.ui, CoachChatActions()) } }
        }
        val node = compose.onAllNodes(SemanticsMatcher("the sentence") { n ->
            (if (SemanticsProperties.Text in n.config) n.config[SemanticsProperties.Text] else null)?.any { it.text == PractiseSamples.SENTENCE } == true
        }, useUnmergedTree = true).fetchSemanticsNodes().first()
        val text = node.config[SemanticsProperties.Text].first { it.text == PractiseSamples.SENTENCE }
        val links = text.getLinkAnnotations(0, text.length)
        val words = links.map { text.text.substring(it.start, it.end) }
        assertTrue("沙发" in words, "words: $words")
        val sofa = links.first { text.text.substring(it.start, it.end) == "沙发" }.item as LinkAnnotation.Clickable
        compose.runOnIdle { sofa.linkInteractionListener!!.onClick(sofa) }
        compose.runOnIdle { assertEquals("沙发", (controller.current as ExplorerItem.Word).hanzi) }

        // Claude's Markdown reply: its Chinese is tappable too.
        val reply = compose.onAllNodes(SemanticsMatcher("the reply") { n ->
            (if (SemanticsProperties.Text in n.config) n.config[SemanticsProperties.Text] else null)?.any { it.text.contains("这个沙发很占地方") } == true
        }, useUnmergedTree = true).fetchSemanticsNodes().first().config[SemanticsProperties.Text].first { it.text.contains("这个沙发很占地方") }
        assertTrue(reply.getLinkAnnotations(0, reply.length).isNotEmpty())
    }

    @Test fun practiseFlow() {
        var ui by mutableStateOf(PractiseUi())
        var mic = 0
        var listen = 0
        var retry = 0
        compose.setContent {
            LabTheme {
                Column(Modifier.padding(16.dp)) {
                    PractiseRowContent(PractiseSamples.SENTENCE, ui, PractiseActions(onListen = { listen++ }, onMic = { mic++ }, onRetryUpload = { retry++ }))
                }
            }
        }
        val tag = CoachPractiseTags.ROOT
        compose.onNodeWithText("🎤  ${CoachPractise.LABEL}", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(CoachPractiseTags.listen(tag)).performClick()
        compose.onNodeWithTag(CoachPractiseTags.mic(tag)).performClick()
        assertEquals(1, listen)
        assertEquals(1, mic)

        ui = PractiseUi(phase = "listening", finalText = "他在沙发上", partialText = "占了")
        compose.onNodeWithText("⏹  ${CoachPractise.STOP}", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(CoachPractiseTags.live(tag)).assertIsDisplayed()

        ui = PractiseUi(result = PractiseSamples.result("他在沙发上占了很多地方"))
        compose.onNodeWithTag(CoachPractiseTags.result(tag)).assertIsDisplayed()
        compose.onAllNodesWithTag("spoken-result-match", useUnmergedTree = true).fetchSemanticsNodes().let { assertEquals(1, it.size) }
        compose.onNodeWithText("🔁  ${CoachPractise.AGAIN}", useUnmergedTree = true).assertIsDisplayed()

        ui = PractiseUi(result = PractiseSamples.result("他在沙发上站了很多地方。"))
        assertEquals(1, compose.onAllNodesWithTag("spoken-result-sound", useUnmergedTree = true).fetchSemanticsNodes().size)
        ui = PractiseUi(result = PractiseSamples.result("他在沙发上放了很多东西"))
        assertEquals(1, compose.onAllNodesWithTag("spoken-result-wrong", useUnmergedTree = true).fetchSemanticsNodes().size)

        ui = PractiseUi(phase = "failed", failure = "failed")
        compose.onNodeWithTag(CoachPractiseTags.retry(tag)).assertIsDisplayed()
        compose.onNodeWithText("Couldn’t transcribe", useUnmergedTree = true).performClick()
        assertEquals(1, retry)

        ui = PractiseUi(phase = "failed", failure = "empty")
        compose.onNodeWithText(CoachPractise.EMPTY).assertIsDisplayed()

        ui = PractiseUi(blocked = "offline")
        compose.onNodeWithText(CoachPractise.OFFLINE).assertIsDisplayed()
        compose.onNodeWithTag(CoachPractiseTags.mic(tag)).performClick()
        assertEquals(1, mic) // disabled offline
    }

    @Test fun tapOnTheCardStopsATake() {
        val stop = PractiseStop()
        var stopped = 0
        stop.stop = { stopped++; true }
        compose.setContent {
            LabTheme {
                Column(Modifier.practiseTapToStop(stop).padding(16.dp)) {
                    CoachZh(PractiseSamples.SENTENCE)
                    androidx.compose.material3.Text("the card", Modifier.padding(top = 40.dp))
                }
            }
        }
        compose.onNodeWithText("the card").performClick()
        assertEquals(1, stopped)
    }

    // ---- screenshots (light + dark)

    @Test fun shotConversation() = shoot("coach-practise-01-conversation") { CoachChatScreen(PractiseSamples.ui, CoachChatActions()) }
    @Test fun shotConversationDark() = shoot("coach-practise-01-conversation-dark", dark = true) { CoachChatScreen(PractiseSamples.ui, CoachChatActions()) }

    @Test fun shotTyping() = shoot("coach-practise-02-respond") {
        CoachChatScreen(PractiseSamples.ui, CoachChatActions(), voicePreview = VoiceDictationUi())
    }

    private fun row(ui: PractiseUi, dark: Boolean, name: String) = shoot(name, dark = dark) {
        Column(Modifier.padding(16.dp)) {
            CoachZh(PractiseSamples.SENTENCE, fontSize = androidx.compose.ui.unit.TextUnit(26f, androidx.compose.ui.unit.TextUnitType.Sp))
            androidx.compose.material3.Text("Tā zài shāfā shang zhàn le hěn duō dìfang.", color = Lab.colors.accent)
            PractiseRowContent(PractiseSamples.SENTENCE, ui, PractiseActions())
        }
    }

    @Test fun shotListening() = row(PractiseUi(phase = "listening", finalText = "他在沙发上", partialText = "占了很多"), false, "coach-practise-03-listening")
    @Test fun shotMatch() = row(PractiseUi(result = PractiseSamples.result("他在沙发上占了很多地方")), false, "coach-practise-04-match")
    @Test fun shotSound() = row(PractiseUi(result = PractiseSamples.result("他在沙发上站了很多地方。")), false, "coach-practise-05-sounded-right")
    @Test fun shotWrong() = row(PractiseUi(result = PractiseSamples.result("他在沙发上放了很多东西")), false, "coach-practise-06-didnt-match")
    @Test fun shotWrongDark() = row(PractiseUi(result = PractiseSamples.result("他在沙发上放了很多东西")), true, "coach-practise-06-didnt-match-dark")
    @Test fun shotFailed() = row(PractiseUi(phase = "failed", failure = "failed"), false, "coach-practise-07-failed")
    @Test fun shotOffline() = row(PractiseUi(blocked = "offline"), true, "coach-practise-08-offline-dark")
}
