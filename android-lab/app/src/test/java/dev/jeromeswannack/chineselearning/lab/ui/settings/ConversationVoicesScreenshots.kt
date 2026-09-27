package dev.jeromeswannack.chineselearning.lab.ui.settings

import dev.jeromeswannack.chineselearning.lab.core.ConversationVoices
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import org.junit.Test
import org.robolectric.annotation.Config

class ConversationVoicesScreenshots : LabScreenshotTest() {
    private val ui = ConversationVoicesUi(enabled = ConversationVoices.DEFAULT_IDS, loaded = true, isAdmin = true, playing = "presenter_female")

    @Test fun list() = shoot("voices-01-list") { ConversationVoicesScreen(ui, ConversationVoicesActions(onBack = {})) }

    @Test fun femaleFiltered() = shoot("voices-02-female") {
        ConversationVoicesScreen(
            ui.copy(gender = "female", isAdmin = false, defaultSource = "admin", playing = null, loadingSample = "Chinese (Mandarin)_Sweet_Lady", notice = "Keep at least one female voice on", noticeKind = NoticeKind.Info),
            ConversationVoicesActions(onBack = {}),
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("voices-03-unfolded") { ConversationVoicesScreen(ui.copy(onlyOn = true), ConversationVoicesActions(onBack = {})) }

    @Test fun dark() = shoot("voices-04-dark", dark = true) { ConversationVoicesScreen(ui.copy(gender = "male"), ConversationVoicesActions(onBack = {})) }
}
