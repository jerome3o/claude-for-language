package dev.jeromeswannack.chineselearning.lab.data.anki

import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.LessonJson
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiCollection
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiMediaFile
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiNaming
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiPackager
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiSource
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiSources
import dev.jeromeswannack.chineselearning.lab.core.anki.AudioRef
import dev.jeromeswannack.chineselearning.lab.core.anki.DeckSourceCard
import dev.jeromeswannack.chineselearning.lab.core.anki.DeckSourceNote
import dev.jeromeswannack.chineselearning.lab.core.anki.ReaderSource
import dev.jeromeswannack.chineselearning.lab.core.anki.ReaderSourcePage
import dev.jeromeswannack.chineselearning.lab.core.anki.ReaderSourceVocab
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.deckWithNotes
import dev.jeromeswannack.chineselearning.lab.data.api.reader
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/** What to export — the web's `AnkiExportTarget`. */
sealed interface AnkiExportTarget {
    val title: String

    data class Deck(val deckId: String, val name: String) : AnkiExportTarget { override val title get() = name }

    /** A lesson or library item's spec, as the editors hold it; [sourceId] goes into SourceId. */
    data class Lesson(val spec: JsonObject, val sourceId: String?) : AnkiExportTarget {
        override val title: String get() = (spec["title"] as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
    }

    data class Reader(val readerId: String, override val title: String) : AnkiExportTarget
}

/** `AnkiExportProgress`: stage loading | audio | building. */
data class AnkiExportProgress(val stage: Stage, val done: Int = 0, val total: Int = 0) {
    enum class Stage { LOADING, AUDIO, BUILDING }
}

/** `AnkiExportResult`: the built file (in the shareable cache folder) and its counts. */
data class AnkiExportResult(
    val file: File,
    val filename: String,
    val notes: Int,
    val cards: Int,
    val audioIncluded: Int,
    val audioMissing: Int,
    val bytes: Long,
)

/**
 * Where the export's inputs come from — the app's stores behind an interface so the whole
 * pipeline (source → audio → SQLite → zip) is unit-tested with fakes.
 */
interface AnkiExportData {
    val online: Boolean

    /** The deck from the local store (null when this device never synced it). */
    suspend fun localDeck(deckId: String): Pair<String, String?>?
    suspend fun localNotes(deckId: String): List<NoteEntity>
    suspend fun localCards(deckId: String): List<CardEntity>
    suspend fun remoteDeck(deckId: String): Triple<String, String?, Pair<List<DeckSourceNote>, List<DeckSourceCard>>>
    suspend fun remoteReader(readerId: String): GradedReaderDto
    suspend fun cachedReader(readerId: String): GradedReaderDto?

    /** A clip's bytes: cache first, fetched / generated when [fetch] and online; null when missing. */
    suspend fun audio(ref: AudioRef, fetch: Boolean): ByteArray?
}

/**
 * The web's services/anki/index.ts for the Lab app: load the source (local store first), resolve
 * its audio (4 at a time; cached clips work offline, missing ones are counted, not fatal), build
 * collection.anki2 + zip on the phone and leave the .apkg in cache/shared/anki/ for the share
 * sheet or Save to Downloads.
 */
class AnkiExporter(private val data: AnkiExportData, private val outDir: File, private val now: () -> Long = System::currentTimeMillis) {

    suspend fun export(
        target: AnkiExportTarget,
        includeAudio: Boolean = true,
        includeProgress: Boolean = false,
        onProgress: (AnkiExportProgress) -> Unit = {},
    ): AnkiExportResult = withContext(Dispatchers.IO) {
        onProgress(AnkiExportProgress(AnkiExportProgress.Stage.LOADING, 0, 1))
        val source = when (target) {
            is AnkiExportTarget.Deck -> deckSource(target.deckId, includeProgress)
            is AnkiExportTarget.Lesson -> AnkiSources.lessonToAnki(LessonJson.decodeFromJsonElement(CustomLessonSpec.serializer(), target.spec), target.sourceId)
            is AnkiExportTarget.Reader -> AnkiSources.readerToAnki(readerSource(target.readerId))
        }
        packageSource(source, includeAudio, onProgress)
    }

