package dev.jeromeswannack.chineselearning.lab.data

import androidx.room.Room
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import java.io.File
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The database holds UNSYNCED REVIEW EVENTS, so every schema change must be a real
 * migration that keeps them. This builds a v1 database from the exported schema
 * (schemas/…/1.json — exactly what v1 of the app created), fills it, opens it with the
 * current LabDatabase + LabMigrations.ALL (Room then validates every table against the
 * current entities and throws on any mismatch) and checks nothing was lost.
 * For a new version N: add a vNToLatest test built from N.json the same way.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class MigrationTest {
    private val name = "migration-test.db"
    private val context get() = ApplicationProvider.getApplicationContext<android.app.Application>()

    /** Creates the database exactly as schema [version] of the app did (tables, indices, Room's identity row). */
    private fun createFromExportedSchema(version: Int): SQLiteDatabase {
        val export = File("schemas/dev.jeromeswannack.chineselearning.lab.data.LabDatabase/$version.json")
        val schema = Json.parseToJsonElement(export.readText()).jsonObject.getValue("database").jsonObject
        val file = context.getDatabasePath(name).apply { parentFile?.mkdirs(); delete() }
        val db = SQLiteDatabase.openOrCreateDatabase(file, null)
        for (entity in schema.getValue("entities").jsonArray) {
            val t = entity.jsonObject
            val table = t.getValue("tableName").jsonPrimitive.content
            db.execSQL(t.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", table))
            t["indices"]?.jsonArray?.forEach { db.execSQL(it.jsonObject.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", table)) }
        }
        schema.getValue("setupQueries").jsonArray.forEach { db.execSQL(it.jsonPrimitive.content) }
        db.version = version
        return db
    }

    @Test fun v1ToV2KeepsEventsCardsAndPendingDeletionsAndIndexesFirstReviews() {
        createFromExportedSchema(1).use { db ->
            db.execSQL("INSERT INTO decks (id, name, description, newCardsPerDay, secondaryCardsPerDay, studyPriority, createdAt) VALUES ('d1', 'HSK 3', NULL, 3, 6, 5, '2026-09-01 10:00:00')")
            db.execSQL("INSERT INTO notes (id, deckId, hanzi, pinyin, english, createdAt) VALUES ('n1', 'd1', '打算', 'dǎsuàn', 'to plan', '2026-09-01 10:00:00')")
            db.execSQL(
                "INSERT INTO cards (id, noteId, deckId, cardType, queue, stability, difficulty, scheduledDays, reps, lapses, nextReviewAt, dueTimestamp, lastReviewedAt, easeFactor) " +
                    "VALUES ('c1', 'n1', 'd1', 'hanzi_to_meaning', 2, 8.5, 4.2, 8, 3, 0, '2026-09-30T08:00:00.000Z', 1790000000000, '2026-09-22T08:00:00.000Z', 2.5)",
            )
            db.execSQL("INSERT INTO review_events (id, cardId, rating, reviewedAt, timeSpentMs, userAnswer, synced) VALUES ('e1', 'c1', 2, '2026-09-20T08:00:00.000Z', 4200, NULL, 1)")
            db.execSQL("INSERT INTO review_events (id, cardId, rating, reviewedAt, timeSpentMs, userAnswer, synced) VALUES ('e2', 'c1', 3, '2026-09-22T08:00:00.000Z', 3100, '打算', 0)")
            db.execSQL("INSERT INTO sentences (id, noteId, position, hanzi) VALUES ('s1', 'n1', 0, '我打算学中文。')")
            db.execSQL("INSERT INTO pending_deletions (eventId) VALUES ('e0')")
        }

        // Opening runs MIGRATION_1_2 and validates every table against the current entities.
        val room = Room.databaseBuilder(context, LabDatabase::class.java, name)
            .addMigrations(*LabMigrations.ALL)
            .allowMainThreadQueries()
            .build()
        runBlocking {
            val dao = room.dao()
            assertEquals(listOf("e1", "e2"), dao.allEvents().map { it.id })
            assertEquals(1, dao.unsyncedCount())
            assertEquals("打算", dao.allEvents().last().userAnswer)
            val card = dao.cards().single()
            assertEquals(8.5, card.stability, 0.0)
            assertEquals(3, card.reps)
            assertEquals(listOf("e0"), dao.pendingDeletions().map { it.eventId })
            assertEquals(5, dao.decks().single().studyPriority)
            assertEquals(1, dao.noteCount())

            // The index for firstReviews exists and the query plan uses it (no temp B-tree for GROUP BY).
            val indexes = room.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'review_events'", null).use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }
            assertTrue(indexes.toString(), "index_review_events_cardId_reviewedAt" in indexes)
            val plan = room.query("EXPLAIN QUERY PLAN SELECT cardId, MIN(reviewedAt) AS firstAt FROM review_events GROUP BY cardId", null).use { c -> buildList { while (c.moveToNext()) add(c.getString(3)) } }.joinToString(" | ")
            assertTrue(plan, plan.contains("index_review_events_cardId_reviewedAt") && !plan.contains("TEMP B-TREE"))
            assertEquals(listOf("c1" to "2026-09-20T08:00:00.000Z"), dao.firstReviews().map { it.cardId to it.firstAt })

            // The new tables work.
            val cache = JsonCache(room.platform(), Json)
            cache.put("nav/test", "nav", listOf("a", "b"))
            assertEquals(listOf("a", "b"), cache.get<List<String>>("nav/test"))
            room.platform().insertOutbox(OutboxEntity(id = "o1", kind = "flags", method = "POST", path = "/api/card-flags", bodyJson = "{}", filePath = null, fileField = null, fileName = null, fileMime = null, createdAt = 1))
            assertEquals(1, room.platform().pendingOutboxCount())
        }
        room.close()
    }

    /** v3 adds notes.longTerm ("Add to my long-term review"): existing notes follow their deck (null). */
    @Test fun v2ToV3AddsTheLongTermChoiceAndKeepsEverything() {
        createFromExportedSchema(2).use { db ->
            db.execSQL("INSERT INTO decks (id, name, description, newCardsPerDay, secondaryCardsPerDay, studyPriority, createdAt) VALUES ('d1', 'Lesson 8', NULL, 0, 0, 1, '2026-09-30 10:00:00')")
            db.execSQL("INSERT INTO notes (id, deckId, hanzi, pinyin, english, createdAt) VALUES ('n1', 'd1', '刮风', 'guā fēng', 'windy', '2026-09-30 10:00:00')")
            db.execSQL("INSERT INTO cards (id, noteId, deckId, cardType, queue, stability, difficulty, scheduledDays, reps, lapses, easeFactor) VALUES ('c1', 'n1', 'd1', 'hanzi_to_meaning', 0, 0, 0, 0, 0, 0, 1.3)")
            db.execSQL("INSERT INTO review_events (id, cardId, rating, reviewedAt, timeSpentMs, userAnswer, synced) VALUES ('e1', 'c1', 2, '2026-09-30T08:00:00.000Z', 4200, NULL, 0)")
            db.execSQL("INSERT INTO outbox (id, kind, method, path, bodyJson, createdAt, attempts, state) VALUES ('o1', 'card-flag', 'POST', '/api/card-flags', '{}', 1, 0, 'pending')")
        }
        val room = Room.databaseBuilder(context, LabDatabase::class.java, name)
            .addMigrations(*LabMigrations.ALL)
            .allowMainThreadQueries()
            .build()
        runBlocking {
            val dao = room.dao()
            assertEquals(1, dao.unsyncedCount())
            assertEquals(null, dao.notes(listOf("n1")).single().longTerm)
            assertEquals(emptyMap<String, Int>(), dao.noteLongTerm())
            dao.setNoteLongTerm("n1", 1)
            assertEquals(mapOf("n1" to 1), dao.noteLongTerm())
            assertEquals(1, room.platform().pendingOutboxCount())
        }
        room.close()
    }

    /** v4 adds notes.checkIssues (word checks): existing notes have none (null); unsynced events stay. */
    @Test fun v3ToV4AddsCheckIssuesAndKeepsEverything() {
        createFromExportedSchema(3).use { db ->
            db.execSQL("INSERT INTO decks (id, name, description, newCardsPerDay, secondaryCardsPerDay, studyPriority, createdAt) VALUES ('d1', 'Lesson 9', NULL, 3, 6, 1, '2026-10-01 10:00:00')")
            db.execSQL("INSERT INTO notes (id, deckId, hanzi, pinyin, english, createdAt, longTerm) VALUES ('n1', 'd1', '一样', 'yī yàng', 'the same', '2026-10-01 10:00:00', 1)")
            db.execSQL("INSERT INTO cards (id, noteId, deckId, cardType, queue, stability, difficulty, scheduledDays, reps, lapses, easeFactor) VALUES ('c1', 'n1', 'd1', 'hanzi_to_meaning', 0, 0, 0, 0, 0, 0, 1.3)")
            db.execSQL("INSERT INTO review_events (id, cardId, rating, reviewedAt, timeSpentMs, userAnswer, synced) VALUES ('e1', 'c1', 2, '2026-10-01T08:00:00.000Z', 4200, NULL, 0)")
        }
        val room = Room.databaseBuilder(context, LabDatabase::class.java, name)
            .addMigrations(*LabMigrations.ALL)
            .allowMainThreadQueries()
            .build()
        runBlocking {
            val dao = room.dao()
            assertEquals(1, dao.unsyncedCount())
            val note = dao.notes(listOf("n1")).single()
            assertEquals(null, note.checkIssues)
            assertEquals(1, note.longTerm)
            val issues = """[{"id":"i1","field":"pinyin","kind":"tone_change","current":"yī yàng","proposed":"yí yàng","reason":"r"}]"""
            dao.upsertNotes(listOf(note.copy(checkIssues = issues)))
            assertEquals(issues, dao.notes(listOf("n1")).single().checkIssues)
        }
        room.close()
    }
}
