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
    /** The deck's folder (server decks.folder_id, migration 0105; core Folders.kt), null = Unfiled. v5. */
    val folderId: String? = null,
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
    /**
     * The learner's "Add to my long-term review" choice (core LongTerm.kt, notes.long_term):
     * 1 in, 0 out, null = follow the deck. v3.
     */
    val longTerm: Int? = null,
    /**
     * Word checks (notes.check_issues): the JSON array of possible issues — "⚠ Possible issue"
     * on the deck page (core CardCheck.parseCheckIssues / liveCheckIssues). v4.
     */
    val checkIssues: String? = null,
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

/**
 * "⚡ Study it today" (core Bumps.kt, server study_bumps): a bumped note — its cards come first in
 * today's session. One row per note (the server keeps one per user + note). [pending] = a local
 * change still on its way: "add" (POST /api/me/bumps in the Outbox as [outboxId]) or "clear"
 * (DELETE /api/me/bumps/:noteId); a pending row wins over the server list until its Outbox item has
 * gone (data/bumps/BumpStore.kt). A "clear" row is hidden from the queue at once. v6.
 */
@Entity(tableName = "study_bumps")
data class StudyBumpEntity(
    @PrimaryKey val noteId: String,
    /** The bump's id (the client id for one made here, the server's otherwise). */
    val id: String,
    /** ISO (or SQLite UTC) as the server / this phone wrote it; reviews at or after it cover a card. */
    val createdAt: String,
    val source: String,
    /** Who bumped it when it was the tutor ("⚡ from Minghui"), else null. */
    val bumpedByName: String? = null,
    val pending: String? = null,
    val outboxId: String? = null,
)

/** A synced review the learner undid: DELETE /api/reviews/:id on the next sync. */
@Entity(tableName = "pending_deletions")
data class PendingDeletionEntity(@PrimaryKey val eventId: String)

data class FirstReview(val cardId: String, val firstAt: String)

data class DeckCount(val deckId: String, val count: Int)

/** A note's id and hanzi — what "new characters first" (core Novelty.kt) needs from every note. */
data class NoteHanzi(val id: String, val hanzi: String)

data class CardPlacement(val id: String, val noteId: String, val deckId: String)

/** A note's long-term choice (only notes that have one) — StudyQueue.build's `longTerm`. */
data class NoteLongTerm(val id: String, val longTerm: Int)

/** The columns of a review event the FSRS replay reads. */
data class ReplayEvent(val id: String, val cardId: String, val rating: Int, val reviewedAt: String)

data class ReviewSummary(val reviews: Int, val correct: Int)

/** A card's first and latest review (ISO). */
data class ReviewSpan(val cardId: String, val firstAt: String, val lastAt: String)

@Dao
interface LabDao {
    // decks
    @Query("SELECT * FROM decks") suspend fun decks(): List<DeckEntity>
    @Upsert suspend fun upsertDecks(decks: List<DeckEntity>)
    @Query("DELETE FROM decks") suspend fun clearDecks()
    @Query("DELETE FROM decks WHERE id IN (:ids)") suspend fun deleteDecks(ids: List<String>)
    /** Folders (data/folders/FolderWrites.kt): a move, and a deleted folder's decks back to Unfiled. */
    @Query("UPDATE decks SET folderId = :folderId WHERE id IN (:ids)") suspend fun setDeckFolder(ids: List<String>, folderId: String?)
    @Query("UPDATE decks SET folderId = NULL WHERE folderId = :folderId") suspend fun unfileDecks(folderId: String)

    // notes
    @Query("SELECT * FROM notes WHERE id = :id") suspend fun note(id: String): NoteEntity?
    @Query("SELECT * FROM notes WHERE id IN (:ids)") suspend fun notes(ids: List<String>): List<NoteEntity>
    @Query("SELECT * FROM notes") suspend fun allNotes(): List<NoteEntity>
    @Query("SELECT id, hanzi FROM notes") suspend fun noteHanziRows(): List<NoteHanzi>
    @Query("SELECT id, longTerm FROM notes WHERE longTerm IS NOT NULL") suspend fun noteLongTermRows(): List<NoteLongTerm>
    @Query("UPDATE notes SET longTerm = :longTerm WHERE id = :id") suspend fun setNoteLongTerm(id: String, longTerm: Int?)
    /** Notes among [ids] with a card past NEW (their long-term switch is fixed: already in the reviews). */
    @Query("SELECT DISTINCT noteId FROM cards WHERE noteId IN (:ids) AND queue != 0") suspend fun startedNoteIds(ids: List<String>): List<String>
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

    // study bumps ("⚡ Study it today", data/bumps/BumpStore.kt)
    @Query("SELECT * FROM study_bumps") suspend fun studyBumps(): List<StudyBumpEntity>
    @Upsert suspend fun upsertStudyBumps(rows: List<StudyBumpEntity>)
    @Query("DELETE FROM study_bumps WHERE noteId IN (:noteIds)") suspend fun deleteStudyBumps(noteIds: List<String>)
    /** First review of each of [cardIds] and its latest (the pocket's covered-since-the-bump rule). */
    @Query("SELECT cardId, MIN(reviewedAt) AS firstAt, MAX(reviewedAt) AS lastAt FROM review_events WHERE cardId IN (:cardIds) GROUP BY cardId")
    suspend fun reviewSpans(cardIds: List<String>): List<ReviewSpan>
    @Query("SELECT * FROM cards WHERE noteId IN (:noteIds)") suspend fun cardsOfNotes(noteIds: List<String>): List<CardEntity>

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
        // v6: "⚡ Study it today".
        StudyBumpEntity::class,
    ],
    version = 6,
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

/**
 * note id → hanzi for StudyQueue.build's "new characters first"; null (= the plain order) if it
 * can't be read — an ordering nicety must never stop the queue from being built.
 */
/** note id → the learner's long-term choice, for every StudyQueue.build (core LongTerm.kt). */
suspend fun LabDao.noteLongTerm(): Map<String, Int> = noteLongTermRows().associate { it.id to it.longTerm }

suspend fun LabDao.noteHanzi(): Map<String, String>? = try {
    noteHanziRows().associate { it.id to it.hanzi }
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Throwable) {
    android.util.Log.w("LabDao", "note hanzi unavailable, plain new-card order", e)
    null
}
