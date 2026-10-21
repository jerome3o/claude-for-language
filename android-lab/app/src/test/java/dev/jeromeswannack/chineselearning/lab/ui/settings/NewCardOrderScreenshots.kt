package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.NewCardOrder
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** Settings → "Order new cards by": the defaults (every switch on) and a customised order. */
class NewCardOrderScreenshots : LabScreenshotTest() {
    private fun frame(name: String, order: NewCardOrder, note: String? = null) = shoot(name) {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            NewCardOrderSection(order, busy = false, note = note, onToggle = { _, _ -> }, onReset = {})
        }
    }

    @Test fun defaults() = frame("new-card-order-01-default", NewCardOrder.DEFAULT)

    @Test fun customised() = frame("new-card-order-02-custom", NewCardOrder.DEFAULT.copy(newWordsFirst = false, sentencesLast = false), "Saved ✓")

    @Test fun knownCharactersOff() = frame("new-card-order-03-known-characters-off", NewCardOrder.DEFAULT.copy(knownCharactersEnglishFirst = false), "Saved ✓")

    @Test fun everydayOff() = frame("new-card-order-04-everyday-off", NewCardOrder.DEFAULT.copy(everydayFirst = false), "Saved ✓")
}
