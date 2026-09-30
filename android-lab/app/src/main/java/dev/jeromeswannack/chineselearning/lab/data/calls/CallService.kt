package dev.jeromeswannack.chineselearning.lab.data.calls

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.jeromeswannack.chineselearning.lab.MainActivity
import dev.jeromeswannack.chineselearning.lab.R
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Keeps a live call running when the screen is off or another app is in front: Android stops an
 * app's microphone and camera in the background unless a foreground service of those types holds
 * them. Its notification ("Video call in progress") opens the call. Screen sharing adds the
 * mediaProjection type before the capture starts ([prepareScreenShare], required on Android 14+).
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val callId = intent?.getStringExtra(EXTRA_CALL_ID).orEmpty()
        val screen = intent?.getBooleanExtra(EXTRA_SCREEN, false) == true
        ensureChannel(this)
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(Intent.ACTION_VIEW, Uri.parse("chineselearning-lab:///calls/$callId"), this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_lab)
            .setContentTitle("Video call in progress")
            .setContentText(if (screen) "Sharing your screen · tap to return to the call" else "Tap to return to the call")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(open)
            .build()
        var types = 0
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (granted(Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (granted(Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }
        if (screen && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        runCatching { ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types) }
        if (screen) screenReady?.complete(Unit)
        return START_NOT_STICKY
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    /**
     * The app was swiped away from recents during a call: leave the room now (best effort — the
     * process may be killed right after; if it is, the room's heartbeat drops us within ~45 s).
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        runCatching { onAppRemoved?.invoke() }
        super.onTaskRemoved(rootIntent)
    }

    companion object {
        private const val CHANNEL = "lab_calls"
        private const val NOTIFICATION_ID = 7301
        private const val EXTRA_CALL_ID = "call_id"
        private const val EXTRA_SCREEN = "screen"
        @Volatile private var screenReady: CompletableDeferred<Unit>? = null
        /** Set by the call screen while a call is on: leave the room (see [onTaskRemoved]). */
        @Volatile var onAppRemoved: (() -> Unit)? = null

        private fun ensureChannel(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Video calls", NotificationManager.IMPORTANCE_LOW))
        }

        fun start(ctx: Context, callId: String, screen: Boolean = false) {
            val intent = Intent(ctx, CallService::class.java).putExtra(EXTRA_CALL_ID, callId).putExtra(EXTRA_SCREEN, screen)
            runCatching { ContextCompat.startForegroundService(ctx, intent) }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, CallService::class.java)) }
        }

        /** Re-promotes the service with the mediaProjection type and waits (≤ 2 s) until it has. */
        suspend fun prepareScreenShare(ctx: Context, callId: String) {
            val ready = CompletableDeferred<Unit>().also { screenReady = it }
            start(ctx, callId, screen = true)
            withTimeoutOrNull(2_000) { ready.await() }
        }
    }
}
