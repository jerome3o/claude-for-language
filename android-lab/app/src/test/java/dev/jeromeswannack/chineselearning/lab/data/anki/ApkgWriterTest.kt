package dev.jeromeswannack.chineselearning.lab.data.anki

import android.database.sqlite.SQLiteDatabase
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiCollection
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiHash
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiModels
import dev.jeromeswannack.chineselearning.lab.core.anki.AudioRef
import dev.jeromeswannack.chineselearning.lab.core.anki.DeckSourceCard
import dev.jeromeswannack.chineselearning.lab.core.anki.DeckSourceNote
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.VocabItemDto
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.zip.ZipFile
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The .apkg the Lab app writes, read back the way Anki would: unzip it, open collection.anki2
 * with SQLite, check the tables, notes (GUIDs, fields, checksums), cards (templates that
 * apply, scheduling), the media index and the media bytes. The row values themselves are
 * parity-tested against the web's sql.js output in core (AnkiParityTest).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ApkgWriterTest {
    @get:Rule val tmp = TemporaryFolder()

    private val now = 1_790_000_000_000L // 2026-09-21

    /** A clip that sniffs as MP3 (ID3 header). */
    private fun mp3(tag: String) = "ID3".toByteArray() + tag.toByteArray()

    private inner class FakeData(
        override val online: Boolean = true,
        val deck: Pair<String, String?>? = "HSK 1 · Greetings" to "Basics",
        val notes: List<NoteEntity> = emptyList(),
        val cards: List<CardEntity> = emptyList(),
        val clips: Map<String, ByteArray> = emptyMap(),
        val reader: GradedReaderDto? = null,
        val cachedReader: GradedReaderDto? = null,
    ) : AnkiExportData {
        val fetched = mutableListOf<AudioRef>()
        override suspend fun localDeck(deckId: String) = deck
        override suspend fun localNotes(deckId: String) = notes.filter { it.deckId == deckId }
        override suspend fun localCards(deckId: String) = cards.filter { it.deckId == deckId }
        override suspend fun remoteDeck(deckId: String): Triple<String, String?, Pair<List<DeckSourceNote>, List<DeckSourceCard>>> =
            Triple("Remote deck", null, listOf(DeckSourceNote("rn1", "远程", "yuǎnchéng", "remote")) to emptyList())
        override suspend fun remoteReader(readerId: String) = reader ?: error("offline")
        override suspend fun cachedReader(readerId: String) = cachedReader
        override suspend fun audio(ref: AudioRef, fetch: Boolean): ByteArray? {
            synchronized(fetched) { fetched += ref }
            val key = when (ref) { is AudioRef.R2 -> ref.key; is AudioRef.Tts -> "tts:${ref.text}"; is AudioRef.ReaderPage -> "page:${ref.pageId}" }
            return clips[key]
        }
    }

    private fun note(id: String, hanzi: String, audio: String? = null, clue: String? = null, clueAudio: String? = null) = NoteEntity(
        id = id, deckId = "d1", hanzi = hanzi, pinyin = "p-$id", english = "e-$id", audioUrl = audio, funFacts = "Fact for $hanzi", context = null,
        sentenceClue = clue, sentenceCluePinyin = null, sentenceClueTranslation = clue?.let { "Translation of $it" }, sentenceClueAudioUrl = clueAudio,
        alternatives = null, createdAt = null,
    )

    private class Read(val entries: List<String>, val media: Map<String, String>, val files: Map<String, ByteArray>, val db: SQLiteDatabase)

    private fun read(file: File): Read {
        ZipFile(file).use { zip ->
            val entries = zip.entries().toList().map { it.name }
            val media = Json.parseToJsonElement(zip.getInputStream(zip.getEntry("media")).readBytes().toString(Charsets.UTF_8)).jsonObject
                .mapValues { it.value.jsonPrimitive.content }
            val files = media.entries.associate { (entry, name) -> name to zip.getInputStream(zip.getEntry(entry)).readBytes() }
            val collection = File(tmp.root, "read-${System.nanoTime()}.anki2")
            zip.getInputStream(zip.getEntry("collection.anki2")).use { input -> collection.outputStream().use { input.copyTo(it) } }
            return Read(entries, media, files, SQLiteDatabase.openDatabase(collection.path, null, SQLiteDatabase.OPEN_READONLY))
        }
    }

    private fun SQLiteDatabase.strings(sql: String): List<List<String?>> = rawQuery(sql, null).use { c ->
        buildList { while (c.moveToNext()) add((0 until c.columnCount).map { c.getString(it) }) }
    }

    @Test
    fun deckExportIsARealAnkiPackage() = runBlocking {
        val data = FakeData(
            notes = listOf(
                note("n2", "谢谢"),
                note("n1", "你好", audio = "generated/n1.mp3", clue = "你好吗？", clueAudio = "generated/n1-clue.mp3"),
                note("n3", "再见", audio = "generated/missing.mp3"),
                note("n4", "  "),
            ),
            cards = listOf(
                CardEntity("c1", "n1", "d1", "hanzi_to_meaning", queue = 2, scheduledDays = 12, reps = 5, lapses = 1, nextReviewAt = "2026-09-24T08:00:00.000Z", easeFactor = 2.3),
                CardEntity("c2", "n1", "d1", "meaning_to_hanzi", queue = 1, reps = 1, easeFactor = 2.5),
            ),
            clips = mapOf("generated/n1.mp3" to mp3("word"), "generated/n1-clue.mp3" to mp3("clue")),
        )
        val progress = mutableListOf<AnkiExportProgress>()
        val out = File(tmp.root, "out")
        val result = AnkiExporter(data, out) { now }.export(AnkiExportTarget.Deck("d1", "HSK 1"), includeAudio = true, includeProgress = true) { synchronized(progress) { progress += it } }

        assertEquals("HSK-1-Greetings.apkg", result.filename)
        assertEquals(3, result.notes)
        assertEquals(2, result.audioIncluded)
        assertEquals(1, result.audioMissing)
        assertEquals(result.file.length(), result.bytes)
        assertEquals(AnkiExportProgress.Stage.LOADING, progress.first().stage)
        assertEquals(AnkiExportProgress(AnkiExportProgress.Stage.BUILDING, 1, 1), progress.last())
        assertTrue(progress.any { it.stage == AnkiExportProgress.Stage.AUDIO && it.done == 3 && it.total == 3 })

        val apkg = read(result.file)
        assertEquals(listOf("collection.anki2", "0", "1", "media"), apkg.entries, "the web's zip entry order")
        val wordName = "${AnkiHash.sha1Hex(mp3("word")).substring(0, 20)}.mp3"
        assertEquals(mapOf("0" to wordName, "1" to "${AnkiHash.sha1Hex(mp3("clue")).substring(0, 20)}.mp3"), apkg.media)
        assertTrue(apkg.files.getValue(wordName).contentEquals(mp3("word")))

        val db = apkg.db
        assertEquals(listOf("cards", "col", "graves", "notes", "revlog"), db.strings("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map { it[0] })
        val col = db.strings("SELECT ver, crt, models, decks FROM col").single()
        assertEquals("11", col[0])
        assertEquals(AnkiCollection.COLLECTION_CRT.toString(), col[1])
        assertTrue(col[2]!!.contains("\"name\":\"汉语学习 Vocabulary\""))
        assertTrue(col[3]!!.contains("\"name\":\"HSK 1 · Greetings\""))

        // Notes in primary-key order (n1, n2, n3); the blank one is skipped.
        val notes = db.strings("SELECT guid, mid, flds, sfld, csum, tags FROM notes ORDER BY id")
        assertEquals(listOf(AnkiHash.guidFor("note", "n1"), AnkiHash.guidFor("note", "n2"), AnkiHash.guidFor("note", "n3")), notes.map { it[0] })
        assertTrue(notes.all { it[1] == AnkiModels.VOCABULARY.id.toString() })
        val n1 = notes[0][2]!!.split('\u001f')
        assertEquals(AnkiModels.VOCABULARY.fields.size, n1.size)
        assertEquals(listOf("你好", "p-n1", "e-n1", "[sound:$wordName]", "你好吗？"), n1.take(5))
        assertEquals("note:n1", n1.last())
        assertEquals("你好", notes[0][3])
        assertEquals(AnkiHash.fieldChecksum("你好").toString(), notes[0][4])
        assertEquals(" chinese-learning deck ", notes[0][5])
        assertEquals("", notes[2][2]!!.split('\u001f')[3], "a clip that couldn't be fetched leaves the field empty")

        // n1 has audio → 3 cards; n2 / n3 have none → 2 each. n1's review card carries its state.
        val cards = db.strings("SELECT n.guid, c.ord, c.type, c.queue, c.ivl, c.factor, c.reps, c.lapses FROM cards c JOIN notes n ON n.id = c.nid ORDER BY c.id")
        assertEquals(7, cards.size)
        assertEquals(7, result.cards)
        assertEquals(listOf("0", "2", "2", "12", "2300", "5", "1"), cards[0].drop(1))
        assertEquals(listOf("1", "2", "2", "1", "2500", "1", "0"), cards[1].drop(1), "a learning card becomes a review due today")
        assertEquals(listOf("2", "0", "0", "0", "0", "0", "0"), cards[2].drop(1))
        db.close()
    }

    @Test
    fun withoutAudioNothingIsFetchedAndNoMediaIsBundled() = runBlocking {
        val data = FakeData(notes = listOf(note("n1", "你好", audio = "generated/n1.mp3")), clips = mapOf("generated/n1.mp3" to mp3("x")))
        val result = AnkiExporter(data, File(tmp.root, "out")) { now }.export(AnkiExportTarget.Deck("d1", "x"), includeAudio = false)
        assertTrue(data.fetched.isEmpty())
        val apkg = read(result.file)
        assertEquals(emptyMap(), apkg.media)
        assertEquals(listOf("collection.anki2", "media"), apkg.entries)
        assertEquals(2, result.cards, "no Audio → no Audio → Hanzi card")
        apkg.db.close()
    }

    @Test
    fun deckNeverSyncedHereComesFromTheApi() = runBlocking {
        val result = AnkiExporter(FakeData(deck = null), File(tmp.root, "out")) { now }.export(AnkiExportTarget.Deck("d9", "x"))
        assertEquals("Remote-deck.apkg", result.filename)
        assertEquals(1, result.notes)
    }

    @Test
    fun readerExportUsesTheCacheOfflineAndNarrationClips() = runBlocking {
        val reader = GradedReaderDto(
            id = "r1", titleChinese = "小猫的一天", titleEnglish = "A cat's day",
            pages = listOf(
                ReaderPageDto("p2", 2, "它去公园玩。", "tā qù gōngyuán wán", "It goes to the park."),
                ReaderPageDto("p1", 1, "小猫早上起床。", "xiǎo māo zǎoshang qǐchuáng", "The kitten gets up."),
            ),
            vocabularyUsed = listOf(VocabItemDto("公园", "gōngyuán", "park")),
        )
        val data = FakeData(online = false, cachedReader = reader, clips = mapOf("page:p1" to mp3("p1"), "tts:公园" to mp3("park")))
        val result = AnkiExporter(data, File(tmp.root, "out")) { now }.export(AnkiExportTarget.Reader("r1", "小猫的一天"))
        assertEquals("Readers-xiao-mao-de-yi-tian.apkg", result.filename)
        assertEquals(3, result.notes)
        assertEquals(2, result.audioIncluded)
        assertEquals(1, result.audioMissing)
        val apkg = read(result.file)
        val notes = apkg.db.strings("SELECT guid, mid FROM notes ORDER BY id")
        assertEquals(AnkiHash.guidFor("reader-page", "r1", "1"), notes[0][0])
        assertEquals(AnkiModels.SENTENCE.id.toString(), notes[0][1])
        assertEquals(AnkiModels.VOCABULARY.id.toString(), notes[2][1])
        apkg.db.close()
    }

    @Test
    fun readerMissingOfflineIsAReadableError() = runBlocking {
        val e = assertFailsWith<IllegalStateException> {
            AnkiExporter(FakeData(online = false), File(tmp.root, "out")) { now }.export(AnkiExportTarget.Reader("r1", "x"))
        }
        assertEquals("This reader is not available offline", e.message)
    }

    @Test
    fun lessonExportFromTheEditorsSpec() = runBlocking {
        val spec = Json.parseToJsonElement(
            """{"title":"Ordering coffee","sections":[{"exercises":[
              {"type":"match","pairs":[{"hanzi":"咖啡","pinyin":"kāfēi","english":"coffee"}]},
              {"type":"translate","english":"Two coffees","reference_hanzi":"请给我两杯咖啡"}]}]}""",
        ).jsonObject
        val data = FakeData(clips = mapOf("tts:咖啡" to mp3("kafei")))
        val result = AnkiExporter(data, File(tmp.root, "out")) { now }.export(AnkiExportTarget.Lesson(spec, "L1"))
        assertEquals("Lessons-Ordering-coffee.apkg", result.filename)
        assertEquals(2, result.notes)
        assertEquals(4, result.cards, "咖啡: 3 cards (it has audio), the sentence: 1")
        val apkg = read(result.file)
        val flds = apkg.db.strings("SELECT flds FROM notes ORDER BY id").map { it[0]!!.split('\u001f') }
        assertEquals("lesson:L1:咖啡", flds[0].last())
        apkg.db.close()
    }

    @Test
    fun anExportReplacesThePreviousFile() = runBlocking {
        val out = File(tmp.root, "out")
        val exporter = AnkiExporter(FakeData(notes = listOf(note("n1", "你好"))), out) { now }
        exporter.export(AnkiExportTarget.Deck("d1", "x"))
        File(out, "old.apkg").writeText("stale")
        exporter.export(AnkiExportTarget.Deck("d1", "x"))
        assertEquals(listOf("HSK-1-Greetings.apkg"), out.listFiles()!!.map { it.name }.sorted())
    }
}
