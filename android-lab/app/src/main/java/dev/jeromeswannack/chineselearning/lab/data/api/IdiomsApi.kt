package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomRecord
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomSummary
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/* 成语 Idioms (beta) — the same endpoints as the web's api/idioms.ts (worker routes/idioms.ts). */

@Serializable
data class IdiomListDto(val starter: List<IdiomSummary> = emptyList(), val more: List<IdiomSummary> = emptyList())

@Serializable
data class IdiomResponseDto(val idiom: IdiomRecord)

@Serializable
data class IdiomRequestBody(val hanzi: String, val retry: Boolean = false)

/** `GET /api/idioms` — the starter list (with each entry's status) + idioms others looked up. */
suspend fun Api.idiomList(): IdiomListDto = get("/api/idioms")

/** `GET /api/idioms/:hanzi` — the row (status `missing` when never asked for). */
suspend fun Api.idiom(hanzi: String): IdiomRecord = get<IdiomResponseDto>("/api/idioms/${enc(hanzi)}").idiom

/** `POST /api/idioms` — get-or-generate (status `generating` while Claude writes it). */
suspend fun Api.requestIdiom(hanzi: String, retry: Boolean = false): IdiomRecord =
    post<IdiomRequestBody, IdiomResponseDto>("/api/idioms", IdiomRequestBody(hanzi, retry)).idiom
