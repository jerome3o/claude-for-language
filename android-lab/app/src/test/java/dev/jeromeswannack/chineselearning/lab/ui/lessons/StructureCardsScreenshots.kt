package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonJson
import dev.jeromeswannack.chineselearning.lab.core.LessonPatterns
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.NoteExercise
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * Structure cards (docs/STUDY_SESSION.md "Structure cards"): a note's `patterns` (the catalogue sample) and an older
 * lesson's "All structures" wall parsed into cards — light and dark, first and a later card.
 */
class StructureCardsScreenshots : LabScreenshotTest() {
    private val env = ExerciseEnv(random = Random(7), playClip = { _, _, _ -> true })

    /** The real opening note of "天冷起来了" (4 Nov 2026), as written before structure cards. */
    private val wall = NoteExercise(
        title = "All structures",
        body = "① 除了 + 名词／动词短语 +（以外），主语 + 还 + 动词\n   Besides + Noun / Verb phrase + (apart from), Subject + also + Verb\n   → besides A, also B\n\n" +
            "② （不）好 + 动词\n   (not) easy to + Verb\n   → (not) easy to do\n\n" +
            "③ 整十数 + 多 + 量词 + 名词\n   Round number (tens, hundreds…) + more + Measure word + Noun\n   → over X (twenty-odd, 100-plus…)\n\n" +
            "④ 个位数 + 量词 + 多 + 名词\n   Single digit + Measure word + more + Noun\n   → a bit over X\n\n" +
            "⑤ 形容词 + 起来了\n   Adjective + start to + le\n   → is starting to get [adjective]",
        sentences = listOf(
            LessonSentence("除了跑步，他还喜欢游泳。", "Chúle pǎobù, tā hái xǐhuan yóuyǒng.", "Besides running, he also likes swimming."),
            LessonSentence("这个词好记吗？", "Zhège cí hǎo jì ma?", "Is this word easy to remember?"),
            LessonSentence("这个城市有三百多万人。", "Zhège chéngshì yǒu sānbǎi duō wàn rén.", "This city has over three million people."),
            LessonSentence("我的猫九岁多了。", "Wǒ de māo jiǔ suì duō le.", "My cat is a bit over nine."),
            LessonSentence("咖啡馆里热闹起来了。", "Kāfēiguǎn lǐ rènao qǐlai le.", "The café is starting to get lively."),
        ),
    )

    private val sample: LessonExercise
        get() = LessonJson.decodeFromJsonElement(CustomLessonSpec.serializer(), LessonCatalogue.sample("note")!!.spec).sections[0].exercises[0]

    private fun player(ex: LessonExercise, title: String): @Composable () -> Unit = {
        LessonPlayer(title, "🍂", CustomLessonSpec(title, "🍂", null, listOf(LessonSection("结构一览 · All structures", listOf(ex)))), env, PlayerContext.Lesson(), {}, {})
    }

    private fun shootAfter(name: String, dark: Boolean, content: @Composable () -> Unit, act: () -> Unit) {
        compose.setContent { LabTheme(dark = dark) { content() } }
        compose.mainClock.advanceTimeBy(1_500)
        act()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun parsesTheWall() {
        val view = assertNotNull(LessonPatterns.noteView(wall.body, wall.sentences, wall.patterns))
        assertEquals("parsed", view.source)
        assertEquals(5, view.cards.size)
        assertEquals(listOf("咖啡馆里", "热闹", "起来了", "。"), view.cards[4].examples[0].parts.map { it.text })
    }

    @Test fun parsedFirst() = shoot("structure-cards-01-parsed", content = player(wall, "天冷起来了"))
    @Test fun parsedFirstDark() = shoot("structure-cards-02-parsed-dark", dark = true, content = player(wall, "天冷起来了"))
    @Test fun parsedThird() = shootAfter("structure-cards-03-parsed-third", dark = false, content = player(wall, "天冷起来了")) {
        repeat(2) { compose.onAllNodesWithTag(StructureCardTags.NEXT).onFirst().performClick(); compose.mainClock.advanceTimeBy(600) }
    }
    @Test fun introOpensOnlyOnTap() {
        compose.setContent { LabTheme { player(sample, "The 把 sentence")() } }
        compose.mainClock.advanceTimeBy(1_500)
        assertEquals(0, compose.onAllNodesWithTag(StructureIntroTags.ROOT).fetchSemanticsNodes().size)
        compose.onAllNodesWithTag(StructureCardTags.INTRO).onFirst().performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithTag(StructureIntroTags.ROOT).assertExists()
        compose.onNodeWithTag("clip-pattern", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun spec() = shoot("structure-cards-04-spec", content = player(sample, "The 把 sentence"))
    @Test fun specDark() = shoot("structure-cards-05-spec-dark", dark = true, content = player(sample, "The 把 sentence"))
}
