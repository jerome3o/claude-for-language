package dev.jeromeswannack.chineselearning.lab.data.calls.rtc

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjection
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.content.ContextCompat
import dev.jeromeswannack.chineselearning.lab.data.api.IceServerDto
import dev.jeromeswannack.chineselearning.lab.ui.calls.CallMedia
import dev.jeromeswannack.chineselearning.lab.ui.calls.MediaOpen
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerListener
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerSession
import dev.jeromeswannack.chineselearning.lab.ui.calls.VideoHandle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnectionFactory
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import kotlin.coroutines.resume

/**
 * Camera, microphone and screen for a call, on Google's WebRTC (web: getUserMedia /
 * getDisplayMedia in hooks/useCall.ts). One instance per call; [release] frees everything.
 * Video is 640×480 @ 24 fps like the web's constraints; the screen at up to 1280 px @ 15 fps.
 */
class WebRtcMedia(private val context: Context, val mic: MicTap = MicTap()) : CallMedia {
    val egl: EglBase = EglBase.create()

    private val adm = JavaAudioDeviceModule.builder(context)
        .setUseHardwareAcousticEchoCanceler(true)
        .setUseHardwareNoiseSuppressor(true)
        .setSamplesReadyCallback { mic.fromWebRtc(it) }
        .createAudioDeviceModule()

    private val factory: PeerConnectionFactory = run {
        initOnce(context)
        PeerConnectionFactory.builder()
            .setAudioDeviceModule(adm)
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
    }

    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var camera: CameraVideoCapturer? = null
    private var cameraHelper: SurfaceTextureHelper? = null
    private var cameraSource: VideoSource? = null
    private var cameraTrack: VideoTrack? = null
    private var cameraRunning = false
    private var screen: ScreenCapturerAndroid? = null
    private var screenHelper: SurfaceTextureHelper? = null
    private var screenSource: VideoSource? = null
    private var screenTrack: VideoTrack? = null
    private var front = true
    private var released = false

    override val hasCamera: Boolean get() = cameraTrack != null
    override val frontCamera: Boolean get() = front
    override val cameraVideo: VideoHandle? get() = cameraTrack
    override val screenVideo: VideoHandle? get() = screenTrack
    override val screenShareSupported: Boolean = true

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    override suspend fun open(): MediaOpen = withContext(Dispatchers.Default) {
        if (audioTrack != null) return@withContext if (cameraTrack != null) MediaOpen.Ok else MediaOpen.AudioOnly("No camera — joining with audio only.")
        if (!granted(Manifest.permission.RECORD_AUDIO)) {
            return@withContext MediaOpen.Failed("The microphone is blocked. Allow it in Settings → Apps → 学 Lab → Permissions, then come back.")
        }
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
        }
        audioSource = factory.createAudioSource(constraints)
        audioTrack = factory.createAudioTrack("mic", audioSource)
        if (!granted(Manifest.permission.CAMERA)) return@withContext MediaOpen.AudioOnly("No camera access — joining with audio only.")
        val enumerator = Camera2Enumerator(context)
        val names = enumerator.deviceNames
        val name = names.firstOrNull { enumerator.isFrontFacing(it) } ?: names.firstOrNull()
            ?: return@withContext MediaOpen.AudioOnly("No camera — joining with audio only.")
        front = enumerator.isFrontFacing(name)
        val capturer = enumerator.createCapturer(name, null)
            ?: return@withContext MediaOpen.AudioOnly("No camera — joining with audio only.")
        cameraHelper = SurfaceTextureHelper.create("call-camera", egl.eglBaseContext)
        cameraSource = factory.createVideoSource(false)
        capturer.initialize(cameraHelper, context, cameraSource!!.capturerObserver)
        camera = capturer
        cameraTrack = factory.createVideoTrack("camera", cameraSource)
        startCamera()
        MediaOpen.Ok
    }

    private fun startCamera() {
        if (cameraRunning) return
        runCatching { camera?.startCapture(640, 480, 24); cameraRunning = camera != null }
    }

    private fun stopCamera() {
        if (!cameraRunning) return
        runCatching { camera?.stopCapture() }
        cameraRunning = false
    }

    override fun setMicEnabled(on: Boolean) {
        audioTrack?.setEnabled(on)
    }

    /** Off also stops the capture, so the camera (and its green dot) really is off. */
    override fun setCameraEnabled(on: Boolean) {
        cameraTrack?.setEnabled(on)
        if (on) startCamera() else stopCamera()
    }

    override suspend fun flipCamera(): Boolean {
        val c = camera ?: return false
        return suspendCancellableCoroutine { cont ->
            c.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
                override fun onCameraSwitchDone(isFrontCamera: Boolean) { front = isFrontCamera; if (cont.isActive) cont.resume(true) }
                override fun onCameraSwitchError(error: String?) { if (cont.isActive) cont.resume(false) }
            })
        }
    }

    override fun startScreenShare(permission: Any, onStopped: () -> Unit): VideoHandle? {
        val data = permission as? Intent ?: return null
        return runCatching {
            val capturer = ScreenCapturerAndroid(data, object : MediaProjection.Callback() {
                override fun onStop() = onStopped()
            })
            screenHelper = SurfaceTextureHelper.create("call-screen", egl.eglBaseContext)
            screenSource = factory.createVideoSource(true)
            capturer.initialize(screenHelper, context, screenSource!!.capturerObserver)
            val (w, h) = screenSize()
            capturer.startCapture(w, h, 15)
            screen = capturer
            factory.createVideoTrack("screen", screenSource).also { screenTrack = it }
        }.onFailure { disposeScreen() }.getOrNull()
    }

    private fun screenSize(): Pair<Int, Int> {
        val dm = DisplayMetrics()
        @Suppress("DEPRECATION")
        (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(dm)
        val scale = minOf(1.0, 1280.0 / maxOf(dm.widthPixels, dm.heightPixels))
        return (dm.widthPixels * scale).toInt() / 2 * 2 to (dm.heightPixels * scale).toInt() / 2 * 2
    }

    override fun stopScreenShare() = disposeScreen()

    private fun disposeScreen() {
        runCatching { screen?.stopCapture() }
        runCatching { screen?.dispose() }
        runCatching { screenTrack?.dispose() }
        runCatching { screenSource?.dispose() }
        runCatching { screenHelper?.dispose() }
        screen = null; screenTrack = null; screenSource = null; screenHelper = null
    }

    override fun createPeer(iceServers: List<IceServerDto>, polite: Boolean, listener: PeerListener): PeerSession =
        PeerLink(factory, iceServers, polite, audioTrack, screenTrack ?: cameraTrack, listener)

    override fun release() {
        if (released) return
        released = true
        mic.setConsumer(null)
        disposeScreen()
        stopCamera()
        runCatching { camera?.dispose() }
        runCatching { cameraTrack?.dispose() }
        runCatching { cameraSource?.dispose() }
        runCatching { cameraHelper?.dispose() }
        runCatching { audioTrack?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { factory.dispose() }
        runCatching { adm.release() }
        runCatching { egl.release() }
        camera = null; cameraTrack = null; audioTrack = null
    }

    companion object {
        @Volatile private var initialized = false

        @Synchronized
        private fun initOnce(context: Context) {
            if (initialized) return
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context.applicationContext).createInitializationOptions())
            initialized = true
        }
    }
}
