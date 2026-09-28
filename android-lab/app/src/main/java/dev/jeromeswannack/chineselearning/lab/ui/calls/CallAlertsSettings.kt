package dev.jeromeswannack.chineselearning.lab.ui.calls

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.settings.Segmented
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection
import dev.jeromeswannack.chineselearning.lab.ui.settings.StatusLine
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

/** Settings → "Video call alerts" (web: CallAlertsSettings.tsx), stateless for screenshots. */
@Composable
fun CallAlertsSection(silent: Boolean, notificationsAllowed: Boolean, note: String?, onSilent: (Boolean) -> Unit, onAllowNotifications: () -> Unit) {
    SettingsSection("Video call alerts", "When your tutor or student starts a video call.") {
        Segmented(listOf(false to "Ring + notify", true to "Silent"), silent, onSelect = onSilent)
        Text(
            if (silent) "Silent: a banner in the app, no sound and no notifications."
            else "The phone rings and vibrates while the app is open. With the app closed a notification comes within about a minute.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
        if (!silent && !notificationsAllowed) {
            Text("Notifications are off for 学 Lab, so a call can't reach you while the app is closed.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink)
            SecondaryPill("Allow notifications", Modifier.height(44.dp), onClick = onAllowNotifications)
        }
        StatusLine(note)
    }
}

@Composable
fun CallAlertsSettings(app: LabApp) {
    val silent by app.callAlerts.silent.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf<String?>(null) }
    fun allowed() = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    var notificationsAllowed by remember { mutableStateOf(allowed()) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { notificationsAllowed = allowed() }
    CallAlertsSection(
        silent, notificationsAllowed, note,
        onSilent = { value ->
            note = null
            scope.launch { runCatching { app.callAlerts.setSilent(value) }.onFailure { note = "Couldn't save: ${it.userMessage()}" } }
        },
        onAllowNotifications = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            else note = "Turn notifications on in Android Settings → Apps → 学 Lab → Notifications."
        },
    )
}
