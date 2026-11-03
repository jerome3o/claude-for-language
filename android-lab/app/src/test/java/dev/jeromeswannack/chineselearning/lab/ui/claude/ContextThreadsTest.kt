package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckTip
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.claude.ContextFields
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.lessons.AnswerCheckCard
import dev.jeromeswannack.chineselearning.lab.ui.lessons.AnswerCheckUi
import dev.jeromeswannack.chineselearning.lab.ui.lessons.exerciseAnswerOf
import dev.jeromeswannack.chineselearning.lab.ui.readers.READER_ASK_CLAUDE_TAG
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderEnv
import dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader
import dev.jeromeswannack.chineselearning.lab.ui.readers.StudyReaderView
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals

/**
 * Claude in a reader page / a mini lesson exercise (docs/CHAT.md "Claude threads" → "Reader and
 * exercise threads"): the thread screen in those contexts — the context chip ("📖 Reader · 成都 p.3" →
 * the reader at that page, "🧩 Exercise · Translate" → the lesson), the context's chips (the fields of
 * this showing win over the stored context), the empty-state hint, Ask only; the reading view's 💬; the
 * answer check's "💬 Ask Claude". Plus the Roborazzi shots, light + dark.
 */
class ContextThreadsTest : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    private val typing = VoiceDictationUi(mode = "type")

    private val readerContext = ClaudeContextDto(ClaudeChats.READER, reader_id = "r1", page_id = "p3", page = 3, looked_up = listOf("熊猫"), label = "成都")
    private val readerEmpty = ClaudeThreadUi(isNew = true, context = readerContext)
    private val readerThread = ClaudeThreadUi(
        threadId = "t1",
        title = "这一页讲的是什么？",
        context = readerContext,
        hasThread = true,
        messages = listOf(
            ClaudeMessageDto("u1", "t1", "u1", "user", "text", "这一页讲的是什么？请一句一句地说一说。", intent = "ask", created_at = "2026-11-03T10:00:01.000Z"),
            ClaudeMessageDto(
                "a2", "t1", null, "assistant", "text",
                "这一页说：成都的熊猫很可爱。\n「熊猫」是一种动物，黑白色的。\n「可爱」就是让人很喜欢的样子。",
                answer_lang = "zh", created_at = "2026-11-03T10:00:02.000Z",
            ),
        ),
    )
    private val exerciseAnswer = buildJsonObject { put("text", JsonPrimitive("我放书在桌子上。")); put("verdict", JsonPrimitive("wrong")) }
    private val exerciseContext = ClaudeContextDto(ClaudeChats.EXERCISE, lesson_id = "l1", exercise_key = "s0e1", exercise_type = "translate", label = "Translate", sublabel = "把字句")
    private val exerciseEmpty = ClaudeThreadUi(isNew = true, context = exerciseContext, fields = ContextFields(answer = exerciseAnswer))

    private fun show(ui: ClaudeThreadUi, actions: ClaudeThreadActions = ClaudeThreadActions()) {
        compose.setContent { LabTheme { ClaudeThreadScreen(ui, actions, voicePreview = typing) } }
        compose.waitForIdle()
    }

    @Test fun aReaderPageThreadOffersThePagesChipsAndLinksToThePage() {
        val sent = mutableListOf<Pair<String, String?>>()
        var opened: ClaudeChats.Link? = null
        show(readerEmpty, ClaudeThreadActions(onSend = { t, _, _, c -> sent += t to c }, onContext = { opened = it }))
        compose.onNodeWithText("📖 Reader · 成都 p.3", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.INTENTS).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.chip("my_words")).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.chip("page_meaning")).performClick()
        compose.waitForIdle()
        assertEquals(listOf<Pair<String, String?>>("这一页讲的是什么？请一句一句地说一说。" to "page_meaning"), sent)
        compose.onNodeWithTag(ClaudeThreadTags.CONTEXT_CHIP).performClick()
        compose.waitForIdle()
        assertEquals(ClaudeChats.Link(ClaudeChats.READER, readerId = "r1", page = 3), opened)
    }

    @Test fun anExerciseThreadsChipsFollowThisShowingsAnswer() {
        show(exerciseEmpty)
        compose.onNodeWithText("🧩 Exercise · Translate", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.chip("why_wrong")).assertIsDisplayed()
        // No answer on this showing (the top-bar 💬): the stored answer's chip goes.
        val stored = exerciseContext.copy(answer = exerciseAnswer)
        assertEquals(listOf("explain", "example", "one_more"), ClaudeThreadUi(context = stored, fields = ContextFields(answer = JsonNull)).chips.map { it.id })
        assertEquals("why_wrong", ClaudeThreadUi(context = stored).chips.first().id)
    }

    @Test fun withFieldsReplacesAReaderPagesWords() {
        val c = readerContext.core()
        assertEquals(listOf("熊猫"), c.lookedUp)
        val f = withFields(c, ContextFields(lookedUp = JsonArray(listOf(JsonPrimitive("可爱"))), saidWrong = JsonNull))
        assertEquals(listOf("可爱"), f.lookedUp)
        assertEquals(emptyList<String>(), f.saidWrong)
        assertEquals("r1:p3", c.ref)
    }

    @Test fun theAnswerCheckOffersAskClaude() {
        val check = AnswerCheck("almost", "Nearly — the object goes before the verb.", corrected = "我把书放在桌子上。", tips = listOf(AnswerCheckTip("Use 把 here", quote = "放书")))
        var asked = 0
        compose.setContent { LabTheme { AnswerCheckCard(AnswerCheckUi.Done(check, cached = false), "我放书在桌子上。", onPlay = {}, onAsk = { asked++ }, askLabel = "💬 Ask Claude") } }
        compose.waitForIdle()
        compose.onNodeWithText("💬 Ask Claude").performClick()
        compose.waitForIdle()
        assertEquals(1, asked)
        val a = exerciseAnswerOf(" 我放书在桌子上。 ", check)
        assertEquals("我放书在桌子上。", (a["text"] as JsonPrimitive).content)
        assertEquals("almost", (a["verdict"] as JsonPrimitive).content)
        assertEquals(JsonArray(listOf(JsonPrimitive("放书: Use 把 here"))), a["tips"])
    }

    private val reader = GradedReaderDto(
        "r1", "成都", "Chengdu", "elementary",
        pages = listOf(
            ReaderPageDto("p1", 1, "小明去成都。", "Xiǎo Míng qù Chéngdū.", "Xiao Ming goes to Chengdu."),
            ReaderPageDto("p2", 2, "成都的熊猫很可爱。", "Chéngdū de xióngmāo hěn kě'ài.", "The pandas of Chengdu are cute."),
        ),
    )

    @Test fun theReadingViewHasAskClaudeOnlyWhereTheAppOffersIt() {
        compose.setContent { LabTheme { StudyReaderView(SessionReader(reader, 1), ReaderEnv(askClaude = true), onFinish = { _, _ -> }, startPage = 1) } }
        compose.waitForIdle()
        compose.onNodeWithTag(READER_ASK_CLAUDE_TAG).assertIsDisplayed()
        compose.onNodeWithText("Chengdu · Page 2 of 2").assertIsDisplayed()
    }

    @Test fun noAskClaudeWhereTheAppDoesNotOfferIt() {
        compose.setContent { LabTheme { StudyReaderView(SessionReader(reader, 2), ReaderEnv(), onFinish = { _, _ -> }) } }
        compose.waitForIdle()
        compose.onNodeWithTag(READER_ASK_CLAUDE_TAG).assertDoesNotExist()
    }

    // ---------------- screenshots ----------------

    @Test fun shotReaderThread() = shoot("claude-context-01-reader-thread") { ClaudeThreadScreen(readerThread, ClaudeThreadActions()) }
    @Test fun shotReaderThreadDark() = shoot("claude-context-02-reader-thread-dark", dark = true) { ClaudeThreadScreen(readerThread, ClaudeThreadActions()) }
    @Test fun shotExerciseEmpty() = shoot("claude-context-03-exercise-empty") { ClaudeThreadScreen(exerciseEmpty, ClaudeThreadActions(), voicePreview = typing) }
    @Test fun shotExerciseEmptyDark() = shoot("claude-context-04-exercise-empty-dark", dark = true) { ClaudeThreadScreen(exerciseEmpty, ClaudeThreadActions(), voicePreview = typing) }
    @Test fun shotReadingView() = shoot("claude-context-05-reading-view-ask") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) { StudyReaderView(SessionReader(reader, 3), ReaderEnv(askClaude = true), onFinish = { _, _ -> }, startPage = 1) }
    }
    @Test fun shotReadingViewDark() = shoot("claude-context-06-reading-view-ask-dark", dark = true) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) { StudyReaderView(SessionReader(reader, 4), ReaderEnv(askClaude = true), onFinish = { _, _ -> }, startPage = 1) }
    }
}
