package dev.jeromeswannack.chineselearning.lab.core

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * The bits of JavaScript number / date semantics the scheduler depends on,
 * reproduced exactly so the Kotlin port computes bit-for-bit what ts-fsrs
 * computes in the web app (see android-lab/parity).
 *
 * Math functions go through [StrictMath] (fdlibm), which is what V8 uses for
 * Math.pow / exp / log.
 */
object Js {
    /**
     * `+x.toFixed(8)`: round the EXACT binary value of |x| to 8 decimals, ties away from zero.
     *
     * Fast path (the FSRS replay calls this several times per review): n = the rounded
     * count of 1e-8 steps, taken from the floating product x·1e8 whenever that product is
     * clearly away from a .5 boundary (its rounding error is below one ulp, so it cannot
     * cross one), and the result is n / 1e8 — one correctly rounded IEEE division of two
     * exact values, which is exactly the double nearest the decimal. Anything near a
     * boundary (or large) takes the exact BigDecimal path. [toFixed8Exact] is the reference;
     * JsCompatTest holds the two equal.
     */
    fun toFixed8(x: Double): Double {
        val a = Math.abs(x)
        if (a < 1e7) { // a·1e8 < 2^53: n and the product are exact-integer representable
            val y = a * 1e8
            val f = Math.floor(y)
            val d = y - f // exact (Sterbenz)
            val margin = 4 * Math.ulp(y)
            val n = when {
                d < 0.5 - margin -> f
                d > 0.5 + margin -> f + 1
                else -> Double.NaN
            }
            if (!n.isNaN()) {
                if (n == 0.0) return 0.0 // BigDecimal has no -0: the exact path gives +0 too
                val r = n / 1e8
                return if (x < 0) -r else r
            }
        }
        return toFixed8Exact(x)
    }

    internal fun toFixed8Exact(x: Double): Double = toFixedDecimal(x, 8).toDouble()

    /** `x.toFixed(digits)` as a string (no exponent form; |x| < 1e21 assumed). */
    fun toFixed(x: Double, digits: Int): String {
        val s = toFixedDecimal(x, digits).abs().toPlainString()
        return if (x < 0) "-$s" else s
    }

    private fun toFixedDecimal(x: Double, digits: Int): BigDecimal {
        require(x.isFinite()) { "toFixed of non-finite $x" }
        val exact = BigDecimal(x)
        // The spec rounds |x| and picks the larger n on a tie: half away from zero.
        return exact.setScale(digits, RoundingMode.HALF_UP)
    }

    /** `Math.round`: nearest integer, ties toward +infinity (java.lang.Math.round has the same rule). */
    fun round(x: Double): Double =
        if (!x.isFinite() || Math.abs(x) >= 4.503599627370496E15) x else Math.round(x).toDouble()

    fun roundToLong(x: Double): Long = round(x).toLong()

    /** ToUint32 of a finite, non-negative double (the `x >>> 0` in Alea's Mash). */
    fun toUint32(x: Double): Double {
        val t = Math.floor(x)
        val m = t % 4294967296.0
        return if (m < 0) m + 4294967296.0 else m
    }

    /** ToInt32 of a finite double (the `x | 0` in Alea). */
    fun toInt32(x: Double): Double {
        val t = if (x < 0) Math.ceil(x) else Math.floor(x)
        var m = t % 4294967296.0
        if (m < 0) m += 4294967296.0
        return if (m >= 2147483648.0) m - 4294967296.0 else m
    }

    /** `String(x)` for a finite double (Number::toString, ECMA-262 §6.1.6.1.20). */
    fun numberToString(x: Double): String {
        if (x.isNaN()) return "NaN"
        if (x == 0.0) return "0"
        if (x.isInfinite()) return if (x > 0) "Infinity" else "-Infinity"
        if (x < 0) return "-" + numberToString(-x)
        return formatShortest(x, shortestDigits(x))
    }

