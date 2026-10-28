package dev.jeromeswannack.chineselearning.lab.ui.auth

import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.auth.SessionRules
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.AccountSwitchDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.SignOutUnsyncedDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.SignedOutBanner
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.ShellFrame
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.study.YouSaidFailed
import org.junit.Test

/** `signed-out-*`: the banner over Home, the transcription row, the sign-out and account-switch questions. */
class SignedOutScreenshots : LabScreenshotTest() {
    private val home = HomeUi(
        loaded = true, userName = "Jerome Swannack", due = QueueCounts(3, 2, 2, 17), reviewedToday = 12,
        decks = listOf(
            DeckSummary("d1", "HSK 3 · Plans & time", 120, QueueCounts(3, 2, 2, 9)),
            DeckSummary("d2", "Homework · 第八课", 24, QueueCounts(0, 0, 0, 6)),
        ),
    )

    @Test fun banner() = shoot("signed-out-01-banner") {
        ShellFrame(NavRules.tabsFor(NavRole()), TabId.STUDY, showBar = true, onSelect = {}, topBanner = { SignedOutBanner({}) }) {
            HomeScreen(ui = home, sync = SyncStatus(lastSyncAt = System.currentTimeMillis() - 3 * 86_400_000L, unsynced = 42), online = true, actions = HomeActions())
        }
    }

    @Test fun transcription() = shoot("signed-out-02-transcription") {
        YouSaidFailed(SessionRules.SIGNED_OUT_TRANSCRIPTION_NOTE, {}, title = SessionRules.SIGNED_OUT_TRANSCRIPTION)
    }

    @Test fun signOutQuestion() = shoot("signed-out-03-sign-out") {
        SignOutUnsyncedDialog(SessionRules.Unsynced(reviews = 42, recordings = 7), {}, {}, {})
    }

    @Test fun accountSwitch() = shoot("signed-out-04-account-switch") {
        AccountSwitchDialog(SessionRules.Unsynced(reviews = 42, recordings = 7), "jerome@example.com", "minghui@example.com", {}, {})
    }
}
