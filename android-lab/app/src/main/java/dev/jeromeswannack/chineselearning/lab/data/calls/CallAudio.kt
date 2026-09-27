package dev.jeromeswannack.chineselearning.lab.data.calls

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Where the call's sound goes. */
enum class AudioRoute(val label: String, val icon: String) {
    SPEAKER("Speaker", "🔊"),
    EARPIECE("Phone", "📱"),
    HEADSET("Headphones", "🎧"),
    BLUETOOTH("Bluetooth", "🎧"),
}

/**
 * Audio for a call: communication mode + audio focus while the call runs, and the route —
 * Bluetooth or a headset when one is connected, else the loudspeaker (it's a video call, the
 * phone is in front of you). The ⋯ menu switches between the [routes] that are available.
 */
class CallAudio(context: Context) {
    private val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focus: AudioFocusRequest? = null
    private var active = false
    private val _route = MutableStateFlow(AudioRoute.SPEAKER)
    val route: StateFlow<AudioRoute> = _route.asStateFlow()

    fun start() {
        if (active) return
        active = true
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .build().also { am.requestAudioFocus(it) }
        }
        val available = routes()
        select(listOf(AudioRoute.BLUETOOTH, AudioRoute.HEADSET, AudioRoute.SPEAKER).first { it in available })
    }

    /** The routes this phone offers right now. */
    fun routes(): List<AudioRoute> {
        val out = mutableListOf(AudioRoute.SPEAKER)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val types = am.availableCommunicationDevices.map { it.type }.toSet()
            if (AudioDeviceInfo.TYPE_BUILTIN_EARPIECE in types) out += AudioRoute.EARPIECE
            if (types.any { it == AudioDeviceInfo.TYPE_WIRED_HEADSET || it == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it == AudioDeviceInfo.TYPE_USB_HEADSET }) out += AudioRoute.HEADSET
            if (types.any { it == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it == AudioDeviceInfo.TYPE_BLE_HEADSET }) out += AudioRoute.BLUETOOTH
        } else {
            out += AudioRoute.EARPIECE
            val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }.toSet()
            if (outs.any { it == AudioDeviceInfo.TYPE_WIRED_HEADSET || it == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it == AudioDeviceInfo.TYPE_USB_HEADSET }) out += AudioRoute.HEADSET
            if (AudioDeviceInfo.TYPE_BLUETOOTH_SCO in outs) out += AudioRoute.BLUETOOTH
        }
        return out
    }

    @Suppress("DEPRECATION")
    fun select(route: AudioRoute) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val wanted = when (route) {
                AudioRoute.SPEAKER -> setOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
                AudioRoute.EARPIECE -> setOf(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
                AudioRoute.HEADSET -> setOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET)
                AudioRoute.BLUETOOTH -> setOf(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET)
            }
            am.availableCommunicationDevices.firstOrNull { it.type in wanted }?.let { am.setCommunicationDevice(it) }
        } else {
            if (route == AudioRoute.BLUETOOTH) { am.startBluetoothSco(); am.isBluetoothScoOn = true } else if (am.isBluetoothScoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco() }
            am.isSpeakerphoneOn = route == AudioRoute.SPEAKER
        }
        _route.value = route
    }

    @Suppress("DEPRECATION")
    fun stop() {
        if (!active) return
        active = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice()
        else { am.isSpeakerphoneOn = false; if (am.isBluetoothScoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco() } }
        focus?.let { am.abandonAudioFocusRequest(it) }
        focus = null
        am.mode = AudioManager.MODE_NORMAL
    }
}
