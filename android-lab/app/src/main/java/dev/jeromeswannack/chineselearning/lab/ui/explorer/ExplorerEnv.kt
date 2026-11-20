package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.core.WordListParser
import dev.jeromeswannack.chineselearning.lab.core.WordFrequency
import dev.jeromeswannack.chineselearning.lab.data.api.GlossWordIn
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.api.glossWords
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.data.chars.OwnCardInfo
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetActions
import dev.jeromeswannack.chineselearning.lab.ui.chars.rememberCharSheetActions
import dev.jeromeswannack.chineselearning.lab.ui.homework.passSentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.quests.QuestSpeech
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** The learner's own card of the word ("📚 You have this in <deck>"). */
data class MyWordCard(
    val noteId: String,
    val deckName: String,
    val pinyin: String,
    val english: String,
    /** The note's AI word tags (notes.word_tags JSON) for the Word view's pills. */
    val wordTags: String? = null,
)

/** A line of the learner's own cards that uses the word (the note itself, else its card sentence). */
data class MyExample(val noteId: String, val text: String, val translation: String?)

/** What this device knows of the word from the learner's own cards. */
data class MyWord(val card: MyWordCard? = null, val examples: List<MyExample> = emptyList())

/**
 * Everything the explorer needs from outside itself. Defaults = an offline preview with no
 * data, so screenshot tests and the navigation test pass only what they show.
 */
class ExplorerEnv(
    /** The character view's environment (dictionary, statuses, "More about 字", deck names). */
    val chars: CharSheetActions = CharSheetActions(),
    /** One batched `GET /api/chars` for the characters this device doesn't have yet. */
    val prefetchChars: suspend (List<String>) -> Unit = {},
    /** The word dictionary: cache first, then `GET /api/words`. */
    val wordLookup: suspend (String) -> WordDict.Lookup = { WordDict.Lookup.Offline },
    /**
     * The learner's card + up to three of their notes using the word (Room). `fresh` = read the
     * database again (after an add) instead of the warm in-memory index.
     */
    val myWord: suspend (hanzi: String, fresh: Boolean) -> MyWord = { _, _ -> MyWord() },
    /**
     * Which of these characters are cards of their OWN (性 itself, not 人性): the Character view's
     * line and the Word view's chip badges (core CharWords.ownCards over Room).
     */
    val ownCards: suspend (chars: List<String>) -> Map<String, OwnCardInfo> = { emptyMap() },
    /** Rank in the shipped word-freq list (null = not listed). */
    val rank: (String) -> Int? = { null },
    /** Frequency decals (outlines on word / character tiles) from the shipped list; null = none. */
    val decal: DecalOf? = null,
    val online: () -> Boolean = { false },
    /** "✨ More about this word": the reader-word explanation (cached on the server and the device). */
    val cachedExplanation: suspend (word: String, sentence: String) -> ReaderWordExplanationDto? = { _, _ -> null },
    val explain: suspend (word: String, sentence: String, pinyin: String?, gloss: String?) -> ReaderWordExplanationDto =
        { _, _, _, _ -> throw java.io.IOException("offline") },
    /** ▶ the word (practice TTS, cached per text; the device voice offline). */
    val play: (String) -> Unit = {},
    /** "+ Add as card" (the add-chunk sheet: decks in queue order, the top one picked). */
    val addActions: SentenceActions = SentenceActions(),
    /**
     * A meaning for "+ Add as card" when the phone has none (`POST /api/ai/gloss-words`):
     * pinyin to english, null = nothing (previews, failures).
     */
    val gloss: suspend (hanzi: String, pinyin: String?) -> Pair<String, String>? = { _, _ -> null },
    /** "⚡ Study it today" (null = previews). */
    val bump: BumpHanzi? = null,
    /**
     * "⚡ Study it today" on a word "+ Add as card" just made ([AddedTo.noteId]): bumped even before the sync
     * brings the note down, planned as an unstarted word (its listening card with "Start new words by ear").
     * Null = [bump] by hanzi only.
     */
    val bumpJustAdded: (suspend (hanzi: String, noteId: String, preferDeck: String?) -> String)? = null,
    /** "Open card" → the card hub (null = no link). */
    val openCard: ((noteId: String) -> Unit)? = null,
    /**
     * Every card of a note as the study card ⋯ sheet's tiles (core SiblingStatus; the ⚡ pocket's cards of the note
     * count as in today) — the "Card variants" row under "📚 You have this". Null = not shown (previews).
     */
    val wordCards: suspend (noteId: String) -> dev.jeromeswannack.chineselearning.lab.ui.study.SiblingsUi? = { null },
    /** ⚡ on one card of the word: a card-level bump of that card type (source explorer). Null = not offered. */
    val bumpCardType: (suspend (noteId: String, cardType: String) -> Unit)? = null,
    /** Unsuspend / Wake now one card. Null = not offered. */
    val releaseCard: (suspend (cardId: String) -> Unit)? = null,
    /** A light haptic tick (a card tile opened). */
    val tick: () -> Unit = {},
    /** "✍️ Write it" is offered (the stroke-order practice). */
    val canWrite: Boolean = false,
    /** A quick drill's right / wrong / good-score feedback (Sounds + Haptics). */
    val drillFx: DrillFx = DrillFx(),
    /** A ready 成语 entry is on the phone (the "📜 Story & usage" row, docs/IDIOMS.md). */
    val idiomKnown: suspend (String) -> Boolean = { false },
    /** "📜 Story & usage" → the idiom page (null = no link: previews). */
    val openIdiom: ((hanzi: String) -> Unit)? = null,
    /** Stroke data for a drill's "Write it" (null = the app's StrokeStore). */
    val strokeLoader: (suspend (String) -> dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad)? = null,
)

