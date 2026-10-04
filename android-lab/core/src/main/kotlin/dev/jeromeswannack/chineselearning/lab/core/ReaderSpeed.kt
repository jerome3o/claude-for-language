package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/reader/speed.ts — the reader's playback speed (1× · 0.75× · 0.5×), one chip
 * in the reader's audio controls, remembered per device. Applied at PLAYBACK only (the app's
 * MediaPlayer gets `PlaybackParams.setSpeed(x).setPitch(1f)` — Sonic time-stretching, pitch
 * kept); the clip is never regenerated. Parity-tested (parity/fixtures/reader-speed.ts).
 */
object ReaderSpeed {
    /** Port of READER_SPEEDS: the chip's order. */
    val SPEEDS: List<Double> = listOf(1.0, 0.75, 0.5)

    /** Port of DEFAULT_READER_SPEED. */
    const val DEFAULT = 1.0

    /** Port of READER_SPEED_STORAGE_KEY (the prefs key on the phone). */
    const val STORAGE_KEY = "reader-playback-speed"

    // JS Number(string) for the decimal forms; anything else can't be a speed we offer.
    private val NUMBER = Regex("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$")

    /** Port of parseReaderSpeed: exactly one of [SPEEDS], else the default. */
    fun parse(raw: Any?): Double {
        val n: Double = when (raw) {
            is Number -> raw.toDouble()
            is String -> raw.trim().let { s -> if (s.isNotEmpty() && NUMBER.matches(s)) s.toDouble() else Double.NaN }
            else -> Double.NaN
        }
        return if (n in SPEEDS) n else DEFAULT
    }

    /** Port of nextReaderSpeed: 1× → 0.75× → 0.5× → 1×. */
    fun next(speed: Double): Double = SPEEDS[(SPEEDS.indexOf(parse(speed)) + 1) % SPEEDS.size]

    /** Port of readerSpeedLabel: "1×", "0.75×", "0.5×". */
    fun label(speed: Double): String = Js.numberToString(parse(speed)) + "×"

    /**
     * Port of blockGraceMsAt: the scrubber's 1 s grace in MEDIA time at this speed. The grace
     * is a wall-clock reaction (he hears the next phrase start and taps stop), so at 0.5× it
     * covers 500 ms of the clip; block advance stays pure media time.
     */
    fun blockGraceMsAt(speed: Double): Double = Js.round(BlockPlayback.GRACE_MS * parse(speed))
}
