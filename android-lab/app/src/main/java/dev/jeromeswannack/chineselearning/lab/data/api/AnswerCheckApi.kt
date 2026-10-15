package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckInput
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswerCheck
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.security.MessageDigest

/*
 * Claude's check of a self-assessed lesson answer (the web's services/answerCheck.ts):
 * `POST /api/lessons/answer-check` and the 💬 follow-up `POST /api/lessons/answer-check/ask`,
 * with the device cache first (JsonCache "lessons/answer-check/<sha256 of the cache text>", so a
 * check seen once shows offline). One retry on a busy 503.
 */

@Serializable
private data class AnswerCheckReply(val check: JsonElement? = null, val cached: Boolean = false)

@Serializable
data class AskTurnDto(val role: String, val text: String)

@Serializable
private data class AnswerAskBody(
    @SerialName("prompt_en") val promptEn: String,
    @SerialName("model_answer") val modelAnswer: String,
    @SerialName("model_pinyin") val modelPinyin: String? = null,
    val answer: String,
    @SerialName("exercise_type") val exerciseType: String,
    val input: String? = null,
    val focus: String? = null,
    val check: AnswerCheck? = null,
    val history: List<AskTurnDto> = emptyList(),
    val question: String,
)

@Serializable
private data class AnswerAskReply(val reply: String = "")

/** No check to be had (offline, busy, no key, declined): the exercise is self-assessed as before. */
class AnswerCheckUnavailable(message: String, val offline: Boolean = false) : IOException(message)

data class AnswerCheckResult(val check: AnswerCheck, val cached: Boolean)

private fun cacheKey(input: AnswerCheckInput): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(LessonAnswerCheck.cacheText(input).toByteArray(Charsets.UTF_8))
    return "lessons/answer-check/" + digest.joinToString("") { "%02x".format(it) }
}

private suspend fun <T> retryBusy(block: suspend () -> T): T {
    for (attempt in 0..1) {
        try {
            return block()
        } catch (e: HttpException) {
            val retryable = runCatching { (Json.parseToJsonElement(e.body ?: "") as JsonObject)["retryable"]?.jsonPrimitive?.boolean == true }.getOrDefault(false)
            if (e.code == 503 && retryable && attempt == 0) continue
            throw AnswerCheckUnavailable("HTTP ${e.code}")
        } catch (e: AnswerCheckUnavailable) {
            throw e
        } catch (e: IOException) {
            throw AnswerCheckUnavailable(e.message ?: "network", offline = true)
        }
    }
    throw AnswerCheckUnavailable("busy")
}

suspend fun Api.checkLessonAnswer(input: AnswerCheckInput, cache: JsonCache, online: Boolean): AnswerCheckResult {
    val key = cacheKey(input)
    runCatching { cache.get<AnswerCheck>(key) }.getOrNull()?.let { return AnswerCheckResult(it, cached = true) }
    if (!online) throw AnswerCheckUnavailable("offline", offline = true)
    val reply = retryBusy { post<AnswerCheckInput, AnswerCheckReply>("/api/lessons/answer-check", input) }
    val check = LessonAnswerCheck.parse(reply.check, input.answer) ?: throw AnswerCheckUnavailable("bad reply")
    runCatching { cache.put(key, "lesson_answer_check", check) }
    return AnswerCheckResult(check, reply.cached)
}

suspend fun Api.askAboutLessonAnswer(input: AnswerCheckInput, check: AnswerCheck?, history: List<AskTurnDto>, question: String): String =
    retryBusy {
        post<AnswerAskBody, AnswerAskReply>(
            "/api/lessons/answer-check/ask",
            AnswerAskBody(input.promptEn, input.modelAnswer, input.modelPinyin, input.answer, input.exerciseType, input.input, input.focus, check, history, question),
        ).reply
    }
