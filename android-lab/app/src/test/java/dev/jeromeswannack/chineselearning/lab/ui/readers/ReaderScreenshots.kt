package dev.jeromeswannack.chineselearning.lab.ui.readers

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AudioBlocks
import dev.jeromeswannack.chineselearning.lab.core.BlockPlayback
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.robolectric.annotation.Config
import java.io.File

/** The reader in the session (hidden / revealed / rating), the reading view, the list and the generate page. */
class ReaderScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-09-27T09:30:00.000Z")
    /** "Revisit later" labels for a story never read: 1 day · 2 days · 2 wk · 6 wk. */
    private val previews = dev.jeromeswannack.chineselearning.lab.core.ItemSchedule.previews(dev.jeromeswannack.chineselearning.lab.core.RevisitState.INITIAL)

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

    private fun env(playing: String? = null, speed: Double = 1.0) = ReaderEnv(
        image = { picture }, cachedImage = { picture }, playingPage = playing, speed = speed,
        pageAudio = { _, _ -> picture },
        // Three phrases with pauses, like 我喜欢 / 一边跑步 / 一边听音乐 (the test has no real clip to decode).
        analyze = { p, _ -> if (p.id == "p3") oneBlock else threeBlocks },
    )

    /** Peaks shaped like the real clip: speech bursts separated by long pauses. */
    private fun speechPeaks(durationMs: Int, speech: List<IntRange>) = List(96) { i ->
        val ms = ((i + 0.5) / 96 * durationMs).toInt()
        if (speech.any { ms in it }) (0.3 + 0.7 * Math.abs(Math.sin(i * 1.7)) * Math.abs(Math.cos(i / 3.0))).toFloat() else 0.03f
    }
    private val threeBlocks = sampleClipAnalysis(
        7883,
        listOf(AudioBlocks.Block(0, 3020), AudioBlocks.Block(3020, 5940), AudioBlocks.Block(5940, 7883)),
        speechPeaks(7883, listOf(120..1000, 3160..4500, 6080..7700)),
    )
    private val oneBlock = sampleClipAnalysis(2345, listOf(AudioBlocks.Block(0, 2345)), speechPeaks(2345, listOf(150..2150)))

    /** The scrubber alone, in the states that matter: a block playing, stopped on a block, a hand-placed anchor, one block. */
    @Test fun phraseBlocks() = shoot("readers-15-phrase-blocks") {
        Column(Modifier.fillMaxWidth().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Stopped — play restarts phrase 2", fontSize = 13.sp, color = Lab.colors.muted)
            ReaderScrubber(pages[0], env(), BlockPlayback.State(anchorMs = 3020.0))
            Text("Hand-placed anchor in phrase 3 (drag)", fontSize = 13.sp, color = Lab.colors.muted)
            ReaderScrubber(pages[1], env(), BlockPlayback.State(anchorMs = 6600.0, manual = true))
            Text("No pause found — one block, as before", fontSize = 13.sp, color = Lab.colors.muted)
            ReaderScrubber(pages[2], env())
        }
    }
    /** The speed chip (1× · 0.75× · 0.5×) on the scrubber's row and beside the reading page's ▶. */
    @Test fun speedChip() = shoot("readers-28-speed-chip") {
        Column(Modifier.fillMaxWidth().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("0.75× — the chip lit while slowed", fontSize = 13.sp, color = Lab.colors.muted)
            ReaderScrubber(pages[0], env(speed = 0.75), BlockPlayback.State(anchorMs = 3020.0))
            Text("0.5×, one block", fontSize = 13.sp, color = Lab.colors.muted)
            ReaderScrubber(pages[2], env(speed = 0.5))
            Text("1× (normal)", fontSize = 13.sp, color = Lab.colors.muted)
            ReaderScrubber(pages[1], env(), BlockPlayback.State(anchorMs = 6600.0, manual = true))
        }
    }
    @Test fun speedChipReadingPage() = shootAfter("readers-29-reader-page-speed", {
        ReaderScreen(reader, null, env(speed = 0.5), onBack = {}, onEdit = {}, onFinish = {})
    }) { tap("Tap to reveal Chinese") }
    @Test fun speedChipSession() = shoot("readers-30-session-speed", content = {
        StudyScreen(
            StudyUi(phase = StudyPhase.Reader(SessionReader(reader, previews, 1)), counts = Samples.counts.copy(new = 0, secondaryNew = 0, learning = 0, review = 0), stats = SessionStats(reviews = 24, correct = 21)),
            playingKey = null,
            actions = StudyActions(readerEnv = { env(speed = 0.75) }),
            autoplay = false,
        )
    })
    @Test fun phraseBlocksDark() = shoot("readers-16-phrase-blocks-dark", dark = true) {
        Column(Modifier.fillMaxWidth().background(Lab.colors.background).padding(16.dp)) { ReaderScrubber(pages[0], env(), BlockPlayback.State(anchorMs = 5940.0)) }
    }

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
            StudyUi(phase = StudyPhase.Reader(SessionReader(reader, previews, 1)), counts = Samples.counts.copy(new = 0, secondaryNew = 0, learning = 0, review = 0), stats = SessionStats(reviews = 24, correct = 21)),
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
    /** The last page's rating row: the revisit gaps + "✓ Done for good · don't bring it back". */
    @Test fun doneForGood() = shootAfter("revisit-02-reader-rating", session()) { tap("Next"); tap("Next") }

    /** Everything revealed, then scrolled to the bottom of the page: the blue progress bar stays pinned at the top. */
    private fun revealAndScroll() {
        tap("Tap to reveal Chinese"); tap("Tap to reveal pinyin"); tap("Tap to reveal translation")
        compose.onNodeWithTag(READER_SCROLL_TAG).performTouchInput { swipeUp() }
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithText(pages[0].contentEnglish).performScrollTo()
    }
    @Test fun pinnedTop() = shootAfter("readers-17-session-pinned-top", session()) {
        tap("Tap to reveal Chinese"); tap("Tap to reveal pinyin"); tap("Tap to reveal translation")
        compose.onNodeWithTag(READER_SCROLL_TAG).performTouchInput { swipeDown() }
    }
    @Test fun pinnedScrolled() = shootAfter("readers-18-session-pinned-scrolled", session()) { revealAndScroll() }
    @Config(fontScale = 1.3f)
    @Test fun pinnedScrolledLargeText() = shootAfter("readers-19-session-pinned-font-1_3", session()) { revealAndScroll() }
    @Config(qualifiers = "w915dp-h412dp-land-xxhdpi")
    @Test fun pinnedScrolledLandscape() = shootAfter("readers-20-session-pinned-landscape", session()) { revealAndScroll() }
    @Config(qualifiers = UNFOLDED)
    @Test fun pinnedScrolledUnfolded() = shootAfter("readers-21-session-pinned-unfolded", session()) { revealAndScroll() }
    @Test fun readingViewScrolled() = shootAfter("readers-22-reader-page-pinned-scrolled", {
        ReaderScreen(reader, null, env(), onBack = {}, onEdit = {}, onFinish = {})
    }) { tap("Tap to reveal Chinese"); tap("Tap to reveal pinyin"); tap("Tap to reveal translation"); compose.onNodeWithText(pages[0].contentEnglish).performScrollTo() }

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
    /** "Next revisit 11 Oct" with ✓ Done for good, and a story done for good with ↩ Bring back. */
    @Test fun listRevisit() = shoot("revisit-04-readers-list") {
        val day = 86_400_000L
        ReadersListScreen(
            listUi.copy(
                readers = listUi.readers!!.filter { it.status != "generating" },
                revisit = mapOf(
                    reader.id to dev.jeromeswannack.chineselearning.lab.core.RevisitState("scheduled", Js.parseDate("2026-10-11T09:00:00.000Z"), 14.0, null, 1),
                    "r2" to dev.jeromeswannack.chineselearning.lab.core.RevisitState("retired", null, 42.0, null, 1),
                ),
                cutoff = dev.jeromeswannack.chineselearning.lab.core.StudyCutoff(Js.parseDate("2026-09-27T23:59:59.999Z") + 0 * day),
            ),
            ReadersActions(onBack = {}),
        )
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
    /** Page 1's word chips as the server makes them (shared/reader/words.ts). */
    private val words = listOf(
        ReaderWordDto("小明", "Xiǎomíng", "Xiaoming"),
        ReaderWordDto("今天", "jīntiān", "today"),
        ReaderWordDto("第一次", "dì yī cì", "for the first time"),
        ReaderWordDto("去", "qù", "go to"),
        ReaderWordDto("巴黎", "Bālí", "Paris"),
        ReaderWordDto("。", "", ""),
        ReaderWordDto("他", "tā", "he"),
        ReaderWordDto("很", "hěn", "very"),
        ReaderWordDto("兴奋", "xīngfèn", "excited"),
        ReaderWordDto("。", "", ""),
    )
    /** A dialogue page with quotes and a line break — what most newer readers look like. */
    private val dialogue = ReaderPageDto(
        "d1", 1, "小徐说：\"早上好！\"\n吴先生笑了。", "Xiǎo Xú shuō: \"Zǎoshang hǎo!\" Wú xiānsheng xiào le.", "Xiao Xu said: \"Good morning!\" Mr Wu laughed.", "k1", "Two neighbours",
        words = listOf(
            ReaderWordDto("小徐", "Xiǎo Xú", "Xiao Xu"), ReaderWordDto("说", "shuō", "says"), ReaderWordDto("：\"", "", ""),
            ReaderWordDto("早上好", "zǎoshang hǎo", "good morning"), ReaderWordDto("！\"", "", ""), ReaderWordDto("\n", "", ""),
            ReaderWordDto("吴先生", "Wú xiānsheng", "Mr Wu"), ReaderWordDto("笑了", "xiào le", "laughed"), ReaderWordDto("。", "", ""),
        ),
    )
    private val known = setOf("今天", "去", "很")
    private val wordsEnv get() = ReaderEnv(image = { picture }, cachedImage = { picture }, words = { p -> if (p.id == "p1") words else null }, known = known)
    private val explanation = ReaderWordExplanationDto(
        word = "兴奋", pinyin = "xīngfèn", english = "excited",
        explanation = "兴 (xīng) rise, mood + 奋 (fèn) exert, rouse: keyed up, thrilled.\nStronger than 高兴 — 他很兴奋 = he's buzzing with excitement.",
        funFacts = "兴 (xīng) rise + 奋 (fèn) rouse.", sentenceClue = "他很兴奋。", sentenceCluePinyin = "tā hěn xīngfèn", sentenceClueTranslation = "He is very excited.",
    )
    private val sheetActions = ReaderWordActions(decks = { listOf(DeckChoice("d1", "HSK 3 · Plans & time", null), DeckChoice("d2", "Reader words", null), DeckChoice("d3", "Food & ordering", null)) })

    @Test fun words() = shootAfter("readers-13-reader-words", {
        ReaderScreen(reader, null, wordsEnv, onBack = {}, onEdit = {}, onFinish = {})
    }) { tap("Tap to reveal Chinese") }
    @Test fun wordSheet() = shoot("readers-14-word-sheet") {
        ReaderWordSheet(words[8], "他很兴奋。", known = false, actions = sheetActions, onDismiss = {})
    }
    @Test fun wordSheetExplained() = shoot("readers-23-word-sheet-explained") {
        ReaderWordSheet(words[8], "他很兴奋。", known = false, actions = sheetActions, onDismiss = {}, initialExplanation = explanation)
    }
    @Test fun wordSheetAdding() = shoot("readers-24-word-sheet-add") {
        ReaderWordSheet(words[8], "他很兴奋。", known = false, actions = sheetActions, onDismiss = {}, initialExplanation = explanation, startAdding = true)
    }
    @Test fun wordSheetKnown() = shoot("readers-25-word-sheet-known", dark = true) {
        ReaderWordSheet(words[1], "小明今天第一次去巴黎。", known = true, actions = sheetActions, onDismiss = {})
    }
    /** The in-session reader has the chips too (it used to be plain text). */
    @Test fun sessionWords() = shootAfter("readers-26-session-words", {
        StudyScreen(
            StudyUi(phase = StudyPhase.Reader(SessionReader(reader, previews, 1)), counts = Samples.counts.copy(new = 0, secondaryNew = 0, learning = 0, review = 0), stats = SessionStats(reviews = 24, correct = 21)),
            playingKey = null,
            actions = StudyActions(readerEnv = { wordsEnv }),
            autoplay = false,
        )
    }) { tap("Tap to reveal Chinese") }
    @Test fun dialogueWords() = shootAfter("readers-27-dialogue-words", {
        ReaderScreen(reader.copy(pages = listOf(dialogue)), null, ReaderEnv(image = { picture }, cachedImage = { picture }), onBack = {}, onEdit = {}, onFinish = {})
    }) { tap("Tap to reveal Chinese") }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("readers-11-session-unfolded", content = session())
    @Test fun dark() = shoot("readers-12-reader-dark", dark = true) { ReaderScreen(reader, null, env(), onBack = {}, onEdit = {}, onFinish = {}) }
}
