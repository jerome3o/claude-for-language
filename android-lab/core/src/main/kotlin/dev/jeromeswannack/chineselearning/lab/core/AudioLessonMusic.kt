package dev.jeromeswannack.chineselearning.lab.core

import kotlin.math.max
import kotlin.math.min

/*
 * The soft music bed under an audio lesson (docs/AUDIO_LESSONS.md "Music"). Port of
 * shared/audio-lesson/music.ts, parity-tested (parity/fixtures/audio-lesson.ts → AudioLessonParityTest).
 * The track itself is res/raw/lesson_music.mp3 — the same file as the web's
 * frontend/public/audio/lesson-music-v1.mp3 (scripts/audio/generate-lesson-music.mjs, CC0).
 */
object AudioLessonMusic {
    /** Port of MUSIC_DEFAULT_VOLUME. */
    const val DEFAULT_VOLUME = 0.35

    /** Port of MUSIC_MIN_VOLUME / MUSIC_MAX_VOLUME: the slider's range. */
    const val MIN_VOLUME = 0.05
    const val MAX_VOLUME = 1.0

    /** Port of musicDefaultOn: on under a sleep or a story lesson, off under a dialogue lesson. */
    fun defaultOn(format: String?): Boolean = format == "sleep" || format == "story"

    /** Port of parseMusicVolume: a stored / dragged volume → one the player uses. */
    fun parseVolume(raw: Double?): Double {
        if (raw == null || raw.isNaN() || raw.isInfinite()) return DEFAULT_VOLUME
        return Js.round(min(MAX_VOLUME, max(MIN_VOLUME, raw)) * 100) / 100
    }

    /** Port of parseMusicOn: a stored choice ("1" / "0"), else the format's default. */
    fun parseOn(raw: String?, format: String?): Boolean = when (raw) {
        "1" -> true
        "0" -> false
        else -> defaultOn(format)
    }

    /** Port of musicShouldPlay: only while the lesson plays, and only when on. */
    fun shouldPlay(on: Boolean, lessonPlaying: Boolean): Boolean = on && lessonPlaying

    /** Port of musicOutputVolume: the music volume × the sleep timer's fade. */
    fun outputVolume(volume: Double, fade: Double = 1.0): Double {
        val v = min(1.0, max(0.0, volume)) * min(1.0, max(0.0, fade))
        return Js.round(v * 1000) / 1000
    }

    /** Port of musicVolumeLabel: "35 %". */
    fun volumeLabel(volume: Double): String = "${Js.round(parseVolume(volume) * 100).toLong()} %"
}
