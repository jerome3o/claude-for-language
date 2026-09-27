package dev.jeromeswannack.chineselearning.lab.shell

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import kotlinx.coroutines.launch

/** What the notifications row shows: the toggle, and whether Android lets the app notify. */
data class NotificationsRowUi(val on: Boolean, val permitted: Boolean)

/** More → Lab app → "Due-card notifications" (the hybrid had no switch; it asked on every launch). */
@Composable
fun NotificationsRow(app: LabApp) {
    val context = LocalContext.current
    var ui by remember { mutableStateOf(NotificationsRowUi(Shell.prefs.notificationsOn, ShellNotifier.canNotify(context))) }
    // Re-read when coming back from the system settings screen.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { ui = NotificationsRowUi(Shell.prefs.notificationsOn, ShellNotifier.canNotify(context)) }
    }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        ui = ui.copy(permitted = granted)
        if (granted) app.scope.launch { runCatching { Shell.check(app, syncFirst = false) } }
    }
    NotificationsRow(ui) { wantOn ->
        Shell.prefs.notificationsOn = wantOn
        ui = ui.copy(on = wantOn)
        if (!wantOn) {
            ShellNotifier.cancelCard(context)
            return@NotificationsRow
        }
        if (ui.permitted) {
            app.scope.launch { runCatching { Shell.check(app, syncFirst = false) } }
        } else if (Build.VERSION.SDK_INT >= 33 && !Shell.prefs.askedPermission) {
            Shell.prefs.askedPermission = true
            request.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            // Asked before (or blocked per app): the system screen is the only way back.
            context.startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}

@Composable
fun NotificationsRow(ui: NotificationsRowUi, onChange: (Boolean) -> Unit) {
    val desc = when {
        !ui.on -> "Off — no due-card or homework reminders"
        !ui.permitted -> "Blocked by Android — tap to allow"
        else -> "A due card every hour (08:00–22:00) — answer it from the notification. Homework due today, once a day."
    }
    ToggleRow("🔔", "Due-card notifications", checked = ui.on && ui.permitted, desc = desc, onChange = onChange)
}

/** More → Lab app → "Add the home-screen widget" (pins it; the launcher asks where). */
@Composable
fun WidgetRow(app: LabApp) {
    val context = LocalContext.current
    val manager = remember { AppWidgetManager.getInstance(context) }
    val placed = remember { DueWidgetProvider.ids(context).isNotEmpty() }
    val canPin = remember { manager.isRequestPinAppWidgetSupported }
    WidgetRow(placed, canPin) {
        manager.requestPinAppWidget(ComponentName(context, DueWidgetProvider::class.java), null, null)
        app.scope.launch { runCatching { Shell.refresh(app) } }
    }
}

@Composable
fun WidgetRow(placed: Boolean, canPin: Boolean, onAdd: () -> Unit) {
    NavRow(
        "🧩",
        if (placed) "Home-screen widget added" else "Add the home-screen widget",
        desc = if (canPin) "Today's due cards and homework, with Study and Coach" else "Long-press your home screen → Widgets → 学 Lab",
        enabled = canPin,
        onClick = if (canPin) onAdd else null,
    )
}
