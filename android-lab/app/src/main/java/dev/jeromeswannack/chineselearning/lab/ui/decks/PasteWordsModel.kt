package dev.jeromeswannack.chineselearning.lab.ui.decks

import dev.jeromeswannack.chineselearning.lab.core.Pinyin
import dev.jeromeswannack.chineselearning.lab.core.ImportPinyin
import dev.jeromeswannack.chineselearning.lab.core.ImportPlanner
import dev.jeromeswannack.chineselearning.lab.core.WordListParser

/** The tutor's own edit of one row (null = not edited). */
data class RowEdit(
    val hanzi: String? = null,
    val pinyin: String? = null,
    val english: String? = null,
    val sentence: String? = null,
    val notes: String? = null,
)

/** What Claude filled in for one row (gloss or enrich). */
data class Suggestion(
    val pinyin: String? = null,
    val english: String? = null,
    val funFacts: String? = null,
    val sentence: String? = null,
    val sentencePinyin: String? = null,
    val sentenceTranslation: String? = null,
)

/** Which values were filled in (✨) rather than pasted or typed. */
data class Filled(val pinyin: Boolean, val english: Boolean, val notes: Boolean, val sentence: Boolean)

/** One effective row: pasted → Claude → on-device pinyin, with the tutor's edits on top. */
data class EffectiveRow(
    val key: String,
    val row: WordListParser.Row,
    val filled: Filled,
    /** A one-character word whose pinyin was filled in on the phone and that has several readings: "Check the reading: a / b". */
    val readings: List<String> = emptyList(),
)

data class PasteInputs(
    val text: String = "",
    val columnSeparator: WordListParser.ColumnSeparator = WordListParser.ColumnSeparator.AUTO,
    val customSeparator: String = "",
    val rowSeparator: WordListParser.RowSeparator = WordListParser.RowSeparator.AUTO,
    val policy: ImportPlanner.Policy = ImportPlanner.Policy.UPDATE,
    val edits: Map<String, RowEdit> = emptyMap(),
    val suggested: Map<String, Suggestion> = emptyMap(),
    val excluded: Set<String> = emptySet(),
)

data class PasteDerived(
    val parsed: WordListParser.Result,
    val rows: List<EffectiveRow>,
    val plan: List<ImportPlanner.Planned>,
    val summary: ImportPlanner.Summary,
    /** Rows that would be saved without an explanation or an example sentence. */
    val enrichable: List<ImportPlanner.Planned>,
    /** Rows Claude's gloss can help (no English, or pinyin only guessed on the phone). */
    val glossable: List<ImportPlanner.Planned>,
    val missingEnglish: Int,
    val detectedCaption: String?,
) {
    fun byIndex(i: Int): EffectiveRow? = rows.firstOrNull { it.row.index == i }
}

/**
 * The web's PasteWordsModal memo chain (`parsed` → `rows` → `plan` → `enrichable` /
 * `glossable`), pure so it is unit-tested. [autoPinyin] is the on-device reading
 * (ICU Han-Latin here, pinyin-pro on the web).
 */
object PasteWordsModel {
    private val HAN = Regex("\\p{IsHan}")

    fun rowKey(r: WordListParser.Row): String = if (WordListParser.NO_CHINESE in r.problems) "#${r.index}" else WordListParser.normalizeHanzi(r.hanzi)

    private val SEP_LABEL = mapOf(
        WordListParser.ColumnSeparator.TAB to "tab between columns",
        WordListParser.ColumnSeparator.COMMA to "commas between columns",
        WordListParser.ColumnSeparator.PIPE to "| between columns",
        WordListParser.ColumnSeparator.COLON to "\"–\" / \":\" between word and meaning",
        WordListParser.ColumnSeparator.SPACE to "spaces between word, pinyin and meaning",
        WordListParser.ColumnSeparator.CUSTOM to "your separator",
    )

