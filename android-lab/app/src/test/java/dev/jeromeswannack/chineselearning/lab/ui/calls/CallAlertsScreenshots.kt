package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallAlerts
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.home.TutorHomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.TutorHomeUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config

/** Finding the call: the banner on Home, across the top, inline; the Settings section. */
class CallAlertsScreenshots : LabScreenshotTest() {
    private val now = System.currentTimeMillis()
    private fun sqlAgo(ms: Long) = java.time.Instant.ofEpochMilli(now - ms).toString().replace('T', ' ').substring(0, 19)
    private val calls = listOf(CallAlerts.LiveCall("c1", "rel-1", "tutor", "live", sqlAgo(20_000), "王明慧"))
    private val incoming = CallAlerts.pickCallBanner(calls, "me", "/", now)!!
    private val rejoin = CallAlerts.pickCallBanner(listOf(calls[0].copy(createdBy = "me", otherUserName = "Jerome")), "me", "/", now)!!
    private val test = CallAlerts.pickCallBanner(listOf(calls[0].copy(relationshipId = null, createdBy = "me")), "me", "/", now, includeTest = true)!!

    @Test fun homeIncoming() = shootInShell("calls-30-home-incoming-call", active = TabId.STUDY) {
        HomeScreen(
            HomeUi(loaded = true, userName = "Jerome Swannack", due = Samples.counts, decks = Samples.decks, reviewedToday = 12), Samples.sync(), online = true,
            actions = HomeActions(), callBanner = { CallBannerView(incoming, CallBannerVariant.CARD, {}, {}) },
        )
    }

    @Test fun tutorHomeIncoming() = shootInShell("calls-31-tutor-home-incoming-call", active = TabId.STUDENTS, tabs = NavRules.tabsFor(NavRole(isTutorAccount = true))) {
        TutorHomeScreen(TutorHomeUi("明慧", 3, Samples.decks.map { it.id to it.name }), onOpen = {}, callBanner = {
            CallBannerView(CallAlerts.pickCallBanner(listOf(calls[0].copy(otherUserName = "Jerome Swannack")), "me", "/", now)!!, CallBannerVariant.CARD, {}, {})
        })
    }

    @Test fun variants() = shootInShell("calls-32-banner-variants", active = TabId.DECKS) {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp).padding(top = 72.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Across the top of every normal screen ↑", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                Text("On the tutor / student page and in the chat:", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
                CallBannerView(incoming, CallBannerVariant.INLINE, {}, null)
                Text("My own call, still on:", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
                CallBannerView(rejoin, CallBannerVariant.INLINE, {}, null)
                Text("A test call (calls page only):", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
                CallBannerView(test, CallBannerVariant.INLINE, {}, null)
            }
            Box(Modifier.padding(8.dp), contentAlignment = Alignment.TopCenter) { CallBannerView(incoming, CallBannerVariant.TOP, {}, {}) }
        }
    }

    @Test fun settingsRing() = shoot("calls-33-settings-call-alerts") {
        LabScreen("Settings") {
            item { CallAlertsSection(silent = false, notificationsAllowed = false, note = null, onSilent = {}, onAllowNotifications = {}) }
            item { CallAlertsSection(silent = true, notificationsAllowed = true, note = "Saved ✓", onSilent = {}, onAllowNotifications = {}) }
        }
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun homeIncomingUnfolded() = shootInShell("calls-34-home-incoming-call-unfolded", active = TabId.STUDY) {
        HomeScreen(
            HomeUi(loaded = true, userName = "Jerome Swannack", due = Samples.counts, decks = Samples.decks, reviewedToday = 12), Samples.sync(), online = true,
            actions = HomeActions(), callBanner = { CallBannerView(incoming, CallBannerVariant.CARD, {}, {}) },
        )
    }
}
