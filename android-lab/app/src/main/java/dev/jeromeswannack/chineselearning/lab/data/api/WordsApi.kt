package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.explorer.WordRecord
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// The word dictionary (worker/src/routes/chars.ts `GET /api/words`; docs/LANGUAGE_EXPLORER.md).
// Record shape = shared/chars/types.ts `WordRecord`.

@Serializable
data class WordRecordDto(
    val hanzi: String,
    val pinyin: String = "",
    val syllables: List<String> = emptyList(),
    val english: String = "",
    val senses: List<String> = emptyList(),
    val rank: Int? = null,
) {
    fun toCore() = WordRecord(hanzi, pinyin, syllables, english, senses, rank)
}

@Serializable
data class WordRecordsResponse(val version: Int, val records: Map<String, WordRecordDto> = emptyMap(), val missing: List<String> = emptyList())

/** `GET /api/words?w=银行,学生` (≤ WORD_BATCH_MAX words) → `{ version, records, missing }`. */
suspend fun Api.wordRecords(words: List<String>): WordRecordsResponse = get("/api/words?w=${enc(words.joinToString(","))}")
