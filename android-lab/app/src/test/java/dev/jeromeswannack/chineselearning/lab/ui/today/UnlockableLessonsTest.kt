package dev.jeromeswannack.chineselearning.lab.ui.today

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.LessonUnlock
import dev.jeromeswannack.chineselearning.lab.ui.audiolessons.CompanionCard
import dev.jeromeswannack.chineselearning.lab.ui.audiolessons.CompanionView
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** "Ready to unlock" on today's lesson list and the audio player's companion card. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h1800dp-xxhdpi", application = android.app.Application::class)
class UnlockableLessonsTest {
    @get:Rule val compose = createComposeRule()

    /** Render on a manual clock (animations never hold up idling — TodayComposeTest's way). */
    private fun show(content: @androidx.compose.runtime.Composable () -> Unit) {
        compose.mainClock.autoAdvance = false
        compose.setContent { LabTheme { content() } }
        compose.mainClock.advanceTimeBy(2_000)
    }

    @Test
    fun readyToUnlockListsLockedLessonsWithListenAndUnlock() {
        val unlocked = mutableListOf<String>()
        val listened = mutableListOf<String>()
        show {
            run {
                TodayLessonsScreen(UnlockSamples.withLocked, onBack = {}, onOpen = {}, onAllLessons = {}, onUnlock = { unlocked += it }, onListen = { listened += it })
            }
        }
        compose.onNodeWithText("🔒 Ready to unlock").assertIsDisplayed()
        compose.onNodeWithTag("unlock-C1").performClick()
        compose.onNodeWithTag("locked-listen-C1").performClick()
        compose.onNodeWithTag("unlock-M1").performClick()
        assertEquals(listOf("C1", "M1"), unlocked)
        assertEquals(listOf("al1"), listened)
        // The manual one has no podcast to listen to; "All mini lessons ›" stays, below.
        compose.onNodeWithText("✓ Done — unlock").assertIsDisplayed()
        compose.onNodeWithTag("today-all-lessons").assertIsDisplayed()
    }

    @Test
    fun theCompanionCardSaysReadyAndStartsOnceListened() {
        val started = mutableListOf<String>()
        show {
            run {
                CompanionCard(UnlockSamples.unlockedCompanion, listened = true, online = true, busy = false, onMake = {}, onUnlock = {}, onStart = { started += it })
            }
        }
        compose.onNodeWithText("🔓 Mini lesson ready: 去朋友家吃饭 · Dinner at a friend's parents' home — mini lesson").assertIsDisplayed()
        compose.onNodeWithTag("al-companion-start").performClick()
        assertEquals(listOf("C1"), started)
    }

    @Test
    fun aLockedCompanionOffersTheUnlockAndNoneOffersMakeIt() {
        var unlocks = 0
        var makes = 0
        show {
            run {
                androidx.compose.foundation.layout.Column {
                    CompanionCard(UnlockSamples.lockedCompanion, listened = false, online = true, busy = false, onMake = {}, onUnlock = { unlocks++ }, onStart = {})
                    CompanionCard(null, listened = false, online = true, busy = false, onMake = { makes++ }, onUnlock = {}, onStart = {})
                }
            }
        }
        compose.onNodeWithText("🔒 Mini lesson waiting").assertIsDisplayed()
        compose.onNodeWithTag("al-companion-unlock").performClick()
        compose.onNodeWithTag("al-companion-make").performClick()
        assertEquals(1, unlocks)
        assertEquals(1, makes)
    }
}

/** Realistic locked / unlocked companions for tests and screenshots. */
object UnlockSamples {
    const val PODCAST = "去朋友家吃饭 · Dinner at a friend's parents' home"
    const val COMPANION = "$PODCAST — mini lesson"
    val audioUnlock = LessonUnlock(LessonUnlock.AUDIO_LESSON, audioLessonId = "al1")
    val manualUnlock = LessonUnlock(LessonUnlock.MANUAL, prompt = "Go to a restaurant and order 打包")

    val withLocked = TodaySamples.midDay.copy(
        locked = listOf(
            TodayLockedRow("C1", COMPANION, audioUnlock, audioTitle = PODCAST),
            TodayLockedRow("M1", "打包 · Taking food home", manualUnlock),
        ),
    )
    val withLockedListened = withLocked.copy(
        locked = listOf(TodayLockedRow("C1", COMPANION, audioUnlock, audioTitle = PODCAST, listened = true), withLocked.locked[1]),
    )
    val lockedCompanion = CompanionView("locked", "C1", COMPANION, audioUnlock)
    val unlockedCompanion = CompanionView("unlocked", "C1", COMPANION, audioUnlock)
}
