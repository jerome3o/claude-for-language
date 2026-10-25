package dev.jeromeswannack.chineselearning.lab.data.homework

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.post
import dev.jeromeswannack.chineselearning.lab.data.api.PrefetchBody
import dev.jeromeswannack.chineselearning.lab.data.api.QueuedDto
import dev.jeromeswannack.chineselearning.lab.data.sentences.SentencePracticeStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** `POST /api/sentences/prefetch` for these notes first (the web's `prefetchSentenceSets(noteIds, limit)`). */
suspend fun Api.prefetchSentenceSetsFor(noteIds: List<String>, limit: Int): QueuedDto =
    post("/api/sentences/prefetch", PrefetchBody(noteIds, limit))

/**
 * Hard mode in the homework pass (docs/HOMEWORK.md §3e; the web's services/passSentences.ts): the Sentence
 * round needs the words' sentences, and one-off homework notes often have no generated set yet. When a pass
 * opens in Hard mode its words with NO set are queued for one (the pass's words first) and those with
 * fewer than the round's four ask for more (`SentencePracticeStore.requestMore(…, "few")`, once a day per
 * word, kept for the next sync when offline). The rows arrive with a later sentence sync; until then the
 * round has what there is — none → no round.
 */
object PassSentenceTopUp {
    private val asked = HashSet<String>()

    suspend fun ensure(app: LabApp, assignmentId: String, noteIds: List<String>) {
        if (noteIds.isEmpty() || !synchronized(asked) { asked.add(assignmentId) }) return
        val ids = noteIds.distinct()
        val (none, few) = withContext(Dispatchers.IO) {
            val dao = app.repo.dao
            val notes = dao.notes(ids).associateBy { it.id }
            val none = mutableListOf<String>()
            val few = mutableListOf<String>()
            for (id in ids) {
                val set = dao.sentencesFor(id).size
                val clue = if (notes[id]?.sentenceClue.isNullOrBlank()) 0 else 1
                if (set == 0) none += id else if (set + clue < SentenceHistory.MIN_VISIBLE) few += id
            }
            none to few
        }
        for (id in few) SentencePracticeStore.requestMore(app, id, "few")
        if (none.isEmpty()) return
        if (!app.online.value) {
            synchronized(asked) { asked.remove(assignmentId) }
            return
        }
        runCatching { app.repo.api.prefetchSentenceSetsFor(none.take(100), minOf(100, none.size)) }
            .onFailure { synchronized(asked) { asked.remove(assignmentId) } }
    }
}
