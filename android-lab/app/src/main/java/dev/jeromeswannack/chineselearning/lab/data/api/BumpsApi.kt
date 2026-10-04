package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// "⚡ Study it today" — the bump pocket (worker/src/routes/study-bumps.ts, shared/decks/bumps.ts;
// data/bumps/BumpStore.kt). `/api/sync/changes` carries the same active list as `bumps`.

/** An active bump (not cleared, not done). `created_at` is ISO or SQLite UTC ('YYYY-MM-DD HH:MM:SS'). */
@Serializable
data class StudyBumpDto(
    val id: String,
    val note_id: String,
    val created_at: String,
    val source: String? = null,
    val bumped_by: String? = null,
    /** Set only when a tutor bumped it ("⚡ from Minghui"). */
    val bumped_by_name: String? = null,
    val hanzi: String? = null,
    val pinyin: String? = null,
    val english: String? = null,
    val deck_id: String? = null,
    val deck_name: String? = null,
)

@Serializable data class StudyBumpsDto(val bumps: List<StudyBumpDto> = emptyList())

/** One bump made on this phone: the client id makes the POST idempotent, so it can wait in the Outbox. */
@Serializable data class BumpItemBody(val id: String, val note_id: String, val created_at: String, val source: String)

@Serializable data class BumpBody(val items: List<BumpItemBody>)

/** `GET /api/me/bumps` — the account's active bumps (a full sync; incremental ones get them in /sync/changes). */
suspend fun Api.studyBumps(): List<StudyBumpDto> = get<StudyBumpsDto>("/api/me/bumps").bumps
