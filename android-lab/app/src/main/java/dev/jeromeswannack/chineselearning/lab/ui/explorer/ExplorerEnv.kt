package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.core.WordListParser
import dev.jeromeswannack.chineselearning.lab.core.WordFrequency
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
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
import kotlinx.coroutines.withContext

/** The learner's own card of the word ("📚 You have this in <deck>"). */
data class MyWordCard(val noteId: String, val deckName: String, val pinyin: String, val english: String)

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
    /** The learner's card + up to three of their notes using the word (Room). */
    val myWord: suspend (String) -> MyWord = { MyWord() },
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
    /** "⚡ Study it today" (null = previews). */
    val bump: BumpHanzi? = null,
    /** "Open card" → the card hub (null = no link). */
    val openCard: ((noteId: String) -> Unit)? = null,
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
    /** `myWord`: the learner's note spelled [hanzi] (normalised like the bump / Paste a list) and up to 3 notes using it. */
    suspend fun myWord(app: LabApp, hanzi: String): MyWord = withContext(Dispatchers.IO) {
        val dao = app.repo.dao
        val decks = dao.decks().associate { it.id to it.name }
        val notes = dao.allNotes().filter { it.deckId in decks }
        val key = WordListParser.normalizeHanzi(hanzi)
        val own = notes.firstOrNull { WordListParser.normalizeHanzi(it.hanzi) == key }
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
        MyWord(own?.let { MyWordCard(it.id, decks[it.deckId].orEmpty(), it.pinyin, it.english) }, examples)
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
            myWord = { ExplorerData.myWord(app, it) },
            rank = { h -> WordFrequency.shipped?.words?.get(h) },
            decal = shippedDecals(),
            online = online,
            cachedExplanation = { w, s -> runCatching { readers.cachedExplanation(w, s) }.getOrNull() },
            explain = { w, s, p, g -> readers.explainWord(w, s, p, g) },
            play = { speech.speak(it) },
            addActions = passSentenceActions(app),
            bump = { hanzi, deck ->
                app.haptics.tick()
                dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.bumpHanzi(app, hanzi, "explorer", deck).message
            },
            openCard = nav?.let { n -> { id: String -> close(); n.open(Routes.cardHub(id)) } },
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
