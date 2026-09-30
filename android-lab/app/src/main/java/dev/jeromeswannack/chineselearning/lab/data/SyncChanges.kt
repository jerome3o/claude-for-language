package dev.jeromeswannack.chineselearning.lab.data

import dev.jeromeswannack.chineselearning.lab.core.GhostDecks
import dev.jeromeswannack.chineselearning.lab.data.decks.DeckWrites

/**
 * One `GET /api/sync/changes` response written into the Room mirror (call inside a
 * transaction). Port of the web's `_doIncrementalSync` (frontend/src/services/sync.ts).
 */
object SyncChanges {
    /**
     * Notes the response places in a deck that is not deleted in the same response (and
     * that are not deleted themselves) — port of the web's `movedToLiveDecks`.
     */
    fun movedToLiveDecks(changes: ChangesDto): Set<String> {
        val deadDecks = changes.deleted.deck_ids.toHashSet()
        val deadNotes = changes.deleted.note_ids.toHashSet()
        return changes.notes.filter { it.deck_id !in deadDecks && it.id !in deadNotes }.mapTo(HashSet()) { it.id }
    }

    /** Returns the ids of decks removed as ghosts (for the log). */
    suspend fun apply(dao: LabDao, changes: ChangesDto): List<String> {
        // Words moved out of a deck that is deleted in the same response (merge into Core,
        // then delete the old deck — 27 Sep): place them in their new deck BEFORE the
        // tombstones run, or the deck delete takes their cards with it for good (the
        // response only carries cards whose own row changed).
        val spared = movedToLiveDecks(changes)
        val placed = changes.notes.filter { it.id in spared }.map(DeckWrites::noteEntity)
        if (placed.isNotEmpty()) {
            dao.upsertNotes(placed)
            placed.forEach { dao.moveCardsOfNote(it.id, it.deckId) }
        }

        val deckIds = changes.deleted.deck_ids
        if (deckIds.isNotEmpty()) deckIds.chunked(500).forEach {
            dao.deleteCardsOfDecks(it); dao.deleteNotesOfDecks(it); dao.deleteDecks(it)
        }
        val noteIds = changes.deleted.note_ids
        if (noteIds.isNotEmpty()) noteIds.chunked(500).forEach {
            dao.deleteCardsOfNotes(it); dao.deleteSentencesOf(it); dao.deleteNotes(it)
        }
        if (changes.deleted.card_ids.isNotEmpty()) changes.deleted.card_ids.chunked(500).forEach { dao.deleteCards(it) }
        // Decks the server no longer has but never tombstoned (deleted before tombstones
        // existed): an incremental sync would otherwise keep them forever.
        val ghosts = changes.live_deck_ids?.let { live ->
            GhostDecks.find(dao.decks().map { GhostDecks.LocalDeck(it.id, it.createdAt) }, live, changes.live_deck_ids_at)
        }.orEmpty()
        ghosts.chunked(500).forEach { dao.deleteCardsOfDecks(it); dao.deleteNotesOfDecks(it); dao.deleteDecks(it) }

        // Nothing deleted above comes back from this same response.
        val deadDecks = (deckIds + ghosts).toHashSet()
        val deadNotes = noteIds.toHashSet()
        dao.upsertDecks(changes.decks.filter { it.id !in deadDecks }.map(DeckWrites::deckEntity))
        val notes = changes.notes.filter { it.id !in deadNotes && it.deck_id !in deadDecks }.map(DeckWrites::noteEntity)
        dao.upsertNotes(notes)
        notes.forEach { dao.moveCardsOfNote(it.id, it.deckId) }
        val deckOfNote = HashMap<String, String>()
        changes.cards.map { it.note_id }.distinct().chunked(500).forEach { ids -> dao.notes(ids).forEach { deckOfNote[it.id] = it.deckId } }
        val newCards = changes.cards.mapNotNull { c -> deckOfNote[c.note_id]?.let { CardEntity(c.id, c.note_id, it, c.card_type) } }
        newCards.chunked(500).forEach { dao.insertCardsIfMissing(it) }
        dao.deleteOrphanSentences()
        return ghosts
    }
}
