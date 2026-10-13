package dev.jeromeswannack.chineselearning.lab.ui.podcasts

import dev.jeromeswannack.chineselearning.lab.core.CoachBreakdownWord
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.podcasts.Podcasts.Reveal
import dev.jeromeswannack.chineselearning.lab.data.api.FeedEpisodeDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastEpisodeDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastFeedViewDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastInfoDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastSegmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastSubscriptionDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastTranscriptDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastsHomeDto
import dev.jeromeswannack.chineselearning.lab.data.api.SuggestedPodcastDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachDeck
import dev.jeromeswannack.chineselearning.lab.ui.coach.NewWordsSheetUi
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.robolectric.annotation.Config

/** 🎙 Podcasts (docs/PODCASTS.md): `podcasts-*.png` → docs/pr-screenshots/lab-podcast-player/. */
class PodcastsScreenshots : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun reset() = DeviceWords.setForTests(null)

    @Test fun home() = shoot("podcasts-01-home") { PodcastsScreen(PodcastsHomeUi(home = Loadable(PodcastSamples.home)), PodcastsHomeActions()) }

    @Test fun homeEmptyDark() = shoot("podcasts-02-home-empty-dark", dark = true) {
        PodcastsScreen(
            PodcastsHomeUi(home = Loadable(PodcastSamples.home.copy(subscriptions = emptyList(), episodes = emptyList())), url = "https://podcasts.apple.com/us/podcast/id1234567890"),
            PodcastsHomeActions(),
        )
    }

    @Test fun feed() = shoot("podcasts-03-feed") { PodcastFeedScreen(PodcastFeedUi(PodcastSamples.FEED, Loadable(PodcastSamples.feed), starting = setOf("pe_4")), PodcastFeedActions()) }

    @Test fun transcribing() = shoot("podcasts-04-transcribing") {
        EpisodeScreen(EpisodeUi("pe_2", episode = PodcastSamples.episode.copy(status = "transcribing", progress = "Transcribing…", segments = emptyList()), loading = false), EpisodeActions())
    }

    @Test fun playerCovered() = shoot("podcasts-05-player-listen-first") {
        EpisodeScreen(PodcastSamples.player(), EpisodeActions())
    }

    @Test fun playerRevealed() = shoot("podcasts-06-player-revealed") {
        EpisodeScreen(
            PodcastSamples.player(current = 1, playing = true, reveals = mapOf(0 to Reveal.ENGLISH, 1 to Reveal.PINYIN, 2 to Reveal.HANZI)),
            EpisodeActions(),
        )
    }

    @Test fun playerDark() = shoot("podcasts-07-player-dark", dark = true) {
        EpisodeScreen(PodcastSamples.player(current = 0, mode = Reveal.ENGLISH, slow = true, auto = true, playing = true), EpisodeActions())
    }

    @Test fun downloading() = shoot("podcasts-08-player-downloading") {
        EpisodeScreen(PodcastSamples.player(audio = EpisodeAudio.Downloading(0.42), translating = true), EpisodeActions())
    }

    @Test fun addWords() = shoot("podcasts-09-add-words") {
        EpisodeScreen(
            PodcastSamples.player(current = 1, reveals = mapOf(1 to Reveal.ENGLISH)).copy(
                newWords = NewWordsSheetUi(
                    words = listOf(CoachBreakdownWord("周末", "zhōu mò", "weekend"), CoachBreakdownWord("散步", "sàn bù", "to take a walk"), CoachBreakdownWord("公园", "gōng yuán", "park")),
                    decks = listOf(CoachDeck("d1", "Podcast words"), CoachDeck("d2", "HSK 3")),
                    picked = setOf("散步"),
                ),
            ),
            EpisodeActions(),
        )
    }

    @Config(qualifiers = LabScreenshotTest.UNFOLDED)
    @Test fun unfolded() = shoot("podcasts-10-player-unfolded") {
        EpisodeScreen(PodcastSamples.player(current = 2, reveals = mapOf(0 to Reveal.ENGLISH, 1 to Reveal.ENGLISH, 2 to Reveal.PINYIN)), EpisodeActions())
    }
}

object PodcastSamples {
    const val FEED = "https://feeds.libsyn.com/330782"

    private val segs = listOf(
        PodcastSegmentDto(0, 1200, 5800, "大家好，欢迎收听今天的茶歇中文。", "1", "zh", "dà jiā hǎo， huān yíng shōu tīng jīn tiān de chá xiē zhōng wén。", "Hi everyone, welcome to today's TeaTime Chinese."),
        PodcastSegmentDto(1, 6100, 11800, "这个周末你一般做什么？我比较喜欢去公园散步。", "2", "zh", "zhè ge zhōu mò nǐ yì bān zuò shén me？ wǒ bǐ jiào xǐ huan qù gōng yuán sàn bù。", "What do you usually do at the weekend? I quite like going for a walk in the park."),
        PodcastSegmentDto(2, 12200, 17500, "有时候我也会去咖啡馆看书，一坐就是一下午。", "1", "zh", "yǒu shí hou wǒ yě huì qù kā fēi guǎn kàn shū， yí zuò jiù shì yí xià wǔ。", "Sometimes I also go to a café to read, and once I sit down I stay the whole afternoon."),
        PodcastSegmentDto(3, 17900, 22100, "哈哈，那你肯定很喜欢喝咖啡吧？", "2", "zh", "hā hā， nà nǐ kěn dìng hěn xǐ huan hē kā fēi ba？", "Haha, then you must really like coffee, right?"),
    )

