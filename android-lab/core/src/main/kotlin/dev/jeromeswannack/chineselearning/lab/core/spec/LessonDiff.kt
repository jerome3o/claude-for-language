package dev.jeromeswannack.chineselearning.lab.core.spec

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.canonical
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.str
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.truthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/** A changed field: `before` / `after` are the JSON values (null = undefined). */
data class FieldChange(val field: String, val before: JsonElement?, val after: JsonElement?)

sealed interface ExerciseDiffEntry {
    val section: Int
    val index: Int
    data class Added(override val section: Int, override val index: Int, val exercise: JsonObject) : ExerciseDiffEntry
    data class Removed(override val section: Int, override val index: Int, val exercise: JsonObject) : ExerciseDiffEntry
    data class Changed(override val section: Int, override val index: Int, val before: JsonObject, val after: JsonObject, val fields: List<FieldChange>) : ExerciseDiffEntry
    data class Moved(val fromSection: Int, val fromIndex: Int, override val section: Int, override val index: Int, val exercise: JsonObject) : ExerciseDiffEntry
}

sealed interface SectionDiffEntry {
    val index: Int
    data class Added(override val index: Int, val title: String?, val exerciseCount: Int) : SectionDiffEntry
    data class Removed(override val index: Int, val title: String?, val exerciseCount: Int) : SectionDiffEntry
    data class Renamed(override val index: Int, val before: String?, val after: String?) : SectionDiffEntry
}

data class LessonDiffResult(
    val changed: Boolean,
    val meta: List<FieldChange>,
    val sections: List<SectionDiffEntry>,
    val exercises: List<ExerciseDiffEntry>,
)

/**
 * Port of shared/lesson/diff.ts: the structural diff between two lesson specs (exercises have
 * no ids, so identity is inferred: identical first, then the best same-type match, the rest are
 * adds / removes) and its plain-text lines. The editor chat uses it for "You've changed: …".
 * Parity-tested (LessonSpecParityTest).
 */
object LessonDiff {
    /** The text that identifies an exercise to a human (exercisePrimaryText). */
    fun primaryText(ex: JsonObject): String = when (str(ex["type"])) {
        "note" -> {
            val title = ex["title"]
            val first = (ex["sentences"] as? JsonArray)?.getOrNull(0) as? JsonObject
            when {
                truthy(title) -> JsJson.jsString(title)
                truthy(first?.get("hanzi")) -> JsJson.jsString(first!!["hanzi"])
                else -> (str(ex["body"]) ?: "").let { if (it.length > 60) it.substring(0, 60) else it }
            }
        }
        "scramble", "translate" -> text(ex["english"])
        "choice" -> text(ex["question"])
        "match" -> (ex["pairs"] as? JsonArray).orEmpty().joinToString(" · ") { joinPart((it as? JsonObject)?.get("hanzi")) }
        "describe_image" -> if (truthy(ex["task"])) JsJson.jsString(ex["task"]) else text(ex["reference_hanzi"])
        "speak", "oral_expression" -> text(ex["prompt"])
        "listen_choice", "listen_translate", "dictation" -> text((ex["audio"] as? JsonObject)?.get("hanzi"))
        "sentence_making" -> if (truthy(ex["task"])) JsJson.jsString(ex["task"])
            else (ex["words"] as? JsonArray).orEmpty().joinToString(" · ") { joinPart((it as? JsonObject)?.get("hanzi")) }
        "write_typed", "write_handwriting" -> text((ex["answer"] as? JsonObject)?.get("hanzi"))
        "conversation" -> text(ex["situation"])
        else -> ""
    }

    /** A field the TS returns as-is (typed as string); non-strings are shown as their JS string. */
    private fun text(e: JsonElement?): String = when (e) {
        null -> ""
        else -> str(e) ?: JsJson.jsString(e)
    }

    /** Array.join treats undefined / null as ''. */
    private fun joinPart(e: JsonElement?): String = if (e == null || e is JsonNull) "" else JsJson.jsString(e)

