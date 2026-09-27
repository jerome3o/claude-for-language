package dev.jeromeswannack.chineselearning.lab.fx

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin

/**
 * Feedback sounds, synthesised on first launch (no audio assets to license):
 * bell-like partials with exponential decay, played through SoundPool so they
 * start in a few milliseconds. The "good" pop climbs a pentatonic scale as the
 * streak grows — the monkey-brain reward loop.
 */
class Sounds(context: Context, private val enabled: () -> Boolean) {
    enum class Sfx { CORRECT, WRONG, FLIP, POP, AGAIN, FANFARE, MILESTONE, TAP }

    private val pool = SoundPool.Builder()
        .setMaxStreams(6)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        .build()
    private val ids = HashMap<Sfx, Int>()

    init {
        val dir = File(context.cacheDir, "sfx-v1").apply { mkdirs() }
        for (sfx in Sfx.entries) {
            val file = File(dir, "${sfx.name.lowercase()}.wav")
            if (!file.exists()) writeWav(file, synth(sfx))
            ids[sfx] = pool.load(file.absolutePath, 1)
        }
    }

    fun play(sfx: Sfx, volume: Float = 0.8f, rate: Float = 1f) {
        if (!enabled()) return
        val id = ids[sfx] ?: return
        pool.play(id, volume, volume, 1, 0, rate.coerceIn(0.5f, 2f))
    }

    /** The rating pop, pitched up the major pentatonic with the streak. */
    fun streakPop(streak: Int) {
        val steps = intArrayOf(0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24)
        val semis = steps[(streak - 1).coerceIn(0, steps.size - 1)]
        play(Sfx.POP, 0.7f, 2.0.pow(semis / 12.0).toFloat().coerceAtMost(2f))
    }

    fun release() = pool.release()

    private companion object {
        const val RATE = 44100

        fun note(buf: FloatArray, startS: Double, freq: Double, durS: Double, gain: Double, decay: Double, partials: DoubleArray = doubleArrayOf(1.0, 2.76, 5.4), weights: DoubleArray = doubleArrayOf(1.0, 0.35, 0.12)) {
            val start = (startS * RATE).toInt()
            val n = (durS * RATE).toInt()
            for (i in 0 until n) {
                val idx = start + i
                if (idx >= buf.size) break
                val t = i.toDouble() / RATE
                val attack = (t / 0.004).coerceAtMost(1.0)
                val env = attack * exp(-t * decay)
                var s = 0.0
                for (p in partials.indices) s += weights[p] * sin(2 * PI * freq * partials[p] * t) * exp(-t * decay * p)
                buf[idx] += (gain * env * s).toFloat()
            }
        }

        fun hz(midi: Int) = 440.0 * 2.0.pow((midi - 69) / 12.0)

        fun synth(sfx: Sfx): FloatArray = when (sfx) {
            Sfx.CORRECT -> FloatArray((0.7 * RATE).toInt()).also {
                note(it, 0.0, hz(84), 0.6, 0.35, 7.0) // C6
                note(it, 0.075, hz(91), 0.6, 0.35, 6.0) // G6
            }
            Sfx.WRONG -> FloatArray((0.28 * RATE).toInt()).also { buf ->
                for (i in buf.indices) {
                    val t = i.toDouble() / RATE
                    val f = 150.0 - 60 * t / 0.28
                    buf[i] = (0.5 * exp(-t * 12) * sin(2 * PI * f * t) * (t / 0.005).coerceAtMost(1.0)).toFloat()
                }
            }
            Sfx.FLIP -> FloatArray((0.05 * RATE).toInt()).also { buf ->
                var seed = 12345L
                var lp = 0.0
                for (i in buf.indices) {
                    seed = seed * 6364136223846793005L + 1442695040888963407L
                    val noise = ((seed ushr 33).toDouble() / (1L shl 31)) - 1.0
                    lp += 0.25 * (noise - lp)
                    val t = i.toDouble() / RATE
                    buf[i] = (0.35 * lp * exp(-t * 90)).toFloat()
                }
            }
            Sfx.POP -> FloatArray((0.22 * RATE).toInt()).also {
                note(it, 0.0, hz(76), 0.22, 0.4, 16.0, doubleArrayOf(1.0, 2.0), doubleArrayOf(1.0, 0.2)) // E5
            }
            Sfx.AGAIN -> FloatArray((0.35 * RATE).toInt()).also {
                note(it, 0.0, hz(67), 0.3, 0.28, 10.0, doubleArrayOf(1.0, 2.0), doubleArrayOf(1.0, 0.15))
                note(it, 0.09, hz(62), 0.3, 0.28, 10.0, doubleArrayOf(1.0, 2.0), doubleArrayOf(1.0, 0.15))
            }
            Sfx.FANFARE -> FloatArray((1.9 * RATE).toInt()).also {
                val seq = intArrayOf(72, 76, 79, 84)
                seq.forEachIndexed { i, m -> note(it, i * 0.11, hz(m), 0.9, 0.22, 4.0) }
                for (m in intArrayOf(72, 76, 79, 84, 88)) note(it, 0.5, hz(m), 1.4, 0.13, 2.4)
            }
            Sfx.MILESTONE -> FloatArray((0.9 * RATE).toInt()).also {
                intArrayOf(84, 88, 91, 96).forEachIndexed { i, m -> note(it, i * 0.05, hz(m), 0.7, 0.2, 6.0) }
            }
            Sfx.TAP -> FloatArray((0.06 * RATE).toInt()).also {
                note(it, 0.0, hz(96), 0.06, 0.15, 60.0, doubleArrayOf(1.0), doubleArrayOf(1.0))
            }
        }

        fun writeWav(file: File, samples: FloatArray) {
            var peak = 0f
            for (s in samples) peak = maxOf(peak, kotlin.math.abs(s))
            val scale = if (peak > 0.95f) 0.95f / peak else 1f
            val data = ByteArray(samples.size * 2)
            for (i in samples.indices) {
                val v = (samples[i] * scale * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                data[2 * i] = (v and 0xff).toByte()
                data[2 * i + 1] = ((v shr 8) and 0xff).toByte()
            }
            RandomAccessFile(file, "rw").use { f ->
                f.setLength(0)
                fun int(v: Int) = f.write(byteArrayOf(v.toByte(), (v shr 8).toByte(), (v shr 16).toByte(), (v shr 24).toByte()))
                fun short(v: Int) = f.write(byteArrayOf(v.toByte(), (v shr 8).toByte()))
                f.writeBytes("RIFF"); int(36 + data.size); f.writeBytes("WAVE")
                f.writeBytes("fmt "); int(16); short(1); short(1); int(RATE); int(RATE * 2); short(2); short(16)
                f.writeBytes("data"); int(data.size); f.write(data)
            }
        }
    }
}
