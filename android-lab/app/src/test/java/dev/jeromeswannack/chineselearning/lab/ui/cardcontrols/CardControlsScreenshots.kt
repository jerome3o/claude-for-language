package dev.jeromeswannack.chineselearning.lab.ui.cardcontrols

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.background
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardHold
import dev.jeromeswannack.chineselearning.lab.core.HoldListRow
import dev.jeromeswannack.chineselearning.lab.data.holds.HoldStore
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/**
 * Suspend & snooze (`./gradlew :app:recordRoborazziDebug` → app/screenshots/card-controls-*.png): the
 * ⋯ → Snooze… and Suspend… sheets, "Suspended & snoozed cards" (filled, a search, empty), the
 * Settings card and the card hub's controls — light and dark.
 */
class CardControlsScreenshots : LabScreenshotTest() {
    private val today = "2026-10-22"

    private fun row(id: String, hanzi: String, pinyin: String, english: String, type: String, kind: String, until: String?, deck: String = "HSK 2") =
        HoldStore.Row(HoldListRow(id, CardHold("h-$id", id, kind, until, "2026-10-${if (kind == "suspend") "03" else "21"}T10:00:00.000Z"), hanzi, pinyin, english), "n-$id", type, "d1", deck)

    private val rows = listOf(
        row("c1", "银行", "yínháng", "bank", "hanzi_to_meaning", "suspend", null),
        row("c2", "银行", "yínháng", "bank", "audio_to_hanzi", "suspend", null),
        row("c3", "辛苦", "xīnkǔ", "hard-working; tiring", "meaning_to_hanzi", "snooze", "2026-10-23"),
        row("c4", "打扰", "dǎrǎo", "to disturb", "hanzi_to_meaning", "snooze", "2026-11-22", deck = "Lesson notes"),
        row("c5", "一模一样", "yìmú-yíyàng", "exactly the same", "meaning_to_hanzi", "snooze", "2026-10-29"),
    )
    private val ui = HeldCardsUi(loaded = true, rows = rows, today = today)

    @Test fun list() = shoot("card-controls-01-held-list") { HeldCardsScreen(ui, HeldCardsActions()) }
    @Test fun listDark() = shoot("card-controls-02-held-list-dark", dark = true) { HeldCardsScreen(ui.copy(picked = setOf("c3", "c4")), HeldCardsActions()) }
    @Test fun listSearch() = shoot("card-controls-03-held-search") { HeldCardsScreen(ui.copy(query = "yinhang", filter = "suspended"), HeldCardsActions()) }
    @Test fun empty() = shoot("card-controls-04-held-empty") { HeldCardsScreen(HeldCardsUi(loaded = true, today = today), HeldCardsActions()) }

    private val types = listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi")

    @Test fun snoozeSheet() = shoot("card-controls-05-snooze-sheet") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            CardControlSheet("snooze", "辛苦", "meaning_to_hanzi", types, today, onApply = { _, _ -> }, onDismiss = {})
        }
    }
    @Test fun snoozeSheetDark() = shoot("card-controls-06-snooze-sheet-dark", dark = true) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            CardControlSheet("snooze", "辛苦", "meaning_to_hanzi", types, today, onApply = { _, _ -> }, onDismiss = {})
        }
    }
    @Test fun suspendSheet() = shoot("card-controls-07-suspend-sheet") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            CardControlSheet("suspend", "银行", "hanzi_to_meaning", types, today, onApply = { _, _ -> }, onDismiss = {})
        }
    }
    @Test fun suspendSheetDark() = shoot("card-controls-08-suspend-sheet-dark", dark = true) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            CardControlSheet("suspend", "银行", "hanzi_to_meaning", types, today, onApply = { _, _ -> }, onDismiss = {})
        }
    }

    private val hubRows = listOf(
        HubHoldRow("c1", "hanzi_to_meaning", CardHold("h1", "c1", "suspend", null, "2026-10-03T10:00:00.000Z")),
        HubHoldRow("c2", "meaning_to_hanzi", CardHold("h2", "c2", "snooze", "2026-10-29", "2026-10-22T10:00:00.000Z")),
        HubHoldRow("c3", "audio_to_hanzi", null),
    )

    @Test fun settingsAndHub() = shoot("card-controls-09-settings-hub") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
            CardControlsSettingsView(on = true, suspended = 2, snoozed = 3, onToggle = {}, onOpen = {})
            Box(Modifier.padding(top = 24.dp)) { HubCardControlsView(hubRows, today, null, onRelease = {}, onHold = { _, _ -> }) }
        }
    }
    @Test fun settingsAndHubDark() = shoot("card-controls-10-settings-hub-dark", dark = true) {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
            CardControlsSettingsView(on = false, suspended = 0, snoozed = 0, onToggle = {}, onOpen = {})
            Box(Modifier.padding(top = 24.dp)) { HubCardControlsView(hubRows, today, "Back in study.", onRelease = {}, onHold = { _, _ -> }) }
        }
    }
}
