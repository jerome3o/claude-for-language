package dev.jeromeswannack.chineselearning.lab.core.spec

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** One exercise type (shared/lesson/registry.ts `ExerciseTypeInfo`). */
@Serializable
data class ExerciseTypeInfo(
    val type: String,
    val icon: String,
    val name: String,
    val label: String,
    val skill: String,
    val summary: String,
    val description: String,
    val checking: String,
    val needs: String? = null,
)

@Serializable
data class SkillLabel(val name: String, val icon: String)

/** A bundled sample lesson (shared/lesson/samples.ts). */
@Serializable
data class SampleLesson(val id: String, val type: String, val spec: JsonObject)

@Serializable
data class CatalogueData(
    val skills: Map<String, SkillLabel>,
    val types: List<ExerciseTypeInfo>,
    val samples: List<SampleLesson>,
    /** `defaultExercise(type)` for every type (shared/lesson/defaults.ts). */
    val defaults: Map<String, JsonObject>,
)

/**
 * The exercise-type registry, the catalogue's sample lessons and the blank exercise per type —
 * the web's shared/lesson registry.ts / samples.ts / defaults.ts, bundled as
 * `resources/lesson/catalogue.json` so the catalogue works offline. The file is generated from
 * the TypeScript (parity/fixtures/lesson-spec.ts writes the same value) and
 * LessonSpecParityTest fails when the two drift.
 */
object LessonCatalogue {
    val data: CatalogueData by lazy {
        val text = LessonCatalogue::class.java.getResourceAsStream("/lesson/catalogue.json")!!.bufferedReader(Charsets.UTF_8).use { it.readText() }
        Json { ignoreUnknownKeys = true }.decodeFromString(CatalogueData.serializer(), text)
    }

    /** Registry entries in catalogue order (EXERCISE_TYPE_LIST). */
    val types: List<ExerciseTypeInfo> get() = data.types

    val samples: List<SampleLesson> get() = data.samples

    fun info(type: String?): ExerciseTypeInfo? = data.types.firstOrNull { it.type == type }

    fun sample(id: String): SampleLesson? = data.samples.firstOrNull { it.id == id }

    fun skill(skill: String): SkillLabel = data.skills[skill] ?: SkillLabel(skill, "•")

    /** A blank exercise of [type] — what "+ Add exercise" inserts; the validator lists what's left to fill. */
    fun defaultExercise(type: String): JsonObject = data.defaults[type] ?: JsJson.obj("type" to JsJson.s(type))

    /** EXERCISE_ICONS / EXERCISE_TYPE_NAMES / EXERCISE_TYPE_LABELS. */
    fun icon(type: String?): String = info(type)?.icon ?: "•"
    fun name(type: String?): String = info(type)?.name ?: (type ?: "")
    fun label(type: String?): String? = info(type)?.label
}
