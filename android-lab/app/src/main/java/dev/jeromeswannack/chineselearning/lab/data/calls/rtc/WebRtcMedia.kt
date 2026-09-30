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
import dev.jeromeswannack.chineselearning.lab.ui.calls.MediaProblem
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerListener
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerSession
import dev.jeromeswannack.chineselearning.lab.ui.calls.VideoHandle
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withTimeoutOrNull
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

    override val hasMic: Boolean get() = audioTrack != null
    override val hasCamera: Boolean get() = cameraTrack != null
    override val frontCamera: Boolean get() = front
    override val micAudio: VideoHandle? get() = audioTrack
    override val cameraVideo: VideoHandle? get() = cameraTrack
    override val screenVideo: VideoHandle? get() = screenTrack
    override val screenShareSupported: Boolean = true
    private var problemListener: (String) -> Unit = {}

    override fun onProblem(listener: (String) -> Unit) { problemListener = listener }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    /**
     * Opens what is allowed and not open yet: the mic when RECORD_AUDIO is granted, the camera when
     * CAMERA is. Nothing here fails the call — a missing device is reported (BLOCKED / IN_USE /
     * NO_DEVICE / FAILED) and the call goes on without it; calling again after a permission is
     * granted adds it.
     */
    override suspend fun open(): MediaOpen = withContext(Dispatchers.Default) {
        if (released) return@withContext MediaOpen(false, false, MediaProblem.FAILED, MediaProblem.FAILED)
        var micProblem: MediaProblem? = null
        if (audioTrack == null) {
            if (!granted(Manifest.permission.RECORD_AUDIO)) micProblem = MediaProblem.BLOCKED
            else runCatching {
                val constraints = MediaConstraints().apply {
                    mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
                    mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
                    mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
                }
                audioSource = factory.createAudioSource(constraints)
                audioTrack = factory.createAudioTrack("mic", audioSource)
            }.onFailure { micProblem = MediaProblem.FAILED; problemListener("microphone failed: ${it.message}") }
        }
        val camProblem = if (cameraTrack != null) null else if (!granted(Manifest.permission.CAMERA)) MediaProblem.BLOCKED else openCamera()
        MediaOpen(mic = audioTrack != null, camera = cameraTrack != null, micProblem = micProblem, cameraProblem = camProblem)
    }

    /** Opens the front camera and waits (≤ 3 s) for its first frame, so "in use by another app" is caught here. */
    private suspend fun openCamera(): MediaProblem? {
        val enumerator = Camera2Enumerator(context)
        val names = runCatching { enumerator.deviceNames.toList() }.getOrDefault(emptyList())
        val name = names.firstOrNull { enumerator.isFrontFacing(it) } ?: names.firstOrNull() ?: return MediaProblem.NO_DEVICE
        val started = CompletableDeferred<String?>()
        val events = object : CameraVideoCapturer.CameraEventsHandler {
            override fun onCameraError(error: String?) {
                if (!started.complete(error ?: "camera error")) problemListener("camera error: $error")
            }
            override fun onCameraDisconnected() {
                if (!started.complete("disconnected")) problemListener("camera disconnected (another app took it?)")
            }
            override fun onCameraFreezed(error: String?) { problemListener("camera froze: $error") }
            override fun onCameraOpening(cameraName: String?) = Unit
            override fun onFirstFrameAvailable() { started.complete(null) }
            override fun onCameraClosed() = Unit
        }
        val capturer = runCatching { enumerator.createCapturer(name, events) }.getOrNull() ?: return MediaProblem.FAILED
        front = enumerator.isFrontFacing(name)
        cameraHelper = SurfaceTextureHelper.create("call-camera", egl.eglBaseContext)
        cameraSource = factory.createVideoSource(false)
        capturer.initialize(cameraHelper, context, cameraSource!!.capturerObserver)
        camera = capturer
        cameraTrack = factory.createVideoTrack("camera", cameraSource)
        startCamera()
        val error = withTimeoutOrNull(3_000) { started.await() }
        if (error == null) return null // first frame (or slow: keep it — it may still start)
        problemListener("camera: $error")
        disposeCamera()
        return if (Regex("in use|in_use|max_cameras|busy|disabled", RegexOption.IGNORE_CASE).containsMatchIn(error)) MediaProblem.IN_USE else MediaProblem.FAILED
    }

    private fun disposeCamera() {
        stopCamera()
        runCatching { camera?.dispose() }
        runCatching { cameraTrack?.dispose() }
        runCatching { cameraSource?.dispose() }
        runCatching { cameraHelper?.dispose() }
        camera = null; cameraTrack = null; cameraSource = null; cameraHelper = null
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
        PeerLink(factory, iceServers, polite, audioTrack, cameraTrack, screenTrack, listener)

    override fun release() {
        if (released) return
        released = true
        mic.setConsumer(null)
        disposeScreen()
        disposeCamera()
        runCatching { audioTrack?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { factory.dispose() }
        runCatching { adm.release() }
        runCatching { egl.release() }
        audioTrack = null
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
