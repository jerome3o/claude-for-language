package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import dev.jeromeswannack.chineselearning.lab.core.AudioLessonChapter
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTranscriptLine
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonWord
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import org.junit.Test
import org.robolectric.annotation.Config

/** Lessons shaped like shared/audio-lesson/samples.ts as the worker times them. */
object SampleAudioLessons {
    private fun l(ms: Long, voice: String, text: String, ch: Int, pinyin: String? = null, english: String? = null) =
        AudioLessonTranscriptLine(ms, if (voice == "narrator" || voice == "recap") "en" else "zh", voice, text, pinyin, english, ch)

    val dialogue = AudioLessonDto(
        id = "al1",
        format = "dialogue",
        title = "Ordering at a Lanzhou noodle shop",
        status = "ready",
        duration_ms = 742_000,
        size_bytes = 5_800_000,
        word_count = 3,
        audio_version = "v1",
        chapters = listOf(
            AudioLessonChapter("Introduction", 0),
            AudioLessonChapter("First listen", 24_000),
            AudioLessonChapter("Second listen", 61_000),
            AudioLessonChapter("Third listen, a little slower", 98_000),
            AudioLessonChapter("Line by line", 142_000),
            AudioLessonChapter("粗 — thick", 260_000),
            AudioLessonChapter("少放点 — put in a bit less", 380_000),
            AudioLessonChapter("加 — to add", 490_000),
            AudioLessonChapter("Final listen", 640_000),
        ),
        transcript = listOf(
            l(400, "narrator", "You're at a busy Lanzhou beef noodle shop, a", 0),
            l(4200, "teacher", "兰州拉面", 0),
            l(5600, "narrator", "place. You order at the counter: the kind of noodle, how spicy, and whether you want an egg.", 0),
            l(14_000, "narrator", "First, just listen to the conversation.", 1),
            l(24_400, "speaker_b", "你好，吃什么？", 1, "nǐ hǎo, chī shénme?", "Hi, what are you having?"),
            l(27_800, "speaker_a", "我要一碗牛肉面。", 1, "wǒ yào yì wǎn niúròu miàn.", "I'd like a bowl of beef noodles."),
            l(32_000, "speaker_b", "要粗的还是细的？", 1, "yào cū de háishi xì de?", "Thick or thin?"),
            l(36_100, "speaker_a", "细的，少放点辣椒。", 1, "xì de, shǎo fàng diǎn làjiāo.", "Thin, and go easy on the chilli."),
            l(41_000, "speaker_b", "加个鸡蛋吗？", 1, "jiā ge jīdàn ma?", "Add an egg?"),
            l(44_300, "speaker_a", "加一个，谢谢。", 1, "jiā yí gè, xièxie.", "Yes, one, thanks."),
            l(142_400, "narrator", "Now line by line.", 4),
            l(146_000, "speaker_b", "你好，吃什么？", 4, "nǐ hǎo, chī shénme?", "Hi, what are you having?"),
            l(150_200, "narrator", "Hi, what are you having?", 4),
            l(154_000, "speaker_a", "我要一碗牛肉面。", 4, "wǒ yào yì wǎn niúròu miàn.", "I'd like a bowl of beef noodles."),
            l(159_000, "narrator", "I'd like a bowl of beef noodles.", 4),
            l(163_000, "speaker_b", "要粗的还是细的？", 4, "yào cū de háishi xì de?", "Thick or thin?"),
            l(168_000, "narrator", "Thick or thin?", 4),
            l(172_000, "speaker_a", "细的，少放点辣椒。", 4, "xì de, shǎo fàng diǎn làjiāo.", "Thin, and go easy on the chilli."),
            l(178_000, "narrator", "Thin, and go easy on the chilli.", 4),
            l(260_400, "teacher", "粗", 5, "cū", "thick"),
            l(263_000, "narrator", "This means thick, for noodles or rope. Its opposite is", 5),
            l(268_000, "teacher", "细", 5),
            l(269_200, "narrator", ", thin.", 5),
        ),
        words = listOf(
            AudioLessonWord("粗", "cū", "thick", "new"),
            AudioLessonWord("少放点", "shǎo fàng diǎn", "put in a bit less", "learning"),
            AudioLessonWord("加", "jiā", "to add", "known"),
        ),
    )

