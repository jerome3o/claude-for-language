package dev.jeromeswannack.chineselearning.lab.fx

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Rich haptics: composed primitives (click, tick, thud, spin, rise) on devices
 * with a capable actuator (Pixels), predefined effects otherwise. This is the
 * part a WebView can't do — navigator.vibrate only buzzes.
 */
class Haptics(context: Context, private val enabled: () -> Boolean) {
    private val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

    private fun supports(vararg primitives: Int): Boolean =
        Build.VERSION.SDK_INT >= 30 && vibrator?.areAllPrimitivesSupported(*primitives) == true

    private fun compose(vararg parts: Triple<Int, Float, Int>, fallback: Int) {
        if (!enabled()) return
        val v = vibrator ?: return
        if (Build.VERSION.SDK_INT >= 30 && supports(*parts.map { it.first }.toIntArray())) {
            val c = VibrationEffect.startComposition()
            for ((p, scale, delay) in parts) c.addPrimitive(p, scale, delay)
            v.vibrate(c.compose())
        } else if (Build.VERSION.SDK_INT >= 29) {
            v.vibrate(VibrationEffect.createPredefined(fallback))
        } else {
            v.vibrate(VibrationEffect.createOneShot(20, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    fun tick() = compose(Triple(VibrationEffect.Composition.PRIMITIVE_TICK, 0.6f, 0), fallback = VibrationEffect.EFFECT_TICK)

    fun flip() = compose(Triple(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 0.9f, 0), Triple(VibrationEffect.Composition.PRIMITIVE_TICK, 0.5f, 60), fallback = VibrationEffect.EFFECT_TICK)

    fun correct() = compose(
        Triple(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, 0.6f, 0),
        Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f, 30),
        fallback = VibrationEffect.EFFECT_DOUBLE_CLICK,
    )

    /**
     * A right answer you can FEEL — Hard mode's check of the question, a sentence said right (Jerome: "when I
     * get it right on the very first page there's no satisfying haptics … I find myself quite dependent on
     * it"). Before this that moment had NO haptic at all (only the spark burst; the flip's soft LOW_TICK came
     * later, at the answer side). A firm click, a rise and a second firm click on a capable actuator; else a
     * strong two-pulse waveform (`HardMode.FEEL_VIBRATION`, full amplitude where the motor has control),
     * else the predefined double click. [scale] lightens it (a sentence row / round exercise: 0.85).
     */
    fun success(scale: Float = 1f) {
        if (!enabled()) return
        val v = vibrator ?: return
        val s = scale.coerceIn(0.3f, 1f)
        val parts = intArrayOf(VibrationEffect.Composition.PRIMITIVE_CLICK, VibrationEffect.Composition.PRIMITIVE_QUICK_RISE)
        if (Build.VERSION.SDK_INT >= 30 && supports(*parts)) {
            v.vibrate(
                VibrationEffect.startComposition()
                    .addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f * s, 0)
                    .addPrimitive(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, 0.85f * s, 40)
                    .addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f * s, 30)
                    .compose(),
            )
            return
        }
        val pattern = dev.jeromeswannack.chineselearning.lab.core.HardMode.FEEL_VIBRATION.getValue(dev.jeromeswannack.chineselearning.lab.core.HardMode.FEEL_SUCCESS)
        val timings = longArrayOf(0L) + pattern.toLongArray()
        if (v.hasAmplitudeControl()) {
            val amp = (255 * s).toInt().coerceIn(1, 255)
            val amps = IntArray(timings.size) { i -> if (i % 2 == 1) amp else 0 }
            v.vibrate(VibrationEffect.createWaveform(timings, amps, -1))
        } else {
            v.vibrate(VibrationEffect.createWaveform(timings, -1))
        }
    }

    fun wrong() = compose(Triple(VibrationEffect.Composition.PRIMITIVE_THUD, 0.8f, 0), fallback = VibrationEffect.EFFECT_HEAVY_CLICK)

    /** The same firm tap for every rating: an honest Again feels no worse than an Easy. */
    @Suppress("UNUSED_PARAMETER")
    fun rated(rating: Int) = compose(Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.7f, 0), fallback = VibrationEffect.EFFECT_CLICK)

    fun celebrate() = compose(
        Triple(VibrationEffect.Composition.PRIMITIVE_SLOW_RISE, 0.7f, 0),
        Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f, 40),
        Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.8f, 90),
        Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.6f, 90),
        fallback = VibrationEffect.EFFECT_HEAVY_CLICK,
    )
}