    private suspend fun deckSource(deckId: String, includeProgress: Boolean): AnkiSource {
        val local = data.localDeck(deckId)
        if (local != null) {
            // Dexie returns a deck's notes in primary-key order; so do we (same note ordinals).
            val notes = data.localNotes(deckId).sortedBy { it.id }
            if (notes.isNotEmpty()) {
                val cards = if (includeProgress) data.localCards(deckId).map { it.toSourceCard() } else emptyList()
                return AnkiSources.deckToAnki(local.first, local.second, notes.map { it.toSourceNote() }, cards, includeProgress, now())
            }
        }
        val (name, description, content) = data.remoteDeck(deckId)
        return AnkiSources.deckToAnki(name, description, content.first, if (includeProgress) content.second else emptyList(), includeProgress, now())
    }

    private suspend fun readerSource(readerId: String): ReaderSource {
        val reader = (if (data.online) runCatchingNonCancel { data.remoteReader(readerId) } else null)
            ?: data.cachedReader(readerId)
            ?: throw IllegalStateException("This reader is not available offline")
        return ReaderSource(
            reader.id, reader.titleChinese, reader.titleEnglish,
            reader.pages.map { ReaderSourcePage(it.id, it.pageNumber, it.contentChinese, it.contentPinyin, it.contentEnglish) },
            reader.vocabularyUsed.map { ReaderSourceVocab(it.hanzi, it.pinyin, it.english) },
        )
    }

    private suspend fun packageSource(source: AnkiSource, includeAudio: Boolean, onProgress: (AnkiExportProgress) -> Unit): AnkiExportResult {
        val resolved = HashMap<String, AnkiMediaFile>()
        var missing = 0
        if (includeAudio) {
            val refs = AnkiPackager.refs(source)
            onProgress(AnkiExportProgress(AnkiExportProgress.Stage.AUDIO, 0, refs.size))
            val done = AtomicInteger(0)
            val missed = AtomicInteger(0)
            val gate = Semaphore(4)
            coroutineScope {
                refs.map { ref ->
                    async {
                        gate.withPermit {
                            val bytes = runCatchingNonCancel { data.audio(ref, fetch = true) }
                            if (bytes != null && bytes.isNotEmpty()) {
                                val file = AnkiMediaFile(AnkiNaming.mediaFilename(bytes, AnkiNaming.sniffAudioType(bytes)), bytes)
                                synchronized(resolved) { resolved[AnkiPackager.key(ref)] = file }
                            } else {
                                missed.incrementAndGet()
                            }
                            onProgress(AnkiExportProgress(AnkiExportProgress.Stage.AUDIO, done.incrementAndGet(), refs.size))
                        }
                    }
                }.awaitAll()
            }
            missing = missed.get()
        }
        onProgress(AnkiExportProgress(AnkiExportProgress.Stage.BUILDING, 0, 1))
        val pkg = AnkiPackager.assemble(source, includeAudio, resolved, missing)
        val plan = AnkiCollection.plan(pkg.input, now())
        val filename = AnkiNaming.apkgFilename(source.deckName)
        outDir.mkdirs()
        outDir.listFiles()?.filter { it.name.endsWith(".apkg") || it.name.endsWith(".part") }?.forEach { it.delete() }
        val out = File(outDir, filename)
        val written = ApkgWriter.writeApkg(plan, pkg.media, out, outDir)
        onProgress(AnkiExportProgress(AnkiExportProgress.Stage.BUILDING, 1, 1))
        return AnkiExportResult(out, filename, written.noteCount, written.cardCount, pkg.audioIncluded, pkg.audioMissing, written.bytes)
    }

