package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// The character dictionary (worker/src/routes/chars.ts; web frontend/src/api/client.ts
// fetchCharRecord / fetchCharRecords / fetchCharExplanation). Record shape = shared/chars/types.ts.

@Serializable
data class CharWordDto(val hanzi: String, val pinyin: String = "", val english: String = "")

@Serializable
data class CharReadingDto(val pinyin: String, val english: String = "")

@Serializable
data class CharComponentDto(val char: String, val meaning: String? = null)

@Serializable
data class CharRecordDto(
    val char: String,
    val readings: List<CharReadingDto> = emptyList(),
    val meaning: String = "",
    val radical: String? = null,
    val radical_meaning: String? = null,
    val decomposition: String? = null,
    val components: List<CharComponentDto> = emptyList(),
    val etymology: String? = null,
    val strokes: Int? = null,
    val rank: Int? = null,
    val words: List<CharWordDto> = emptyList(),
)

@Serializable
data class CharRecordResponse(val version: Int, val record: CharRecordDto)

@Serializable
data class CharRecordsResponse(val version: Int, val records: Map<String, CharRecordDto> = emptyMap(), val missing: List<String> = emptyList())

@Serializable
data class CharExplanationResponse(val char: String, val explanation: String, val cached: Boolean = false)

/** `GET /api/chars/:char` → `{ version, record }` (404 when the dictionary lacks it). */
suspend fun Api.charRecord(char: String): CharRecordResponse = get("/api/chars/${enc(char)}")

/** `GET /api/chars?c=<chars>` (≤ CHAR_BATCH_MAX characters) → `{ version, records, missing }`. */
suspend fun Api.charRecords(chars: String): CharRecordsResponse = get("/api/chars?c=${enc(chars)}")

/** `POST /api/chars/:char/explain` → one short explanation shared by everyone (503 = no AI key). */
suspend fun Api.charExplanation(char: String): CharExplanationResponse = post("/api/chars/${enc(char)}/explain")
