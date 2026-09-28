package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Js

/**
 * Port of shared/calls/videoFit.ts — how a video call lays its video out. A feed is only
 * cropped to fill its box when the shapes nearly match; otherwise the whole picture is shown
 * over a letterbox (a phone's portrait camera in a wide window was cropped to a band across
 * the face). Parity-tested against the TypeScript (parity/fixtures/calls-video.ts →
 * CallsVideoParityTest).
 */
object VideoFit {
    data class Size(val width: Double, val height: Double)
    data class Rect(val x: Double, val y: Double, val width: Double, val height: Double)

    enum class Fit(val wire: String) { COVER("cover"), CONTAIN("contain") }

    /** Crop only when the video's and the box's aspect ratios are within this much of each other. */
    const val COVER_TOLERANCE = 0.15
    const val PIP_MIN = 88.0
    const val PIP_MAX = 260.0

    private fun valid(s: Size?): Boolean =
        s != null && s.width.isFinite() && s.height.isFinite() && s.width > 0 && s.height > 0

    /** Port of aspectMismatch: 1 = the same shape. */
    fun aspectMismatch(a: Size, b: Size): Double {
        val ra = a.width / a.height
        val rb = b.width / b.height
        return if (ra > rb) ra / rb else rb / ra
    }

    /** Port of chooseVideoFit: cover only when the shapes nearly match; a screen or an unknown size is shown whole. */
    fun choose(video: Size?, box: Size?, screen: Boolean = false, tolerance: Double = COVER_TOLERANCE): Fit {
        if (screen) return Fit.CONTAIN
        if (!valid(video) || !valid(box)) return Fit.CONTAIN
        return if (aspectMismatch(video!!, box!!) <= 1 + tolerance + 1e-9) Fit.COVER else Fit.CONTAIN
    }

    /** Port of containRect: where the picture sits inside the box when shown whole. */
    fun containRect(video: Size?, box: Size): Rect {
        if (!valid(video) || !valid(box)) return Rect(0.0, 0.0, maxOf(0.0, box.width), maxOf(0.0, box.height))
        val scale = minOf(box.width / video!!.width, box.height / video.height)
        val w = video.width * scale
        val h = video.height * scale
        return Rect((box.width - w) / 2, (box.height - h) / 2, w, h)
    }

    /** Port of coverRect: the picture overflows the box. */
    fun coverRect(video: Size?, box: Size): Rect {
        if (!valid(video) || !valid(box)) return Rect(0.0, 0.0, maxOf(0.0, box.width), maxOf(0.0, box.height))
        val scale = maxOf(box.width / video!!.width, box.height / video.height)
        val w = video.width * scale
        val h = video.height * scale
        return Rect((box.width - w) / 2, (box.height - h) / 2, w, h)
    }

    fun videoRect(video: Size?, box: Size, fit: Fit): Rect = if (fit == Fit.COVER) coverRect(video, box) else containRect(video, box)

    /** Port of pipSize: the self-view shaped like my camera, about a third of the stage's shorter side. */
    fun pipSize(video: Size?, stage: Size): Size {
        val short = maxOf(0.0, minOf(stage.width, stage.height))
        val aspect = if (valid(video)) video!!.width / video.height else if (stage.width >= stage.height) 4.0 / 3 else 3.0 / 4
        val longSide = minOf(PIP_MAX, maxOf(PIP_MIN, Js.round(short * 0.32)))
        if (aspect >= 1) {
            val w = minOf(longSide, maxOf(PIP_MIN, Js.round(stage.width * 0.45)))
            return Size(w, Js.round(w / aspect))
        }
        val h = minOf(longSide, maxOf(PIP_MIN, Js.round(stage.height * 0.45)))
        return Size(Js.round(h * aspect), h)
    }
}
