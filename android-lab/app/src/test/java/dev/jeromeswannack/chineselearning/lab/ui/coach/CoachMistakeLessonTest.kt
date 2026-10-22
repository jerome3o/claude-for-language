package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.CoachMistakeLesson
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.data.api.CoachMessageDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonPlayer
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PREVIEW_NOT_NOW_TAG
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PREVIEW_SAVE_NOW_TAG
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PREVIEW_SAVE_TAG
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PlayerContext
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PreviewSave
import dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachBackgroundSamples as B

/** "🎯 Mini lesson on this mistake" (core CoachMistakeLesson; web SentenceCoachPage + CoachLessonPage). */
class CoachMistakeLessonTest : LabScreenshotTest() {

    @Test fun chipOnlyAfterAMistake() {
        assertTrue(B.quickActions.mistakeLessonOffered)
        val right = B.ready.copy(messages = listOf(B.ready.messages[0], B.ready.messages[1].copy(content = B.ANALYSIS.replace("\"isCorrect\":false", "\"isCorrect\":true"))))
        assertFalse(B.quickActions.copy(thread = Loadable(right)).mistakeLessonOffered)
        // No analysis yet (still being written): nothing to make a lesson about.
        assertFalse(CoachChatUi(thread = Loadable(B.pendingAnalysis)).mistakeLessonOffered)
    }

    @Test fun chipAsksForTheLesson() {
        var asked = 0
        compose.setContent { LabTheme { CoachChatScreen(B.quickActions, CoachChatActions(onMistakeLesson = { asked++ })) } }
        compose.onNodeWithTag(CoachLessonTags.CHIP).assertIsDisplayed()
        compose.onNodeWithText(CoachMistakeLesson.LABEL).performClick()
        assertEquals(1, asked)
    }

    @Test fun pendingLessonDoesNotHoldUpTheChat() {
        assertFalse(CoachMistakeLessonSamples.pending.replyPending)
        val ui = CoachMistakeLessonSamples.pendingLean
        compose.setContent { LabTheme { CoachChatScreen(ui, CoachChatActions()) } }
        compose.onNodeWithTag(CoachLessonTags.PENDING).assertExists()
    }

    @Test fun cardPlaysAndSaves() {
        var played: String? = null
        var saved: String? = null
        compose.setContent {
            LabTheme { CoachChatScreen(CoachMistakeLessonSamples.readyLean, CoachChatActions(onPlayLesson = { id, _ -> played = id }, onSaveLesson = { saved = it })) }
        }
        compose.onNodeWithTag(CoachLessonTags.CARD).assertExists()
        compose.onNodeWithTag(CoachLessonTags.PLAY).performClick()
        assertEquals("ml1", played)
        compose.onNodeWithTag(CoachLessonTags.SAVE).performClick()
        assertEquals("ml1", saved)
    }

    @Test fun savedCardSaysSo() {
        compose.setContent { LabTheme { CoachChatScreen(CoachMistakeLessonSamples.savedLean, CoachChatActions()) } }
        compose.onNodeWithTag(CoachLessonTags.SAVED).assertExists()
    }

    @Test fun previewEndsWithSave() {
        var rated: LessonResult? = null
        var savedNow = 0
        compose.setContent {
            LabTheme {
                LessonPlayer(
                    title = "One 了 is enough", icon = "🎯", spec = CoachMistakeLessonSamples.oneNote, env = ExerciseEnv(),
                    context = PlayerContext.Preview, onComplete = {}, onEnd = {},
                    previewSave = PreviewSave(saved = false, onSaveNow = { savedNow++ }, onSaveDone = { rated = it }),
                )
            }
        }
        compose.onNodeWithText("Trying it · not saved yet").assertIsDisplayed()
        compose.onNodeWithTag(PREVIEW_SAVE_NOW_TAG).performClick()
        assertEquals(1, savedNow)
        compose.onNodeWithText("Continue", substring = true, ignoreCase = true).performClick()
        compose.onNodeWithTag(PREVIEW_SAVE_TAG).assertExists()
        compose.onNodeWithTag(PREVIEW_NOT_NOW_TAG).assertExists()
        // No rating any more: "Save to my mini lessons" keeps this run (a note only: nothing missed).
        compose.onNodeWithText("Save to my mini lessons").performClick()
        assertNotNull(rated)
        assertEquals(emptyList<String>(), rated!!.outcome.missed)
    }
}

