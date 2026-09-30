package dev.jeromeswannack.chineselearning.lab.data.calls

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.R
import dev.jeromeswannack.chineselearning.lab.core.calls.CallAlerts
import dev.jeromeswannack.chineselearning.lab.data.api.CallListItemDto
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.get
import dev.jeromeswannack.chineselearning.lab.data.api.put
import dev.jeromeswannack.chineselearning.lab.shell.ShellLinks
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.util.concurrent.TimeUnit

@Serializable
data class LiveCallsDto(val calls: List<CallListItemDto> = emptyList())

@Serializable
data class PushConfigDto(val public_key: String = "", val call_alerts: String = "ring", val subscriptions: Int = 0)

@Serializable
data class CallAlertsBody(val call_alerts: String)

suspend fun Api.liveCallsAll(): List<CallListItemDto> = get<LiveCallsDto>("/api/calls?live=1").calls
suspend fun Api.pushConfig(): PushConfigDto = get("/api/push/config")
suspend fun Api.setCallAlerts(mode: String): CallAlertsBody = put("/api/profile/call-alerts", CallAlertsBody(mode))

fun CallListItemDto.toLive() = CallAlerts.LiveCall(id, relationship_id, created_by, status, created_at, other_user_name, present_user_ids)

/**
 * "Someone is calling" for the Lab app (web: components/calls/CallAlerts.tsx + useLiveCalls).
 *
 * While the app is in front it polls `GET /api/calls?live=1` every 20 s (the web's rate) and rings
 * (the phone's ringtone + vibration, 30 s at most) for a new incoming call, unless the account is set
 * to silent or a full-screen page is open. The shell shows the banner from [live].
 *
 * In the background there is no true push yet (the Lab app has no Firebase / FCM project):
 * [CallWatchWorker] checks every minute or so for two hours after the app goes to the background
 * (WorkManager may stretch that in Doze), and the hourly shell check looks too — each posts a
 * high-priority "📹 <name> is calling" notification (tap → the call), replaced by "Missed video call"
 * if it ends first.
 */
class CallAlertsWatcher(private val app: LabApp) {
    private val sp = app.getSharedPreferences("call_alerts", Context.MODE_PRIVATE)
    private val _live = MutableStateFlow<List<CallAlerts.LiveCall>>(emptyList())
    val live: StateFlow<List<CallAlerts.LiveCall>> = _live.asStateFlow()
    private val _dismissed = MutableStateFlow<Set<String>>(emptySet())
    val dismissed: StateFlow<Set<String>> = _dismissed.asStateFlow()
    private val _silent = MutableStateFlow(sp.getBoolean(KEY_SILENT, false))
    val silent: StateFlow<Boolean> = _silent.asStateFlow()
    private val _myId = MutableStateFlow("")
    val myId: StateFlow<String> = _myId.asStateFlow()

    @Volatile var path: String = "/"
        set(value) {
            field = value
            decideRing()
        }

    private var loop: Job? = null
    private var configAt = 0L
    private val ringer = CallRinger(app)
    private var ringingFor: String? = null

    fun setForeground(on: Boolean) {
        if (on) {
            CallWatchWorker.cancel(app)
            if (loop?.isActive == true) return
            loop = app.scope.launch {
                while (isActive) {
                    refresh()
                    delay(CallAlerts.LIVE_CALL_POLL_MS)
                }
            }
        } else {
            loop?.cancel()
            loop = null
            stopRinging()
            if (app.prefs.sessionToken != null) CallWatchWorker.start(app)
        }
    }

    /** One poll; also refreshes the account's ring setting every 10 minutes. Never throws. */
    suspend fun refresh(): List<CallAlerts.LiveCall> {
        if (app.prefs.sessionToken == null || !app.online.value) {
            _live.value = emptyList()
            return emptyList()
        }
        ensureMyId()
        val calls = runCatching { app.repo.api.liveCallsAll().map { it.toLive() } }.getOrNull() ?: return _live.value
        _live.value = calls
        if (System.currentTimeMillis() - configAt > 10 * 60_000) {
            configAt = System.currentTimeMillis()
            runCatching { app.repo.api.pushConfig() }.getOrNull()?.let { rememberSilent(it.call_alerts == "silent") }
        }
        decideRing()
        return calls
    }

