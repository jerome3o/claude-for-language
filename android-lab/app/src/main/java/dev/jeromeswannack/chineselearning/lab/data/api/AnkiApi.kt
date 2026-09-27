package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The one read the Anki export needs beyond the local store: a deck that was never synced to
// this device, as the web's `getDeck(deckId)` fallback in services/anki/index.ts.

@Serializable
data class AnkiDeckCardDto(
    @SerialName("card_type") val cardType: String = "",
    val queue: Int = 0,
    val interval: Double = 0.0,
    @SerialName("ease_factor") val easeFactor: Double = 0.0,
    val repetitions: Int = 0,
    val lapses: Int = 0,
    @SerialName("next_review_at") val nextReviewAt: String? = null,
)

@Serializable
data class AnkiDeckNoteDto(
    val id: String,
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    @SerialName("fun_facts") val funFacts: String? = null,
    val context: String? = null,
    @SerialName("sentence_clue") val sentenceClue: String? = null,
    @SerialName("sentence_clue_pinyin") val sentenceCluePinyin: String? = null,
    @SerialName("sentence_clue_translation") val sentenceClueTranslation: String? = null,
    @SerialName("audio_url") val audioUrl: String? = null,
    @SerialName("sentence_clue_audio_url") val sentenceClueAudioUrl: String? = null,
    val cards: List<AnkiDeckCardDto> = emptyList(),
)

@Serializable
data class AnkiDeckDto(val id: String, val name: String = "", val description: String? = null, val notes: List<AnkiDeckNoteDto> = emptyList())

/** `GET /api/decks/:id` — the deck with its notes and their cards. */
suspend fun Api.deckWithNotes(id: String): AnkiDeckDto = get("/api/decks/${enc(id)}")
