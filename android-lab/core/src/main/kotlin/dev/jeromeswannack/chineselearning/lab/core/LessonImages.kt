package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * describe_image pictures: one per scene description (worker/src/services/lesson-images.ts).
 * Port of shared/lesson/images.ts plus the placeholder copy of the web's
 * frontend/src/hooks/useLessonImage.ts (`lessonImagePlaceholder`).
 */
object LessonImages {
    /** JS `\s` is Unicode whitespace; spelled out (Android's regex `\s` is ASCII). */
    private val WHITESPACE = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")

    /** `normalizeImagePrompt`: what the picture is keyed by. */
    fun normalizePrompt(prompt: String): String = prompt.replace(WHITESPACE, " ").trim()

    private fun exercises(spec: CustomLessonSpec): List<DescribeImageExercise> =
        spec.sections.flatMap { it.exercises }.filterIsInstance<DescribeImageExercise>().filter { it.imagePrompt.isNotBlank() }

    /** `describeImagePrompts`: distinct scene prompts (by normalised text); [missingOnly] skips exercises with a picture. */
    fun prompts(spec: CustomLessonSpec, missingOnly: Boolean = false): List<String> =
        exercises(spec).filter { !missingOnly || it.imageUrl.isNullOrEmpty() }.distinctBy { normalizePrompt(it.imagePrompt) }.map { it.imagePrompt }

    /** The same over a raw JSON spec (catalogue samples, the editor). */
    fun prompts(spec: JsonObject): List<String> {
        val out = LinkedHashMap<String, String>()
        for (section in (spec["sections"] as? JsonArray).orEmpty()) {
            for (ex in ((section as? JsonObject)?.get("exercises") as? JsonArray).orEmpty()) {
                val o = ex as? JsonObject ?: continue
                if ((o["type"] as? JsonPrimitive)?.contentOrNull != "describe_image") continue
                val prompt = (o["image_prompt"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() } ?: continue
                out.putIfAbsent(normalizePrompt(prompt), prompt)
            }
        }
        return out.values.toList()
    }

    /** `describeImageKeys`: every picture key a spec already carries (offline prefetch). */
    fun keys(spec: CustomLessonSpec): List<String> = exercises(spec).mapNotNull { it.imageUrl?.takeIf(String::isNotEmpty) }.distinct()

    /** Where a picture is: shown, or what stands in for it (`LessonImageState`). */
    enum class State { Ready, Loading, Pending, Slow, Offline, Failed, None }

    data class Placeholder(val drawing: Boolean, val title: String, val detail: String? = null)

    /** `lessonImagePlaceholder` — the same words as the web. */
    fun placeholder(state: State): Placeholder = when (state) {
        State.Loading -> Placeholder(true, "Loading the picture…")
        State.Pending -> Placeholder(true, "Drawing the picture…", "It appears here in a moment.")
        State.Slow -> Placeholder(true, "Still drawing the picture…", "It will be here next time — meanwhile, imagine the scene:")
        State.Offline -> Placeholder(false, "Picture not downloaded yet — it comes with your next sync. Imagine the scene:")
        State.Failed -> Placeholder(false, "The picture could not be drawn. Imagine the scene:")
        State.Ready, State.None -> Placeholder(false, "Imagine this scene:")
    }

    /** Server status (`/api/lesson-images/ensure`) → what to show; null = poll again. */
    fun stateFor(status: String, polls: Int, maxPolls: Int): State = when (status) {
        "ready" -> State.Ready
        "pending" -> if (polls > maxPolls) State.Slow else State.Pending
        "failed" -> State.Failed
        else -> State.None
    }
}
