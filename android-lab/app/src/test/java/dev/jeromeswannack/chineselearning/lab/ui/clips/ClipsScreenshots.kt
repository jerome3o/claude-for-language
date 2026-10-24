package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.doubleClick
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPlayState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipQuizState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSpec
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipUserState
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.data.clips.ClipStore
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.serialization.json.Json
import org.junit.Test
import org.robolectric.annotation.Config

/** 🎬 Clips: every layout (neon), the other seven themes, a quiz answered, the story, the end card, Learn more, empty, the ❤️ burst. */
class ClipsScreenshots : LabScreenshotTest() {
    private val json = Json { ignoreUnknownKeys = true }
    private val sample: ClipSpec = json.decodeFromString(ClipSpec.serializer(), """{"v": 1, "title": "刚 vs 刚才 — the 5-second rule", "hook": "You've been using 刚才 wrong 👀", "topic": "刚 vs 刚才", "style": {"theme": "neon", "accent": "#FF3B6B"}, "words": [{"hanzi": "刚才", "pinyin": "gāngcái", "english": "just now (a moment ago)"}, {"hanzi": "刚", "pinyin": "gāng", "english": "just (adverb)"}], "tags": ["grammar", "confusables"], "scenes": [{"layout": "title", "duration_ms": 2500, "voice": {"text": "刚和刚才，有什么不一样？", "lang": "zh", "voice": "teacher"}, "emoji": "⏱️", "title": {"headline_zh": "刚 vs 刚才", "headline_en": "just vs just now", "sub": "one small difference"}}, {"layout": "big_word", "duration_ms": 4000, "big_word": {"hanzi": "刚才", "pinyin": "gāngcái", "english": "just now — a moment ago (a time word)", "breakdown": [{"char": "刚", "meaning": "just"}, {"char": "才", "meaning": "only then"}]}}, {"layout": "sentence", "duration_ms": 4500, "sentence": {"hanzi": "我刚才吃了饭。", "pinyin": "Wǒ gāngcái chīle fàn.", "english": "I ate a moment ago.", "highlight": "刚才"}}, {"layout": "compare", "duration_ms": 6000, "compare": {"left": {"hanzi": "刚", "pinyin": "gāng", "english": "just (adverb, right before the verb)", "example": "我刚到。"}, "right": {"hanzi": "刚才", "pinyin": "gāngcái", "english": "just now (a time word, can go before the subject)", "example": "刚才我在开会。"}, "rule_en": "刚才 can start the sentence; 刚 can't."}}, {"layout": "quiz", "duration_ms": 8000, "quiz": {"prompt_zh": "___我在洗澡，没听到电话。", "prompt_en": "I was in the shower just now…", "options": ["刚", "刚才"], "answer_index": 1, "explain": "Before the subject → 刚才."}}, {"layout": "story", "duration_ms": 7000, "story": {"lines": [{"speaker": "A", "hanzi": "你刚才去哪儿了？", "pinyin": "Nǐ gāngcái qù nǎr le?", "english": "Where did you go just now?"}, {"speaker": "B", "hanzi": "我刚下楼。", "pinyin": "Wǒ gāng xià lóu.", "english": "I just went downstairs."}]}}, {"layout": "list", "duration_ms": 5000, "list": {"title": "Also say it like…", "items": [{"hanzi": "刚刚", "pinyin": "gānggāng", "english": "just (emphatic)"}]}}, {"layout": "fact", "duration_ms": 4000, "fact": {"text_en": "Native speakers often say 刚刚 for both.", "hanzi": "刚刚", "pinyin": "gānggāng"}}], "ending": {"question_en": "Which one would you use: ___我们见过吗？", "cta": "Double-tap to learn more"}}""")
    private val story: ClipSpec = json.decodeFromString(ClipSpec.serializer(), """{"v": 1, "title": "一会儿 — how long is \"a moment\"?", "hook": "\"一会儿\" can mean five minutes… or an hour", "topic": "一会儿", "style": {"theme": "ink"}, "words": [{"hanzi": "一会儿", "pinyin": "yíhuìr", "english": "a little while"}, {"hanzi": "马上", "pinyin": "mǎshàng", "english": "right away"}], "tags": ["time words", "daily life"], "scenes": [{"layout": "title", "duration_ms": 3000, "voice": {"text": "How long is 一会儿, really?", "lang": "en", "voice": "narrator"}, "emoji": "⏳", "title": {"headline_zh": "一会儿", "headline_en": "a little while… right?", "sub": "a tiny time word with a big range"}}, {"layout": "story", "duration_ms": 8000, "image_prompt": "A cosy small Chinese noodle shop at night seen from the street, steam rising from a pot, warm lights, vertical composition, no text", "story": {"lines": [{"speaker": "旁白", "hanzi": "晚上七点，小王在面馆等朋友。", "pinyin": "Wǎnshang qī diǎn, Xiǎo Wáng zài miànguǎn děng péngyou.", "english": "Seven in the evening: Xiao Wang waits for a friend at a noodle shop."}, {"speaker": "小王", "hanzi": "你到哪儿了？", "pinyin": "Nǐ dào nǎr le?", "english": "Where are you?"}, {"speaker": "小李", "hanzi": "马上到！一会儿就到！", "pinyin": "Mǎshàng dào! Yíhuìr jiù dào!", "english": "Almost there! I'll be there in a moment!"}, {"speaker": "旁白", "hanzi": "一个小时以后……", "pinyin": "Yí gè xiǎoshí yǐhòu……", "english": "An hour later…"}]}}, {"layout": "big_word", "duration_ms": 4500, "big_word": {"hanzi": "一会儿", "pinyin": "yíhuìr", "english": "a little while — anything from a minute to \"later\"", "breakdown": [{"char": "一", "meaning": "one"}, {"char": "会", "meaning": "a moment"}, {"char": "儿", "meaning": "(spoken ending)"}]}}, {"layout": "quiz", "duration_ms": 8000, "quiz": {"prompt_en": "Your friend says \"我马上到\". Compared with \"一会儿到\", that is…", "options": ["sooner", "later"], "answer_index": 0, "explain": "马上 = right away; 一会儿 = in a while."}}, {"layout": "fact", "duration_ms": 4500, "voice": {"text": "马上 literally means on horseback.", "lang": "en", "voice": "narrator"}, "fact": {"text_en": "马上 literally means \"on horseback\" — already on the way.", "hanzi": "马上", "pinyin": "mǎshàng"}}], "ending": {"question_en": "When did your friend last say 马上到?", "cta": "Double-tap to learn more"}}""")

