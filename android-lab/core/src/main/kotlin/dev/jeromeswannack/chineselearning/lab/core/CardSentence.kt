package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/study/cardSentence.ts, parity-tested (parity/fixtures/card-sentence.ts → CardSentenceParityTest).
 * docs/STUDY_SESSION.md "Example sentences — one model".
 *
 * The card's own example sentence is ONE OF the note's example sentence rows: id `<note id>-card`, `is_card`,
 * position −1 (migration 0154). Every reader treats it like any other row; "From the card" is a badge from
 * [isCardRow]. While a device holds a note newer than its rows (it synced notes before the migration, or the
 * learner just edited the sentence), [withCardSentence] makes the card row from the note's deprecated
 * `sentence_clue*` fields — the ONLY place the app reads them for display.
 */
object CardSentence {
    const val SUFFIX = "-card"
    /** The legacy practice-history key of the card sentence (events written before migration 0154). */
    const val LEGACY_KEY = "clue"
    private const val LEGACY_ROW_PREFIX = "clue:"

    /** `cardSentenceId` */
    fun id(noteId: String): String = "$noteId$SUFFIX"

    /** `isCardSentenceKey`: `<note>-card`, or a legacy `clue:<note>` / `clue`. */
    fun isCardKey(key: String): Boolean = key.endsWith(SUFFIX) || key.startsWith(LEGACY_ROW_PREFIX) || key == LEGACY_KEY

    /** `canonicalSentenceKey`: the row id; a legacy `clue` / `clue:<noteId>` → the note's card row id. */
    fun canonicalKey(key: String, noteId: String): String = when {
        key == LEGACY_KEY -> id(noteId)
        key.startsWith(LEGACY_ROW_PREFIX) -> id(key.removePrefix(LEGACY_ROW_PREFIX).ifEmpty { noteId })
        else -> key
    }

    /** One sentence row as the helpers need it. */
    data class Row(
        val id: String,
        val noteId: String,
        val position: Int,
        val hanzi: String,
        val pinyin: String? = null,
        val translation: String? = null,
        val audioUrl: String? = null,
        val focus: String? = null,
        val focusNote: String? = null,
        val explanation: String? = null,
        val isCard: Boolean = false,
    )

    /**
     * The note's card-sentence fields. [hasField] = false: the device has no note to compare with (trust the
     * rows); [clue] null / blank with [hasField] = the note has no card sentence.
     */
    data class NoteFields(
        val id: String,
        val clue: String?,
        val pinyin: String? = null,
        val translation: String? = null,
        val audioUrl: String? = null,
        val hasField: Boolean = true,
    )

    /** `isCardSentenceRow` */
    fun isCardRow(row: Row): Boolean = row.isCard || row.id.endsWith(SUFFIX)

    private fun blank(s: String?): String? = s?.let { AnswerKey.jsTrim(it) }?.takeIf { it.isNotEmpty() }

    /**
     * `withCardSentence`: the note's rows as ONE list, the card's own first — the stored card row, or one made
     * from the note while the device has none / holds an older text; a set row repeating the card sentence is
     * dropped; the rest keep their stored order (by position, stable).
     */
    fun withCardSentence(note: NoteFields?, rows: List<Row>): List<Row> {
        val sorted = rows.withIndex().sortedWith(compareBy<IndexedValue<Row>> { it.value.position }.thenBy { it.index }).map { it.value }
        val stored = sorted.firstOrNull { isCardRow(it) }
        val hasField = note != null && note.hasField
        val noteText = if (hasField) blank(note!!.clue) else null
        val card: Row? = when {
            hasField && noteText != null && (stored == null || AnswerKey.jsTrim(stored.hanzi) != noteText) -> Row(
                id = id(note!!.id), noteId = note.id, position = -1, hanzi = noteText,
                pinyin = blank(note.pinyin), translation = blank(note.translation), audioUrl = blank(note.audioUrl),
                isCard = true,
            )
            hasField && noteText == null -> null
            stored != null && hasField -> stored.copy(
                pinyin = stored.pinyin ?: blank(note!!.pinyin),
                translation = stored.translation ?: blank(note!!.translation),
                audioUrl = stored.audioUrl ?: blank(note!!.audioUrl),
            )
            else -> stored
        }
        val cardText = card?.let { AnswerKey.jsTrim(it.hanzi) }
        val rest = sorted.filter { !isCardRow(it) && !(cardText != null && AnswerKey.jsTrim(it.hanzi) == cardText) }
        return if (card != null) listOf(card) + rest else rest
    }
}
