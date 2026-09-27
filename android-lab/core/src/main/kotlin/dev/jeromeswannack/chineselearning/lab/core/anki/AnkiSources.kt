package dev.jeromeswannack.chineselearning.lab.core.anki

import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.core.DescribeImageExercise
import dev.jeromeswannack.chineselearning.lab.core.DictationExercise
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.ListenChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ListenTranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.MatchExercise
import dev.jeromeswannack.chineselearning.lab.core.NoteExercise
import dev.jeromeswannack.chineselearning.lab.core.OralExpressionExercise
import dev.jeromeswannack.chineselearning.lab.core.ScrambleExercise
import dev.jeromeswannack.chineselearning.lab.core.SentenceMakingExercise
import dev.jeromeswannack.chineselearning.lab.core.SpeakExercise
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteHandwritingExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteTypedExercise
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson

/**
 * Port of frontend/src/services/anki/sources.ts — a deck, a lesson spec or a graded reader as
 * Anki notes. Pure: audio is described as an [AudioRef] that the app resolves to bytes later
 * (cache first, fetched when online), exactly like the web's media.ts.
 */
sealed interface AudioRef {
    /** An R2 object served from /api/audio/<key> (note audio, sentence clue audio). */
    data class R2(val key: String) : AudioRef

    /** Generated TTS for arbitrary text (lesson sentences, reader vocabulary). */
    data class Tts(val text: String) : AudioRef

    /** A reader page's narration (its own cache key, slower narration speed). */
    data class ReaderPage(val pageId: String, val text: String) : AudioRef
}

/** `AnkiCardProgress`: approximate scheduling state for one card. `state` is new | learning | review. */
data class AnkiCardProgress(
    val state: String,
    val intervalDays: Double,
    val ease: Double,
    val reps: Int,
    val lapses: Int,
    val dueInDays: Double,
)

/** `AnkiNote`: fields by field name (missing ones are exported empty); progress by template ordinal. */
data class AnkiNote(
    val model: String,
    val guid: String,
    val fields: Map<String, String>,
    val tags: List<String>? = null,
    val progress: Map<Int, AnkiCardProgress>? = null,
)

/** `SourceNote`: an [AnkiNote] plus where its clips come from, by field (`Audio` / `SentenceAudio`). */
data class SourceNote(
    val model: String,
    val guid: String,
    val fields: Map<String, String>,
    val tags: List<String>? = null,
    val audio: Map<String, AudioRef>? = null,
    val progress: Map<Int, AnkiCardProgress>? = null,
) {
    fun toNote(fields: Map<String, String> = this.fields) = AnkiNote(model, guid, fields, tags, progress)
}

data class AnkiSource(val deckName: String, val description: String, val notes: List<SourceNote>)

/** `DeckSourceNote` — a note as the local store holds it. */
data class DeckSourceNote(
    val id: String,
    val hanzi: String,
    val pinyin: String = "",
    val english: String = "",
    val funFacts: String? = null,
    val context: String? = null,
    val sentenceClue: String? = null,
    val sentenceCluePinyin: String? = null,
    val sentenceClueTranslation: String? = null,
    val audioUrl: String? = null,
    val sentenceClueAudioUrl: String? = null,
)

/** `DeckSourceCard` — a card's cached (event-derived) state. */
data class DeckSourceCard(
    val noteId: String,
    val cardType: String,
    val queue: Int,
    val interval: Double,
    val easeFactor: Double,
    val repetitions: Int,
    val lapses: Int,
    val nextReviewAt: String?,
)

/** `ReaderSource`. */
data class ReaderSourcePage(val id: String, val pageNumber: Int, val contentChinese: String, val contentPinyin: String, val contentEnglish: String)
data class ReaderSourceVocab(val hanzi: String, val pinyin: String, val english: String)
data class ReaderSource(
    val id: String,
    val titleChinese: String,
    val titleEnglish: String,
    val pages: List<ReaderSourcePage>,
    val vocabularyUsed: List<ReaderSourceVocab> = emptyList(),
)

object AnkiSources {
    const val APP_TAG = "chinese-learning"
    const val AUDIO = "Audio"
    const val SENTENCE_AUDIO = "SentenceAudio"
    val AUDIO_FIELDS = listOf(AUDIO, SENTENCE_AUDIO)

    private const val QUEUE_NEW = 0
    private const val QUEUE_REVIEW = 2
    private const val DAY_MS = 86_400_000.0

