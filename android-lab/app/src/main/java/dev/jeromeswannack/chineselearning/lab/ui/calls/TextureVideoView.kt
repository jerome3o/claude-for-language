package dev.jeromeswannack.chineselearning.lab.ui.calls

import android.content.Context
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.Looper
import android.view.TextureView
import org.webrtc.EglBase
import org.webrtc.EglRenderer
import org.webrtc.GlRectDrawer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * A WebRTC video drawn into a TextureView (an EglRenderer on its SurfaceTexture). Unlike a
 * SurfaceViewRenderer it composes like any other view: tiles move, resize, float over the board and
 * overlap each other in any order without z-order tricks, and it isn't torn down when the layout
 * changes. `contain` shows the whole frame stretched to the view (FittedVideo sizes the view to the
 * picture's rectangle), otherwise the frame is cropped to fill the view.
 */
class TextureVideoView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener, VideoSink {
    private val renderer = EglRenderer("call-video")
    private val main = Handler(Looper.getMainLooper())
    private var initialised = false
    private var contain = false
    private var frameW = 0
    private var frameH = 0

    /** The frame's size (rotation applied), on the main thread, whenever it changes. */
    var onFrameSize: ((Int, Int) -> Unit)? = null

    init {
        surfaceTextureListener = this
        isOpaque = false
    }

    fun init(egl: EglBase.Context) {
        if (initialised) return
        renderer.init(egl, EglBase.CONFIG_PLAIN, GlRectDrawer())
        initialised = true
        surfaceTexture?.let { renderer.createEglSurface(it); updateAspect() }
    }

    fun setMirror(mirror: Boolean) = renderer.setMirror(mirror)

    fun setContain(contain: Boolean) {
        if (this.contain == contain) return
        this.contain = contain
        updateAspect()
    }

    private fun updateAspect() {
        renderer.setLayoutAspectRatio(if (contain || width == 0 || height == 0) 0f else width.toFloat() / height)
    }

    override fun onFrame(frame: VideoFrame) {
        val w = frame.rotatedWidth
        val h = frame.rotatedHeight
        if (w != frameW || h != frameH) {
            frameW = w
            frameH = h
            main.post { onFrameSize?.invoke(w, h) }
        }
        renderer.onFrame(frame)
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        if (initialised) renderer.createEglSurface(surface)
        updateAspect()
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = updateAspect()

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        val done = CountDownLatch(1)
        renderer.releaseEglSurface { done.countDown() }
        done.await(1, TimeUnit.SECONDS)
        return true
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit

    fun release() {
        onFrameSize = null
        if (initialised) renderer.release()
        initialised = false
    }
}