    private fun record(spec: ClipSpec, id: String = "c1", theme: String? = null, liked: Boolean = false) = ClipRecord(
        id = id, status = "ready", source = "agent", title = spec.title, topic = spec.topic,
        spec = if (theme == null) spec else spec.copy(style = spec.style.copy(theme = theme)),
        state = ClipUserState(liked = liked),
    )

    private fun ui(vararg clips: ClipRecord, sheet: ClipSheetUi? = null, scene: Int = 0) =
        ClipsUi(clips = clips.toList(), prefs = ClipStore.CaptionPrefs(), startId = clips.firstOrNull()?.id, startScene = scene, sheet = sheet)

    private fun shot(name: String, clip: ClipRecord, scene: Int = 0, state: ClipPlayState? = null, sheet: ClipSheetUi? = null) =
        shoot(name) { ClipsScreen(ui(clip, sheet = sheet, scene = scene), ClipsActions(), animate = false, clock = false, previewState = state) }

    @Test fun neonTitle() = shot("clips-01-neon-title", record(sample))
    @Test fun bigWord() = shot("clips-02-neon-big-word", record(sample), 1)
    @Test fun sentence() = shot("clips-03-neon-sentence", record(sample), 2)
    @Test fun compare() = shot("clips-04-neon-compare", record(sample), 3)
    @Test fun quiz() = shot("clips-05-neon-quiz", record(sample), 4, ClipPlayState(4, 3000.0, ClipQuizState(null, false, 0.0), false))
    @Test fun quizAnswered() = shot("clips-06-neon-quiz-answered", record(sample, liked = true), 4, ClipPlayState(4, 3000.0, ClipQuizState(0, false, 0.0), false))
    @Test fun storyScene() = shot("clips-07-neon-story", record(sample), 5, ClipPlayState(5, 7000.0, null, false))
    @Test fun list() = shot("clips-08-neon-list", record(sample), 6)
    @Test fun fact() = shot("clips-09-neon-fact", record(sample), 7)
    @Test fun end() = shot("clips-10-end-card", record(sample), 8, ClipPlayState(8, 0.0, null, true))
    @Test fun inkStory() = shot("clips-11-ink-story", record(story, "s1"), 1, ClipPlayState(1, 8000.0, null, false))
    @Test fun inkBigWord() = shot("clips-12-ink-big-word", record(story, "s1"), 2)
    @Test fun paper() = shot("clips-13-paper-title", record(sample, theme = "paper"))
    @Test fun chalk() = shot("clips-14-chalk-compare", record(sample, theme = "chalk"), 3)
    @Test fun comic() = shot("clips-15-comic-title", record(sample, theme = "comic"))
    @Test fun sunset() = shot("clips-16-sunset-compare", record(sample, theme = "sunset"), 3)
    @Test fun mono() = shot("clips-17-mono-title", record(sample, theme = "mono"))
    @Test fun retro() = shot("clips-18-retro-compare", record(sample, theme = "retro"), 3)
    @Test fun learnMore() = shot("clips-19-learn-more", record(sample), 2, sheet = clipSheet(record(sample)))
    @Test fun empty() = shoot("clips-20-empty") { ClipsScreen(ClipsUi(clips = emptyList()), ClipsActions(), animate = false, clock = false) }

    @Test fun heartBurst() {
        val clip = record(sample, theme = "paper", liked = true)
        compose.setContent { LabTheme { ClipsScreen(ui(clip, scene = 1), ClipsActions(), animate = true, clock = false) } }
        compose.mainClock.advanceTimeBy(1500)
        compose.onNodeWithTag("clip-player").performTouchInput { doubleClick(androidx.compose.ui.geometry.Offset(80f * density, 640f * density)) }
        compose.mainClock.autoAdvance = false
        compose.mainClock.advanceTimeBy(300)
        val hearts = compose.onAllNodesWithTag("clip-heart", useUnmergedTree = true).fetchSemanticsNodes()
        kotlin.test.assertEquals(1, hearts.size)
        compose.mainClock.advanceTimeByFrame()
        compose.onRoot().captureRoboImage("screenshots/clips-21-heart-burst.png")
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shot("clips-22-unfolded-compare", record(sample), 3)

    @Test fun offersAreTheCoreOnes() {
        val sheet = clipSheet(record(sample))!!
        kotlin.test.assertEquals(listOf("lesson", "reader", "podcast", "study_words", "add_card", "more"), sheet.offers.map { it.action })
        kotlin.test.assertEquals("Keep going with 刚 vs 刚才", sheet.title)
        kotlin.test.assertEquals(41000, Clips.durationMs(sample))
    }
}