    /** `htmlField`: fields are HTML in Anki — escape text and keep line breaks. */
    fun htmlField(text: String?): String {
        if (text.isNullOrEmpty()) return ""
        return JsJson.trim(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\r\n", "<br>")
            .replace("\n", "<br>")
    }

    private const val CJK_PUNCTUATION = "，。！？、；：“”‘’「」『』（）《》…,.!?;:()"

    /** `isWordLike`: short (≤ 4 UTF-16 units) and unpunctuated reads as a word. */
    fun isWordLike(hanzi: String): Boolean {
        val t = JsJson.trim(hanzi)
        return t.isNotEmpty() && t.length <= 4 && t.none { it in CJK_PUNCTUATION || JsJson.isJsSpace(it) }
    }

    /** `Date.parse` for the ISO strings the store holds; NaN for anything else. */
    private fun parseDate(s: String?): Double {
        if (s.isNullOrEmpty()) return Double.NaN
        return try { Js.parseDate(s).toDouble() } catch (_: Exception) { Double.NaN }
    }

    /** `cardProgress(card, now)`. */
    fun cardProgress(card: DeckSourceCard, now: Long): AnkiCardProgress {
        val state = when (card.queue) { QUEUE_NEW -> "new"; QUEUE_REVIEW -> "review"; else -> "learning" }
        // ease_factor is a multiplier on cards (2.5); deck settings store percentages (250).
        val ease = if (card.easeFactor > 10) card.easeFactor / 100 else if (card.easeFactor == 0.0 || card.easeFactor.isNaN()) 2.5 else card.easeFactor
        val due = parseDate(card.nextReviewAt)
        val dueInDays = if (due.isFinite()) (due - now) / DAY_MS else 0.0
        val interval = if (card.interval.isNaN()) 0.0 else card.interval
        return AnkiCardProgress(state, maxOf(0.0, interval), ease, card.repetitions, card.lapses, dueInDays)
    }

    private fun truthy(s: String?) = !s.isNullOrEmpty()

    /** `deckToAnki(deck, notes, cards, { progress, now })`. */
    fun deckToAnki(
        deckName: String,
        description: String?,
        notes: List<DeckSourceNote>,
        cards: List<DeckSourceCard>,
        progress: Boolean = false,
        now: Long = System.currentTimeMillis(),
    ): AnkiSource {
        val cardsByNote = LinkedHashMap<String, MutableList<DeckSourceCard>>()
        if (progress) for (c in cards) cardsByNote.getOrPut(c.noteId) { ArrayList() }.add(c)

        val out = ArrayList<SourceNote>()
        for (note in notes) {
            if (JsJson.trim(note.hanzi).isEmpty()) continue
            val notesParts = listOf(if (truthy(note.context)) "Context: ${note.context}" else "", note.funFacts ?: "").filter { it.isNotEmpty() }
            val audio = LinkedHashMap<String, AudioRef>()
            if (truthy(note.audioUrl)) audio[AUDIO] = AudioRef.R2(note.audioUrl!!)
            if (truthy(note.sentenceClue) && truthy(note.sentenceClueAudioUrl)) audio[SENTENCE_AUDIO] = AudioRef.R2(note.sentenceClueAudioUrl!!)

            var noteProgress: Map<Int, AnkiCardProgress>? = null
            cardsByNote[note.id]?.let { noteCards ->
                val p = LinkedHashMap<Int, AnkiCardProgress>()
                for (c in noteCards) {
                    val ord = AnkiModels.CARD_TYPE_ORD[c.cardType] ?: continue
                    p[ord] = cardProgress(c, now)
                }
                noteProgress = p
            }

            out += SourceNote(
                model = AnkiModels.VOCABULARY_KEY,
                guid = AnkiHash.guidFor("note", note.id),
                fields = linkedMapOf(
                    "Hanzi" to htmlField(note.hanzi),
                    "Pinyin" to htmlField(note.pinyin),
                    "English" to htmlField(note.english),
                    "Sentence" to htmlField(note.sentenceClue),
                    "SentencePinyin" to htmlField(note.sentenceCluePinyin),
                    "SentenceEnglish" to htmlField(note.sentenceClueTranslation),
                    "Notes" to htmlField(notesParts.joinToString("\n\n")),
                    "SourceId" to "note:${note.id}",
                ),
                tags = listOf(APP_TAG, "deck"),
                audio = audio,
                progress = noteProgress,
            )
        }
        return AnkiSource(deckName, description ?: "", out)
    }

    /** `NoteCollector`: dedupes by hanzi and routes words vs sentences. */
    private class NoteCollector(private val sourceId: String, private val tags: List<String>) {
        private val seen = HashSet<String>()
        val notes = ArrayList<SourceNote>()

        fun word(hanzi: String, pinyin: String?, english: String?) {
            val h = JsJson.trim(hanzi)
            if (h.isEmpty() || !seen.add(h)) return
            notes += SourceNote(
                model = AnkiModels.VOCABULARY_KEY,
                guid = AnkiHash.guidFor("vocab", h),
                fields = linkedMapOf("Hanzi" to htmlField(h), "Pinyin" to htmlField(pinyin), "English" to htmlField(english), "SourceId" to "$sourceId:$h"),
                tags = tags,
                audio = linkedMapOf(AUDIO to AudioRef.Tts(h)),
            )
        }

        fun sentence(hanzi: String, pinyin: String?, english: String?, audio: AudioRef? = null, guid: String? = null, sourceId: String? = null) {
            val h = JsJson.trim(hanzi)
            if (h.isEmpty() || !seen.add(h)) return
            notes += SourceNote(
                model = AnkiModels.SENTENCE_KEY,
                guid = guid ?: AnkiHash.guidFor("sentence", h),
                fields = linkedMapOf("Chinese" to htmlField(h), "Pinyin" to htmlField(pinyin), "English" to htmlField(english), "SourceId" to (sourceId ?: "${this.sourceId}:$h")),
                tags = tags,
                audio = linkedMapOf(AUDIO to (audio ?: AudioRef.Tts(h))),
            )
        }

        /** Route by shape: short and unpunctuated → word, otherwise sentence. */
        fun auto(s: LessonSentence?) {
            if (s == null || s.hanzi.isEmpty()) return
            if (isWordLike(s.hanzi)) word(s.hanzi, s.pinyin, s.english) else sentence(s.hanzi, s.pinyin, s.english)
        }
    }

    /** `lessonToAnki(spec, { sourceId })`. */
    fun lessonToAnki(spec: CustomLessonSpec, sourceId: String? = null): AnkiSource {
        val c = NoteCollector("lesson:${sourceId ?: "draft"}", listOf(APP_TAG, "lesson"))
        for (section in spec.sections) {
            for (ex in section.exercises) {
                when (ex) {
                    is MatchExercise -> ex.pairs.forEach { c.word(it.hanzi, it.pinyin, it.english) }
                    is NoteExercise -> ex.sentences.orEmpty().forEach { c.auto(it) }
                    is TranslateExercise -> c.sentence(ex.referenceHanzi, ex.referencePinyin, ex.english)
                    is ScrambleExercise -> c.sentence(ex.correctOrder.joinToString(""), null, ex.english)
                    is DescribeImageExercise -> c.sentence(ex.referenceHanzi, ex.referencePinyin, ex.referenceEnglish)
                    is SpeakExercise -> ex.example?.let { c.sentence(it.hanzi, it.pinyin, it.english) }
                    is ChoiceExercise -> c.auto(ex.options.getOrNull(ex.correct))
                    is ListenChoiceExercise -> c.auto(ex.audio)
                    is ListenTranslateExercise -> c.auto(ex.audio)
                    is SentenceMakingExercise -> {
                        ex.words.forEach { c.word(it.hanzi, it.pinyin, it.english) }
                        ex.example?.let { c.sentence(it.hanzi, it.pinyin, it.english) }
                    }
                    is WriteTypedExercise -> c.auto(ex.answer)
                    is WriteHandwritingExercise -> c.auto(ex.answer)
                    is DictationExercise -> c.auto(ex.audio)
                    is OralExpressionExercise -> {
                        ex.hints.orEmpty().forEach { c.word(it.hanzi, it.pinyin, it.english) }
                        ex.example?.let { c.sentence(it.hanzi, it.pinyin, it.english) }
                    }
                    is ConversationExercise -> ex.lines.forEach { c.sentence(it.hanzi, it.pinyin, it.english) }
                    else -> Unit
                }
            }
        }
        return AnkiSource(
            deckName = "Lessons::${JsJson.trim(spec.title).ifEmpty { "Lesson" }}",
            description = spec.description ?: "",
            notes = c.notes,
        )
    }

    /** `readerToAnki(reader)`: a Sentence note per page (in page order), then the vocabulary. */
    fun readerToAnki(reader: ReaderSource): AnkiSource {
        val c = NoteCollector("reader:${reader.id}", listOf(APP_TAG, "reader"))
        for (page in reader.pages.sortedBy { it.pageNumber }) {
            c.sentence(
                page.contentChinese,
                page.contentPinyin,
                page.contentEnglish,
                AudioRef.ReaderPage(page.id, page.contentChinese),
                AnkiHash.guidFor("reader-page", reader.id, page.pageNumber.toString()),
                "reader:${reader.id}:page:${page.pageNumber}",
            )
        }
        for (v in reader.vocabularyUsed) c.word(v.hanzi, v.pinyin, v.english)
        val title = JsJson.trim(reader.titleChinese).ifEmpty { JsJson.trim(reader.titleEnglish) }.ifEmpty { "Reader" }
        return AnkiSource("Readers::$title", reader.titleEnglish, c.notes)
    }
}
