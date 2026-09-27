package dev.jeromeswannack.chineselearning.lab.ui.cards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.CardFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.HubReviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.NotePaths
import dev.jeromeswannack.chineselearning.lab.data.api.NoteHubDto
import dev.jeromeswannack.chineselearning.lab.data.api.QuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.noteHub
import dev.jeromeswannack.chineselearning.lab.data.api.send
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.decks.WriteOutcome
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksEnv
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The note as the hub shows it: from the server's hub, else from Room. */
data class HubNoteUi(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val funFacts: String?,
    val sentenceClue: String?,
    val sentenceCluePinyin: String?,
    val sentenceClueTranslation: String?,
    val audioUrl: String?,
    val deckId: String,
    val deckName: String,
)

/** A human tutor the flag can go to (the web's humanTutors). */
data class HubTutor(val relationshipId: String, val name: String)

data class CardHubUi(
    val loaded: Boolean = false,
    /** Null once loaded = the note isn't on this phone and the server couldn't be asked. */
    val note: HubNoteUi? = null,
    val cards: List<HubCardDto> = emptyList(),
    val flags: List<CardFlagDto> = emptyList(),
    /** Ask-Claude conversations, newest first; each oldest question first. */
    val threads: List<List<QuestionDto>> = emptyList(),
    val reviews: List<HubReviewDto> = emptyList(),
    val reviewCount: Int = 0,
    /** Flags and Claude chats come from the server: false when only Room could answer. */
    val fromServer: Boolean = false,
    val loadable: Loadable<NoteHubDto> = Loadable(),
    val tutors: List<HubTutor> = emptyList(),
    val flagBusy: Boolean = false,
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    val online: Boolean = true,
)

/**
 * The card hub (web: pages/CardHubPage.tsx, `/cards/:noteId`): the note, how each of its
 * three cards is doing, the flags on it (with the tutor's reply / a flag form), every
 * Ask-Claude conversation about it and the recent reviews. The server's hub is cached for
 * offline; before it has ever loaded, Room answers the note, the cards and the reviews.
 */
class CardHubViewModel(private val env: DecksEnv, private val noteId: String) : ViewModel() {
    private val _ui = MutableStateFlow(CardHubUi())
    val ui: StateFlow<CardHubUi> = _ui
    val editor = NoteEditor(env, viewModelScope).apply { onDone = { msg -> say(msg) } }

    private val hub = CachedResource(
        viewModelScope, env.cache, "cards/hub/$noteId", "cards", NoteHubDto.serializer(), online = { env.online.value },
    ) { env.api.noteHub(noteId) }

    init {
        viewModelScope.launch { hub.state.collect { refresh() } }
        viewModelScope.launch { env.dataVersion.collect { refresh() } }
        viewModelScope.launch { env.online.collect { on -> _ui.update { it.copy(online = on) } } }
        viewModelScope.launch {
            env.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collect { rel -> _ui.update { it.copy(tutors = humanTutors(rel, env)) } }
        }
    }

    fun reload() {
        hub.refresh()
    }

    private fun refresh() {
        viewModelScope.launch {
            val local = withContext(Dispatchers.IO) { localHub() }
            // Read the server state after the Room query: refreshes overlap, and one that started
            // before the hub arrived must not overwrite it with the stale "not loaded yet" state.
            val state = hub.state.value
            _ui.update { s -> build(state, local).copy(tutors = s.tutors, flagBusy = s.flagBusy, notice = s.notice, noticeIsError = s.noticeIsError, online = s.online) }
        }
    }

    private data class LocalHub(val note: HubNoteUi, val cards: List<HubCardDto>, val reviews: List<HubReviewDto>, val count: Int)

    /** Room's answer: the note (with this phone's edits), the cards' computed state, the last reviews. */
    private suspend fun localHub(): LocalHub? {
        val n = env.dao.note(noteId) ?: return null
        val deckName = env.dao.decks().firstOrNull { it.id == n.deckId }?.name ?: "Deck"
        val cards = env.dao.cards().filter { it.noteId == noteId }
        val typeOf = cards.associate { it.id to it.cardType }
        val events = env.dao.replayEventsForCards(cards.map { it.id })
        val full = cards.flatMap { env.dao.eventsForCard(it.id) }.sortedWith(compareByDescending<dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity> { it.reviewedAt }.thenByDescending { it.id })
        return LocalHub(
            HubNoteUi(n.hanzi, n.pinyin, n.english, n.funFacts, n.sentenceClue, n.sentenceCluePinyin, n.sentenceClueTranslation, n.audioUrl, n.deckId, deckName),
            cards.sortedBy { dev.jeromeswannack.chineselearning.lab.ui.decks.DeckStats.CARD_TYPES.indexOf(it.cardType) }.map { c ->
                HubCardDto(c.id, c.cardType, c.queue, c.stability, c.difficulty, c.lapses, c.reps, c.nextReviewAt)
            },
            full.take(RECENT).map { e -> HubReviewDto(e.id, e.cardId, typeOf[e.cardId].orEmpty(), e.rating, e.reviewedAt, e.timeSpentMs, e.userAnswer, null) },
            events.size,
        )
    }