    fun derive(
        inputs: PasteInputs,
        existing: List<ImportPlanner.Existing>,
        autoPinyin: (String) -> String,
        polyphonic: (String) -> List<String> = Pinyin::readings,
    ): PasteDerived {
        val parsed = WordListParser.parse(inputs.text, inputs.columnSeparator, inputs.customSeparator, inputs.rowSeparator)
        val rows = parsed.rows.map { r ->
            val key = rowKey(r)
            val edit = inputs.edits[key] ?: RowEdit()
            val sug = inputs.suggested[key] ?: Suggestion()
            val hanzi = edit.hanzi ?: r.hanzi
            val pastedPinyin = if (r.pinyin.isNotEmpty() && ImportPinyin.hasToneInfo(r.pinyin)) r.pinyin else ""
            val auto = if (hanzi.isNotEmpty() && HAN.containsMatchIn(hanzi)) autoPinyin(hanzi) else ""
            val pinyinValue = edit.pinyin ?: pastedPinyin.ifEmpty { null } ?: sug.pinyin?.ifEmpty { null } ?: r.pinyin.ifEmpty { null } ?: auto
            val englishValue = edit.english ?: r.english.ifEmpty { null } ?: sug.english ?: ""
            val notesValue = edit.notes ?: r.notes.ifEmpty { null } ?: sug.funFacts ?: ""
            val sentenceFromClaude = edit.sentence == null && r.sentence.isEmpty() && !sug.sentence.isNullOrEmpty()
            val sentenceValue = edit.sentence ?: r.sentence.ifEmpty { null } ?: sug.sentence ?: ""
            val filled = Filled(
                pinyin = edit.pinyin == null && pastedPinyin.isEmpty() && pinyinValue.isNotEmpty(),
                english = edit.english == null && r.english.isEmpty() && englishValue.isNotEmpty(),
                notes = edit.notes == null && r.notes.isEmpty() && notesValue.isNotEmpty(),
                sentence = sentenceFromClaude,
            )
            val row = r.copy(
                hanzi = hanzi,
                pinyin = pinyinValue,
                english = englishValue,
                sentence = sentenceValue,
                notes = notesValue,
                // Claude's pinyin / translation ride with Claude's sentence; a pasted or edited
                // sentence gets on-device pinyin so the card back is never bare.
                sentencePinyin = if (sentenceFromClaude) sug.sentencePinyin else if (sentenceValue.isNotEmpty() && HAN.containsMatchIn(sentenceValue)) autoPinyin(sentenceValue) else null,
                sentenceTranslation = if (sentenceFromClaude) sug.sentenceTranslation else null,
                problems = if (hanzi.isNotEmpty() && HAN.containsMatchIn(hanzi)) r.problems - WordListParser.NO_CHINESE else r.problems,
            )
            // A one-character word with several readings deserves a look.
            val readings = if (hanzi.length == 1 && filled.pinyin) polyphonic(hanzi) else emptyList()
            EffectiveRow(key, row, filled, if (readings.size > 1) readings else emptyList())
        }
        val excludedIdx = rows.filter { it.key in inputs.excluded }.map { it.row.index }.toSet()
        val plan = ImportPlanner.plan(rows.map { it.row }, existing, inputs.policy, excludedIdx)
        val filledPinyin = rows.associate { it.row.index to it.filled.pinyin }
        val enrichable = plan.filter { p ->
            if (p.action != ImportPlanner.Action.ADD && p.action != ImportPlanner.Action.UPDATE && p.action != ImportPlanner.Action.UNCHANGED) return@filter false
            if (p.row.hanzi.isEmpty() || p.row.english.isEmpty()) return@filter false
            val needsNotes = p.row.notes.isEmpty() && p.existing?.funFacts.isNullOrEmpty()
            val needsSentence = p.row.sentence.isEmpty() && p.existing?.sentenceClue.isNullOrEmpty()
            needsNotes || needsSentence
        }
        val missingEnglish = plan.count { p ->
            (p.action == ImportPlanner.Action.PROBLEM && "english" in p.missing) || (p.action == ImportPlanner.Action.ADD && p.row.english.isEmpty())
        }
        val glossable = plan
            .filter { it.action != ImportPlanner.Action.PROBLEM || it.reason == "incomplete" }
            .filter { it.row.english.isEmpty() || filledPinyin[it.row.index] == true }
        val caption = if (parsed.rows.isEmpty()) null else buildList {
            add(SEP_LABEL[parsed.detected.columnSeparator].orEmpty())
            add("${parsed.rows.size} ${if (parsed.rows.size == 1) "row" else "rows"}")
            if (parsed.detected.rowSeparator == WordListParser.RowSeparator.SEMICOLON) add("rows split at \";\"")
            if (parsed.detected.headerDropped) add("header row skipped")
        }.joinToString(" · ")
        return PasteDerived(parsed, rows, plan, ImportPlanner.summarize(plan), enrichable, glossable, missingEnglish, caption)
    }

    /** The Save button's label (the web's). */
    fun saveLabel(s: ImportPlanner.Summary): String = when {
        s.add > 0 && s.update > 0 -> "Add ${s.add} · Update ${s.update}"
        s.update > 0 -> "Update ${s.update}"
        else -> "Add ${if (s.add > 0) s.add.toString() else ""}".trim()
    }

    /** The footer line: "3 new · 1 to update · 2 need attention". */
    fun summaryLine(s: ImportPlanner.Summary): String = listOfNotNull(
        s.add.takeIf { it > 0 }?.let { "$it new" },
        s.update.takeIf { it > 0 }?.let { "$it to update" },
        s.unchanged.takeIf { it > 0 }?.let { "$it unchanged" },
        s.skipped.takeIf { it > 0 }?.let { "$it skipped" },
        s.problems.takeIf { it > 0 }?.let { "$it need attention" },
    ).joinToString(" · ")

    /** The fields an update sends: only the changes (+ the sentence's pinyin / translation). */
    fun patchFor(p: ImportPlanner.Planned): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (ch in p.changes) {
            out[ch.field] = ch.to
            if (ch.field == "sentence_clue") {
                p.row.sentencePinyin?.takeIf { it.isNotEmpty() }?.let { out["sentence_clue_pinyin"] = it }
                p.row.sentenceTranslation?.takeIf { it.isNotEmpty() }?.let { out["sentence_clue_translation"] = it }
            }
        }
        return out
    }
}
