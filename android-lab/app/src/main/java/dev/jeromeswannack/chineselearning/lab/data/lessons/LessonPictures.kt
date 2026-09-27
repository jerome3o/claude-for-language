package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.LessonImages
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.ensureLessonImages
import dev.jeromeswannack.chineselearning.lab.data.api.topUpLessonImages
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import java.io.File

/** A describe_image picture: the file when [state] is Ready, else what stands in for it. */
data class LessonPicture(val state: LessonImages.State, val file: File? = null) {
    companion object {
        val Loading = LessonPicture(LessonImages.State.Loading)
    }
}

/**
 * describe_image pictures on the phone — the web's hooks/useLessonImage.ts +
 * services/lessonImages.ts. The worker draws one picture per scene description and writes
 * its key into every lesson copy waiting for it (the next lesson sync brings it down); until
 * then — and for specs that never carry a key (library previews, catalogue samples) — ask by
 * prompt (`POST /api/lesson-images/ensure`) and poll while it is being drawn. Prompt → key is
 * remembered in the JsonCache and the picture file in [media], so a picture seen once shows offline.
 */
class LessonPictures(private val cache: JsonCache, private val api: Api, private val media: LessonMedia) {
    private val keysSerializer = MapSerializer(String.serializer(), String.serializer())

    suspend fun rememberedKey(prompt: String?): String? =
        prompt?.takeIf { it.isNotBlank() }?.let { cache.get(KEYS, keysSerializer)?.get(LessonImages.normalizePrompt(it)) }

    private suspend fun remember(prompt: String, key: String) {
        val keys = LinkedHashMap(cache.get(KEYS, keysSerializer).orEmpty())
        val norm = LessonImages.normalizePrompt(prompt)
        if (keys[norm] == key) return
        keys.remove(norm)
        keys[norm] = key
        val kept = if (keys.size > MAX_REMEMBERED) keys.entries.toList().takeLast(MAX_REMEMBERED).associate { it.key to it.value } else keys
        cache.put(KEYS, KIND, kept, keysSerializer)
    }

    /** Ask by scene; ready keys are remembered. [queue] false only looks up. */
    suspend fun ensure(prompts: List<String>, queue: Boolean = true) =
        api.ensureLessonImages(prompts, queue).also { list -> list.forEach { if (it.status == "ready" && it.imageUrl != null) remember(it.prompt, it.imageUrl) } }

    /**
     * The picture's states over time (`useLessonImage`): the key's file when it is on the
     * phone or downloads; else asked by prompt, "Drawing the picture…" while pending (polled
     * every [pollMs], "still drawing" after [maxPolls]); offline → waits for the connection.
     */
    fun picture(
        key: String?,
        prompt: String?,
        online: StateFlow<Boolean>,
        queue: Boolean = true,
        pollMs: Long = 4_000,
        maxPolls: Int = 45,
    ): Flow<LessonPicture> = flow {
        var broken: String? = null
        while (true) {
            val k = key?.takeIf { it.isNotBlank() } ?: rememberedKey(prompt)
            if (k != null && k != broken) {
                media.cachedImage(k)?.let { emit(LessonPicture(LessonImages.State.Ready, it)); return@flow }
                if (online.value) {
                    media.image(k, online = true)?.let { emit(LessonPicture(LessonImages.State.Ready, it)); return@flow }
                    broken = k // the download failed: ask by prompt instead
                }
            }
            if (prompt.isNullOrBlank()) { emit(LessonPicture(LessonImages.State.None)); return@flow }
            if (!online.value) {
                emit(LessonPicture(LessonImages.State.Offline))
                online.first { it } // try again when the phone is back online
                broken = null
                continue
            }
            emit(LessonPicture.Loading)
            var polls = 0
            while (true) {
                val res = try {
                    ensure(listOf(prompt), queue).firstOrNull()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    null
                }
                if (res == null) {
                    emit(LessonPicture(if (online.value) LessonImages.State.None else LessonImages.State.Offline))
                    return@flow
                }
                val readyKey = res.imageUrl
                if (res.status == "ready" && readyKey != null && readyKey != broken) {
                    val file = media.image(readyKey, online = true)
                    emit(if (file != null) LessonPicture(LessonImages.State.Ready, file) else LessonPicture(LessonImages.State.Failed))
                    return@flow
                }
                if (res.status == "ready") { emit(LessonPicture(LessonImages.State.Failed)); return@flow }
                polls++
                val state = LessonImages.stateFor(res.status, polls, maxPolls)
                emit(LessonPicture(state))
                if (state != LessonImages.State.Pending && state != LessonImages.State.Slow) return@flow
                delay(if (state == LessonImages.State.Slow) pollMs * 4 else pollMs)
            }
        }
    }

    /**
     * Hourly from the sync (`topUpLessonImagesIfDue`): the server writes ready pictures into
     * this account's lessons / queues missing ones and pre-draws the catalogue samples, whose
     * pictures are then downloaded so "Try it" shows them offline.
     */
    suspend fun topUpIfDue() {
        if (cache.isFresh(TOP_UP, TOP_UP_INTERVAL_MS)) return
        cache.put(TOP_UP, KIND, System.currentTimeMillis(), Long.serializer())
        api.topUpLessonImages()
        val samplePrompts = LessonCatalogue.samples.flatMap { LessonImages.prompts(it.spec) }
        if (samplePrompts.isEmpty()) return
        for (img in ensure(samplePrompts)) {
            if (img.status == "ready" && img.imageUrl != null) media.image(img.imageUrl, online = true)
        }
    }

    companion object {
        const val KIND = "lesson-images"
        const val KEYS = "lesson-images/keys"
        const val TOP_UP = "lesson-images/top-up"
        private const val MAX_REMEMBERED = 300
        private const val TOP_UP_INTERVAL_MS = 60L * 60 * 1000
    }
}
