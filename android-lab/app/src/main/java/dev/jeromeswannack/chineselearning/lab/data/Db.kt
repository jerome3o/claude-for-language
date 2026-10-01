package dev.jeromeswannack.chineselearning.lab.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import dev.jeromeswannack.chineselearning.lab.core.ComputedCardState
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueDeck
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCacheEntity
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import dev.jeromeswannack.chineselearning.lab.data.platform.PlatformDao

/*
 * Local mirror of the account, like the web app's IndexedDB (frontend/src/db/database.ts).
 * Review events are the source of truth; the scheduling columns on CardEntity are a
 * cache recomputed from them (CardScheduler.computeCardState).
 */

@Entity(tableName = "decks")
data class DeckEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String?,
    val newCardsPerDay: Int,
    val secondaryCardsPerDay: Int?,
    val studyPriority: Int,
    val createdAt: String,
) {
    fun toQueueDeck() = QueueDeck(id, studyPriority, createdAt, newCardsPerDay, secondaryCardsPerDay ?: StudyQueue.DEFAULT_SECONDARY_CAP)
}

@Entity(tableName = "notes", indices = [Index("deckId")])
data class NoteEntity(
    @PrimaryKey val id: String,
    val deckId: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val audioUrl: String?,
    val funFacts: String?,
    val context: String?,
    val sentenceClue: String?,
    val sentenceCluePinyin: String?,
    val sentenceClueTranslation: String?,
    val sentenceClueAudioUrl: String?,
    /** JSON array of accepted typed answers. */
    val alternatives: String?,
    val createdAt: String?,
)

@Entity(tableName = "cards", indices = [Index("noteId"), Index("deckId")])
data class CardEntity(
    @PrimaryKey val id: String,
    val noteId: String,
    val deckId: String,
    val cardType: String,
    val queue: Int = 0,
    val stability: Double = 0.0,
    val difficulty: Double = 0.0,
    val scheduledDays: Long = 0,
    val reps: Int = 0,
    val lapses: Int = 0,
    val nextReviewAt: String? = null,
    val dueTimestamp: Long? = null,
    val lastReviewedAt: String? = null,
    val easeFactor: Double = 1.3,
) {
    fun state() = ComputedCardState(
        queue = queue, stability = stability, difficulty = difficulty, scheduledDays = scheduledDays,
        reps = reps, lapses = lapses, nextReviewAt = nextReviewAt, dueTimestamp = dueTimestamp,
        lastReviewedAt = lastReviewedAt, easeFactor = easeFactor, interval = scheduledDays,
        repetitions = reps, learningStep = 0,
    )

    fun toQueueCard() = QueueCard(id, noteId, deckId, cardType, state())

    fun withState(s: ComputedCardState) = copy(
        queue = s.queue, stability = s.stability, difficulty = s.difficulty, scheduledDays = s.scheduledDays,
        reps = s.reps, lapses = s.lapses, nextReviewAt = s.nextReviewAt, dueTimestamp = s.dueTimestamp,
        lastReviewedAt = s.lastReviewedAt, easeFactor = s.easeFactor,
    )
}

@Entity(tableName = "review_events", indices = [Index("cardId"), Index("synced"), Index(value = ["cardId", "reviewedAt"])])
data class ReviewEventEntity(
    @PrimaryKey val id: String,
    val cardId: String,
    val rating: Int,
    /** ISO string exactly as created (the FSRS replay parses it). */
    val reviewedAt: String,
    val timeSpentMs: Long?,
    val userAnswer: String?,
    val synced: Boolean,
)

@Entity(tableName = "sentences", indices = [Index("noteId")])
data class SentenceEntity(
    @PrimaryKey val id: String,
    val noteId: String,
    val position: Int,
    val hanzi: String,
    val pinyin: String?,
    val translation: String?,
    val audioUrl: String?,
    val focus: String?,
    val focusNote: String?,
)

/** A synced review the learner undid: DELETE /api/reviews/:id on the next sync. */
@Entity(tableName = "pending_deletions")
data class PendingDeletionEntity(@PrimaryKey val eventId: String)

