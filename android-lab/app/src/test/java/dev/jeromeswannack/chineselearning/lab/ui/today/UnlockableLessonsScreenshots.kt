package dev.jeromeswannack.chineselearning.lab.ui.today

import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonCompanionDto
import dev.jeromeswannack.chineselearning.lab.data.api.CustomLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonUnlockDto
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.audiolessons.AudioLessonPlayerActions
import dev.jeromeswannack.chineselearning.lab.ui.audiolessons.AudioLessonPlayerScreen
import dev.jeromeswannack.chineselearning.lab.ui.audiolessons.AudioLessonPlayerUi
import dev.jeromeswannack.chineselearning.lab.ui.audiolessons.AudioLessonsActions
import dev.jeromeswannack.chineselearning.lab.ui.audiolessons.AudioLessonsScreen
import dev.jeromeswannack.chineselearning.lab.ui.audiolessons.SampleAudioLessons
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonSamples
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LockedGate
import dev.jeromeswannack.chineselearning.lab.ui.lessons.MiniLessonsActions
import dev.jeromeswannack.chineselearning.lab.ui.lessons.MiniLessonsScreen
import dev.jeromeswannack.chineselearning.lab.ui.lessons.MiniLessonsUi
import org.junit.Test

/**
 * Unlockable lessons (`./gradlew :app:recordRoborazziDebug` → app/screenshots/unlock-*.png):
 * today's lesson list with "Ready to unlock" (light / dark), the Mini Lessons list's 🔒 group,
 * the locked gate, the audio lesson list's companion badges, and the player's companion card
 * (waiting / "Mini lesson ready → Start").
 */
class UnlockableLessonsScreenshots : LabScreenshotTest() {
    private val s = UnlockSamples

    @Test fun todayReadyToUnlock() = shoot("unlock-01-today-ready-to-unlock") { TodayLessonsScreen(s.withLockedListened, {}, {}, {}) }
    @Test fun todayReadyToUnlockDark() = shoot("unlock-02-today-ready-to-unlock-dark", dark = true) { TodayLessonsScreen(s.withLockedListened, {}, {}, {}) }

    private fun entry(id: String, title: String, icon: String, created: String, unlock: LessonUnlockDto? = null, unlockedAt: String? = null): LessonEntry {
        val spec = LessonSamples.lesson(LessonSamples.note, LessonSamples.choice, LessonSamples.translate).copy(title = title, icon = icon, description = null)
        return LessonEntry(CustomLessonDto(id, title, null, icon, "companion", "active", created, null, spec, emptyList(), unlock, unlockedAt, unlock?.audioLessonId), emptyList(), ItemSchedule.state(emptyList()))
    }

    private val lessonsUi = MiniLessonsUi(
        lessons = listOf(
            entry("C1", s.COMPANION, "🎧", "2026-10-09T08:00:00Z", LessonUnlockDto("audio_lesson", "al1")),
            entry("M1", "打包 · Taking food home", "🥡", "2026-10-09T08:05:00Z", LessonUnlockDto("manual", prompt = "Go to a restaurant and order 打包")),
            entry("trip1", "China trip 1 · Arriving at Pudong: metro or Didi?", "✈️", "2026-10-06T22:43:00Z"),
        ),
        cutoff = StudyCutoff(Js.parseDate("2026-10-09T23:59:59.999Z")),
        audio = mapOf("al1" to (s.PODCAST to true)),
    )

    @Test fun miniLessons() = shoot("unlock-03-mini-lessons") { MiniLessonsScreen(lessonsUi, MiniLessonsActions(onBack = {})) }
    @Test fun miniLessonsDark() = shoot("unlock-04-mini-lessons-dark", dark = true) { MiniLessonsScreen(lessonsUi, MiniLessonsActions(onBack = {})) }
    @Test fun lockedGate() = shoot("unlock-05-locked-gate") { LockedGate(lessonsUi.lessons!![1], onUnlock = {}, onBack = {}) }

    private val podcast = SampleAudioLessons.dialogue.copy(id = "al1", title = s.PODCAST)
    private val list = SampleAudioLessons.list.copy(
        lessons = SampleAudioLessons.list.lessons.copy(
            data = listOf(
                podcast.copy(chapters = emptyList(), transcript = emptyList(), words = emptyList(), companion = AudioLessonCompanionDto("locked", "C1", s.COMPANION)),
                SampleAudioLessons.sleep.copy(chapters = emptyList(), transcript = emptyList(), words = emptyList(), companion = AudioLessonCompanionDto("unlocked", "C2", "我家旁边有一个邮局 — mini lesson")),
                SampleAudioLessons.story.copy(chapters = emptyList(), transcript = emptyList(), companion = AudioLessonCompanionDto("generating")),
            ),
        ),
    )

    // Tall: the list sits under the "make a lesson" form.
    @org.robolectric.annotation.Config(qualifiers = "w412dp-h1900dp-xxhdpi")
    @Test fun audioListBadges() = shoot("unlock-06-audio-list-badges") { AudioLessonsScreen(list, AudioLessonsActions()) }
    @org.robolectric.annotation.Config(qualifiers = "w412dp-h1900dp-xxhdpi")
    @Test fun audioListBadgesDark() = shoot("unlock-07-audio-list-badges-dark", dark = true) { AudioLessonsScreen(list, AudioLessonsActions()) }

    @Test fun playerWaiting() = shoot("unlock-08-player-mini-lesson-waiting") {
        AudioLessonPlayerScreen(AudioLessonPlayerUi(lesson = podcast, savedOnPhone = true, canPlay = true, positionMs = 155_000, companion = s.lockedCompanion), AudioLessonPlayerActions())
    }
    @Test fun playerReady() = shoot("unlock-09-player-mini-lesson-ready") {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(lesson = podcast, savedOnPhone = true, canPlay = true, positionMs = 700_000, companion = s.unlockedCompanion, listened = true),
            AudioLessonPlayerActions(),
        )
    }
    @Test fun playerMake() = shoot("unlock-10-player-make-mini-lesson") {
        AudioLessonPlayerScreen(AudioLessonPlayerUi(lesson = podcast, savedOnPhone = true, canPlay = true, positionMs = 30_000), AudioLessonPlayerActions())
    }
}
