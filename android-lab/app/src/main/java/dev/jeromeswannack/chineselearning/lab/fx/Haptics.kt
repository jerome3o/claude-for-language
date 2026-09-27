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

    fun wrong() = compose(Triple(VibrationEffect.Composition.PRIMITIVE_THUD, 0.8f, 0), fallback = VibrationEffect.EFFECT_HEAVY_CLICK)

    fun rated(rating: Int) = when (rating) {
        0 -> compose(Triple(VibrationEffect.Composition.PRIMITIVE_QUICK_FALL, 0.7f, 0), fallback = VibrationEffect.EFFECT_HEAVY_CLICK)
        1 -> compose(Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.5f, 0), fallback = VibrationEffect.EFFECT_CLICK)
        else -> compose(Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.9f, 0), fallback = VibrationEffect.EFFECT_CLICK)
    }

    fun milestone() = compose(
        Triple(VibrationEffect.Composition.PRIMITIVE_SPIN, 0.8f, 0),
        Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f, 80),
        fallback = VibrationEffect.EFFECT_HEAVY_CLICK,
    )

    fun celebrate() = compose(
        Triple(VibrationEffect.Composition.PRIMITIVE_SLOW_RISE, 0.7f, 0),
        Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f, 40),
        Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.8f, 90),
        Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.6f, 90),
        fallback = VibrationEffect.EFFECT_HEAVY_CLICK,
    )
}