    /** The reference: try every precision from 1 up. [numberToString] must equal this. */
    internal fun numberToStringReference(x: Double): String {
        if (x.isNaN()) return "NaN"
        if (x == 0.0) return "0"
        if (x.isInfinite()) return if (x > 0) "Infinity" else "-Infinity"
        if (x < 0) return "-" + numberToStringReference(-x)
        val exact = BigDecimal(x)
        var rounded: BigDecimal = exact
        for (p in 1..17) {
            val candidate = exact.round(MathContext(p, RoundingMode.HALF_EVEN))
            if (candidate.toDouble() == x) { rounded = candidate; break }
        }
        return formatShortest(x, rounded)
    }

    /**
     * Shortest digit string that round-trips (x > 0, finite); BigDecimal rounding is on the
     * exact value, which also gives the closest candidate when several have the same length.
     *
     * "p digits round-trip" is monotonic in p whenever x's rounding interval is symmetric —
     * any significand but an exact power of two: the correctly rounded (p+1)-digit value is
     * at least as close to x as the p-digit one (which is also a (p+1)-digit decimal), so it
     * lies inside the interval too. There a binary search over 1..17 finds the same smallest
     * p as the linear scan with ~5 BigDecimal roundings instead of up to 17 (this runs once
     * per fuzzed review in the FSRS replay). Powers of two keep the linear scan.
     */
    private fun shortestDigits(x: Double): BigDecimal {
        val exact = BigDecimal(x)
        fun at(p: Int) = exact.round(MathContext(p, RoundingMode.HALF_EVEN))
        val powerOfTwo = (java.lang.Double.doubleToRawLongBits(x) and 0x000F_FFFF_FFFF_FFFFL) == 0L
        if (powerOfTwo) {
            for (p in 1..17) at(p).let { if (it.toDouble() == x) return it }
            return exact
        }
        var lo = 1
        var hi = 17 // 17 significant digits always round-trip
        var best: BigDecimal? = null
        var bestP = 0
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            val c = at(mid)
            if (c.toDouble() == x) { hi = mid; best = c; bestP = mid } else lo = mid + 1
        }
        return if (best != null && bestP == lo) best else at(lo)
    }

    private fun formatShortest(x: Double, rounded: BigDecimal): String {
        val stripped = rounded.stripTrailingZeros()
        val digits = stripped.unscaledValue().toString()
        val k = digits.length
        val n = k - stripped.scale() // value = digits × 10^(n − k)
        return when {
            n in k..21 -> digits + "0".repeat(n - k)
            n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
            n in -5..0 -> "0." + "0".repeat(-n) + digits
            else -> {
                val e = n - 1
                val sign = if (e >= 0) "+" else "-"
                val mantissa = if (k == 1) digits else digits[0] + "." + digits.substring(1)
                "${mantissa}e$sign${Math.abs(e)}"
            }
        }
    }

    private val ISO_OUT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    private val SQL_IN: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss[.SSS]")

    /** `new Date(ms).toISOString()`. */
    fun toIsoString(epochMs: Long): String = ISO_OUT.format(Instant.ofEpochMilli(epochMs))

    /**
     * `Date.parse` for the timestamp shapes this app stores: ISO 8601 with Z or an offset
     * (what every client writes for reviewed_at), a date-only ISO string, and SQLite's
     * `YYYY-MM-DD HH:MM:SS` (read as UTC — the server writes UTC; V8 would read it as local
     * time, but no review event carries that shape).
     */
    fun parseDate(s: String): Long {
        try { return Instant.parse(s).toEpochMilli() } catch (_: DateTimeParseException) {}
        try { return OffsetDateTime.parse(s).toInstant().toEpochMilli() } catch (_: DateTimeParseException) {}
        try { return LocalDateTime.parse(s, SQL_IN).toInstant(ZoneOffset.UTC).toEpochMilli() } catch (_: DateTimeParseException) {}
        try { return LocalDateTime.parse(s).toInstant(ZoneOffset.UTC).toEpochMilli() } catch (_: DateTimeParseException) {}
        return java.time.LocalDate.parse(s).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
    }
}
