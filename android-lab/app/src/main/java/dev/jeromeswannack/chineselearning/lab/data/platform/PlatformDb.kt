package dev.jeromeswannack.chineselearning.lab.data.platform

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/*
 * Generic offline tables every feature shares, so a feature never needs its own
 * schema change (added in schema v2, see data/Migrations.kt):
 *
 *  - json_cache: synced feature data stored as JSON (readers, lessons, chats, stats…).
 *    Use it through JsonCache / CachedResource, never directly.
 *  - outbox: writes made offline, replayed in order during sync. Use it through Outbox.
 */

/** One cached JSON document. [key] is "<feature>/<thing>[/<id>]", [kind] the feature name. */
@Entity(tableName = "json_cache", indices = [Index("kind")])
data class JsonCacheEntity(
    @PrimaryKey val key: String,
    val kind: String,
    val json: String,
    /** Epoch ms when it was written (freshness checks). */
    val updatedAt: Long,
)

/**
 * One queued API write. Drained oldest first ([seq]); [id] is the client-generated id
 * (also the idempotency key the server dedupes on). A multipart upload carries a
 * [filePath] (+ [fileField] / [fileName] / [fileMime]); its text form fields are the
 * JSON object in [bodyJson].
 */
@Entity(tableName = "outbox", indices = [Index(value = ["id"], unique = true), Index("kind"), Index("state")])
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val id: String,
    val kind: String,
    val method: String,
    val path: String,
    val bodyJson: String?,
    val filePath: String?,
    val fileField: String?,
    val fileName: String?,
    val fileMime: String?,
    val createdAt: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
    /** [Outbox.PENDING] or [Outbox.FAILED] (gave up; kept for the UI and debug reports). */
    val state: String = Outbox.PENDING,
)

@Dao
interface PlatformDao {
    // ---- json_cache ----
    @Query("SELECT * FROM json_cache WHERE `key` = :key") suspend fun cacheEntry(key: String): JsonCacheEntity?
    @Query("SELECT * FROM json_cache WHERE `key` = :key") fun observeCacheEntry(key: String): Flow<JsonCacheEntity?>
    @Query("SELECT * FROM json_cache WHERE kind = :kind ORDER BY `key`") suspend fun cacheEntries(kind: String): List<JsonCacheEntity>
    @Query("SELECT * FROM json_cache WHERE kind = :kind ORDER BY `key`") fun observeCacheEntries(kind: String): Flow<List<JsonCacheEntity>>
    @Upsert suspend fun putCache(entries: List<JsonCacheEntity>)
    @Query("DELETE FROM json_cache WHERE `key` = :key") suspend fun deleteCache(key: String)
    @Query("DELETE FROM json_cache WHERE kind = :kind") suspend fun deleteCacheKind(kind: String)

    // ---- outbox ----
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertOutbox(item: OutboxEntity): Long
    @Query("SELECT * FROM outbox WHERE state = 'pending' ORDER BY seq LIMIT :limit") suspend fun pendingOutbox(limit: Int): List<OutboxEntity>
    @Query("SELECT COUNT(*) FROM outbox WHERE state = 'pending'") suspend fun pendingOutboxCount(): Int
    @Query("SELECT * FROM outbox ORDER BY seq") suspend fun allOutbox(): List<OutboxEntity>
    @Query("SELECT * FROM outbox ORDER BY seq") fun observeOutbox(): Flow<List<OutboxEntity>>
    @Query("SELECT * FROM outbox WHERE kind = :kind ORDER BY seq") fun observeOutboxKind(kind: String): Flow<List<OutboxEntity>>
    @Query("UPDATE outbox SET attempts = :attempts, lastError = :error, state = :state WHERE id = :id")
    suspend fun updateOutbox(id: String, attempts: Int, error: String?, state: String)
    @Query("DELETE FROM outbox WHERE id = :id") suspend fun deleteOutbox(id: String)
    @Query("UPDATE outbox SET state = 'pending', attempts = 0 WHERE state = 'failed' AND (:kind IS NULL OR kind = :kind)")
    suspend fun retryFailedOutbox(kind: String?)
    @Query("DELETE FROM outbox WHERE state = 'failed' AND (:kind IS NULL OR kind = :kind)")
    suspend fun discardFailedOutbox(kind: String?)
}
