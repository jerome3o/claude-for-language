package dev.jeromeswannack.chineselearning.lab.ui.more

import androidx.compose.runtime.Composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav

/**
 * THE slot for extra rows at the end of More → "Lab app" (debug report, diagnostics, …).
 * One list entry per row, built with the kit's `NavRow` / `ToggleRow`; the More screen
 * draws the dividers. Keep each row's logic in its own file and add one line here:
 *
 *   { NavRow("🐞", "Send debug report", desc = "Logs and sync state for Jerome", onClick = { DebugReport.send(nav.app) }) },
 */
fun labExtraRows(nav: LabNav): List<@Composable () -> Unit> = listOf(
    // one line per row
)
