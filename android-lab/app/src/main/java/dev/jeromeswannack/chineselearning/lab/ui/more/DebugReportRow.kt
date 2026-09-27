package dev.jeromeswannack.chineselearning.lab.ui.more

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import kotlinx.coroutines.launch

/** More → Lab app → "Send debug report" (data/DebugReport.kt; web: Settings → Advanced). */
@Composable
fun DebugReportRow(app: LabApp) {
    val status by app.debugReports.status.collectAsStateWithLifecycle()
    val sending by app.debugReports.sending.collectAsStateWithLifecycle()
    DebugReportRow(status, sending) { app.scope.launch { app.debugReports.sendNow() } }
}

@Composable
fun DebugReportRow(status: String?, sending: Boolean, onSend: () -> Unit) {
    NavRow(
        "🐞",
        if (sending) "Sending debug report…" else "Send debug report",
        desc = status ?: "Uploads what this phone thinks is due, to compare with the web app",
        enabled = !sending,
        onClick = onSend,
    )
}
