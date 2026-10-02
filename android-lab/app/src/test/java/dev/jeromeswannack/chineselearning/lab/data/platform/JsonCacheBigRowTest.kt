package dev.jeromeswannack.chineselearning.lab.data.platform

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Regression for "the Lab app closes on every open" (v0.357–v0.360): Jerome's
 * "readers/list" document (38 readers with their vocabulary lists and, since #477, every
 * page's word chips) grew past 2 MB of UTF-8. Android reads a row through a 2 MB
 * CursorWindow, so Room threw SQLiteBlobTooBigException on every read of that row — and
 * Home's readers flow crashed the app about a second after launch. The background sync
 * only ever WROTE the row, so hourly syncs kept working.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class JsonCacheBigRowTest {
    private lateinit var db: LabDatabase
    private lateinit var dir: File
    private val json = Json { ignoreUnknownKeys = true }
    private val ser = ListSerializer(String.serializer())

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        dir = File(ApplicationProvider.getApplicationContext<android.app.Application>().filesDir, "json-cache-test").apply { deleteRecursively() }
    }

    @After fun tearDown() = db.close()

    /** ~3 MB of UTF-8 — Chinese text (3 bytes a character) like the readers list, with an emoji (4 bytes) or two. */
    private fun big(): List<String> = (0 until 2_000).map { i -> "第${i}页：小明在巴黎的咖啡馆里喝咖啡，他觉得很开心😀。".repeat(20) }

    @Test fun theOldRowLayoutReallyCannotBeReadBack() = runBlocking {
        // The failure itself, so this test keeps meaning something: a 3 MB row read whole throws.
        db.platform().putCache(listOf(JsonCacheEntity("readers/list", "readers", json.encodeToString(ser, big()), 1L)))
        assertFailsWith<android.database.sqlite.SQLiteBlobTooBigException> { db.platform().cacheEntry("readers/list") }
        Unit
    }

    @Test fun aBigDocumentGoesToAFileAndReadsBackEveryWay() = runBlocking {
        val cache = JsonCache(db.platform(), json, dir = dir)
        val value = big()
        cache.put("readers/list", "readers", value, ser)
        assertTrue(db.platform().cacheEntry("readers/list")!!.json.startsWith(JsonCache.FILE_MARKER), "the row holds a pointer")
        assertEquals(value, cache.get("readers/list", ser))
        assertEquals(value, cache.observe("readers/list", ser).first())
        assertEquals(listOf(value), cache.all("readers", ser))
        assertEquals(listOf(value), cache.observeAll("readers", ser).first())
        assertEquals(value, cache.decode(ser, cache.entry("readers/list")!!.json))
        // Shrinking back under the limit keeps it in the row and removes the file.
        cache.put("readers/list", "readers", listOf("小"), ser)
        assertEquals(listOf("小"), cache.get("readers/list", ser))
        assertEquals(0, dir.listFiles().orEmpty().count { it.name.endsWith(".json") })
        cache.put("readers/list", "readers", value, ser)
        cache.delete("readers/list")
        assertNull(cache.get("readers/list", ser))
        assertEquals(0, dir.listFiles().orEmpty().count { it.name.endsWith(".json") })
    }

    @Test fun anOversizedRowFromAnOlderBuildIsRecoveredLosslesslyAndMovedToAFile() = runBlocking {
        val value = big()
        db.platform().putCache(listOf(JsonCacheEntity("readers/list", "readers", json.encodeToString(ser, value), 7L)))
        val cache = JsonCache(db.platform(), json, dir = dir)
        assertEquals(value, cache.observe("readers/list", ser).first(), "Home's flow gets the readers instead of crashing")
        assertTrue(db.platform().cacheEntry("readers/list")!!.json.startsWith(JsonCache.FILE_MARKER), "moved to a file")
        assertEquals(value, cache.get("readers/list", ser))
        assertEquals(7L, cache.updatedAt("readers/list"))
    }

    @Test fun smallDocumentsStayInTheRow() = runBlocking {
        val cache = JsonCache(db.platform(), json, dir = dir)
        cache.put("lessons/list", "lessons", listOf("一", "二"), ser)
        assertEquals("""["一","二"]""", db.platform().cacheEntry("lessons/list")!!.json)
        assertEquals(listOf("一", "二"), cache.observe("lessons/list", ser).first())
    }
}
