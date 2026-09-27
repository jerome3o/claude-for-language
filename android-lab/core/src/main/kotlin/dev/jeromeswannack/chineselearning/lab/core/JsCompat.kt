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
    /** `+x.toFixed(8)`: round the EXACT binary value of |x| to 8 decimals, ties away from zero. */
    fun toFixed8(x: Double): Double = toFixedDecimal(x, 8).toDouble()

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
        val exact = BigDecimal(x)
        // Shortest digit string that round-trips; BigDecimal rounding is on the exact value,
        // which also gives the closest candidate when several have the same length.
        var rounded: BigDecimal = exact
        for (p in 1..17) {
            val candidate = exact.round(MathContext(p, RoundingMode.HALF_EVEN))
            if (candidate.toDouble() == x) { rounded = candidate; break }
        }
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
