package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.core.ImportPlanner
import dev.jeromeswannack.chineselearning.lab.core.WordListParser
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.EnrichWordIn
import dev.jeromeswannack.chineselearning.lab.data.api.GlossWordIn
import dev.jeromeswannack.chineselearning.lab.data.api.StudentShareDto
import dev.jeromeswannack.chineselearning.lab.data.api.deckStudentShares
import dev.jeromeswannack.chineselearning.lab.data.api.enrichWords
import dev.jeromeswannack.chineselearning.lab.data.api.glossWords
import dev.jeromeswannack.chineselearning.lab.data.api.updateStudentCopy
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.decks.NoteFields
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicInteger

enum class AiStep { IDLE, LOADING, ERROR, UNAVAILABLE }

enum class PasteStage { EDIT, RUNNING, DONE }

data class ImportOutcome(val added: Int, val updated: Int, val failed: List<Pair<String, String>>)

data class ShareState(val busy: Boolean = false, val note: String? = null)

data class PasteUi(
    val inputs: PasteInputs = PasteInputs(),
    val derived: PasteDerived? = null,
    val editing: String? = null,
    val showUnchanged: Boolean = false,
    val gloss: AiStep = AiStep.IDLE,
    val glossedText: String? = null,
    val enrich: AiStep = AiStep.IDLE,
    val enrichDone: Int = 0,
    val enrichTotal: Int = 0,
    val enrichedText: String? = null,
    val stage: PasteStage = PasteStage.EDIT,
    val progressDone: Int = 0,
    val progressTotal: Int = 0,
    val current: String? = null,
    val outcome: ImportOutcome? = null,
    val savedBare: Int = 0,
    val shares: List<StudentShareDto> = emptyList(),
    val shareState: Map<String, ShareState> = emptyMap(),
    val online: Boolean = true,
    val deckName: String = "",
) {
    val canSave: Boolean get() = stage == PasteStage.EDIT && online && (derived?.summary?.let { it.add > 0 || it.update > 0 } == true)
}

/**
 * "Paste a list" (web: components/import/PasteWordsModal.tsx + services/wordImport.ts): parse
 * and plan on the phone (core/Import.kt, parity-tested), fill gaps with Claude, write
 * explanations with Claude, then save one request per row (3 in flight), per-row failures
 * reported, and offer a tutor "Update their copy" per student.
 */
