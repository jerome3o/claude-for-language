package dev.jeromeswannack.chineselearning.lab.data.feedback

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioManager
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.feedback.Shake

/**
 * "Shake the phone to send feedback" (docs/FEEDBACK.md): the accelerometer while the app is in front
 * (MainActivity onResume / onPause), fed into core [Shake] — the same rule as the web. A shake opens
 * [FeedbackCenter] unless the sheet is already up, the microphone is recording (a take, dictation, a
 * voice message — any of the app's own recordings) or a call is on (the audio mode, or the call screen).
 */
class ShakeWatcher(private val app: LabApp, private val onShake: () -> Unit) : SensorEventListener {
    private val sensors = app.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val audio = app.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    private val prefs = FeedbackPrefs(app)
    private var state = Shake.State()
    private var listening = false

    fun start() {
        if (listening) return
        val accel = sensors?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        listening = sensors.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
        state = Shake.State()
    }

    fun stop() {
        if (!listening) return
        sensors?.unregisterListener(this)
        listening = false
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER || event.values.size < 3) return
        val out = Shake.step(state, event.timestamp / 1_000_000.0, event.values[0].toDouble(), event.values[1].toDouble(), event.values[2].toDouble())
        state = out.state
        if (out.shake && allowed()) onShake()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun allowed(): Boolean {
        if (FeedbackCenter.isOpen || !prefs.shakeOn) return false
        if (app.analytics.currentScreen?.startsWith("/calls/") == true || app.analytics.currentScreen?.startsWith("/group-class") == true) return false
        val a = audio ?: return true
        if (a.mode == AudioManager.MODE_IN_COMMUNICATION || a.mode == AudioManager.MODE_IN_CALL) return false
        return runCatching { a.activeRecordingConfigurations.isEmpty() }.getOrDefault(true)
    }
}
