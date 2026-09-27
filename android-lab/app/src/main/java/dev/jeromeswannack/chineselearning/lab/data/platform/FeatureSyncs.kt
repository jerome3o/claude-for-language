package dev.jeromeswannack.chineselearning.lab.data.platform

import dev.jeromeswannack.chineselearning.lab.ui.nav.NavSync

/**
 * THE registry of per-feature sync steps — one line per feature, nothing else. Each step
 * runs after the core sync and the outbox drain (LabPlatform.afterSync), in this order,
 * and a failing step never fails the others.
 *
 * A feature adds `platform.register("<feature>", <Feature>Sync)` here and implements
 * `FeatureSync` in its own `data/<feature>/` or `ui/<feature>/` file.
 */
object FeatureSyncs {
    fun registerAll(platform: LabPlatform) {
        platform.register("nav", NavSync) // relationships → tab set / landing (ui/nav/NavData.kt)
        platform.register("teaching", dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSync) // tutor dashboard + student pages (F)
        platform.register("shell", dev.jeromeswannack.chineselearning.lab.shell.HomeworkFeed) // widget + homework notification (package I)
        // Add yours below, one line each (keep the order: what study needs offline first).
        platform.register("study-notes", dev.jeromeswannack.chineselearning.lab.ui.study.TutorNotes.Sync) // tutor notes on the card back (A)
        platform.register("lessons", dev.jeromeswannack.chineselearning.lab.data.lessons.LessonsSync) // B: mini lessons (+ media)
    }
}