    private fun build(state: Loadable<NoteHubDto>, local: LocalHub?): CardHubUi {
        val server = state.data
        // The phone's own copy of the note wins (an edit made offline shows at once); the
        // server supplies what the phone doesn't hold: flags, Claude chats, recordings.
        val note = local?.note ?: server?.let { h ->
            val n = h.note
            HubNoteUi(n.hanzi, n.pinyin, n.english, n.fun_facts, n.sentence_clue, n.sentence_clue_pinyin, n.sentence_clue_translation, n.audio_url, h.deck.id, h.deck.name)
        }
        val loaded = server != null || local != null || !state.loading
        return CardHubUi(
            loaded = loaded,
            note = note,
            cards = local?.cards ?: server?.cards.orEmpty(),
            flags = server?.flags.orEmpty(),
            threads = groupThreads(server?.questions.orEmpty()),
            // Server reviews carry recordings; fall back to Room's when the server hasn't answered.
            reviews = server?.recent_reviews ?: local?.reviews.orEmpty(),
            reviewCount = maxOf(server?.review_count ?: 0, local?.count ?: 0),
            fromServer = server != null,
            loadable = state,
        )
    }

    fun play() {
        val n = _ui.value.note ?: return
        env.fx.playAudio(n.audioUrl, n.hanzi)
    }

    fun playRecording(key: String) = env.fx.playAudio(key, "")

    // ---------------- flags ----------------

    fun sendFlag(relationshipId: String, message: String, tutorName: String, onSent: () -> Unit) {
        _ui.update { it.copy(flagBusy = true, notice = null) }
        viewModelScope.launch {
            when (val o = env.writes.flagCard(relationshipId, noteId, message)) {
                WriteOutcome.Saved -> { env.fx.success(); onSent(); say("Sent to $tutorName."); hub.refresh() }
                WriteOutcome.Queued -> { env.fx.success(); onSent(); say("Saved — it goes to $tutorName when you're back online.") }
                is WriteOutcome.Refused -> say(o.message, error = true)
            }
            _ui.update { it.copy(flagBusy = false) }
        }
    }

    /** Resolve / reopen / delete one of my flags (online, like the web). */
    fun flagAction(flag: CardFlagDto, action: FlagAction) {
        if (!env.online.value) return say("You're offline — try again when you're connected.", error = true)
        viewModelScope.launch {
            val (method, path) = when (action) {
                FlagAction.RESOLVE -> "POST" to NotePaths.resolveFlag(flag.id)
                FlagAction.REOPEN -> "POST" to NotePaths.reopenFlag(flag.id)
                FlagAction.DELETE -> "DELETE" to NotePaths.flag(flag.id)
            }
            try {
                val res = withContext(Dispatchers.IO) { env.api.send(method, path) }
                if (!res.ok) say(dev.jeromeswannack.chineselearning.lab.data.HttpException(res.code, res.body.take(200), res.body).userMessage(), error = true)
                else { env.fx.tick(); hub.refresh() }
            } catch (e: Exception) {
                say(e.userMessage(), error = true)
            }
        }
    }

    enum class FlagAction { RESOLVE, REOPEN, DELETE }

    fun say(message: String, error: Boolean = false) = _ui.update { it.copy(notice = message, noticeIsError = error) }

    fun dismissNotice() = _ui.update { it.copy(notice = null) }

    class Factory(private val env: DecksEnv, private val noteId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CardHubViewModel(env, noteId) as T
    }

    companion object {
        const val RECENT = 20

        /** Two questions on the same card closer than this read as one conversation (shared/chats/threads.ts). */
        const val THREAD_GAP_MS = 30 * 60 * 1000L

        /** `groupQuestionThreads` for one note's rows: newest thread first, each oldest question first. */
        fun groupThreads(rows: List<QuestionDto>, gapMs: Long = THREAD_GAP_MS): List<List<QuestionDto>> {
            fun t(q: QuestionDto) = runCatching { Js.parseDate(sqliteToIso(q.asked_at)) }.getOrDefault(0L)
            val threads = ArrayList<MutableList<QuestionDto>>()
            for (row in rows.sortedBy(::t)) {
                val cur = threads.lastOrNull()
                if (cur != null && t(row) - t(cur.last()) <= gapMs) cur += row else threads += mutableListOf(row)
            }
            return threads.sortedByDescending { t(it.last()) }
        }

        /** SQLite's datetime('now') as ISO (the web's sqliteToIso). */
        fun sqliteToIso(v: String): String = if (v.isEmpty() || v.contains('T')) v else v.replace(' ', 'T') + if (v.endsWith("Z")) "" else "Z"

        const val CLAUDE_AI_USER_ID = "claude-ai"

        fun humanTutors(rel: MyRelationshipsDto?, env: DecksEnv): List<HubTutor> =
            rel?.tutors.orEmpty().filter { it.status == "active" }.mapNotNull { r ->
                // The other person is whoever isn't me; the tutors list's other side is the tutor.
                val other = listOfNotNull(r.requester, r.recipient).firstOrNull { u ->
                    if (r.requester_role == "tutor") u.id == r.requester_id else u.id == r.recipient_id
                }
                if (other == null || other.id == CLAUDE_AI_USER_ID) null else HubTutor(r.id, other.name ?: other.email ?: "your tutor")
            }
    }
}
