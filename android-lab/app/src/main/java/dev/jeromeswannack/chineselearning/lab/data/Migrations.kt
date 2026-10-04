package dev.jeromeswannack.chineselearning.lab.data

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/*
 * Room schema migrations. The database holds UNSYNCED REVIEW EVENTS, so a schema
 * change is always a real Migration — never fallbackToDestructiveMigration.
 *
 * To change the schema: bump `version` in LabDatabase (Db.kt), add MIGRATION_N_N+1
 * below and append it to ALL, build once so Room exports schemas/<N+1>.json (commit
 * it), then copy the CREATE statements from that JSON into the migration and extend
 * MigrationTest. Most features need no schema change: use JsonCache / Outbox
 * (data/platform/) instead.
 */
object LabMigrations {
    /**
     * v2: the generic feature tables — json_cache (synced feature data) and outbox (offline
     * writes) — and an index on review_events(cardId, reviewedAt), which turns the per-card
     * MIN(reviewedAt) of LabDao.firstReviews (every Home / queue build) into an index scan.
     */
    val MIGRATION_1_2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("CREATE TABLE IF NOT EXISTS `json_cache` (`key` TEXT NOT NULL, `kind` TEXT NOT NULL, `json` TEXT NOT NULL, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`key`))")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_json_cache_kind` ON `json_cache` (`kind`)")
            db.execSQL("CREATE TABLE IF NOT EXISTS `outbox` (`seq` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `id` TEXT NOT NULL, `kind` TEXT NOT NULL, `method` TEXT NOT NULL, `path` TEXT NOT NULL, `bodyJson` TEXT, `filePath` TEXT, `fileField` TEXT, `fileName` TEXT, `fileMime` TEXT, `createdAt` INTEGER NOT NULL, `attempts` INTEGER NOT NULL, `lastError` TEXT, `state` TEXT NOT NULL)")
            db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_outbox_id` ON `outbox` (`id`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_outbox_kind` ON `outbox` (`kind`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_outbox_state` ON `outbox` (`state`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_review_events_cardId_reviewedAt` ON `review_events` (`cardId`, `reviewedAt`)")
        }
    }

    /**
     * v3: notes.longTerm — the learner's "Add to my long-term review" choice from a homework
     * pass (server notes.long_term, migration 0096; core LongTerm.kt). Nullable, no index.
     */
    val MIGRATION_2_3 = object : Migration(2, 3) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE `notes` ADD COLUMN `longTerm` INTEGER")
        }
    }

    /**
     * v4: notes.checkIssues — the word check's possible issues on a note (server
     * notes.check_issues, migration 0104; core CardCheck.kt). Nullable JSON text, no index.
     */
    val MIGRATION_3_4 = object : Migration(3, 4) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE `notes` ADD COLUMN `checkIssues` TEXT")
        }
    }

    /**
     * v5: decks.folderId — the deck's folder (server decks.folder_id, migration 0105; core
     * Folders.kt). Nullable (= Unfiled), no index. Organisation only: the queue ignores it.
     */
    val MIGRATION_4_5 = object : Migration(4, 5) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE `decks` ADD COLUMN `folderId` TEXT")
        }
    }

    /**
     * v6: study_bumps — "⚡ Study it today" (server study_bumps, migration 0106; core Bumps.kt):
     * one row per bumped note, with the local pending add / clear still in the Outbox.
     */
    val MIGRATION_5_6 = object : Migration(5, 6) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("CREATE TABLE IF NOT EXISTS `study_bumps` (`noteId` TEXT NOT NULL, `id` TEXT NOT NULL, `createdAt` TEXT NOT NULL, `source` TEXT NOT NULL, `bumpedByName` TEXT, `pending` TEXT, `outboxId` TEXT, PRIMARY KEY(`noteId`))")
        }
    }

    /** Every migration, oldest first. Append new ones here. */
    val ALL: Array<Migration> = arrayOf(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)
}
