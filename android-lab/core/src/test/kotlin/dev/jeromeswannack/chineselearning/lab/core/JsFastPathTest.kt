package dev.jeromeswannack.chineselearning.lab.core

import org.junit.Test
import kotlin.random.Random
import kotlin.test.assertEquals

/**
 * The fast paths of [Js.toFixed8] and [Js.numberToString] (hot in the FSRS replay) must give
 * exactly what the straightforward BigDecimal versions give, bit for bit. ParityTest already
 * compares both with the JavaScript; this sweeps far more values, aimed at the edges.
 */
class JsFastPathTest {
    private val rnd = Random(20260927)

    private fun sameToFixed8(x: Double) {
        val fast = Js.toFixed8(x)
        val exact = Js.toFixed8Exact(x)
        assertEquals(exact.toRawBits(), fast.toRawBits(), "toFixed8($x): fast=$fast exact=$exact")
    }

    private fun sameString(x: Double) =
        assertEquals(Js.numberToStringReference(x), Js.numberToString(x), "numberToString(${x.toRawBits()})")

    @Test
    fun toFixed8MatchesTheExactPath() {
        val specials = doubleArrayOf(0.0, -0.0, 1e-9, -1e-9, 4.9e-9, 5e-9, 5.000000001e-9, -5e-9, 0.5, 1.0, 9_999_999.999999995, 1e7, 1e7 + 0.5, 3e8, 123456.123456785)
        specials.forEach(::sameToFixed8)
        repeat(300_000) {
            // FSRS-sized values (difficulty 1–10, stability up to 36500, retrievability 0–1, …)
            sameToFixed8(rnd.nextDouble() * listOf(1.0, 10.0, 100.0, 36500.0, 1e6, 2e7)[it % 6] * if (it % 7 == 0) -1 else 1)
        }
        repeat(200_000) {
            // On and around the .5 boundaries: k/1e8 + 0.5e-8 and its neighbours.
            val k = rnd.nextLong(0, 1_000_000_000_000L)
            val mid = (k + 0.5) / 1e8
            var x = mid
            repeat(3) { x = Math.nextDown(x) }
            repeat(7) { sameToFixed8(x); sameToFixed8(-x); x = Math.nextUp(x) }
        }
        repeat(100_000) { sameToFixed8(Double.fromBits(rnd.nextLong()).let { if (it.isFinite()) it else 1.0 }) }
    }

    @Test
    fun numberToStringMatchesTheLinearScan() {
        val specials = doubleArrayOf(
            0.0, 1.0, 0.1, 0.2 + 0.1, 1e21, 1e-7, 123e-20, 5e-324, Double.MAX_VALUE, Double.MIN_VALUE,
            java.lang.Double.MIN_NORMAL, 2.0, 1024.0, 0.5, 0.25, 9007199254740992.0, 9.5, 9.95, 99.5, 999999999999999.9,
        )
        specials.forEach { sameString(it); sameString(-it) }
        for (e in -1074..1023) sameString(Math.scalb(1.0, e)) // every power of two
        repeat(200_000) {
            // The fuzz seed's difficulty × stability products.
            val d = Js.toFixed8(1 + rnd.nextDouble() * 9)
            val s = Js.toFixed8(rnd.nextDouble() * listOf(1.0, 30.0, 400.0, 36500.0)[it % 4])
            sameString(d * s)
        }
        repeat(200_000) { sameString(Double.fromBits(rnd.nextLong() and Long.MAX_VALUE).let { if (it.isFinite()) it else 3.0 }) }
        repeat(50_000) { sameString(rnd.nextInt(1, 1_000_000) / listOf(10.0, 100.0, 1000.0, 1e8)[it % 4]) }
    }
}