object ExplorerData {
    /** The learner's notes as the explorer needs them, kept warm in memory (built once, rebuilt when notes / decks change). */
    class NoteIndex(val notes: List<Row>) {
        class Row(
            val id: String,
            val deckName: String,
            val hanzi: String,
            val pinyin: String,
            val english: String,
            val wordTags: String?,
            val sentenceClue: String?,
            val sentenceClueTranslation: String?,
        ) {
            val key: String = WordListParser.normalizeHanzi(hanzi)
        }

        /** `myWord`: the note spelled [hanzi] (normalised like the bump / Paste a list) and up to 3 notes using it. */
        fun myWord(hanzi: String): MyWord {
            val key = WordListParser.normalizeHanzi(hanzi)
            val own = notes.firstOrNull { it.key == key }
            val examples = ArrayList<MyExample>()
            for (n in notes) {
                if (examples.size >= 3) break
                if (n.id == own?.id) continue
                if (Known.noteKey(n.hanzi) == Known.noteKey(hanzi)) continue
                when {
                    hanzi in n.hanzi -> examples += MyExample(n.id, n.hanzi.trim(), n.english.ifBlank { null })
                    n.sentenceClue?.contains(hanzi) == true -> examples += MyExample(n.id, n.sentenceClue.trim(), n.sentenceClueTranslation?.ifBlank { null })
                }
            }
            return MyWord(own?.let { MyWordCard(it.id, it.deckName, it.pinyin, it.english, it.wordTags) }, examples)
        }
    }

    /** One app's warm index: the current build, the database generation it was built from, and the watcher. */
    private class Warm(val app: LabApp) {
        @Volatile var generation = 0L
        @Volatile var built: Pair<Long, NoteIndex>? = null
        val lock = kotlinx.coroutines.sync.Mutex()
        init {
            // Any write to notes / decks (sync, an add, a move, a delete) makes the index stale.
            runCatching {
                app.repo.db.invalidationTracker.addObserver(object : androidx.room.InvalidationTracker.Observer(arrayOf("notes", "decks")) {
                    override fun onInvalidated(tables: Set<String>) { generation++ }
                })
            }
        }
    }

    private val warm = java.util.WeakHashMap<LabApp, Warm>()
    private fun warmOf(app: LabApp): Warm = synchronized(warm) { warm.getOrPut(app) { Warm(app) } }

    private suspend fun build(app: LabApp): NoteIndex = withContext(Dispatchers.IO) {
        val dao = app.repo.dao
        val decks = dao.decks().associate { it.id to it.name }
        NoteIndex(
            dao.allNotes().filter { it.deckId in decks }.map {
                NoteIndex.Row(it.id, decks[it.deckId].orEmpty(), it.hanzi, it.pinyin, it.english, it.wordTags, it.sentenceClue, it.sentenceClueTranslation)
            },
        )
    }

    /** The index, from memory when nothing changed since it was built; [fresh] = always read the database. */
    suspend fun index(app: LabApp, fresh: Boolean = false): NoteIndex {
        val w = warmOf(app)
        return w.lock.withLock {
            val gen = w.generation
            val have = w.built
            if (!fresh && have != null && have.first == gen) return@withLock have.second
            build(app).also { w.built = gen to it }
        }
    }

    /**
     * Builds the index in the background so the first word tapped opens with its card at once
     * (called when a screen with tappable Chinese shows and when the explorer opens).
     */
    fun warm(app: LabApp) {
        val w = warmOf(app)
        val have = w.built
        if (have != null && have.first == w.generation) return
        if (w.lock.isLocked) return
        app.scope.launch { app.safely("explorer.warm") { index(app) } }
    }

    /** `myWord`: the learner's note spelled [hanzi] and up to 3 notes using it. */
    suspend fun myWord(app: LabApp, hanzi: String, fresh: Boolean = false): MyWord = index(app, fresh).myWord(hanzi)