    private fun identityFields(ex: JsonObject): List<String> = when (str(ex["type"])) {
        "note" -> listOf("title", "body", "sentences")
        "scramble" -> listOf("english", "correct_order")
        "choice" -> listOf("question", "options")
        "translate" -> listOf("english", "reference_hanzi")
        "match" -> listOf("pairs")
        "describe_image" -> listOf("image_prompt", "reference_hanzi", "task")
        "speak" -> listOf("prompt", "example")
        "listen_choice" -> listOf("audio", "options", "question")
        "listen_translate" -> listOf("audio")
        "sentence_making" -> listOf("words", "task")
        "write_typed", "write_handwriting" -> listOf("answer")
        "dictation" -> listOf("audio")
        "oral_expression" -> listOf("prompt", "question_audio")
        "conversation" -> listOf("situation", "lines")
        else -> emptyList()
    }

    private class Located(val section: Int, val index: Int, val exercise: JsonObject, val key: String?) {
        var matched = false
    }

    private fun sectionsOf(spec: JsonObject): List<JsonObject> = (spec["sections"] as? JsonArray).orEmpty().map { it as? JsonObject ?: JsonObject(emptyMap()) }

    private fun exercisesOf(section: JsonObject): List<JsonElement> = (section["exercises"] as? JsonArray).orEmpty()

    private fun locate(spec: JsonObject): List<Located> {
        val out = mutableListOf<Located>()
        sectionsOf(spec).forEachIndexed { si, section ->
            exercisesOf(section).forEachIndexed { ei, ex ->
                val o = ex as? JsonObject ?: JsonObject(emptyMap())
                out += Located(si, ei, o, canonical(ex))
            }
        }
        return out
    }

    private fun fieldChanges(before: JsonObject, after: JsonObject): List<FieldChange> {
        val keys = LinkedHashSet<String>().apply { addAll(before.keys); addAll(after.keys) }
        val changes = mutableListOf<FieldChange>()
        for (field in keys.sorted()) {
            // image_url is server-filled; a proposal that omits it isn't a change.
            if (field == "image_url") continue
            val b = before[field]
            val a = after[field]
            if (canonical(b) != canonical(a)) changes += FieldChange(field, b, a)
        }
        return changes
    }

    private fun similarity(a: JsonObject, b: JsonObject): Double {
        if (!JsJson.strictEquals(a["type"], b["type"])) return 0.0
        val fields = identityFields(a)
        if (fields.isEmpty()) return 0.0
        var same = 0.0
        for (f in fields) if (canonical(a[f]) == canonical(b[f])) same++
        val pa = primaryText(a)
        if (pa.isNotEmpty() && pa == primaryText(b)) same = maxOf(same, fields.size * 0.75)
        return same / fields.size
    }

    private fun sectionTitle(s: JsonObject?): String? {
        val t = s?.let { str(it["title"]) } ?: return null
        return JsJson.trim(t).ifEmpty { null }
    }

