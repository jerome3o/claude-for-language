package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import dev.jeromeswannack.chineselearning.lab.data.decks.DeckWrites
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.mockwebserver.MockWebServer
import java.io.File

/** An in-memory Room mirror with a small account + a fake server, for the package C tests. */
class DecksFixture {
    val server = MockWebServer().apply { start() }
    val db: LabDatabase = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
    val api = Api(server.url("").toString().removeSuffix("/")) { "token-1" }
    val outbox = Outbox(db.platform(), api, File(ApplicationProvider.getApplicationContext<android.app.Application>().filesDir, "outbox-decks").apply { deleteRecursively() })
    val online = MutableStateFlow(true)
    val version = MutableStateFlow(0)
    val cache = JsonCache(db.platform(), api.json)
    var afterWrites = 0
    val writes = DeckWrites(db.dao(), api, outbox, online = { online.value }, onLocalChange = { version.value++ }, afterWrite = { afterWrites++ })
    var queued = 0
    val folderWrites = dev.jeromeswannack.chineselearning.lab.data.folders.FolderWrites(
        db.dao(), api, cache, outbox, online = { online.value }, onLocalChange = { version.value++ }, onQueued = { queued++ },
        newId = { "folder-${++folderIds}" },
    )
    private var folderIds = 0
    val env = DecksEnv(db.dao(), api, writes, cache, online, version, folderWrites = folderWrites)

    suspend fun seed() {
        val dao = db.dao()
        dao.upsertDecks(
            listOf(
                DeckEntity("d1", "HSK 3 · Plans & time", null, 3, 6, 2, "2026-09-01T10:00:00Z"),
                DeckEntity("d2", "Food & ordering", null, 3, 6, 1, "2026-09-02T10:00:00Z"),
                DeckEntity("d3", "Starter Chinese", "15 everyday words", 3, 6, 0, "2026-09-03T10:00:00Z"),
            ),
        )
        dao.upsertNotes(
            listOf(
                note("n1", "d1", "打算", "dǎsuàn", "to plan; to intend", "你周末打算做什么？"),
                note("n2", "d1", "银行", "yínháng", "bank"),
                note("n3", "d2", "菜单", "càidān", "menu"),
                note("n4", "d3", "你好", "nǐ hǎo", "hello"),
            ),
        )
        val cards = listOf("n1" to "d1", "n2" to "d1", "n3" to "d2", "n4" to "d3").flatMap { (n, d) ->
            listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi").map { t -> CardEntity("$n-$t", n, d, t) }
        }
        dao.upsertCards(cards)
        dao.insertEvents(
            listOf(
                ReviewEventEntity("e1", "n1-hanzi_to_meaning", 2, "2026-09-20T08:00:00.000Z", 4000, null, true),
                ReviewEventEntity("e2", "n1-hanzi_to_meaning", 0, "2026-09-21T08:00:00.000Z", 9000, null, true),
                ReviewEventEntity("e3", "n1-meaning_to_hanzi", 3, "2026-09-22T08:00:00.000Z", 5000, "打算", true),
            ),
        )
    }

    fun close() {
        server.shutdown()
        db.close()
    }

    companion object {
        fun note(id: String, deck: String, hanzi: String, pinyin: String, english: String, clue: String? = null, audio: String? = "generated/$id.mp3") =
            NoteEntity(id, deck, hanzi, pinyin, english, audio, null, null, clue, null, null, null, null, "2026-09-01 10:00:00")
    }
}
