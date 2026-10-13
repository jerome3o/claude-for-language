package dev.jeromeswannack.chineselearning.lab.testing

import android.os.Looper
import org.robolectric.Shadows.shadowOf

/**
 * Runs the main looper until [ready] gives a value, for up to [timeoutMs] of WALL time (default
 * 30 s), else fails with [describe]. For waits on real background work (a study session loading
 * its queue from Room: the first one in a JVM also loads the shipped word-frequency list), which
 * a fixed number of short polls (`repeat(300) { idle(); sleep(10) }` ≈ 3 s) didn't always cover
 * on a busy CI runner — "no card: phase=Loading" in RecordAgainAutoplayTest. A deadline instead
 * of an iteration count: a fast machine still returns at once.
 */
fun <T : Any> awaitOnMain(timeoutMs: Long = 30_000, describe: () -> String, ready: () -> T?): T {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000
    while (true) {
        shadowOf(Looper.getMainLooper()).idle()
        ready()?.let { return it }
        if (System.nanoTime() > deadline) error(describe())
        Thread.sleep(10)
    }
}
