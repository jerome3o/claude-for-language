package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPatternBody
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPatternExample
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipScene
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSpec
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipStyle
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipTitleBody
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipVoiceLine
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipWord
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.core.clips.Karaoke

/**
 * Port of shared/lesson/patternIntro.ts — "▶ Watch the intro" on a structure card: the card as a 🎬 clip
 * (a title, the pattern building up, each example read with its parts lighting up, a closing line), the
 * voice-over (the structure's own `intro`, else a template in simple Chinese) and what it says (prefetch).
 * Parity-tested (LessonPatternIntroParityTest).
 */
object LessonPatternIntro {
    const val MAX_EXAMPLES = 3
    const val MAX_LINES = 6
    private const val TITLE_MS = 3500
    private const val EXAMPLE_MS = 5000
    private const val CLOSING_MS = 3000
    private const val PIECE_MS = 450

    /** `spokenPatternName`. */
    fun spokenName(card: LessonPatterns.Card): String = LessonPatterns.patternName(LessonPattern(pieces = card.pattern.pieces)).replace("…", "……")

    private fun shownName(card: LessonPatterns.Card): String = LessonPatterns.patternName(card.pattern)

    /** `templateIntroLines`. */
    fun templateLines(card: LessonPatterns.Card): List<PatternIntroLine> {
        val name = spokenName(card)
        val examples = minOf(card.examples.size, MAX_EXAMPLES)
        val meaning = card.pattern.meaning
        val lines = mutableListOf(
            if (name.isNotEmpty()) PatternIntroLine("今天我们学一个新句型：“$name”。", "Today's new structure: ${shownName(card)}")
            else PatternIntroLine("今天我们学一个新句型。", "Today's new structure"),
            PatternIntroLine("我们先看看这个句型。", if (!meaning.isNullOrEmpty()) "First, the pattern — $meaning" else "First, the pattern."),
        )
        if (examples > 0) lines += if (examples == 1) PatternIntroLine("我们听一个例子。", "Let's hear an example.") else PatternIntroLine("我们听几个例子。", "Let's hear some examples.")
        lines += PatternIntroLine("现在你也试一试吧！", "Now you try!")
        return lines
    }

    /** `patternIntroLines`: the structure's own intro (cleaned, ≤ 6), else the template. */
    fun lines(card: LessonPatterns.Card): List<PatternIntroLine> {
        val own = card.pattern.intro.orEmpty()
            .filter { it.zh.trim().isNotEmpty() }
            .take(MAX_LINES)
            .map { l -> PatternIntroLine(l.zh.trim(), l.en?.trim()?.takeIf { it.isNotEmpty() }) }
        return own.ifEmpty { templateLines(card) }
    }

    /** `patternIntroClip`. */
    fun clip(card: LessonPatterns.Card): ClipSpec {
        val lines = lines(card)
        val pieces = card.pattern.pieces
        val name = shownName(card)
        fun voice(l: PatternIntroLine?) = l?.let { ClipVoiceLine(it.zh, "zh", null, it.en) }
        val body = ClipPatternBody(name = name.ifEmpty { null }, pieces = pieces, meaning = card.pattern.meaning?.ifEmpty { null })
        val closing = if (lines.size >= 3) lines.last() else null
        val middle = lines.subList(minOf(2, lines.size), if (closing != null) lines.size - 1 else lines.size)
        val examples = card.examples.take(MAX_EXAMPLES)

        val scenes = mutableListOf<ClipScene>()
        scenes += ClipScene(
            layout = "title", duration_ms = TITLE_MS, voice = voice(lines.getOrNull(0)),
            title = ClipTitleBody(headline_zh = "新句型", headline_en = name.ifEmpty { null }, sub = card.pattern.meaning?.ifEmpty { null }),
        )
        scenes += ClipScene(layout = "pattern", duration_ms = minOf(9000, 1500 + PIECE_MS * pieces.size), voice = voice(lines.getOrNull(1)), pattern = body)
        val extra = maxOf(0, middle.size - examples.size)
        for (i in 0 until extra) scenes += ClipScene(layout = "pattern", duration_ms = 3500, voice = voice(middle[i]), pattern = body)
        examples.forEachIndexed { i, e ->
            scenes += ClipScene(
                layout = "pattern", duration_ms = EXAMPLE_MS, voice = voice(middle.getOrNull(extra + i)),
                pattern = body.copy(example = ClipPatternExample(e.hanzi, e.pinyin?.ifEmpty { null }, e.english?.ifEmpty { null }, e.parts)),
            )
        }
        if (closing != null) scenes += ClipScene(
            layout = "title", duration_ms = CLOSING_MS, voice = voice(closing),
            title = ClipTitleBody(headline_zh = "你也试一试！", headline_en = "Now you try", sub = name.ifEmpty { null }),
        )
        val words = mutableListOf<ClipWord>()
        for (p in pieces) {
            if (LessonPatterns.isSlotPiece(p) || p.optional == true || p.hanzi.isNullOrEmpty() || LessonPatterns.isPunctuation(p.hanzi) || words.size >= 6) continue
            words += ClipWord(p.hanzi, p.pinyin ?: "", p.english ?: "")
        }
        val title = if (name.isNotEmpty()) "Intro · $name".let { if (it.length > 60) it.substring(0, 60) else it } else "Intro"
        return ClipSpec(v = 1, title = title, hook = "", style = ClipStyle(theme = "paper"), words = words, scenes = scenes)
    }

    /** `patternIntroTexts`: every text the intros of a note's cards say (prefetch). */
    fun texts(view: LessonPatterns.View): List<String> = view.cards.flatMap { card -> Clips.utterances(clip(card)).map { it.text } }

    /** `introLitPart`: the example part being read at [positionMs] of a [durationMs] clip (-1 before the first). */
    fun litPart(parts: List<PatternExamplePart>, positionMs: Double, durationMs: Double): Int {
        val texts = parts.map { it.text }
        val timeline = Karaoke.timeline(texts.joinToString(""), "zh", durationMs, texts)
        if (timeline.size != parts.size) return -1
        return Karaoke.active(timeline, positionMs)
    }
}
