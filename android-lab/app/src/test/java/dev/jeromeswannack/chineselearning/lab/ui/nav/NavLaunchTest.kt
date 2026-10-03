package dev.jeromeswannack.chineselearning.lab.ui.nav

import android.app.NotificationManager
import android.content.Intent
import android.os.Looper
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.navigation.NavGraph
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.MainActivity
import dev.jeromeswannack.chineselearning.lab.shell.NotifyContent
import dev.jeromeswannack.chineselearning.lab.shell.ShellLinks
import dev.jeromeswannack.chineselearning.lab.shell.ShellNotifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config

/**
 * Jerome's two navigation bugs, end to end through MainActivity (intents, onNewIntent,
 * recreate, process death): one Study at most, "go study" taps leave the homework pass alone,
 * and a cold start opens where he was (for 6 h), not Study.
 *
 * The activities are driven by Robolectric (intents, onNewIntent, recreate, destroy) and composed
 * on an empty compose rule's clock: without it, only the first activity of a reused sandbox
 * composes (Compose's window recomposer keeps the first test's frame clock).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class NavLaunchTest {
    @get:Rule val compose = createEmptyComposeRule()

    private lateinit var app: LabApp
    private val launched = mutableListOf<ActivityController<MainActivity>>()

    @Before
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        dev.jeromeswannack.chineselearning.lab.data.CrashLog.clear(app)
        app.prefs.sessionToken = "test-session"
        app.prefs.accountRole = "student"
        app.prefs.landingPage = "study"
        compose.mainClock.autoAdvance = false
        LastRouteStore(app).clear()
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    @After
    fun tearDown() {
        // Never leave an activity composing for the next test, whatever happened.
        launched.forEach { c -> runCatching { if (!c.get().isDestroyed) c.pause().stop().destroy() } }
    }

    private fun waitFor(what: String, check: () -> Boolean) {
        repeat(1500) {
            settleOnce()
            if (runCatching(check).getOrDefault(false)) return
            Thread.sleep(10)
        }
        throw AssertionError("timed out waiting for $what")
    }

    private fun launch(intent: Intent? = null): ActivityController<MainActivity> {
        val c = if (intent == null) Robolectric.buildActivity(MainActivity::class.java) else Robolectric.buildActivity(MainActivity::class.java, intent)
        launched += c
        c.setup()
        waitFor("the shell") { c.get().nav != null }
        settle()
        return c
    }

    private fun settleOnce() {
        shadowOf(Looper.getMainLooper()).idle()
        compose.mainClock.advanceTimeBy(50)
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun settle() = repeat(10) { settleOnce(); Thread.sleep(5) }

    private fun ActivityController<MainActivity>.nav() = get().nav!!
    private fun ActivityController<MainActivity>.stack() =
        nav().controller.currentBackStack.value.filter { it.destination !is NavGraph }.map(LabNav::fullPathOf)

    private fun widgetStudy() = ShellLinks.softIntent(app, ShellLinks.STUDY)

    private fun ActivityController<MainActivity>.background() = apply { pause().stop() }
    private fun ActivityController<MainActivity>.foreground() = apply { start().resume(); settle() }

    /** (a) Home → Study → background → widget Study → back once is Home: one Study entry. */
    @Test
    fun widgetStudyOverAnOpenStudyKeepsOneEntry() {
        val c = launch()
        c.nav().open(Routes.study()); settle()
        c.background()
        c.newIntent(widgetStudy())
        c.foreground()
        assertEquals(listOf("/", "/study"), c.stack())
        c.nav().closeStudy(); settle()
        assertEquals("/", c.nav().currentFullPath())
        c.pause().stop().destroy()
    }

    /** (b) Double widget taps, recreate() and a fold change add nothing. */
    @Test
    fun repeatedIntentsAndRecreationAddNoLayers() {
        val c = launch(widgetStudy())
        waitFor("study from the widget") { c.nav().currentFullPath() == "/study" }
        c.newIntent(widgetStudy()); settle()
        c.newIntent(widgetStudy()); settle()
        assertEquals(listOf("/", "/study"), c.stack())
        c.recreate(); settle()
        waitFor("the shell after recreate") { c.get().nav?.currentFullPath() == "/study" }
        assertEquals(listOf("/", "/study"), c.stack())
        // Unfolding: a configuration change (handled in place, configChanges) replays nothing.
        val wide = android.content.res.Configuration(c.get().resources.configuration).apply { screenWidthDp = 840; smallestScreenWidthDp = 700 }
        c.configurationChange(wide); settle()
        assertEquals(listOf("/", "/study"), c.stack())
        c.pause().stop().destroy()
    }

    /** (c) In a homework pass → the process dies (no saved state) → relaunch restores the pass, not Study. */
    @Test
    fun aColdStartRestoresTheHomeworkPass() {
        val c = launch()
        c.nav().open(Routes.homework()); settle()
        c.nav().open(Routes.homeworkPass("hw1")); settle()
        c.pause().stop().destroy()
        // Relaunched from Recents with the task's original (widget Study) intent: not replayed.
        val fromRecents = widgetStudy().addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)
        val again = launch(fromRecents)
        waitFor("the pass restored") { again.nav().currentFullPath() == "/homework/hw1" }
        assertEquals(listOf("/", "/homework", "/homework/hw1"), again.stack())
        again.pause().stop().destroy()
    }

    /** (d) A last route older than 6 h → the normal landing. */
    @Test
    fun aStaleLastRouteOpensTheLanding() {
        LastRouteStore(app).save(listOf("/", "/homework/hw1"), System.currentTimeMillis() - 7 * 3_600_000L)
        val c = launch()
        assertEquals(listOf("/"), c.stack())
        c.pause().stop().destroy()
    }

    /** (e) Closing Study returns to the screen it was opened from. */
    @Test
    fun closingStudyReturnsToThePreviousScreen() {
        val c = launch()
        c.nav().openTabPath(Routes.DECKS); settle()
        c.nav().open(Routes.deck("abc")); settle()
        c.background()
        c.newIntent(widgetStudy())
        c.foreground()
        assertEquals("/study", c.nav().currentFullPath())
        c.nav().closeStudy(); settle()
        assertEquals("/decks/abc", c.nav().currentFullPath())
        c.pause().stop().destroy()
    }

    /** Homework pass open → the due-card reminder (body or "Open study") and the widget ALWAYS open Study; ✕ → the pass again. */
    @Test
    fun aStudyReminderOpensStudyOverTheHomeworkPass() {
        val c = launch()
        c.nav().open(Routes.homework()); settle()
        c.nav().open(Routes.homeworkPass("hw1")); settle()
        val before = c.stack()
        c.background()
        ShellNotifier.showFront(app, NotifyContent("card1", "打算", "dǎsuàn", "to plan"), dueTotal = 12)
        val n = shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications.single { it.channelId == ShellNotifier.CHANNEL_CARDS }
        val body = shadowOf(n.contentIntent).savedIntent
        val openStudy = shadowOf(n.actions.single { it.title == "Open study" }.actionIntent).savedIntent
        assertTrue(body.getBooleanExtra(ShellLinks.EXTRA_SOFT, false) && openStudy.getBooleanExtra(ShellLinks.EXTRA_SOFT, false))
        for (intent in listOf(body, openStudy, widgetStudy())) {
            c.newIntent(intent)
            c.foreground()
            waitFor("study (stack ${c.stack()})") { c.nav().currentFullPath() == "/study" }
            c.nav().closeStudy(); settle()
            assertEquals(before, c.stack())
            c.background()
        }
        c.foreground()
        c.pause().stop().destroy()
    }

    /** A cold start rebuilt onto Chats (with Study over it) → ✕ → the Study tab opens Home (the v0.456 "Study won't open"). */
    @Test
    fun theStudyTabOpensAfterAColdStartRestoredChats() {
        LastRouteStore(app).save(listOf("/", "/chats", "/study"), System.currentTimeMillis() - 60_000L)
        val c = launch()
        waitFor("the stack restored (${c.stack()})") { c.nav().currentFullPath() == "/study" }
        c.nav().closeStudy(); settle()
        assertEquals("/chats", c.nav().currentFullPath())
        val tabs = NavRules.tabsFor(NavRole(loaded = true))
        c.nav().openTab(tabs.first { it.id == TabId.STUDY }); settle()
        assertEquals("/", c.nav().currentFullPath())
        c.nav().openTab(tabs.first { it.id == TabId.MORE }); settle()
        c.nav().openTab(tabs.first { it.id == TabId.STUDY }); settle()
        assertEquals("/", c.nav().currentFullPath())
        c.pause().stop().destroy()
    }

    /** Nothing resumable going on: the same tap opens Study; a chat notification always opens its chat. */
    @Test
    fun aReminderTapOpensStudyOtherwiseAndChatsAlwaysOpen() {
        val c = launch()
        c.nav().openTabPath(Routes.DECKS); settle()
        c.background()
        c.newIntent(widgetStudy())
        c.foreground()
        assertEquals(listOf("/", "/decks", "/study"), c.stack())
        c.nav().open(Routes.homeworkPass("hw1")); settle()
        c.background()
        c.newIntent(ShellLinks.intent(app, Routes.chat("r1", "c1")))
        c.foreground()
        waitFor("the chat (stack ${c.stack()})") { c.nav().currentFullPath() == "/connections/r1/chat/c1" }
        c.pause().stop().destroy()
    }
}
