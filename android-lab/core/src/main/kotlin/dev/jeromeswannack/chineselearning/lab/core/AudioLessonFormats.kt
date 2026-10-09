package dev.jeromeswannack.chineselearning.lab.core

import kotlin.math.max

/*
 * The three audio-lesson formats (docs/AUDIO_LESSONS.md): how each is named and shown, and the
 * story form's length hint. Port of AUDIO_LESSON_FORMAT_INFO / audioLessonFormatInfo
 * (shared/audio-lesson/types.ts) and storyMinutesForText / storyEstimateLine
 * (shared/audio-lesson/story.ts), parity-tested (parity/fixtures/audio-lesson.ts → AudioLessonParityTest).
 * The story SPLITTER itself runs only on the server (the worker splits the pasted text).
 */

/** Port of AudioLessonFormatInfo. */
data class AudioLessonFormatInfo(val icon: String, val label: String, val short: String, val kind: String)

object AudioLessonFormats {
    /** Port of AUDIO_LESSON_FORMATS. */
    val ALL: List<String> = listOf("dialogue", "sleep", "story")

    private val INFO = mapOf(
        "dialogue" to AudioLessonFormatInfo("🎙️", "Dialogue", "Practise a situation", "Dialogue lesson"),
        "sleep" to AudioLessonFormatInfo("🌙", "Sleep", "New words, slowly", "Sleep lesson"),
        "story" to AudioLessonFormatInfo("📖", "Story", "Listen & repeat", "Listen & repeat a story"),
    )

    /** Port of audioLessonFormatInfo: an unknown format is shown as a dialogue lesson. */
    fun info(format: String?): AudioLessonFormatInfo = INFO[format] ?: INFO.getValue("dialogue")

    /** Port of STORY_MS_PER_HAN: about how much audio one character of a story makes. */
    const val STORY_MS_PER_HAN = 2350

    /** Port of STORY_LIMITS.maxMinutes: a story lesson holds this much at most. */
    const val STORY_MAX_MINUTES = 60

    /** Port of storyMinutesForText's result. */
    data class StoryEstimate(val minutes: Int, val han: Int, val capped: Boolean)

    /** compile.ts's HAN: the main Han blocks (UTF-16 units, like the JS regex without the u flag). */
    private fun isHan(c: Char): Boolean = c in '\u3400'..'\u4DBF' || c in '\u4E00'..'\u9FFF' || c in '\uF900'..'\uFAFF'

    /** Port of storyMinutesForText: "about N minutes" from the pasted text's Han characters, capped at 60. */
    fun storyMinutesForText(text: String): StoryEstimate {
        val han = text.count { isHan(it) }
        val raw = han.toDouble() * STORY_MS_PER_HAN / 60000
        val capped = raw > STORY_MAX_MINUTES
        val minutes = if (han == 0) 0 else max(1.0, Js.round(if (capped) STORY_MAX_MINUTES.toDouble() else raw)).toInt()
        return StoryEstimate(minutes, han, capped)
    }

    /** Port of storyEstimateLine: the line under a story's text box. */
    fun storyEstimateLine(text: String): String {
        val est = storyMinutesForText(text)
        if (est.han == 0) return "Each line three times, slowly, then its English."
        if (est.capped) return "Long text: the lesson covers about the first $STORY_MAX_MINUTES minutes — paste the rest as another lesson."
        return "About ${est.minutes} minute${if (est.minutes == 1) "" else "s"} of audio."
    }
}
