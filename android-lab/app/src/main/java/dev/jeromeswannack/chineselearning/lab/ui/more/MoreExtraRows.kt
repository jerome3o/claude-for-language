package dev.jeromeswannack.chineselearning.lab.ui.more

import androidx.compose.runtime.Composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav

/**
 * THE slot for extra rows at the end of More → "Lab app" (debug report, diagnostics, …).
 * One list entry per row, built with the kit's `NavRow` / `ToggleRow`; the More screen
 * draws the dividers. Keep each row's logic in its own file and add one line here:
 *
 *   { NavRow("🩺", "Audio diagnostics", desc = "…", onClick = { … }) },
 */
fun labExtraRows(nav: LabNav): List<@Composable () -> Unit> = listOf(
    { DebugReportRow(nav.app) }, // data/DebugReport.kt
    { dev.jeromeswannack.chineselearning.lab.shell.NotificationsRow(nav.app) }, // shell/ (package I)
    { dev.jeromeswannack.chineselearning.lab.shell.WidgetRow(nav.app) }, // shell/ (package I)
)
