package dev.jeromeswannack.chineselearning.lab.shell

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch

/**
 * Android 13+ POST_NOTIFICATIONS, asked ONCE after sign-in (the hybrid asked on every launch).
 * Created in MainActivity.onCreate (a result launcher must be registered before STARTED);
 * More → Lab app → Due-card notifications asks again on demand.
 */
class ShellPermission(private val activity: ComponentActivity) {
    private val launcher: ActivityResultLauncher<String> =
        activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) return@registerForActivityResult
            // First card straight away if one is due (outside quiet hours).
            (activity.application as? dev.jeromeswannack.chineselearning.lab.LabApp)?.let { app ->
                app.scope.launch { runCatching { Shell.check(app, syncFirst = false) } }
            }
        }

    fun maybeAsk() {
        if (Build.VERSION.SDK_INT < 33) return
        val prefs = ShellPrefs(activity)
        if (prefs.askedPermission || !prefs.notificationsOn) return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        prefs.askedPermission = true
        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
