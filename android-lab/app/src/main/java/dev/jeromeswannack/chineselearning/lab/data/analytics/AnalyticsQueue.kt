package dev.jeromeswannack.chineselearning.lab.data.analytics

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

/*
 * The offline queue of usage events: its OWN small Room database (analytics.db), never the
 * core mirror (lab.db holds unsynced review events and needs real migrations). Nothing in
 * here is precious — a lost queue loses a few usage events — so a schema change may simply
 * start it over (fallbackToDestructiveMigration), and the queue is capped at [MAX_QUEUED].
 */

/** One queued event: [json] is its wire form (shared/analytics/wire.ts `UsageEventInput`). */
@Entity(tableName = "usage_events")
data class UsageEventEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val id: String,
    val json: String,
    val createdAt: Long,
)

@Dao
interface UsageEventDao {
    @Insert
    suspend fun insert(row: UsageEventEntity): Long

    @Query("SELECT * FROM usage_events ORDER BY seq LIMIT :limit")
    suspend fun oldest(limit: Int): List<UsageEventEntity>

    @Query("DELETE FROM usage_events WHERE seq IN (:seqs)")
    suspend fun delete(seqs: List<Long>)

    @Query("DELETE FROM usage_events")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM usage_events")
    suspend fun count(): Int

    /** Keeps the newest [keep] rows. */
    @Query("DELETE FROM usage_events WHERE seq NOT IN (SELECT seq FROM usage_events ORDER BY seq DESC LIMIT :keep)")
    suspend fun trimTo(keep: Int)
}

@Database(entities = [UsageEventEntity::class], version = 1, exportSchema = false)
abstract class AnalyticsDatabase : RoomDatabase() {
    abstract fun events(): UsageEventDao

    companion object {
        fun open(context: Context): AnalyticsDatabase =
            Room.databaseBuilder(context, AnalyticsDatabase::class.java, "analytics.db")
                .fallbackToDestructiveMigration() // usage events only — never the study data
                .build()
    }
}

/** What [Analytics] needs from a queue (Room in the app, a list in tests). */
interface AnalyticsQueue {
    suspend fun add(id: String, json: String, now: Long)
    suspend fun oldest(limit: Int): List<UsageEventEntity>
    suspend fun remove(seqs: List<Long>)
    suspend fun clear()
    suspend fun count(): Int
}

class RoomAnalyticsQueue(private val dao: UsageEventDao) : AnalyticsQueue {
    private var adds = 0

    override suspend fun add(id: String, json: String, now: Long) {
        dao.insert(UsageEventEntity(id = id, json = json, createdAt = now))
        // Trim now and then, not on every insert.
        if (++adds % 50 == 0) dao.trimTo(MAX_QUEUED)
    }

    override suspend fun oldest(limit: Int) = dao.oldest(limit)
    override suspend fun remove(seqs: List<Long>) = seqs.chunked(500).forEach { dao.delete(it) }
    override suspend fun clear() = dao.clear()
    override suspend fun count() = dao.count()

    companion object {
        /** The newest events kept while offline for a long time. */
        const val MAX_QUEUED = 5000
    }
}