    companion object {
        /** The folder FileProvider shares (res/xml/shared_files.xml: cache/shared/). */
        fun outDir(app: LabApp) = File(app.cacheDir, "shared/anki")

        fun of(app: LabApp) = AnkiExporter(LabAnkiData(app), outDir(app))
    }
}

private inline fun <T> runCatchingNonCancel(block: () -> T): T? = try {
    block()
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    null
}

internal fun NoteEntity.toSourceNote() = DeckSourceNote(
    id = id, hanzi = hanzi, pinyin = pinyin, english = english, funFacts = funFacts, context = context,
    sentenceClue = sentenceClue, sentenceCluePinyin = sentenceCluePinyin, sentenceClueTranslation = sentenceClueTranslation,
    audioUrl = audioUrl, sentenceClueAudioUrl = sentenceClueAudioUrl,
)

/** The cached, event-derived state (never stored state): interval = scheduled days, as the web's LocalCard. */
internal fun CardEntity.toSourceCard() = DeckSourceCard(noteId, cardType, queue, scheduledDays.toDouble(), easeFactor, reps, lapses, nextReviewAt)

/** The real stores: Room for decks, the audio / TTS / reader caches, the API when online. */
class LabAnkiData(private val app: LabApp) : AnkiExportData {
    private val api: Api get() = app.repo.api
    private val runtime by lazy { LessonRuntime.of(app) }

    override val online: Boolean get() = app.online.value

    override suspend fun localDeck(deckId: String) = app.repo.dao.decks().firstOrNull { it.id == deckId }?.let { it.name to it.description }
    override suspend fun localNotes(deckId: String) = app.repo.dao.allNotes().filter { it.deckId == deckId }
    override suspend fun localCards(deckId: String) = app.repo.dao.cards().filter { it.deckId == deckId }

    override suspend fun remoteDeck(deckId: String): Triple<String, String?, Pair<List<DeckSourceNote>, List<DeckSourceCard>>> {
        val deck = api.deckWithNotes(deckId)
        val notes = deck.notes.map {
            DeckSourceNote(it.id, it.hanzi, it.pinyin, it.english, it.funFacts, it.context, it.sentenceClue, it.sentenceCluePinyin, it.sentenceClueTranslation, it.audioUrl, it.sentenceClueAudioUrl)
        }
        val cards = deck.notes.flatMap { n -> n.cards.map { c -> DeckSourceCard(n.id, c.cardType, c.queue, c.interval, c.easeFactor, c.repetitions, c.lapses, c.nextReviewAt) } }
        return Triple(deck.name, deck.description, notes to cards)
    }

    override suspend fun remoteReader(readerId: String) = api.reader(readerId)
    override suspend fun cachedReader(readerId: String) = runtime.readers.entry(readerId)?.reader

    override suspend fun audio(ref: AudioRef, fetch: Boolean): ByteArray? {
        val online = fetch && app.online.value
        val file: File? = when (ref) {
            is AudioRef.R2 -> app.repo.cachedAudio(ref.key) ?: if (online) downloadR2(ref.key) else null
            is AudioRef.Tts -> runtime.media.tts(ref.text, online = online)
            is AudioRef.ReaderPage -> runtime.readers.pageAudio(ReaderPageDto(id = ref.pageId, contentChinese = ref.text), online)
        }
        return file?.takeIf { it.exists() && it.length() > 0 }?.readBytes()
    }

    private suspend fun downloadR2(key: String): File? {
        val dir = File(app.cacheDir, "anki-audio").apply { mkdirs() }
        val dest = File(dir, key.removePrefix("/api/audio/").replace(Regex("[^A-Za-z0-9._-]"), "_"))
        if (dest.exists() && dest.length() > 0) return dest
        return runCatchingNonCancel { api.download(Config.audioUrl(key, api.baseUrl), dest); dest }
    }
}
