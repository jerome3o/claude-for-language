package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.ChoiceMistake
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.security.MessageDigest

/*
 * The correction of a "which sentence is wrong?" choice's wrong option for an older lesson (the web's
 * services/choiceCorrection.ts; core ChoiceMistake): the device cache first (JsonCache
 * "lessons/choice-correction/<sha256 of the cache text>", so a correction seen once shows offline), then
 * `POST /api/lessons/choice-correction` (cached for everyone on the server). One retry on a busy 503.
 */

data class ChoiceCorrectionReply(val result: ChoiceMistake.Result, val cached: Boolean)

private fun cacheKey(input: ChoiceMistake.Input): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(ChoiceMistake.cacheText(input.question, input.sentence).toByteArray(Charsets.UTF_8))
    return "lessons/choice-correction/" + digest.joinToString("") { "%02x".format(it) }
}

suspend fun Api.choiceCorrection(input: ChoiceMistake.Input, cache: JsonCache, online: Boolean): ChoiceCorrectionReply {
    val key = cacheKey(input)
    runCatching { cache.get<JsonElement>(key) }.getOrNull()?.let { stored ->
        runCatching { ChoiceMistake.normalize(stored, input.sentence) }.getOrNull()?.let { return ChoiceCorrectionReply(it, cached = true) }
    }
    if (!online) throw AnswerCheckUnavailable("offline", offline = true)
    val reply = retryCorrection { post<ChoiceMistake.Input, JsonElement>("/api/lessons/choice-correction", input) }
    val result = runCatching { ChoiceMistake.normalize(reply, input.sentence) }.getOrNull() ?: throw AnswerCheckUnavailable("bad reply")
    runCatching { cache.put(key, "lesson_choice_correction", reply) }
    val cached = ((reply as? JsonObject)?.get("cached") as? JsonPrimitive)?.booleanOrNull == true
    Analytics.track("lesson.choice_correction", mapOf("cached" to cached, "unchanged" to result.unchanged))
    return ChoiceCorrectionReply(result, cached)
}

private suspend fun <T> retryCorrection(block: suspend () -> T): T {
    for (attempt in 0..1) {
        try {
            return block()
        } catch (e: dev.jeromeswannack.chineselearning.lab.data.HttpException) {
            if (e.code == 503 && attempt == 0 && (e.body ?: "").contains("\"retryable\":true")) continue
            throw AnswerCheckUnavailable("HTTP ${e.code}")
        } catch (e: java.io.IOException) {
            throw AnswerCheckUnavailable(e.message ?: "network", offline = true)
        }
    }
    throw AnswerCheckUnavailable("busy")
}