object CoachMistakeLessonSamples {
    const val CONTENT = """{"spec":{"title":"One 了 is enough","icon":"🎯","description":"Where 了 goes when the action is done.","sections":[
{"title":"Your mistake","exercises":[{"type":"note","title":"One 了 is enough","body":"You wrote: 我昨天去了商店买东西了 ✗\nA native says: 我昨天去商店买东西了 ✓\nOne 了 at the end marks the whole outing as done.","sentences":[{"hanzi":"我昨天去商店买东西了。","pinyin":"wǒ zuótiān qù shāngdiàn mǎi dōngxi le.","english":"I went shopping yesterday."},{"hanzi":"他上午去银行取钱了。","pinyin":"tā shàngwǔ qù yínháng qǔ qián le.","english":"He went to the bank to get money this morning."}]}]},
{"title":"Practise it","exercises":[
{"type":"choice","question":"Which sentence is correct?","options":[{"hanzi":"她昨天去超市买水果了。"},{"hanzi":"她昨天去了超市买水果了。"}],"correct":0,"explanation":"One 了, at the end."},
{"type":"scramble","english":"We went to the park yesterday.","tiles":["了","我们","去公园","昨天"],"correct_order":["我们","昨天","去公园","了"]},
{"type":"choice","question":"Which one fits? 我上个月去北京＿","options":[{"hanzi":"了"},{"hanzi":"过"}],"correct":0}]},
{"title":"Use it","exercises":[
{"type":"translate","english":"I went to the library yesterday to borrow books.","reference_hanzi":"我昨天去图书馆借书了。","reference_pinyin":"wǒ zuótiān qù túshūguǎn jiè shū le."},
{"type":"write_typed","answer":{"hanzi":"我昨天去商店买东西了","pinyin":"wǒ zuótiān qù shāngdiàn mǎi dōngxi le","english":"I went shopping yesterday."}},
{"type":"sentence_making","words":[{"hanzi":"了","pinyin":"le"}],"task":"Say where you went yesterday and why.","example":{"hanzi":"我昨天去医院看朋友了。","pinyin":"wǒ zuótiān qù yīyuàn kàn péngyou le.","english":"I went to the hospital to see a friend yesterday."}}]}]}}"""

    val content = CoachMistakeLesson.parse(CONTENT)!!
    val oneNote = content.spec.copy(sections = listOf(content.spec.sections[0]))

    private fun withLesson(m: CoachMessageDto) = B.quickActions.copy(thread = Loadable(B.ready.copy(messages = B.ready.messages + m)))

    val pending = withLesson(CoachMessageDto("ml1", "c9", "assistant", CoachMistakeLesson.CONTENT_TYPE, "", status = "pending"))
    val ready = withLesson(CoachMessageDto("ml1", "c9", "assistant", CoachMistakeLesson.CONTENT_TYPE, CONTENT))
    val saved = withLesson(CoachMessageDto("ml1", "c9", "assistant", CoachMistakeLesson.CONTENT_TYPE, CONTENT.replaceFirst("{\"spec\"", "{\"lesson_id\":\"l1\",\"spec\"")))

    /** The lesson message right under the sentence (no tall analysis above it): what the UI tests look at. */
    private fun lean(ui: CoachChatUi) = ui.copy(thread = Loadable(B.ready.copy(messages = listOf(B.ready.messages[0]) + ui.thread.data!!.messages.drop(2))))
    val pendingLean = lean(pending)
    val readyLean = lean(ready)
    val savedLean = lean(saved)
}