    fun diff(before: JsonObject, after: JsonObject): LessonDiffResult {
        val meta = mutableListOf<FieldChange>()
        for (field in listOf("title", "icon", "description")) {
            val b = before[field]?.takeIf { it !is JsonNull }
            val a = after[field]?.takeIf { it !is JsonNull }
            val bv = b ?: JsJson.s("")
            val av = a ?: JsJson.s("")
            if (!JsJson.strictEquals(bv, av)) meta += FieldChange(field, b ?: JsonNull, a ?: JsonNull)
        }

        val bs = sectionsOf(before)
        val asx = sectionsOf(after)
        val sections = mutableListOf<SectionDiffEntry>()
        val common = minOf(bs.size, asx.size)
        for (i in 0 until common) {
            val b = sectionTitle(bs[i])
            val a = sectionTitle(asx[i])
            if (b != a) sections += SectionDiffEntry.Renamed(i, b, a)
        }
        for (i in common until asx.size) sections += SectionDiffEntry.Added(i, sectionTitle(asx[i]), exercisesOf(asx[i]).size)
        for (i in common until bs.size) sections += SectionDiffEntry.Removed(i, sectionTitle(bs[i]), exercisesOf(bs[i]).size)

        val olds = locate(before)
        val news = locate(after)
        val exercises = mutableListOf<ExerciseDiffEntry>()

        // Pass 1: byte-identical exercises (unchanged, or moved between sections).
        for (n in news) {
            val o = olds.firstOrNull { !it.matched && it.key == n.key } ?: continue
            o.matched = true
            n.matched = true
            if (o.section != n.section) exercises += ExerciseDiffEntry.Moved(o.section, o.index, n.section, n.index, n.exercise)
        }

        // Pass 2: edited exercises — best same-type match above a threshold.
        for (n in news) {
            if (n.matched) continue
            var best: Located? = null
            var bestScore = 0.0
            for (o in olds) {
                if (o.matched) continue
                val score = similarity(o.exercise, n.exercise)
                if (score > bestScore) {
                    best = o
                    bestScore = score
                }
            }
            if (best != null && bestScore >= 0.34) {
                best.matched = true
                n.matched = true
                exercises += ExerciseDiffEntry.Changed(n.section, n.index, best.exercise, n.exercise, fieldChanges(best.exercise, n.exercise))
            }
        }

        for (n in news) if (!n.matched) exercises += ExerciseDiffEntry.Added(n.section, n.index, n.exercise)
        for (o in olds) if (!o.matched) exercises += ExerciseDiffEntry.Removed(o.section, o.index, o.exercise)

        val sorted = exercises.sortedWith(compareBy<ExerciseDiffEntry> { it.section }.thenBy { it.index })
        return LessonDiffResult(meta.isNotEmpty() || sections.isNotEmpty() || sorted.isNotEmpty(), meta, sections, sorted)
    }

    private fun describe(ex: JsonObject): String {
        val label = LessonCatalogue.label(str(ex["type"])) ?: JsJson.jsString(ex["type"])
        val text = primaryText(ex)
        return if (text.isNotEmpty()) "$label \"${JsJson.short(JsJson.s(text), 60)}\"" else label
    }

    /** formatLessonDiff: plain-text lines for the model and the "You've changed" line. */
    fun format(diff: LessonDiffResult): List<String> {
        val lines = mutableListOf<String>()
        for (m in diff.meta) lines += "${m.field}: \"${JsJson.short(m.before, 60)}\" → \"${JsJson.short(m.after, 60)}\""
        fun name(t: String?) = if (t != null) "\"$t\"" else "(untitled)"
        for (s in diff.sections) lines += when (s) {
            is SectionDiffEntry.Added -> "Section ${s.index + 1} ${name(s.title)} added (${s.exerciseCount} exercises)"
            is SectionDiffEntry.Removed -> "Section ${s.index + 1} ${name(s.title)} removed (${s.exerciseCount} exercises)"
            is SectionDiffEntry.Renamed -> "Section ${s.index + 1} renamed ${name(s.before)} → ${name(s.after)}"
        }
        for (e in diff.exercises) {
            val where = "Section ${e.section + 1}, exercise ${e.index + 1}"
            lines += when (e) {
                is ExerciseDiffEntry.Added -> "$where: added ${describe(e.exercise)}"
                is ExerciseDiffEntry.Removed -> "$where: removed ${describe(e.exercise)}"
                is ExerciseDiffEntry.Moved -> "$where: moved ${describe(e.exercise)} here from section ${e.fromSection + 1}"
                is ExerciseDiffEntry.Changed -> {
                    val fields = e.fields.joinToString("; ") { f -> "${f.field} \"${JsJson.short(f.before, 40)}\" → \"${JsJson.short(f.after, 40)}\"" }
                    "$where: changed ${describe(e.after)} — ${fields.ifEmpty { "reworded" }}"
                }
            }
        }
        return lines
    }
}