    val sleep = AudioLessonDto(
        id = "al2",
        format = "sleep",
        title = "银行和邮局",
        status = "ready",
        duration_ms = 1_268_000,
        size_bytes = 6_100_000,
        word_count = 3,
        audio_version = "v1",
        chapters = listOf(
            AudioLessonChapter("开始", 0),
            AudioLessonChapter("银行", 9_000),
            AudioLessonChapter("邮局", 420_000),
            AudioLessonChapter("寄", 830_000),
            AudioLessonChapter("原文", 1_200_000),
        ),
        transcript = listOf(
            l(1000, "sleep", "你好。今天我们慢慢地学三个新词。", 0, "nǐ hǎo. jīntiān wǒmen mànmàn de xué sān gè xīn cí."),
            l(9_200, "sleep", "这是一个新词。我说三遍。", 1),
            l(14_000, "sleep", "银行", 1, "yínháng", "bank"),
            l(20_000, "sleep", "银行", 1, "yínháng", "bank"),
            l(26_000, "sleep", "银行", 1, "yínháng", "bank"),
            l(33_000, "sleep", "银行是放钱的地方。", 1),
            l(38_000, "sleep", "‘银’是‘银色’的‘银’。", 1),
            l(43_000, "sleep", "我们听三个句子。", 1),
            l(47_000, "sleep", "我去银行取钱。", 1, "wǒ qù yínháng qǔ qián.", "I'm going to the bank to take out money."),
            l(52_000, "sleep", "我去银行取钱。", 1),
            l(57_000, "sleep", "我去银行取钱。", 1),
            l(63_000, "recap", "The word was", 1),
            l(64_200, "sleep", "银行", 1),
            l(65_600, "recap", ": bank, as in the place where you keep your money, not the bank of a river.", 1),
            l(80_000, "sleep", "这是一个新词。我说三遍。", 2),
        ),
        words = listOf(
            AudioLessonWord("银行", "yínháng", "bank", "new"),
            AudioLessonWord("邮局", "yóujú", "post office", "new"),
            AudioLessonWord("寄", "jì", "to send by post", "new"),
        ),
    )

    private val summaries = listOf(
        AudioLessonDto(id = "al3", format = "dialogue", title = "Taking a taxi and giving directions", status = "speaking", progress_done = 23, progress_total = 64),
        AudioLessonDto(id = "al4", format = "sleep", title = "我家旁边有一个邮局", status = "writing", progress = "Checking the words you know…"),
        dialogue.copy(chapters = emptyList(), transcript = emptyList(), words = emptyList()),
        sleep.copy(chapters = emptyList(), transcript = emptyList(), words = emptyList()),
        AudioLessonDto(id = "al5", format = "dialogue", title = "Seeing a doctor about a cold", status = "failed", error = "The voices are busy — try again in a few minutes."),
    )

    val list = AudioLessonsUi(
        lessons = Loadable(data = summaries),
        saved = setOf("al1"),
        downloading = mapOf("al2" to 0.42),
        description = "Ordering at a Lanzhou beef noodle shop",
    )
}

class AudioLessonScreenshots : LabScreenshotTest() {
    private val s = SampleAudioLessons

    @Test fun list() = shoot("audio-lessons-01-list-dialogue") { AudioLessonsScreen(s.list, AudioLessonsActions()) }

    @Test fun pastedDialogue() = shoot("audio-lessons-02-form-dialogue-pasted") {
        AudioLessonsScreen(
            s.list.copy(description = "", showDialogue = true, dialogue = "A：你好，吃什么？\nB：我要一碗牛肉面。\nA：要粗的还是细的？", minutes = 15),
            AudioLessonsActions(),
        )
    }

    @Test fun sleepForm() = shoot("audio-lessons-03-form-sleep") {
        AudioLessonsScreen(
            s.list.copy(format = "sleep", minutes = 20, text = "我家旁边有一个邮局，邮局在银行旁边。我常常去邮局给妈妈寄信。邮局的阿姨很好，她总是笑着问我：“今天又给妈妈写信了？”"),
            AudioLessonsActions(),
        )
    }

    @Test fun offlineEmpty() = shoot("audio-lessons-04-offline-empty") {
        AudioLessonsScreen(AudioLessonsUi(lessons = Loadable(data = emptyList(), offline = true), online = false), AudioLessonsActions())
    }