    val episode = PodcastEpisodeDto(
        id = "pe_2",
        feed_url = FEED,
        guid = "ttc-98",
        title = "第98集：周末做什么？",
        podcast_title = "TeaTime Chinese 茶歇中文",
        status = "ready",
        progress_done = 4,
        progress_total = 4,
        duration_ms = 1_856_000,
        audio_bytes = 74_719_232,
        has_audio = true,
        segments = segs,
    )

    fun player(
        current: Int = 0,
        playing: Boolean = false,
        mode: Reveal = Reveal.LISTEN,
        reveals: Map<Int, Reveal> = emptyMap(),
        slow: Boolean = false,
        auto: Boolean = false,
        audio: EpisodeAudio = EpisodeAudio.Saved(74_719_232),
        translating: Boolean = false,
    ) = EpisodeUi(
        id = "pe_2",
        episode = if (translating) episode.copy(status = "translating", progress_done = 2, progress_total = 4, segments = segs.mapIndexed { i, s -> if (i >= 2) s.copy(english = null) else s }) else episode,
        loading = false,
        audio = audio,
        current = current,
        playing = playing,
        positionMs = segs[current].start_ms + 1500,
        slow = slow,
        auto = auto,
        mode = mode,
        reveals = reveals,
        known = setOf("咖啡", "喜欢", "周末"),
        newWordCount = 2,
    )

    val home = PodcastsHomeDto(
        subscriptions = listOf(
            PodcastSubscriptionDto("s1", FEED, "TeaTime Chinese 茶歇中文", "Grace & Ting"),
            PodcastSubscriptionDto("s2", "https://anchor.fm/s/843fa4ec/podcast/rss", "Lazy Chinese", "Suqing"),
        ),
        suggested = listOf(
            SuggestedPodcastDto("https://kitchenknif.github.io/SlowChinese/podcast.rss", "慢速中文 Slow Chinese", "Short talks on everyday topics, read slowly and clearly", "intermediate"),
            SuggestedPodcastDto("https://anchor.fm/s/843fa4ec/podcast/rss", "Lazy Chinese", "Slow, easy stories and chats — comprehensible input", "beginner", subscribed = true),
            SuggestedPodcastDto(FEED, "TeaTime Chinese 茶歇中文", "Natural conversations about life and culture", "intermediate", subscribed = true),
            SuggestedPodcastDto("https://anchor.fm/s/88ca316c/podcast/rss", "Dashu Mandarin", "Relaxed everyday Mandarin with clear explanations", "intermediate"),
        ),
        episodes = listOf(
            episode.copy(segments = emptyList()),
            PodcastEpisodeDto("pe_3", FEED, "lazy-12", "Intermediate | 怎么点外卖", "Lazy Chinese", status = "translating", progress_done = 120, progress_total = 310, duration_ms = 1_275_000),
        ),
        transcription_available = true,
    )

    val feed = PodcastFeedViewDto(
        podcast = PodcastInfoDto(FEED, "TeaTime Chinese 茶歇中文", "Grace & Ting", null, "两个朋友用自然的中文聊生活、文化和历史。Natural Chinese conversations about life, culture and history."),
        episodes = listOf(
            FeedEpisodeDto("pe_2", "ttc-98", "第98集：项羽，英雄的悲剧 Xiang Yu, tragedy of a hero", "2026-10-06T08:00:00Z", 1856, 74_719_232, transcript = PodcastTranscriptDto("ready", progress_done = 412, progress_total = 412)),
            FeedEpisodeDto("pe_5", "ttc-97", "第97集：中秋节快乐 Happy Mid-Autumn Festival", "2026-09-29T08:00:00Z", 1620, 64_000_000, transcript = PodcastTranscriptDto("translating", progress_done = 150, progress_total = 380)),
            FeedEpisodeDto("pe_4", "ttc-96", "第96集：在中国坐高铁 Taking the high-speed train", "2026-09-22T08:00:00Z", 1710, 66_500_000),
            FeedEpisodeDto("pe_6", "ttc-95", "第95集：我们的第一份工作 Our first jobs", "2026-09-15T08:00:00Z", 1540, 60_000_000),
        ),
        subscription_id = "s1",
        transcription_available = true,
    )
}