    private suspend fun ensureMyId() {
        if (_myId.value.isNotEmpty()) return
        _myId.value = Connections.myId(app.cache) ?: runCatching { app.repo.api.me().id }.getOrNull().orEmpty()
    }

    fun rememberSilent(silent: Boolean) {
        _silent.value = silent
        sp.edit().putBoolean(KEY_SILENT, silent).apply()
        if (silent) stopRinging()
    }

    suspend fun setSilent(silent: Boolean) {
        val prev = _silent.value
        rememberSilent(silent)
        runCatching { app.repo.api.setCallAlerts(if (silent) "silent" else "ring") }.onFailure { rememberSilent(prev); throw it }
    }

    fun dismiss(callId: String) {
        _dismissed.value = _dismissed.value + callId
        if (ringingFor == callId) stopRinging()
    }

    fun stopRinging() {
        ringer.stop()
        ringingFor = null
    }

    private fun rung(): Set<String> = sp.getStringSet(KEY_RUNG, emptySet()) ?: emptySet()
    private fun addRung(id: String) {
        sp.edit().putStringSet(KEY_RUNG, (rung().toList().takeLast(29) + id).toSet()).apply()
    }

    @Synchronized
    private fun decideRing() {
        val calls = _live.value
        val current = ringingFor
        val immersive = NavRules.isImmersiveRoute(path)
        // Stop when the call is over, or nobody is in it any more (the caller hung up / left).
        val stillCalling = current != null && calls.firstOrNull { it.id == current }?.let { CallAlerts.someoneElseInCall(it, _myId.value) != false } == true
        if (current != null && (!stillCalling || CallAlerts.callIdFromPath(path) == current || current in _dismissed.value || immersive)) stopRinging()
        if (immersive || loop == null) return
        val me = _myId.value.ifEmpty { return }
        val target = CallAlerts.callToRing(calls, me, System.currentTimeMillis(), rung(), _silent.value, path) ?: return
        if (target.id in _dismissed.value) return
        addRung(target.id)
        ringingFor = target.id
        ringer.start(CallAlerts.CALL_RING_DURATION_MS)
    }

    // ------------------------------------------------------------ background

    /** Background check: notify new incoming calls, turn ended ones into "missed". */
    suspend fun checkInBackground() {
        if (loop != null || app.prefs.sessionToken == null || _silent.value) return // in front: the banner + ring do it
        ensureMyId()
        val me = _myId.value.ifEmpty { return }
        val calls = runCatching { app.repo.api.liveCallsAll().map { it.toLive() } }.getOrNull() ?: return
        _live.value = calls
        val notified = sp.getStringSet(KEY_NOTIFIED, emptySet())?.toMutableSet() ?: mutableSetOf()
        CallAlerts.callToRing(calls, me, System.currentTimeMillis(), notified, false, "/")?.let { c ->
            CallAlertNotifier.ringing(app, c)
            notified += c.id
        }
        // A call we announced that's over now — ended, or nobody in it any more — never opened here:
        // say it was missed (it replaces the "is calling" notification).
        val liveIds = calls.filter { CallAlerts.someoneElseInCall(it, me) != false }.map { it.id }.toSet()
        for (id in notified.toList()) {
            if (id !in liveIds && id !in (sp.getStringSet(KEY_MISSED, emptySet()) ?: emptySet())) {
                if (CallAlertNotifier.isShowing(app, id)) CallAlertNotifier.missed(app, id, sp.getString("$KEY_NAME$id", null))
                sp.edit().putStringSet(KEY_MISSED, ((sp.getStringSet(KEY_MISSED, emptySet()) ?: emptySet()).toList().takeLast(29) + id).toSet()).apply()
            }
        }
        calls.forEach { c -> c.otherUserName?.let { sp.edit().putString("$KEY_NAME${c.id}", it).apply() } }
        sp.edit().putStringSet(KEY_NOTIFIED, notified.toList().takeLast(30).toSet()).apply()
    }

    companion object {
        private const val KEY_SILENT = "call_alerts_silent"
        private const val KEY_RUNG = "calls_rung"
        private const val KEY_NOTIFIED = "calls_notified"
        private const val KEY_MISSED = "calls_missed"
        private const val KEY_NAME = "call_name_"
    }
}