    @Test fun playerDialogue() = shoot("audio-lessons-05-player-dialogue") {
        AudioLessonPlayerScreen(AudioLessonPlayerUi(lesson = s.dialogue, savedOnPhone = true, canPlay = true, playing = true, positionMs = 155_000, speed = 0.9), AudioLessonPlayerActions())
    }

    @Test fun playerDownloading() = shoot("audio-lessons-06-player-saving") {
        AudioLessonPlayerScreen(AudioLessonPlayerUi(lesson = s.dialogue, download = 0.4, downloadBytes = 2_300_000), AudioLessonPlayerActions())
    }

    @Test fun playerChapters() = shoot("audio-lessons-07-player-chapters") {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(lesson = s.dialogue, savedOnPhone = true, canPlay = true, positionMs = 265_000, showChapters = true, showTranscript = false),
            AudioLessonPlayerActions(),
        )
    }

    @Test fun playerSleepTimer() = shoot("audio-lessons-08-player-sleep-timer") {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(lesson = s.sleep, savedOnPhone = true, canPlay = true, playing = true, positionMs = 21_000, speed = 0.75, timerMinutes = 30, timerLeftMs = 1_712_000, showTimer = true, showWords = true),
            AudioLessonPlayerActions(),
        )
    }

    @Test fun playerBeingMade() = shoot("audio-lessons-09-player-being-made") {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(lesson = AudioLessonDto(id = "al3", format = "dialogue", title = "Taking a taxi and giving directions", status = "speaking", progress = "Recording 23 of 64 clips…")),
            AudioLessonPlayerActions(),
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun playerUnfolded() = shoot("audio-lessons-10-player-unfolded") {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(lesson = s.dialogue, savedOnPhone = true, canPlay = true, playing = true, positionMs = 34_000, showChapters = true, timerMinutes = -1),
            AudioLessonPlayerActions(),
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun listUnfolded() = shoot("audio-lessons-11-list-unfolded") { AudioLessonsScreen(s.list, AudioLessonsActions()) }

    @Test fun playerSleepRecap() = shoot("audio-lessons-13-player-sleep-recap") {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(lesson = s.sleep, savedOnPhone = true, canPlay = true, playing = true, positionMs = 64_500, showTranscript = true),
            AudioLessonPlayerActions(),
        )
    }

    private val feed = dev.jeromeswannack.chineselearning.lab.data.api.PodcastFeedDto(
        url = "https://chinese-learning-api.jeromeswannack.workers.dev/api/podcast/o_SLkX2f9QdW3bq7Lm0pZr8Tn4Yc6Hv1Ja5Ue2Gtcg8/feed.xml",
        podcast_url = "podcast://chinese-learning-api.jeromeswannack.workers.dev/api/podcast/o_SLkX2f9QdW3bq7Lm0pZr8Tn4Yc6Hv1Ja5Ue2Gtcg8/feed.xml",
        apple_url = "pcast://chinese-learning-api.jeromeswannack.workers.dev/api/podcast/o_SLkX2f9QdW3bq7Lm0pZr8Tn4Yc6Hv1Ja5Ue2Gtcg8/feed.xml",
        created_at = "2026-10-07T08:00:00Z",
    )

    @Test fun podcastFeed() = shoot("audio-lessons-14-podcast-feed") {
        androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.padding(16.dp)) { PodcastFeedSection(PodcastFeedUi(feed = feed), PodcastFeedActions()) }
    }

    @Test fun podcastFeedCopied() = shoot("audio-lessons-15-podcast-feed-copied") {
        androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.padding(16.dp)) {
            PodcastFeedSection(PodcastFeedUi(feed = feed.copy(last_fetched_at = "2026-10-07T21:30:00Z", fetch_count = 4), copied = true), PodcastFeedActions())
        }
    }

    @Test fun podcastFeedOff() = shoot("audio-lessons-16-podcast-feed-off") {
        androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.padding(16.dp)) { PodcastFeedSection(PodcastFeedUi(off = true), PodcastFeedActions()) }
    }

    @Test fun listDark() = shoot("audio-lessons-12-list-dark", dark = true) { AudioLessonsScreen(s.list, AudioLessonsActions()) }
}
