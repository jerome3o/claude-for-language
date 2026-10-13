package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonPlayer
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PlayerContext
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PreviewSave
import org.junit.Test
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachMistakeLessonSamples as M

/** "🎯 Mini lesson on this mistake": the chip, the card in the conversation, an exercise in the preview, the save step. */
class CoachMistakeLessonScreenshots : LabScreenshotTest() {
    @Test fun chip() = shoot("coach-mistake-01-chip") { CoachChatScreen(CoachBackgroundSamples.quickActions, CoachChatActions()) }

    @Test fun writing() = shoot("coach-mistake-02-writing", settleMs = 600) { CoachChatScreen(M.pending, CoachChatActions()) }

    @Test fun card() = shoot("coach-mistake-03-card") { CoachChatScreen(M.ready, CoachChatActions()) }

    @Test fun exercise() = shoot("coach-mistake-04-exercise") {
        LessonPlayer(
            title = M.content.spec.title, icon = "🎯", spec = M.content.spec, env = ExerciseEnv(), context = PlayerContext.Preview,
            previews = null, onComplete = {}, onEnd = {}, startAt = 1,
            previewSave = PreviewSave(M.previews, saved = false),
        )
    }

    @Test fun saveStep() = shoot("coach-mistake-05-save-step", settleMs = 400) {
        LessonPlayer(
            title = M.content.spec.title, icon = "🎯", spec = M.oneNote, env = ExerciseEnv(), context = PlayerContext.Preview,
            previews = null, onComplete = {}, onEnd = {}, startAt = 1,
            previewSave = PreviewSave(M.previews, saved = false),
        )
    }

    @Test fun saved() = shoot("coach-mistake-06-saved", settleMs = 400) {
        CoachLessonScreen(CoachLessonUi(loading = false, content = M.content, previews = M.previews, savedHere = true, finishedRating = 2), onSave = {}, onBack = {}) { _, _ -> }
    }
}