data class FirstReview(val cardId: String, val firstAt: String)

data class DeckCount(val deckId: String, val count: Int)

/** A note's id and hanzi — what "new characters first" (core Novelty.kt) needs from every note. */
data class NoteHanzi(val id: String, val hanzi: String)

data class CardPlacement(val id: String, val noteId: String, val deckId: String)

/** The columns of a review event the FSRS replay reads. */
data class ReplayEvent(val id: String, val cardId: String, val rating: Int, val reviewedAt: String)

data class ReviewSummary(val reviews: Int, val correct: Int)

@Dao
interface LabDao {
    // decks
    @Query("SELECT * FROM decks") suspend fun decks(): List<DeckEntity>
    @Upsert suspend fun upsertDecks(decks: List<DeckEntity>)
    @Query("DELETE FROM decks") suspend fun clearDecks()
    @Query("DELETE FROM decks WHERE id IN (:ids)") suspend fun deleteDecks(ids: List<String>)

    // notes
    @Query("SELECT * FROM notes WHERE id = :id") suspend fun note(id: String): NoteEntity?
    @Query("SELECT * FROM notes WHERE id IN (:ids)") suspend fun notes(ids: List<String>): List<NoteEntity>
    @Query("SELECT * FROM notes") suspend fun allNotes(): List<NoteEntity>
    @Query("SELECT id, hanzi FROM notes") suspend fun noteHanziRows(): List<NoteHanzi>
    @Query("SELECT COUNT(*) FROM notes") suspend fun noteCount(): Int
    @Query("SELECT deckId, COUNT(*) AS count FROM notes GROUP BY deckId") suspend fun noteCounts(): List<DeckCount>
    @Upsert suspend fun upsertNotes(notes: List<NoteEntity>)
    @Query("DELETE FROM notes") suspend fun clearNotes()
    @Query("DELETE FROM notes WHERE id IN (:ids)") suspend fun deleteNotes(ids: List<String>)
    @Query("DELETE FROM notes WHERE deckId IN (:deckIds)") suspend fun deleteNotesOfDecks(deckIds: List<String>)

    // cards
    @Query("SELECT * FROM cards") suspend fun cards(): List<CardEntity>
    @Query("SELECT * FROM cards WHERE id = :id") suspend fun card(id: String): CardEntity?
    @Query("SELECT id FROM cards") suspend fun cardIds(): List<String>
    @Query("SELECT * FROM cards WHERE id IN (:ids)") suspend fun cardsByIds(ids: List<String>): List<CardEntity>
    @Query("SELECT id, noteId, deckId FROM cards") suspend fun cardPlacements(): List<CardPlacement>
    @Query("UPDATE cards SET noteId = :noteId, deckId = :deckId WHERE id = :id") suspend fun placeCard(id: String, noteId: String, deckId: String)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertCardsIfMissing(cards: List<CardEntity>)
    @Upsert suspend fun upsertCards(cards: List<CardEntity>)
    @Query("UPDATE cards SET deckId = :deckId WHERE noteId = :noteId") suspend fun moveCardsOfNote(noteId: String, deckId: String)
    @Query("DELETE FROM cards WHERE id IN (:ids)") suspend fun deleteCards(ids: List<String>)
    @Query("DELETE FROM cards WHERE noteId IN (:noteIds)") suspend fun deleteCardsOfNotes(noteIds: List<String>)
    @Query("DELETE FROM cards WHERE deckId IN (:deckIds)") suspend fun deleteCardsOfDecks(deckIds: List<String>)
    @Query("DELETE FROM cards WHERE noteId NOT IN (SELECT id FROM notes)") suspend fun deleteOrphanCards()