class PasteWordsViewModel(
    private val env: DecksEnv,
    private val deckId: String,
    private val autoPinyin: (String) -> String,
) : ViewModel() {
    private val _ui = MutableStateFlow(PasteUi())
    val ui: StateFlow<PasteUi> = _ui
    private var existing: List<ImportPlanner.Existing> = emptyList()

    init {
        viewModelScope.launch { env.online.collect { on -> _ui.update { it.copy(online = on) } } }
        viewModelScope.launch {
            val (notes, name) = withContext(Dispatchers.IO) {
                env.dao.allNotes().filter { it.deckId == deckId } to (env.dao.decks().firstOrNull { it.id == deckId }?.name ?: "")
            }
            existing = notes.map { ImportPlanner.Existing(it.id, it.hanzi, it.pinyin, it.english, it.funFacts, it.sentenceClue) }
            _ui.update { it.copy(deckName = name) }
            recompute()
        }
        loadShares()
    }

    private fun recompute() {
        val inputs = _ui.value.inputs
        _ui.update { it.copy(derived = PasteWordsModel.derive(inputs, existing, autoPinyin)) }
    }

    private fun setInputs(transform: (PasteInputs) -> PasteInputs) {
        _ui.update { it.copy(inputs = transform(it.inputs)) }
        recompute()
    }

    fun setText(t: String) = setInputs { it.copy(text = t) }

    fun setColumnSeparator(s: WordListParser.ColumnSeparator) = setInputs { it.copy(columnSeparator = s) }

    fun setCustomSeparator(s: String) = setInputs {
        it.copy(customSeparator = s, columnSeparator = if (s.isNotEmpty()) WordListParser.ColumnSeparator.CUSTOM else WordListParser.ColumnSeparator.AUTO)
    }

    fun setRowSeparator(s: WordListParser.RowSeparator) = setInputs { it.copy(rowSeparator = s) }

    fun setPolicy(p: ImportPlanner.Policy) = setInputs { it.copy(policy = p) }

    fun edit(key: String, patch: (RowEdit) -> RowEdit) = setInputs { i -> i.copy(edits = i.edits + (key to patch(i.edits[key] ?: RowEdit()))) }

    fun toggleExcluded(key: String) = setInputs { i -> i.copy(excluded = if (key in i.excluded) i.excluded - key else i.excluded + key) }

    fun toggleEditing(key: String) = _ui.update { it.copy(editing = if (it.editing == key) null else key) }

    fun toggleUnchanged() = _ui.update { it.copy(showUnchanged = !it.showUnchanged) }

    private fun aiFailure(e: Throwable): AiStep =
        if ((e is HttpException && e.code == 503) || e.message.orEmpty().contains("not configured", ignoreCase = true)) AiStep.UNAVAILABLE else AiStep.ERROR

    /** ✨ Fill in English (and check the guessed pinyin) with Claude — one call, ≤100 words. */
    fun fillWithClaude() {
        val d = _ui.value.derived ?: return
        val targets = d.glossable.take(100)
        if (targets.isEmpty()) return
        val text = _ui.value.inputs.text
        _ui.update { it.copy(gloss = AiStep.LOADING) }
        viewModelScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    env.api.glossWords(
                        targets.map { p ->
                            GlossWordIn(p.row.hanzi, if (d.byIndex(p.row.index)?.filled?.pinyin == true) null else p.row.pinyin.ifEmpty { null }, p.row.english.ifEmpty { null })
                        },
                    )
                }
                val sug = _ui.value.inputs.suggested.toMutableMap()
                for (w in result) {
                    val target = targets.firstOrNull { WordListParser.normalizeHanzi(it.row.hanzi) == WordListParser.normalizeHanzi(w.hanzi) } ?: continue
                    val key = PasteWordsModel.rowKey(target.row)
                    val prev = sug[key] ?: Suggestion()
                    sug[key] = prev.copy(pinyin = w.pinyin.ifEmpty { prev.pinyin }, english = w.english.ifEmpty { prev.english })
                }
                setInputs { it.copy(suggested = sug) }
                env.fx.success()
                _ui.update { it.copy(gloss = AiStep.IDLE, glossedText = text) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(gloss = aiFailure(e)) }
            }
        }
    }

    /** ✨ Write explanations & example sentences with Claude, [ENRICH_CHUNK] words per call. */
    fun writeWithClaude() {
        val d = _ui.value.derived ?: return
        val targets = d.enrichable.take(ENRICH_MAX)
        if (targets.isEmpty()) return
        val text = _ui.value.inputs.text
        _ui.update { it.copy(enrich = AiStep.LOADING, enrichDone = 0, enrichTotal = targets.size) }
        viewModelScope.launch {
            try {
                for (chunk in targets.chunked(ENRICH_CHUNK)) {
                    val result = withContext(Dispatchers.IO) {
                        env.api.enrichWords(
                            chunk.map { p ->
                                EnrichWordIn(
                                    p.row.hanzi, p.row.pinyin.ifEmpty { null }, p.row.english.ifEmpty { null },
                                    p.row.notes.ifEmpty { null } ?: p.existing?.funFacts?.ifEmpty { null },
                                    p.row.sentence.ifEmpty { null } ?: p.existing?.sentenceClue?.ifEmpty { null },
                                )
                            },
                        )
                    }
                    val sug = _ui.value.inputs.suggested.toMutableMap()
                    for (w in result) {
                        val t = chunk.firstOrNull { WordListParser.normalizeHanzi(it.row.hanzi) == WordListParser.normalizeHanzi(w.hanzi) } ?: continue
                        val key = PasteWordsModel.rowKey(t.row)
                        val cur = sug[key] ?: Suggestion()
                        val needsNotes = t.row.notes.isEmpty() && t.existing?.funFacts.isNullOrEmpty()
                        val needsSentence = t.row.sentence.isEmpty() && t.existing?.sentenceClue.isNullOrEmpty()
                        val newSentence = needsSentence && !w.sentence_clue.isNullOrEmpty()
                        sug[key] = cur.copy(
                            funFacts = if (needsNotes && !w.fun_facts.isNullOrEmpty()) w.fun_facts else cur.funFacts,
                            sentence = if (newSentence) w.sentence_clue else cur.sentence,
                            sentencePinyin = if (newSentence) w.sentence_clue_pinyin?.ifEmpty { null } else cur.sentencePinyin,
                            sentenceTranslation = if (newSentence) w.sentence_clue_translation?.ifEmpty { null } else cur.sentenceTranslation,
                        )
                    }
                    setInputs { it.copy(suggested = sug) }
                    _ui.update { it.copy(enrichDone = minOf(it.enrichDone + chunk.size, targets.size)) }
                }
                env.fx.success()
                _ui.update { it.copy(enrich = AiStep.IDLE, enrichedText = text) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(enrich = aiFailure(e)) }
            }
        }
    }

    /** Save: one request per row through the normal note endpoints, 3 in flight. */
    fun save(onImported: (ImportOutcome) -> Unit = {}) {
        val d = _ui.value.derived ?: return
        if (!_ui.value.canSave) return
        val work = d.plan.filter { it.action == ImportPlanner.Action.ADD || it.action == ImportPlanner.Action.UPDATE }
        val bare = work.count { it.row.notes.isEmpty() && it.existing?.funFacts.isNullOrEmpty() }
        _ui.update { it.copy(stage = PasteStage.RUNNING, progressDone = 0, progressTotal = work.size, savedBare = bare) }
        viewModelScope.launch {
            val done = AtomicInteger()
            val added = AtomicInteger()
            val updated = AtomicInteger()
            val failed = java.util.Collections.synchronizedList(ArrayList<Pair<String, String>>())
            val gate = Semaphore(CONCURRENCY)
            work.map { p ->
                async {
                    gate.withPermit {
                        _ui.update { it.copy(current = p.row.hanzi) }
                        val r = p.row
                        val result = if (p.action == ImportPlanner.Action.ADD) {
                            env.writes.createNote(
                                deckId,
                                NoteFields(
                                    r.hanzi, r.pinyin, r.english, funFacts = r.notes, sentenceClue = r.sentence,
                                    sentenceCluePinyin = if (r.sentence.isNotEmpty()) r.sentencePinyin.orEmpty() else "",
                                    sentenceClueTranslation = if (r.sentence.isNotEmpty()) r.sentenceTranslation.orEmpty() else "",
                                ),
                            ).map { added.incrementAndGet() }
                        } else {
                            env.writes.patchNote(p.existing!!.id, PasteWordsModel.patchFor(p)).map { updated.incrementAndGet() }
                        }
                        result.exceptionOrNull()?.let { failed += r.hanzi to (it.message ?: it.userMessage()) }
                        val n = done.incrementAndGet()
                        _ui.update { it.copy(progressDone = n) }
                    }
                }
            }.awaitAll()
            val outcome = ImportOutcome(added.get(), updated.get(), failed.toList())
            dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("deck.paste_list", mapOf("added" to outcome.added, "updated" to outcome.updated, "skipped" to d.plan.size - work.size, "failed" to failed.size))
            if (outcome.added + outcome.updated > 0) env.fx.success() else if (failed.isNotEmpty()) env.fx.failure()
            _ui.update { it.copy(stage = PasteStage.DONE, outcome = outcome, current = null) }
            env.requestSync()
            onImported(outcome)
            loadShares()
        }
    }

    // ---------------- students' copies (tutors) ----------------

    private fun loadShares() {
        if (!env.online.value) return
        viewModelScope.launch {
            val shares = runCatching { withContext(Dispatchers.IO) { env.api.deckStudentShares(deckId) } }.getOrDefault(emptyList())
            _ui.update { it.copy(shares = shares) }
        }
    }

    fun updateShare(s: StudentShareDto) {
        _ui.update { it.copy(shareState = it.shareState + (s.shared_deck_id to ShareState(busy = true))) }
        viewModelScope.launch {
            val note = try {
                val r = withContext(Dispatchers.IO) { env.api.updateStudentCopy(s.relationship_id, s.shared_deck_id) }
                val parts = listOfNotNull(r.added.takeIf { it > 0 }?.let { "added $it" }, r.updated.takeIf { it > 0 }?.let { "updated $it" })
                env.fx.success()
                if (parts.isNotEmpty()) "${parts.joinToString(", ")} — their progress is kept" else "Already up to date"
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                e.userMessage()
            }
            _ui.update { it.copy(shareState = it.shareState + (s.shared_deck_id to ShareState(busy = false, note = note))) }
            loadShares()
        }
    }

    class Factory(private val env: DecksEnv, private val deckId: String, private val autoPinyin: (String) -> String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = PasteWordsViewModel(env, deckId, autoPinyin) as T
    }

    companion object {
        const val ENRICH_CHUNK = 15
        const val ENRICH_MAX = 150
        const val CONCURRENCY = 3
    }
}
