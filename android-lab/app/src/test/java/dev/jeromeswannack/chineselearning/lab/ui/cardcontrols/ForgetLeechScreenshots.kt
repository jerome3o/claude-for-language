package dev.jeromeswannack.chineselearning.lab.ui.cardcontrols

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardHold
import dev.jeromeswannack.chineselearning.lab.core.Leech
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/**
 * Leeches + "Forget this card" (`./gradlew :app:recordRoborazziDebug` → app/screenshots/forget-leech-*.png):
 * the Forget sheet (warning first), the leech sheet, the card hub with a leech — light and dark.
 */
class ForgetLeechScreenshots : LabScreenshotTest() {
    private val types = listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi")

    private val info = Leech.Info(
        lapses = 9,
        isLeech = true,
        lapseDates = listOf("2026-09-02T08:00:00.000Z", "2026-10-20T08:00:00.000Z"),
        reviews = 31,
        recent = listOf(
            Leech.Recent("2026-10-21T08:10:00.000Z", 2, false),
            Leech.Recent("2026-10-20T08:20:00.000Z", 1, false),
            Leech.Recent("2026-10-20T08:00:00.000Z", 0, true),
            Leech.Recent("2026-10-14T08:00:00.000Z", 2, false),
            Leech.Recent("2026-10-09T08:00:00.000Z", 3, false),
        ),
        forgottenAt = null,
    )
    private val actions = LeechSheetActions(onEdit = {}, onMemoryHook = {}, onSnooze = {}, onSuspend = {}, onForget = {})

    @Test fun forgetSheet() = shoot("forget-leech-01-forget-sheet") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) { ForgetSheet("银行", "hanzi_to_meaning", types, onApply = {}, onDismiss = {}) }
    }
    @Test fun forgetSheetDark() = shoot("forget-leech-02-forget-sheet-dark", dark = true) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) { ForgetSheet("银行", "hanzi_to_meaning", types, onApply = {}, onDismiss = {}) }
    }
    @Test fun leechSheet() = shoot("forget-leech-03-leech-sheet") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) { LeechSheet(9, load = { info }, actions = actions, onDismiss = {}) }
    }
    @Test fun leechSheetDark() = shoot("forget-leech-04-leech-sheet-dark", dark = true) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) { LeechSheet(9, load = { info }, actions = actions, onDismiss = {}) }
    }

    private val hubRows = listOf(
        HubHoldRow("c1", "hanzi_to_meaning", null, lapses = 9),
        HubHoldRow("c2", "meaning_to_hanzi", CardHold("h2", "c2", "snooze", "2026-10-29", "2026-10-22T10:00:00.000Z"), lapses = 2),
        HubHoldRow("c3", "audio_to_hanzi", null),
    )

    @Test fun hub() = shoot("forget-leech-05-hub") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
            HubCardControlsView(hubRows, "2026-10-22", "Card reset to New.", onRelease = {}, onHold = { _, _ -> }, canUndo = true)
        }
    }
    @Test fun hubDark() = shoot("forget-leech-06-hub-dark", dark = true) {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
            HubCardControlsView(hubRows, "2026-10-22", null, onRelease = {}, onHold = { _, _ -> })
            Box(Modifier.padding(top = 24.dp)) { LeechPill(12, onOpen = {}) }
        }
    }
}