    /**
     * Every card of [noteId] as the ⋯ sheet's tiles (core SiblingStatus, no card on screen) from Room: the replayed
     * state, the holds, and the ⚡ pocket's cards of the note as in today (core Bumps.bumpedCardsForNote). Null = no cards.
     */
    suspend fun wordCards(app: LabApp, noteId: String): dev.jeromeswannack.chineselearning.lab.ui.study.SiblingsUi? = withContext(Dispatchers.IO) {
        val dao = app.repo.dao
        val cards = dao.cardsOfNotes(listOf(noteId)).map { it.toQueueCard() }
        if (cards.isEmpty()) return@withContext null
        val now = System.currentTimeMillis()
        val cutoffMs = dev.jeromeswannack.chineselearning.lab.core.StudyQueue.cutoff(now, java.time.ZoneId.systemDefault(), dev.jeromeswannack.chineselearning.lab.data.StudyDayClock.rolloverHour).ts
        val inToday = HashSet<String>()
        dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.queueBumps(dao)?.let { qb ->
            for (b in qb.bumps) if (b.noteId == noteId) {
                dev.jeromeswannack.chineselearning.lab.core.Bumps.bumpedCardsForNote(cards, b, qb.lastReviewMs, qb.firstReviewMs, cutoffMs).forEach { inToday += it.id }
            }
        }
        val ctx = dev.jeromeswannack.chineselearning.lab.core.SiblingStatus.Context(
            cutoffMs = cutoffMs,
            today = dev.jeromeswannack.chineselearning.lab.data.StudyDayClock.todayKey(),
            holds = dev.jeromeswannack.chineselearning.lab.data.holds.HoldStore.activeByCard(dao),
            inToday = inToday,
            canBump = true,
        )
        val sib = dev.jeromeswannack.chineselearning.lab.core.SiblingStatus
        dev.jeromeswannack.chineselearning.lab.ui.study.SiblingsUi(
            sib.tiles(cards.map(sib::card), "", ctx),
            sib.missingTypes(cards.map { it.cardType }, ""),
        )
    }
}

/** The running app's explorer environment. */
@Composable
fun rememberExplorerEnv(app: LabApp, nav: LabNav?, close: () -> Unit): ExplorerEnv {
    val chars = rememberCharSheetActions(app, onOpenCard = nav?.let { n -> { id: String -> close(); n.open(Routes.cardHub(id)) } })
    return remember(app, nav, chars) {
        val charDict = CharDict.of(app)
        val wordDict = WordDict.of(app)
        val readers = LessonRuntime.of(app).readers
        val speech = QuestSpeech(app)
        val online = { app.online.value && !dev.jeromeswannack.chineselearning.lab.data.settings.SettingsStore.forcedOffline(app) }
        ExplorerEnv(
            chars = chars,
            prefetchChars = { list -> if (online()) runCatching { charDict.prefetch(list) } },
            wordLookup = wordDict::lookup,
            myWord = { h, fresh -> ExplorerData.myWord(app, h, fresh) },
            ownCards = { cs -> CharDict.ownCards(app.repo.dao, cs) },
            rank = { h -> WordFrequency.shipped?.words?.get(h) },
            decal = shippedDecals(),
            online = online,
            cachedExplanation = { w, s -> runCatching { readers.cachedExplanation(w, s) }.getOrNull() },
            explain = { w, s, p, g -> readers.explainWord(w, s, p, g) },
            play = { speech.speak(it) },
            addActions = passSentenceActions(app),
            gloss = { h, p ->
                app.repo.api.glossWords(listOf(GlossWordIn(h, p))).let { out -> out.firstOrNull { it.hanzi == h } ?: out.firstOrNull() }?.let { it.pinyin to it.english }
            },
            bump = { hanzi, deck ->
                app.haptics.tick()
                dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.bumpHanzi(app, hanzi, "explorer", deck).message
            },
            bumpJustAdded = { hanzi, noteId, deck ->
                app.haptics.tick()
                dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.bumpHanzi(app, listOf(hanzi), "explorer", deck, justCreated = mapOf(hanzi to noteId)).message
            },
            openCard = nav?.let { n -> { id: String -> close(); n.open(Routes.cardHub(id)) } },
            wordCards = { noteId -> ExplorerData.wordCards(app, noteId) },
            bumpCardType = { noteId, cardType ->
                dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.bumpCardTypes(app, noteId, listOf(cardType), "explorer")
                app.haptics.correct()
            },
            releaseCard = { cardId -> dev.jeromeswannack.chineselearning.lab.data.holds.HoldStore.release(app, listOf(cardId), "explorer") },
            tick = { app.haptics.tick() },
            idiomKnown = { h -> dev.jeromeswannack.chineselearning.lab.data.idioms.IdiomStore.isCached(app, h) },
            openIdiom = nav?.let { n -> { h: String -> close(); n.open(Routes.idiom(h, "explorer")) } },
            canWrite = true,
            drillFx = DrillFx(
                right = { app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.CORRECT); app.haptics.correct() },
                wrong = { app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.WRONG); app.haptics.wrong() },
                celebrate = { app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.FANFARE); app.haptics.celebrate() },
            ),
        )
    }
}
