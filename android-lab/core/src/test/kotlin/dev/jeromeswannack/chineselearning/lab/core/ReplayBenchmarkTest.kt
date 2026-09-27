package dev.jeromeswannack.chineselearning.lab.core

import org.junit.Assume.assumeTrue
import org.junit.Test
import kotlin.random.Random

/**
 * How long replaying a heavy account's review history takes (the recompute a full sync
 * does): ~6,500 reviewed cards, ~45k events. Opt-in:
 * `LAB_BENCH=1 ./gradlew :core:test --tests '*ReplayBenchmarkTest*' -i` and read the BENCH lines.
 */
class ReplayBenchmarkTest {
    @Test
    fun replayAHeavyAccount() {
        assumeTrue("set LAB_BENCH=1 to run the replay benchmark", System.getenv("LAB_BENCH") != null)
        val rnd = Random(42)
        val start = 1_768_867_200_000L // 2026-01-20
        val cards = (0 until 6_500).map { c ->
            var t = start + rnd.nextInt(200) * 86_400_000L
            (0 until 2 + rnd.nextInt(11)).map { q ->
                t += if (q < 2) 60_000L * (1 + rnd.nextInt(10)) else 86_400_000L * (1 + rnd.nextInt(20))
                val r = rnd.nextDouble()
                ReviewEventInput("e$c-$q", "c$c", if (r < 0.12) 0 else if (r < 0.25) 1 else if (r < 0.9) 2 else 3, Js.toIsoString(t))
            }
        }
        val events = cards.sumOf { it.size }
        repeat(5) { round ->
            val t0 = System.nanoTime()
            var sink = 0.0
            for (evs in cards) sink += CardScheduler.computeCardState(evs).stability
            val ms = (System.nanoTime() - t0) / 1_000_000
            println("BENCH replay round $round: ${cards.size} cards / $events events in $ms ms (${"%.1f".format(ms * 1000.0 / events)} µs/event) sink=$sink")
        }
        val xs = DoubleArray(200_000) { rnd.nextDouble() * 100 }
        repeat(3) {
            var t0 = System.nanoTime()
            var s = 0.0
            for (x in xs) s += Js.toFixed8(x)
            println("BENCH toFixed8: ${(System.nanoTime() - t0) / xs.size} ns/call ($s)")
            t0 = System.nanoTime()
            var n = 0
            for (x in xs) n += Js.numberToString(x * 7.3).length
            println("BENCH numberToString: ${(System.nanoTime() - t0) / xs.size} ns/call ($n)")
            t0 = System.nanoTime()
            for (x in xs) n += Js.parseDate(Js.toIsoString(start + (x * 1e9).toLong())).toInt()
            println("BENCH toIso+parseDate: ${(System.nanoTime() - t0) / xs.size} ns/call ($n)")
        }
    }
}
