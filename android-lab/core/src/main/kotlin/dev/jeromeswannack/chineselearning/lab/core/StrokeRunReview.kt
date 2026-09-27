package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * The review side of a stroke-order checked handwriting run — the pure part of the web's
 * components/lessonAttempts/StrokeRunView.tsx. An attempt keeps the run as JSON
 * (`StrokeWritingSummary` in shared/lesson/attempt.ts, written by `summarizeWriting`);
 * this reads it back leniently (a tutor may open an attempt written by an older web or Lab
 * build) and says how each stroke is drawn and labelled.
 */

/** How one stroke went, which decides its colour (`strokeColour`). */
enum class StrokeTone { FIRST_TRY, AFTER_MISS, HINTED, SHOWN }

data class RunStroke(
    val misses: Int = 0,
    val mistakes: List<String> = emptyList(),
    val hinted: Boolean = false,
    val revealed: Boolean = false,
    /** The learner's own stroke in character-data space (y up), compacted; null when none was kept. */
    val drawn: List<StrokePoint>? = null,
)

data class RunCharacter(
    val character: String,
    val grade: String,
    val mistakes: Int,
    val hints: Int,
    val revealed: Int,
    val ms: Double,
    val strokes: List<RunStroke>,
)

data class StrokeRun(
    val text: String,
    val mode: String,
    val grade: String,
    val skipped: List<String>,
    val characters: List<RunCharacter>,
)

object StrokeRunReview {
    /** `GRADE_LABEL`. */
    fun gradeLabel(grade: String): String = when (grade) {
        "perfect" -> "Perfect"
        "good" -> "Good"
        "practice" -> "Needs practice"
        else -> grade
    }

    /** `strokeColour`: shown by the app → with a hint → after a miss → first try. */
    fun tone(s: RunStroke): StrokeTone = when {
        s.revealed -> StrokeTone.SHOWN
        s.hinted -> StrokeTone.HINTED
        s.misses > 0 -> StrokeTone.AFTER_MISS
        else -> StrokeTone.FIRST_TRY
    }

    /** A stroke is re-drawn from the learner's ink when it has at least two points; else the model's median, dashed. */
    fun hasInk(s: RunStroke): Boolean = (s.drawn?.size ?: 0) >= 2

    /** The run's heading: "From memory · Good" / "Traced over the outline · Perfect". */
    fun heading(run: StrokeRun): String =
        (if (run.mode == "recall") "From memory" else "Traced over the outline") + " · " + gradeLabel(run.grade)

    /** One character's grade line: "好 · Needs practice". */
    fun characterLabel(c: RunCharacter): String = "${c.character} · ${gradeLabel(c.grade)}"

    /** "2 mistakes · 1 hint · 1 shown · 3.4 s" (web: `detail`). */
    fun detail(c: RunCharacter): String = listOfNotNull(
        if (c.mistakes != 0) "${c.mistakes} mistake${if (c.mistakes == 1) "" else "s"}" else "no mistakes",
        if (c.hints != 0) "${c.hints} hint${if (c.hints == 1) "" else "s"}" else null,
        if (c.revealed != 0) "${c.revealed} shown" else null,
        "${Js.toFixed(c.ms / 1000, 1)} s",
    ).joinToString(" · ")

    /**
     * The distinct kinds of mistake made on the character, in first-seen order, or null when
     * none (web: `new Set(strokes.flatMap(mistakes))`, each with its FIRST `_` made a space —
     * `String.replace` with a string pattern).
     */
    fun mistakeKinds(c: RunCharacter): String? {
        if (c.strokes.none { it.mistakes.isNotEmpty() }) return null
        return c.strokes.flatMap { it.mistakes }.distinct().joinToString(", ") { it.replaceFirst('_', ' ') }
    }

    /** "No stroke data for 龘 䨻." or null. */
    fun skippedLine(run: StrokeRun): String? = if (run.skipped.isEmpty()) null else "No stroke data for ${run.skipped.joinToString(" ")}."

    /** Reads an attempt's `handwriting.writing`; null when it isn't a run. */
    fun parse(json: JsonElement?): StrokeRun? {
        val o = json as? JsonObject ?: return null
        val chars = (o["characters"] as? JsonArray) ?: return null
        return StrokeRun(
            text = o.str("text") ?: "",
            mode = o.str("mode") ?: "recall",
            grade = o.str("grade") ?: "practice",
            skipped = (o["skipped"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content },
            characters = chars.mapNotNull { c ->
                val co = c as? JsonObject ?: return@mapNotNull null
                RunCharacter(
                    character = co.str("character") ?: return@mapNotNull null,
                    grade = co.str("grade") ?: "practice",
                    mistakes = co.num("mistakes")?.toInt() ?: 0,
                    hints = co.num("hints")?.toInt() ?: 0,
                    revealed = co.num("revealed")?.toInt() ?: 0,
                    ms = co.num("ms") ?: 0.0,
                    strokes = (co["strokes"] as? JsonArray).orEmpty().map { s ->
                        val so = s as? JsonObject ?: JsonObject(emptyMap())
                        RunStroke(
                            misses = so.num("misses")?.toInt() ?: 0,
                            mistakes = (so["mistakes"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content },
                            hinted = (so["hinted"] as? JsonPrimitive)?.booleanOrNull ?: false,
                            revealed = (so["revealed"] as? JsonPrimitive)?.booleanOrNull ?: false,
                            drawn = (so["drawn"] as? JsonArray)?.mapNotNull { p ->
                                val xy = p as? JsonArray ?: return@mapNotNull null
                                val x = (xy.getOrNull(0) as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
                                val y = (xy.getOrNull(1) as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
                                StrokePoint(x, y)
                            },
                        )
                    },
                )
            },
        )
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
}