    // review events
    @Query("SELECT * FROM review_events WHERE cardId = :cardId ORDER BY reviewedAt, id") suspend fun eventsForCard(cardId: String): List<ReviewEventEntity>
    @Query("SELECT * FROM review_events ORDER BY cardId, reviewedAt, id") suspend fun allEvents(): List<ReviewEventEntity>
    /** The replay inputs of many cards at once, in each card's replay order (as [eventsForCard]). */
    @Query("SELECT id, cardId, rating, reviewedAt FROM review_events WHERE cardId IN (:cardIds) ORDER BY cardId, reviewedAt, id")
    suspend fun replayEventsForCards(cardIds: List<String>): List<ReplayEvent>
    @Query("SELECT * FROM review_events WHERE synced = 0 ORDER BY reviewedAt LIMIT :limit") suspend fun unsyncedEvents(limit: Int): List<ReviewEventEntity>
    @Query("SELECT COUNT(*) FROM review_events WHERE synced = 0") suspend fun unsyncedCount(): Int
    @Query("SELECT id FROM review_events WHERE id IN (:ids)") suspend fun existingEventIds(ids: List<String>): List<String>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertEvents(events: List<ReviewEventEntity>)
    @Query("UPDATE review_events SET synced = 1 WHERE id IN (:ids)") suspend fun markSynced(ids: List<String>)
    /**
     * Events the server refused (`orphan_event_ids`): `synced = -1`, like the web's `_synced = -1`.
     * Never uploaded again (`unsyncedEvents` reads `synced = 0`); the Boolean field reads it as true.
     */
    @Query("UPDATE review_events SET synced = -1 WHERE id IN (:ids)") suspend fun markRejected(ids: List<String>)
    @Query("SELECT COUNT(*) FROM review_events WHERE synced = -1") suspend fun rejectedCount(): Int
    @Query("DELETE FROM review_events WHERE id = :id") suspend fun deleteEvent(id: String)
    @Query("SELECT * FROM review_events WHERE id = :id") suspend fun event(id: String): ReviewEventEntity?
    @Query("SELECT cardId, MIN(reviewedAt) AS firstAt FROM review_events GROUP BY cardId") suspend fun firstReviews(): List<FirstReview>
    @Query("SELECT COUNT(*) FROM review_events WHERE reviewedAt >= :sinceIso") suspend fun reviewsSince(sinceIso: String): Int
    /** Today's numbers on the All done screen (docs/STUDY_SESSION.md): reviews since [sinceIso] and how many were Good / Easy. */
    @Query("SELECT COUNT(*) AS reviews, COALESCE(SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END), 0) AS correct FROM review_events WHERE reviewedAt >= :sinceIso AND synced != -1")
    suspend fun reviewSummarySince(sinceIso: String): ReviewSummary

    // sentences
    @Query("SELECT * FROM sentences WHERE noteId = :noteId ORDER BY position") suspend fun sentencesFor(noteId: String): List<SentenceEntity>
    @Query("SELECT * FROM sentences") suspend fun allSentences(): List<SentenceEntity>
    @Query("DELETE FROM sentences WHERE noteId IN (:noteIds)") suspend fun deleteSentencesOf(noteIds: List<String>)
    @Upsert suspend fun upsertSentences(sentences: List<SentenceEntity>)
    @Query("DELETE FROM sentences WHERE noteId NOT IN (SELECT id FROM notes)") suspend fun deleteOrphanSentences()

    // pending deletions
    @Query("SELECT * FROM pending_deletions") suspend fun pendingDeletions(): List<PendingDeletionEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun addPendingDeletion(p: PendingDeletionEntity)
    @Query("DELETE FROM pending_deletions WHERE eventId = :id") suspend fun removePendingDeletion(id: String)
}

@Database(
    entities = [
        DeckEntity::class, NoteEntity::class, CardEntity::class, ReviewEventEntity::class, SentenceEntity::class, PendingDeletionEntity::class,
        // v2: generic feature tables (data/platform/) — features use these instead of new schema.
        JsonCacheEntity::class, OutboxEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class LabDatabase : RoomDatabase() {
    abstract fun dao(): LabDao
    abstract fun platform(): PlatformDao

    companion object {
        fun open(context: Context): LabDatabase =
            Room.databaseBuilder(context, LabDatabase::class.java, "lab.db").addMigrations(*LabMigrations.ALL).build()
    }
}

/** note id → hanzi for StudyQueue.build's "new characters first". */
suspend fun LabDao.noteHanzi(): Map<String, String> = noteHanziRows().associate { it.id to it.hanzi }
