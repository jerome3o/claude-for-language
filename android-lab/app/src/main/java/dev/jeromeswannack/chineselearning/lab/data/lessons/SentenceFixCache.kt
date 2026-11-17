package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import dev.jeromeswannack.chineselearning.lab.core.SentenceFix
import java.util.concurrent.ConcurrentHashMap

/**
 * ✨ Show a fixed version, remembered per (exercise words + task, his sentence — punctuation aside) for the app's life,
 * so a second tap (or a revisit of the same exercise) never asks again. The server caches it for everyone too
 * (web: the same map in api/lessonPractice.ts `fixMadeSentence`).
 */
object SentenceFixCache {
    private val fixes = ConcurrentHashMap<String, SentenceFix>()

    fun key(words: List<String>, task: String?, sentence: String, input: String?): String =
        listOf(words.joinToString("、"), task.orEmpty().trim(), LessonAnswers.normalizeHanzi(AnswerKey.spokenCheckAnswer(sentence, input))).joinToString("\n")

    suspend fun get(words: List<String>, task: String?, sentence: String, input: String?, fetch: suspend () -> SentenceFix): SentenceFix {
        val k = key(words, task, sentence, input)
        fixes[k]?.let { return it }
        return fetch().also { fixes[k] = it }
    }
}
