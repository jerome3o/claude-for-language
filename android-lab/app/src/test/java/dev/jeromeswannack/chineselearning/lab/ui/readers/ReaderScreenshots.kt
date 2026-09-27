package dev.jeromeswannack.chineselearning.lab.ui.readers

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.VocabItemDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.study.SessionStats
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config
import java.io.File

/** The reader in the session (hidden / revealed / rating), the reading view, the list and the generate page. */
class ReaderScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-09-27T09:30:00.000Z")
    private val previews = CardScheduler.intervalPreviews(CardScheduler.initialCardState(), now)

    /** A soft "illustration" (sky, sun, hills) so the image slot renders like the real thing. */
    private val picture: File by lazy {
        val bmp = Bitmap.createBitmap(800, 600, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, 0f, 600f, 0xFFBFDBFE.toInt(), 0xFFFDE68A.toInt(), Shader.TileMode.CLAMP) })
        c.drawCircle(620f, 150f, 70f, Paint().apply { color = 0xFFF59E0B.toInt() })
        c.drawOval(-200f, 380f, 600f, 900f, Paint().apply { color = 0xFF86EFAC.toInt() })
        c.drawOval(250f, 420f, 1100f, 950f, Paint().apply { color = 0xFF4ADE80.toInt() })
        c.drawRect(360f, 230f, 380f, 470f, Paint().apply { color = 0xFF6B7280.toInt() })
        File.createTempFile("reader", ".png").also { f -> f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } }
    }

    private fun env(playing: String? = null) = ReaderEnv(
        image = { picture }, cachedImage = { picture }, playingPage = playing,
        pageAudio = { _, _ -> picture },
        // A speech-like envelope for the waveform (the test has no real clip to decode).
        peaks = { List(96) { i -> (0.25 + 0.75 * Math.abs(Math.sin(i / 5.0)) * (if (i % 23 < 3) 0.15 else 1.0)).toFloat() } },
    )

    private val pages = listOf(
        ReaderPageDto("p1", 1, "小明今天第一次去巴黎。他很兴奋。", "Xiǎomíng jīntiān dì yī cì qù Bālí. Tā hěn xīngfèn.", "Today Xiaoming is going to Paris for the first time. He is very excited.", "k1", "A boy with a backpack at a Paris train station"),
        ReaderPageDto("p2", 2, "他在咖啡店点了一杯咖啡和一个面包。", "Tā zài kāfēidiàn diǎnle yì bēi kāfēi hé yí ge miànbāo.", "At a café he ordered a coffee and a croissant.", "k2", "A café"),
        ReaderPageDto("p3", 3, "晚上，他在塞纳河边看日落，觉得很开心。", "Wǎnshang, tā zài Sàinàhé biān kàn rìluò, juéde hěn kāixīn.", "In the evening he watched the sunset by the Seine and felt happy.", "k3", "Sunset by the Seine"),
    )
    private val reader = GradedReaderDto(
        "r1", "小明在巴黎", "Xiaoming in Paris", "beginner", "travel",
        listOf(VocabItemDto("巴黎", "Bālí", "Paris"), VocabItemDto("咖啡", "kāfēi", "coffee"), VocabItemDto("日落", "rìluò", "sunset")),
        "ready", null, "2026-09-26T08:00:00Z", pages,
    )

    private fun session(content: @Composable () -> Unit = {}): @Composable () -> Unit = {
        StudyScreen(
            StudyUi(phase = StudyPhase.Reader(SessionReader(reader, previews, 1)), counts = Samples.counts.copy(new = 0, secondaryNew = 0, learning = 0, review = 0), stats = SessionStats(reviews = 24, correct = 21, streak = 6)),
            playingKey = null,
            actions = StudyActions(readerEnv = { env() }),
            autoplay = false,
        )
        content()
    }

    private fun shootAfter(name: String, content: @Composable () -> Unit, act: () -> Unit) {
        compose.setContent { LabTheme { content() } }
        compose.mainClock.advanceTimeBy(1_500)
        act()
        compose.mainClock.advanceTimeBy(1_500)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    private fun tap(text: String) {
        val node = compose.onAllNodesWithText(text).onLast()
        runCatching { node.performScrollTo() }
        node.performClick()
        compose.mainClock.advanceTimeBy(400)
    }

    @Test fun inSession() = shoot("readers-01-session-page", content = session())
    @Test fun revealed() = shootAfter("readers-02-session-revealed", session()) {
        tap("Tap to reveal Chinese"); tap("Tap to reveal pinyin"); tap("Tap to reveal translation")
    }
    @Test fun lastPage() = shootAfter("readers-03-session-rate", session()) { tap("Next"); tap("Next") }

    @Test fun readingView() = shoot("readers-04-reader-page") {
        ReaderScreen(reader, null, env(playing = "p1"), onBack = {}, onEdit = {}, onFinish = {})
    }
    @Test fun generating() = shoot("readers-05-reader-generating") {
        ReaderScreen(reader.copy(status = "generating", titleEnglish = "A story about the zoo", pages = emptyList()), null, env(), onBack = {}, onEdit = {}, onFinish = {})
    }

    private val listUi = ReadersUi(
        readers = listOf(
            reader.copy(id = "g", titleChinese = "动物园的一天", titleEnglish = "A day at the zoo", status = "generating", topic = "animals", createdAt = "2026-09-27T09:00:00Z"),
            reader,
            reader.copy(id = "r2", titleChinese = "我的新邻居", titleEnglish = "My new neighbour", difficulty = "elementary", topic = null, createdAt = "2025-12-02T09:00:00Z"),
            reader.copy(id = "f1", titleChinese = "生成中...", titleEnglish = "Today's story...", status = "failed", errorMessage = "ANTHROPIC_API_KEY not configured", createdAt = "2026-09-25T06:00:00Z"),
            reader.copy(id = "f2", titleChinese = "生成中...", titleEnglish = "Generating...", status = "failed", topic = "weekend plans", errorMessage = "Request timed out after 120s", createdAt = "2026-09-24T06:00:00Z"),
        ),
    )

    @Test fun list() = shoot("readers-06-list") { ReadersListScreen(listUi, ReadersActions(onBack = {})) }
    @Test fun listFailedOpen() = shootAfter("readers-07-list-failed-open", { ReadersListScreen(listUi, ReadersActions(onBack = {})) }) {
        tap("2 failed generations")
        tap("Show details")
    }
    @Test fun empty() = shoot("readers-08-list-empty") { ReadersListScreen(ReadersUi(readers = emptyList(), offline = true, updatedAt = now), ReadersActions(onBack = {})) }

    private val decks = listOf(
        DeckChoice("d1", "HSK 3 · Plans & time", "Words for planning your week"),
        DeckChoice("d2", "Homework — 周末的活动", null),
        DeckChoice("d3", "Food & ordering", "Restaurants, cafés, markets"),
    )
    @Test fun generate() = shoot("readers-09-generate") {
        GenerateReaderScreen(GenerateUi(decks = decks, dueWords = 23, selected = setOf("d1", "d3"), topic = "A weekend in Shanghai", difficulty = "elementary"), GenerateActions())
    }
    @Test fun generateDue() = shoot("readers-10-generate-due-cards") {
        GenerateReaderScreen(GenerateUi(decks = decks, dueWords = 23, source = "due_cards"), GenerateActions())
    }
    private val chunks = listOf(
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("小明", "Xiǎomíng", "Xiaoming"),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("今天", "jīntiān", "today"),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("第一次", "dì yī cì", "for the first time"),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("去", "qù", "to go"),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("巴黎", "Bālí", "Paris"),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("。", "", ""),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("他", "tā", "he"),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("很", "hěn", "very"),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("兴奋", "xīngfèn", "excited", note = "Stronger than 高兴 — thrilled, keyed up."),
        dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto("。", "", ""),
    )
    @Test fun words() = shootAfter("readers-13-reader-words", {
        ReaderScreen(reader, null, ReaderEnv(image = { picture }, cachedImage = { picture }, segments = { chunks }), onBack = {}, onEdit = {}, onFinish = {})
    }) { tap("Tap to reveal Chinese") }
    @Test fun addWord() = shoot("readers-14-add-word") {
        AddWordSheet(chunks[8], AddWordActions(decks = { listOf(DeckChoice("d1", "HSK 3 · Plans & time", null), DeckChoice("d2", "Reader words", null), DeckChoice("d3", "Food & ordering", null)) }, isDuplicate = { _, _ -> false }), onDismiss = {})
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("readers-11-session-unfolded", content = session())
    @Test fun dark() = shoot("readers-12-reader-dark", dark = true) { ReaderScreen(reader, null, env(), onBack = {}, onEdit = {}, onFinish = {}) }
}
