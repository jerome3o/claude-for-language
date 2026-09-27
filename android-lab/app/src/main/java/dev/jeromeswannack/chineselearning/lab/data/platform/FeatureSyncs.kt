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
        platform.register("connections", dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsSync) // E: my id + notifications (Tutor tab badge)
        platform.register("homework", dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkSync) // E: homework, "From <tutor>", onboarding
        platform.register("teaching", dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSync) // tutor dashboard + student pages (F)
        platform.register("shell", dev.jeromeswannack.chineselearning.lab.shell.HomeworkFeed) // widget + homework notification (package I)
        platform.register("library", dev.jeromeswannack.chineselearning.lab.ui.library.LibrarySync) // lesson library list (ui/library)
        // Add yours below, one line each (keep the order: what study needs offline first).
        platform.register("study-notes", dev.jeromeswannack.chineselearning.lab.ui.study.TutorNotes.Sync) // tutor notes on the card back (A)
        platform.register("study-mc", dev.jeromeswannack.chineselearning.lab.ui.study.MultipleChoice.Sync) // multiple-choice options for offline listen cards (A)
        platform.register("lessons", dev.jeromeswannack.chineselearning.lab.data.lessons.LessonsSync) // B: mini lessons (+ media)
        platform.register("quests", dev.jeromeswannack.chineselearning.lab.ui.quests.QuestsSync) // H: levels playable offline
    }
}