/** The phone's ringtone + a vibration pattern, stopped by [stop] or after [durationMs]. */
class CallRinger(private val context: Context) {
    private var ringtone: Ringtone? = null
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    fun start(durationMs: Long) {
        handler.post {
            stopNow()
            runCatching {
                val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                ringtone = RingtoneManager.getRingtone(context, uri)?.apply {
                    audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
                    play()
                }
            }
            runCatching { vibrator()?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 200, 400, 1200), 0)) }
            handler.postDelayed({ stopNow() }, durationMs)
        }
    }

    fun stop() = handler.post { stopNow() }.let { }

    private fun stopNow() {
        handler.removeCallbacksAndMessages(null)
        runCatching { ringtone?.stop() }
        ringtone = null
        runCatching { vibrator()?.cancel() }
    }

    private fun vibrator(): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        else @Suppress("DEPRECATION") context.getSystemService(Vibrator::class.java)
}

/** The call notifications (their own channel, so Android can give it the ringing importance). */
object CallAlertNotifier {
    const val CHANNEL = "lab_call_alerts"

    private fun notificationId(callId: String) = 3200 + (callId.hashCode() and 0x3ff)

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Incoming video calls", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "When your tutor or student starts a video call"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 400, 200, 400, 1200, 400, 200, 400)
            },
        )
    }

    private fun canPost(ctx: Context): Boolean =
        NotificationManagerCompat.from(ctx).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    fun isShowing(ctx: Context, callId: String): Boolean =
        ctx.getSystemService(NotificationManager::class.java)?.activeNotifications?.any { it.id == notificationId(callId) } == true

    fun ringing(ctx: Context, call: CallAlerts.LiveCall) {
        if (!canPost(ctx)) return
        ensureChannel(ctx)
        val who = call.otherUserName?.trim()?.takeIf { it.isNotEmpty() } ?: "Your partner"
        val open = ShellLinks.pending(ctx, notificationId(call.id), "/calls/${call.id}")
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_lab)
            .setContentTitle("📹 $who is calling")
            .setContentText("Tap to join the video lesson")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .addAction(0, "Join", open)
            .setAutoCancel(true)
            .setTimeoutAfter(10 * 60_000)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(notificationId(call.id), n) }
    }

    fun missed(ctx: Context, callId: String, name: String?) {
        if (!canPost(ctx)) return
        ensureChannel(ctx)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_lab)
            .setContentTitle("Missed video call from ${name?.trim()?.takeIf { it.isNotEmpty() } ?: "your partner"}")
            .setContentText("Tap to see your calls")
            .setContentIntent(ShellLinks.pending(ctx, notificationId(callId), "/calls"))
            .setSilent(true)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(notificationId(callId), n) }
    }

    fun cancel(ctx: Context, callId: String) = NotificationManagerCompat.from(ctx).cancel(notificationId(callId))
}

/** Checks for calls about once a minute for two hours after the app goes to the background. */
class CallWatchWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? LabApp ?: return Result.success()
        val until = inputData.getLong(KEY_UNTIL, 0)
        runCatching { app.callAlerts.checkInBackground() }
        if (System.currentTimeMillis() < until) enqueue(app, until, 60, ExistingWorkPolicy.APPEND_OR_REPLACE)
        return Result.success()
    }

    companion object {
        private const val NAME = "call-watch"
        private const val KEY_UNTIL = "until"
        private const val WINDOW_MS = 2 * 60 * 60_000L

        fun start(context: Context) = enqueue(context, System.currentTimeMillis() + WINDOW_MS, 30)

        private fun enqueue(context: Context, until: Long, delaySec: Long, policy: ExistingWorkPolicy = ExistingWorkPolicy.REPLACE) {
            val req = OneTimeWorkRequestBuilder<CallWatchWorker>()
                .setInitialDelay(delaySec, TimeUnit.SECONDS)
                .setInputData(workDataOf(KEY_UNTIL to until))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, policy, req)
        }

        fun cancel(context: Context) = WorkManager.getInstance(context).cancelUniqueWork(NAME)
    }
}
