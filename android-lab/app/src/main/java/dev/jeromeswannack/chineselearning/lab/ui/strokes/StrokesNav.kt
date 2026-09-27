package dev.jeromeswannack.chineselearning.lab.ui.strokes

import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `/practice/strokes?text=` — handwriting practice (package H). */
fun NavGraphBuilder.strokesGraph(nav: LabNav) {
    composable(
        Routes.route("/practice/strokes?text={text}"),
        arguments = listOf(navArgument("text") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        val text = entry.arguments?.getString("text").orEmpty().trim()
        val vm: StrokePracticeViewModel = viewModel(factory = StrokePracticeViewModel.Factory(nav.app, text))
        val ui by vm.ui.collectAsStateWithLifecycle()
        StrokePracticeScreen(
            ui,
            StrokePracticeActions(
                onBack = nav::back,
                onPick = vm::pick,
                onSaveAll = vm::saveAll,
                onComplete = { vm.refreshOffline() },
            ),
        )
    }
}

/** Words worth writing: 1–4 Han characters, nothing else on the card. Port of `isWritableWord`. */
internal fun isWritableWord(hanzi: String): Boolean {
    val han = StrokeQuiz.writableCharacters(hanzi)
    val t = hanzi.trim()
    return han.size in 1..4 && han.size == t.codePointCount(0, t.length)
}

class StrokePracticeViewModel(private val app: LabApp, text: String) : ViewModel() {
    private val store = StrokeStore.of(app)
    private val _ui = MutableStateFlow(StrokePracticeUi(text = text))
    val ui: StateFlow<StrokePracticeUi> = _ui

    init {
        viewModelScope.launch {
            val recent = recentWords(12)
            _ui.update { it.copy(recent = recent) }
            lookUp(_ui.value.text)
        }
        refreshOffline()
    }

    fun pick(word: String) {
        val w = word.trim()
        _ui.update { it.copy(text = w, found = null, runKey = it.runKey + 1) }
        viewModelScope.launch { lookUp(w) }
    }

    /** A word from the card's "Write it" link or typed in: find its note for the prompt. */
    private suspend fun lookUp(text: String) {
        if (text.isEmpty()) return
        val found = _ui.value.recent?.firstOrNull { it.hanzi == text } ?: withContext(Dispatchers.IO) {
            runCatching {
                app.repo.db.openHelper.readableDatabase.query("SELECT hanzi, pinyin, english FROM notes WHERE hanzi = ? LIMIT 1", arrayOf(text)).use { c ->
                    if (c.moveToFirst()) PracticeWord(c.getString(0), c.getString(1), c.getString(2)) else null
                }
            }.getOrNull()
        }
        if (_ui.value.text == text) _ui.update { it.copy(found = found) }
    }

    /** The words studied most recently, newest first (falls back to the newest notes). */
    private suspend fun recentWords(limit: Int): List<PracticeWord> = withContext(Dispatchers.IO) {
        val out = LinkedHashMap<String, PracticeWord>()
        fun addAll(sql: String) = runCatching {
            app.repo.db.openHelper.readableDatabase.query(sql).use { c ->
                while (c.moveToNext() && out.size < limit) {
                    val w = PracticeWord(c.getString(0), c.getString(1), c.getString(2))
                    if (w.hanzi !in out && isWritableWord(w.hanzi)) out[w.hanzi] = w
                }
            }
        }
        addAll("SELECT n.hanzi, n.pinyin, n.english FROM review_events e JOIN cards c ON c.id = e.cardId JOIN notes n ON n.id = c.noteId ORDER BY e.reviewedAt DESC LIMIT 400")
        if (out.size < limit) addAll("SELECT hanzi, pinyin, english FROM notes ORDER BY createdAt DESC LIMIT 200")
        out.values.take(limit)
    }

    private suspend fun deckCharacters(): List<String> = withContext(Dispatchers.IO) {
        val set = LinkedHashSet<String>()
        runCatching { app.repo.dao.allNotes().forEach { n -> set += StrokeQuiz.writableCharacters(n.hanzi) } }
        set.toList()
    }

    fun refreshOffline() {
        viewModelScope.launch {
            val chars = deckCharacters()
            val have = store.cached(chars)
            _ui.update { it.copy(offlineTotal = chars.size, offlineCached = have.size) }
        }
    }

    fun saveAll() {
        if (_ui.value.saving != null) return
        viewModelScope.launch {
            _ui.update { it.copy(saveNote = null) }
            val chars = deckCharacters()
            val r = store.prefetch(chars) { done, total -> _ui.update { it.copy(saving = done to total) } }
            val have = store.cached(chars)
            val note = when {
                r.failed > 0 -> "Saved ${r.saved}. ${r.failed} couldn't be downloaded — check your connection and try again."
                r.saved > 0 -> "Saved ${r.saved} more characters."
                else -> "Everything is already saved."
            }
            if (r.saved > 0) app.haptics.correct()
            _ui.update { it.copy(saving = null, saveNote = note, offlineTotal = chars.size, offlineCached = have.size) }
        }
    }

    class Factory(private val app: LabApp, private val text: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = StrokePracticeViewModel(app, text) as T
    }
}
