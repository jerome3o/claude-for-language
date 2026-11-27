package dev.jeromeswannack.chineselearning.lab.ui.watch

import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.watch.Watch
import dev.jeromeswannack.chineselearning.lab.data.api.WatchGapDto
import dev.jeromeswannack.chineselearning.lab.data.api.WatchLineDto
import dev.jeromeswannack.chineselearning.lab.data.api.WatchListDto
import dev.jeromeswannack.chineselearning.lab.data.api.WatchVideoDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * 📺 Watch (docs/WATCH.md): `watch-*.png` → docs/pr-screenshots/watch/lab/. The YouTube player is a
 * drawn stand-in box (VideoStandIn) — no frame of a real video is ever in the repo.
 */
class WatchScreenshots : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun reset() = DeviceWords.setForTests(null)

    @Test fun list() = shoot("watch-01-list") { WatchListScreen(WatchSamples.listUi, WatchListActions(onBack = {}), thumbnails = emptyMap()) }

    @Test fun listShareNotAVideo() = shoot("watch-02-list-share-not-a-link") {
        WatchListScreen(
            WatchListUi(list = Loadable(WatchListDto(emptyList())), notice = "That wasn't a YouTube video link. Share a video from the YouTube app (Share → Watch (Lab)), or paste its link below."),
            WatchListActions(onBack = {}),
            thumbnails = emptyMap(),
        )
    }

    @Test fun player() = shoot("watch-03-player") {
        WatchPlayerScreen(WatchSamples.player(positionMs = 9_600), WatchPlayerActions()) { m -> VideoStandIn(m, "0:09") }
    }

    @Test fun playerListenFirst() = shoot("watch-04-player-listen-first") {
        WatchPlayerScreen(WatchSamples.player(positionMs = 13_400, listenFirst = true, pauseEachLine = true, speed = 0.75), WatchPlayerActions()) { m -> VideoStandIn(m, "0:13") }
    }

    @Test fun playerListenFirstRevealed() = shoot("watch-05-player-listen-first-pinyin") {
        val ui = WatchSamples.player(positionMs = 13_400, listenFirst = true)
        WatchPlayerScreen(ui.copy(reveal = Watch.Reveal.PINYIN, revealFor = ui.active), WatchPlayerActions()) { m -> VideoStandIn(m, "0:13") }
    }

    @Test fun transcribing() = shoot("watch-06-player-transcribing") {
        WatchPlayerScreen(
            WatchSamples.player(positionMs = 5_200, status = "transcribing", lineCount = 4, chunksDone = 2, gaps = listOf(WatchGapDto(300_000, 600_000))),
            WatchPlayerActions(),
        ) { m -> VideoStandIn(m, "0:05") }
    }

    @Test fun offline() = shoot("watch-07-player-offline", dark = true) {
        WatchPlayerScreen(WatchSamples.player(positionMs = 21_000).copy(online = false, pinyin = false), WatchPlayerActions())
    }

    @Config(qualifiers = LabScreenshotTest.UNFOLDED)
    @Test fun unfolded() = shoot("watch-08-player-unfolded") {
        WatchPlayerScreen(WatchSamples.player(positionMs = 17_500), WatchPlayerActions()) { m -> VideoStandIn(m, "0:17") }
    }
}

/** A self-written family-dinner scene (not from any show). */
object WatchSamples {
    private val script = listOf(
        Triple("你怎么才回来？饭都凉了。", "nǐ zěnme cái huílai? fàn dōu liáng le.", "Why are you only back now? The food's gone cold."),
        Triple("路上堵车，堵了一个多小时。", "lùshang dǔchē, dǔ le yí gè duō xiǎoshí.", "There was traffic — stuck for over an hour."),
        Triple("快洗手，我再给你热一下。", "kuài xǐ shǒu, wǒ zài gěi nǐ rè yíxià.", "Wash your hands, I'll heat it up for you again."),
        Triple("妈，今天的红烧肉真香！", "mā, jīntiān de hóngshāoròu zhēn xiāng!", "Mum, the braised pork smells amazing today!"),
        Triple("考试考得怎么样？", "kǎoshì kǎo de zěnmeyàng?", "How did the exam go?"),
        Triple("还行吧，数学有点难。", "hái xíng ba, shùxué yǒudiǎn nán.", "It was okay, maths was a bit hard."),
        Triple("别光吃肉，多吃点青菜。", "bié guāng chī ròu, duō chī diǎn qīngcài.", "Don't just eat the meat, have some greens."),
        Triple("知道了知道了。", "zhīdao le zhīdao le.", "Okay, okay, I know."),
    )
    private val speakers = listOf("妈妈", "儿子", "妈妈", "儿子", "爸爸", "儿子", "妈妈", "儿子")

    fun lines(n: Int = script.size, english: Boolean = true) = script.take(n).mapIndexed { i, (zh, py, en) ->
        WatchLineDto(i, start_ms = 1_000L + i * 4_000L, end_ms = 1_000L + i * 4_000L + 3_200L, zh = zh, pinyin = py, english = if (english) en else null, speaker = speakers[i])
    }

    private fun video(id: String, title: String, channel: String, status: String, duration: Long, position: Long, chunksDone: Int = 0, chunksTotal: Int = 9, error: String? = null, total: Int? = null) =
        WatchVideoDto(id, title = title, channel = channel, duration_ms = duration, status = status, chunks_done = chunksDone, chunks_total = chunksTotal, progress_total = total, error = error, position_ms = position)

    val listUi = WatchListUi(
        list = Loadable(
            WatchListDto(
                listOf(
                    video("aaaaaaaaaa1", "小欢喜 第1集（黄磊、海清主演）", "华策影视", "ready", 2_700_000, 1_250_000, total = 812),
                    video("bbbbbbbbbb2", "欢乐颂 第3集", "东方卫视", "transcribing", 2_640_000, 0, chunksDone = 2),
                    video("ccccccccc_3", "开端 第1集", "正午阳光", "failed", 1_980_000, 300_000, error = "video unavailable"),
                ),
            ),
        ),
    )

    fun player(
        positionMs: Long,
        status: String = "ready",
        lineCount: Int = script.size,
        chunksDone: Int = 9,
        listenFirst: Boolean = false,
        pauseEachLine: Boolean = false,
        speed: Double = 1.0,
        gaps: List<WatchGapDto> = emptyList(),
    ) = WatchPlayerUi(
        id = "aaaaaaaaaa1",
        video = video("aaaaaaaaaa1", "小欢喜 第1集", "华策影视", status, 2_700_000, positionMs, chunksDone = chunksDone, total = if (status == "ready") lineCount else null)
            .copy(lines = lines(lineCount, english = status == "ready"), gaps = gaps),
        loading = false,
        startMs = 0,
        ready = true,
        playing = true,
        positionMs = positionMs,
        durationMs = 2_700_000,
        listenFirst = listenFirst,
        pauseEachLine = pauseEachLine,
        speed = speed,
        known = setOf("回来", "今天", "考试", "知道"),
    )
}
