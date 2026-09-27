package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Same cases as shared/lesson/images.ts + lessonImagePlaceholder (frontend/src/services/lessonImages.test.ts). */
class LessonImagesTest {
    private val cafe = "A small café counter: a barista hands two cups of coffee"

    private fun spec(vararg ex: DescribeImageExercise) = CustomLessonSpec("Scenes", sections = listOf(LessonSection(exercises = ex.toList())))

    @Test fun normalisesLikeJs() {
        assertEquals("a cat on a mat", LessonImages.normalizePrompt("  a  cat\n on　a mat "))
    }

    @Test fun promptsAndKeys() {
        val s = spec(
            DescribeImageExercise(imagePrompt = cafe),
            DescribeImageExercise(imagePrompt = "A park", imageUrl = "lesson-images/p.png"),
            DescribeImageExercise(imagePrompt = "$cafe "),
        )
        assertEquals(listOf(cafe, "A park"), LessonImages.prompts(s))
        assertEquals(listOf(cafe), LessonImages.prompts(s, missingOnly = true))
        assertEquals(listOf("lesson-images/p.png"), LessonImages.keys(s))
    }

    @Test fun catalogueSampleHasAScene() {
        val sample = LessonCatalogue.sample("describe_image")!!
        val prompts = LessonImages.prompts(sample.spec)
        assertEquals(1, prompts.size)
        assertTrue(prompts[0].startsWith("A small café counter"))
    }

    @Test fun placeholderCopyMatchesTheWeb() {
        assertEquals(LessonImages.Placeholder(true, "Drawing the picture…", "It appears here in a moment."), LessonImages.placeholder(LessonImages.State.Pending))
        assertTrue(LessonImages.placeholder(LessonImages.State.Slow).drawing)
        assertTrue(LessonImages.placeholder(LessonImages.State.Offline).title.contains("next sync"))
        assertTrue(LessonImages.placeholder(LessonImages.State.Failed).title.contains("could not be drawn"))
        assertEquals("Imagine this scene:", LessonImages.placeholder(LessonImages.State.None).title)
    }

    @Test fun statusToState() {
        assertEquals(LessonImages.State.Pending, LessonImages.stateFor("pending", 3, 45))
        assertEquals(LessonImages.State.Slow, LessonImages.stateFor("pending", 46, 45))
        assertEquals(LessonImages.State.Failed, LessonImages.stateFor("failed", 0, 45))
        assertEquals(LessonImages.State.None, LessonImages.stateFor("unavailable", 0, 45))
        assertEquals(LessonImages.State.Ready, LessonImages.stateFor("ready", 0, 45))
    }
}
