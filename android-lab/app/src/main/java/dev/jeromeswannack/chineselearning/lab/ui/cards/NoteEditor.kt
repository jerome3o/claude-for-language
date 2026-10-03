package dev.jeromeswannack.chineselearning.lab.ui.cards

import dev.jeromeswannack.chineselearning.lab.data.decks.NoteFields
import dev.jeromeswannack.chineselearning.lab.data.decks.WriteOutcome
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksEnv
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The card editor's state + writes, shared by every screen that edits a note (the deck
 * page, the Decks tab search, the card hub; the study card can reuse it). Owns the open
 * sheet ([state]) and the "move to…" picker ([moving]).
 */
class NoteEditor(private val env: DecksEnv, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow<NoteEditUi?>(null)
    val state: StateFlow<NoteEditUi?> = _state

    /** Note ids waiting for a deck pick. */
    private val _moving = MutableStateFlow<List<String>?>(null)
    val moving: StateFlow<List<String>?> = _moving

    private var addToDeck: String? = null

    /** Called after a save / delete / move landed (Saved or Queued) with a short confirmation. */
    var onDone: (String) -> Unit = {}

    /**
     * Called after a word was added or edited ON THE SERVER (not queued offline): the deck page
     * asks "Also update their copies?" (docs/HOMEWORK.md §10). [deckId] = the word's deck.
     */
    var onWordSaved: (deckId: String?) -> Unit = {}

    fun openEdit(noteId: String) {
        scope.launch {
            val n = withContext(Dispatchers.IO) { env.dao.note(noteId) } ?: return@launch
            addToDeck = null
            _state.value = NoteEditUi(noteId, NoteFields.of(n), hasAudio = n.audioUrl != null, online = env.online.value)
        }
    }

    fun openAdd(deckId: String) {
        addToDeck = deckId
        _state.value = NoteEditUi(null, NoteFields("", "", ""), online = env.online.value)
    }

    fun close() {
        _state.value = null
    }

    fun save(f: NoteFields) {
        val s = _state.value ?: return
        _state.update { it?.copy(busy = true, error = null, info = null) }
        scope.launch {
            val id = s.noteId
            if (id == null) {
                val deckId = addToDeck ?: return@launch
                env.writes.createNote(deckId, f).fold(
                    onSuccess = { env.fx.success(); close(); onDone("Added ${it.hanzi} — audio is on its way"); onWordSaved(deckId) },
                    onFailure = { e -> env.fx.failure(); _state.update { it?.copy(busy = false, error = e.message) } },
                )
                return@launch
            }
            when (val o = env.writes.updateNote(id, f)) {
                WriteOutcome.Saved -> { env.fx.success(); close(); onDone("Saved"); onWordSaved(null) }
                WriteOutcome.Queued -> { env.fx.success(); close(); onDone("Saved on this phone — it goes to the server when you're back online.") }
                is WriteOutcome.Refused -> { env.fx.failure(); _state.update { it?.copy(busy = false, error = o.message) } }
            }
        }
    }

    fun delete() {
        val id = _state.value?.noteId ?: return
        _state.update { it?.copy(busy = true, error = null) }
        scope.launch {
            when (val o = env.writes.deleteNote(id)) {
                is WriteOutcome.Refused -> _state.update { it?.copy(busy = false, error = o.message) }
                else -> { env.fx.tick(); close(); onDone("Deleted") }
            }
        }
    }

    fun generateAudio() {
        val id = _state.value?.noteId ?: return
        _state.update { it?.copy(busy = true, error = null) }
        scope.launch {
            env.writes.generateAudio(id).fold(
                onSuccess = { n -> env.fx.success(); _state.update { it?.copy(busy = false, hasAudio = n.audio_url != null, info = null) } },
                onFailure = { e -> _state.update { it?.copy(busy = false, error = e.message) } },
            )
        }
    }

    /** ✨ A new example sentence from Claude; the form reloads with the note's other fields kept as typed. */
    fun generateSentence(current: NoteFields? = null) {
        val s = _state.value ?: return
        val id = s.noteId ?: return
        _state.update { it?.copy(busy = true, error = null) }
        scope.launch {
            env.writes.generateSentence(id).fold(
                onSuccess = { n ->
                    val base = current ?: s.initial
                    _state.update {
                        it?.copy(
                            busy = false,
                            revision = it.revision + 1,
                            initial = base.copy(
                                sentenceClue = n.sentence_clue.orEmpty(),
                                sentenceCluePinyin = n.sentence_clue_pinyin.orEmpty(),
                                sentenceClueTranslation = n.sentence_clue_translation.orEmpty(),
                            ),
                        )
                    }
                },
                onFailure = { e -> _state.update { it?.copy(busy = false, error = e.message) } },
            )
        }
    }

    /** Where the notes being moved can go: (id, name) in queue order, and the deck they're all in now. */
    data class MoveTargets(val decks: List<Pair<String, String>>, val currentDeckId: String?)

    private val _targets = MutableStateFlow(MoveTargets(emptyList(), null))
    val targets: StateFlow<MoveTargets> = _targets

    fun startMove(noteIds: List<String>) {
        scope.launch {
            _targets.value = withContext(Dispatchers.IO) {
                val decks = dev.jeromeswannack.chineselearning.lab.core.Budget.sortForQueue(env.dao.decks(), { it.studyPriority }, { it.createdAt })
                val from = env.dao.notes(noteIds).map { it.deckId }.distinct().singleOrNull()
                MoveTargets(decks.map { it.id to it.name }, from)
            }
            _moving.value = noteIds
        }
    }

    /** ▶ the word being edited: its clip, or the phone's voice. */
    fun play() {
        val s = _state.value ?: return
        scope.launch {
            val n = s.noteId?.let { withContext(Dispatchers.IO) { env.dao.note(it) } }
            env.fx.playAudio(n?.audioUrl, n?.hanzi ?: s.initial.hanzi)
        }
    }

    fun cancelMove() {
        _moving.value = null
    }

    fun moveTo(deckId: String) {
        val ids = _moving.value ?: return
        _moving.value = null
        scope.launch {
            when (val o = env.writes.moveNotes(ids, deckId)) {
                is WriteOutcome.Refused -> onDone(o.message)
                else -> {
                    env.fx.drop()
                    close()
                    val name = withContext(Dispatchers.IO) { env.dao.decks().firstOrNull { it.id == deckId }?.name } ?: "the deck"
                    onDone(if (ids.size == 1) "Moved to $name" else "Moved ${ids.size} words to $name")
                }
            }
        }
    }
}
