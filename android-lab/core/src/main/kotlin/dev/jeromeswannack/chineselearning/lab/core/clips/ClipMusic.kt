package dev.jeromeswannack.chineselearning.lab.core.clips

import kotlin.math.max
import kotlin.math.min

/**
 * Port of shared/clips/music.ts — 🎬 the lo-fi beat under a clip (docs/CLIPS.md "Music"): three
 * procedural loops (res/raw/clip_beat_*.mp3, CC0), one per theme, ducked under every voice line,
 * on by default, silenced by 🔇. Parity-tested (parity/fixtures/clips.ts → ClipsParityTest).
 */
object ClipMusic {
    data class Track(val id: String, val path: String, val raw: String, val bpm: Int, val name: String)

    val TRACKS = listOf(
        Track("clip-beat-cafe-v1", "/audio/clip-beat-cafe-v1.mp3", "clip_beat_cafe", 88, "Café"),
        Track("clip-beat-nightbus-v1", "/audio/clip-beat-nightbus-v1.mp3", "clip_beat_nightbus", 92, "Night bus"),
        Track("clip-beat-rain-v1", "/audio/clip-beat-rain-v1.mp3", "clip_beat_rain", 85, "Rain"),
    )

    private val THEME_TRACK = mapOf("neon" to 1, "retro" to 1, "comic" to 1, "paper" to 0, "chalk" to 0, "mono" to 0, "sunset" to 2, "ink" to 2)

    const val VOLUME = 0.22
    const val DUCKED = 0.07
    const val DUCK_DOWN_PER_S = 0.75
    const val DUCK_UP_PER_S = 0.375

    /** Port of `clipMusicFor`. */
    fun forTheme(theme: String?): Track = TRACKS[THEME_TRACK[theme] ?: 0]

    /** Port of `clipMusicTarget`. */
    fun target(speaking: Boolean): Double = if (speaking) DUCKED else VOLUME

    /** Port of `clipMusicStep` (3 decimals, JS rounding). */
    fun step(current: Double, target: Double, dtMs: Double): Double {
        val rate = if (target < current) DUCK_DOWN_PER_S else DUCK_UP_PER_S
        val step = (rate * max(0.0, dtMs)) / 1000
        val next = if (target < current) max(target, current - step) else min(target, current + step)
        return kotlin.math.floor(next * 1000 + 0.5) / 1000
    }

    /** Port of `clipMusicShouldPlay`. */
    fun shouldPlay(playing: Boolean, muted: Boolean, music: Boolean): Boolean = playing && !muted && music
}
