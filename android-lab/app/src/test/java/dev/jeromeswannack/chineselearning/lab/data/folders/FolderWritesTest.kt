package dev.jeromeswannack.chineselearning.lab.data.folders

import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.data.api.FolderDto
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummary
import dev.jeromeswannack.chineselearning.lab.data.decks.WriteOutcome
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderStore
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksFixture
import dev.jeromeswannack.chineselearning.lab.ui.library.LibraryKeys
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Folder writes (data/folders/): the web's calls online, applied on the phone at once, queued
 * offline, undone when the server refuses, and kept through a sync while still queued.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FolderWritesTest {
    private lateinit var f: DecksFixture
    private val dao get() = f.db.dao()
    private val w get() = f.folderWrites

    @Before fun setUp() = runBlocking {
        f = DecksFixture()
        f.seed()
        FolderStore.put(f.cache, listOf(Folder("hsk", "u", "deck", "HSK 2", position = 0), Folder("wk1", "u", "deck", "Week 1", parentId = "hsk"), Folder("les", "u", "lesson", "Grammar")))
    }

    @After fun tearDown() = f.close()

    private fun ok(body: String = "{}") = MockResponse().setResponseCode(200).setBody(body)
    private fun body(): kotlinx.serialization.json.JsonObject = Json.parseToJsonElement(f.server.takeRequest().body.readUtf8()).jsonObject

    @Test fun moveOnlineSendsTheWebCallAndMovesTheDeckAtOnce() = runBlocking {
        f.server.enqueue(ok("""{"moved":2,"not_found":[],"folder_id":"hsk"}"""))
        assertEquals(WriteOutcome.Saved, w.move("deck", listOf("d1", "d3"), "hsk"))
        val req = f.server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/folders/move", req.path)
        val b = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("deck", b["kind"]!!.jsonPrimitive.content)
        assertEquals(listOf("d1", "d3"), b["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("hsk", b["folder_id"]!!.jsonPrimitive.content)
        assertEquals(mapOf("d1" to "hsk", "d2" to null, "d3" to "hsk"), dao.decks().associate { it.id to it.folderId })
        // Organisation only: the queue order is untouched.
        assertEquals(mapOf("d1" to 2, "d2" to 1, "d3" to 0), dao.decks().associate { it.id to it.studyPriority })
    }

    @Test fun movingToUnfiledSendsAnExplicitNull() = runBlocking {
        dao.setDeckFolder(listOf("d2"), "hsk")
        f.server.enqueue(ok())
        w.move("deck", listOf("d2"), null)
        assertEquals(JsonNull, body()["folder_id"])
        assertNull(dao.decks().first { it.id == "d2" }.folderId)
    }

    @Test fun offlineMoveIsMirroredQueuedAndSurvivesASyncThatStillHasTheOldFolder() = runBlocking {
        f.online.value = false
        assertEquals(WriteOutcome.Queued, w.move("deck", listOf("d2"), "wk1"))
        assertEquals("wk1", dao.decks().first { it.id == "d2" }.folderId)
        val queued = f.outbox.all().single()
        assertEquals(FolderStore.MOVE, queued.kind)
        assertEquals(Outbox.PENDING, queued.state)
        assertEquals(1, f.queued)
        // A sync rewrites the deck from the server (still Unfiled there) …
        dao.upsertDecks(listOf(dao.decks().first { it.id == "d2" }.copy(folderId = null)))
        FolderStore.reapplyPendingItems(dao, f.cache, f.db.platform())
        // … and the move still waiting in the Outbox wins.
        assertEquals("wk1", dao.decks().first { it.id == "d2" }.folderId)
    }

    @Test fun deleteSendsDeleteAndPutsItemsAndSubfoldersBackOutside() = runBlocking {
        dao.setDeckFolder(listOf("d1", "d2"), "hsk")
        f.server.enqueue(ok("""{"deleted":true,"unfiled":2,"lifted":1}"""))
        assertEquals(WriteOutcome.Saved, w.delete(FolderStore.all(f.cache).first { it.id == "hsk" }))
        val req = f.server.takeRequest()
        assertEquals("DELETE", req.method)
        assertEquals("/api/folders/hsk", req.path)
        assertEquals(listOf(null, null, null), dao.decks().map { it.folderId })
        val left = FolderStore.all(f.cache)
        assertEquals(listOf("wk1", "les"), left.map { it.id })
        assertNull(left.first { it.id == "wk1" }.parentId) // lifted to the top level
    }

    @Test fun offlineDeleteKeepsItsUnfilingThroughASync() = runBlocking {
        dao.setDeckFolder(listOf("d1"), "hsk")
        f.online.value = false
        assertEquals(WriteOutcome.Queued, w.delete(FolderStore.all(f.cache).first { it.id == "hsk" }))
        // The next sync still has the folder (and the deck in it) on the server side.
        FolderStore.replaceFromServer(f.cache, f.db.platform(), listOf(FolderDto("hsk", "u", "deck", "HSK 2"), FolderDto("wk1", "u", "deck", "Week 1", "hsk")))
        dao.setDeckFolder(listOf("d1"), "hsk")
        FolderStore.reapplyPendingItems(dao, f.cache, f.db.platform())
        assertEquals(listOf("wk1"), FolderStore.all(f.cache).map { it.id })
        assertNull(dao.decks().first { it.id == "d1" }.folderId)
    }

    @Test fun createCarriesAClientIdAndGoesLastAmongItsSiblings() = runBlocking {
        f.server.enqueue(MockResponse().setResponseCode(201).setBody("{}"))
        val (out, folder) = w.create("deck", "  Food   words ", null)
        assertEquals(WriteOutcome.Saved, out)
        val b = body()
        assertEquals("Food words", b["name"]!!.jsonPrimitive.content)
        assertEquals("folder-1", b["id"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, b["parent_id"])
        assertEquals("Food words", folder!!.name)
        assertEquals(1, folder.position)
    }

    @Test fun badNamesAndTwoLevelsAreRefusedOnThePhone() = runBlocking {
        assertEquals(WriteOutcome.Refused("Give the folder a name"), w.create("deck", "   ", null).first)
        assertEquals(WriteOutcome.Refused("Folders go one level deep: pick a top-level folder"), w.create("deck", "Deep", "wk1").first)
        assertEquals(0, f.server.requestCount)
    }

    @Test fun aRefusedWriteIsUndone() = runBlocking {
        f.server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"Invalid folder","problems":["That folder does not exist"]}"""))
        val out = w.move("deck", listOf("d1"), "hsk")
        assertEquals(WriteOutcome.Refused("That folder does not exist"), out)
        assertNull(dao.decks().first { it.id == "d1" }.folderId)
    }

    @Test fun lessonAndReaderMovesPatchTheirListCaches() = runBlocking {
        f.cache.put(LibraryKeys.LIST, LibraryKeys.KIND, listOf(LibraryItemSummary("l1", "了 lesson"), LibraryItemSummary("l2", "把 lesson")), ListSerializer(LibraryItemSummary.serializer()))
        f.cache.put(ReaderStore.LIST, ReaderStore.KIND, listOf(GradedReaderDto("r1", "小明在巴黎")), ListSerializer(GradedReaderDto.serializer()))
        f.online.value = false
        w.move("lesson", listOf("l2"), "les")
        w.move("reader", listOf("r1"), "rf")
        assertEquals(listOf(null, "les"), f.cache.get(LibraryKeys.LIST, ListSerializer(LibraryItemSummary.serializer()))!!.map { it.folder_id })
        assertEquals("rf", f.cache.get(ReaderStore.LIST, ListSerializer(GradedReaderDto.serializer()))!!.single().folderId)
        assertEquals(2, f.outbox.all().size)
    }

    @Test fun reorderAndRenameMirrorTheFolderList() = runBlocking {
        f.server.enqueue(ok())
        f.server.enqueue(ok())
        FolderStore.put(f.cache, FolderStore.all(f.cache) + Folder("food", "u", "deck", "Food", position = 1))
        w.reorder("deck", listOf("food", "hsk"))
        assertEquals("""{"kind":"deck","folder_ids":["food","hsk"]}""", f.server.takeRequest().body.readUtf8())
        w.rename(FolderStore.all(f.cache).first { it.id == "food" }, "Food & drink")
        val req = f.server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("""{"name":"Food & drink"}""", req.body.readUtf8())
        val all = FolderStore.all(f.cache).associateBy { it.id }
        assertEquals(0, all.getValue("food").position)
        assertEquals(1, all.getValue("hsk").position)
        assertEquals("Food & drink", all.getValue("food").name)
    }

    @Test fun aFetchedListKeepsAFolderCreatedOffline() = runBlocking {
        f.online.value = false
        val (out, folder) = w.create("reader", "Stories", null)
        assertEquals(WriteOutcome.Queued, out)
        FolderStore.replaceFromServer(f.cache, f.db.platform(), listOf(FolderDto("hsk", "u", "deck", "HSK 2")))
        assertTrue(FolderStore.all(f.cache).any { it.id == folder!!.id && it.name == "Stories" })
    }

    @Test fun theControllerMovesFromTheSheetAndSaysWhere() = runBlocking {
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Unconfined)
        val folderOf = mapOf("d1" to "hsk", "d2" to null, "d3" to null)
        val c = dev.jeromeswannack.chineselearning.lab.ui.folders.FolderController(scope, "deck", f.cache, w, currentFolderOf = { folderOf[it] }, toastMs = 60_000)
        try {
            suspend fun until(cond: () -> Boolean) = kotlinx.coroutines.withTimeout(5_000) { while (!cond()) kotlinx.coroutines.delay(10) }
            // Mixed folders: nothing ticked.
            c.openMove(listOf("d1", "d2"))
            until { c.ui.value.sheet != null }
            assertEquals(dev.jeromeswannack.chineselearning.lab.ui.folders.FolderController.MIXED, (c.ui.value.sheet as dev.jeromeswannack.chineselearning.lab.ui.folders.FolderSheet.Move).currentFolderId)
            c.startSelecting()
            c.toggleSelected("d2")
            c.toggleSelected("d3")
            c.openMoveSelected()
            until { (c.ui.value.sheet as? dev.jeromeswannack.chineselearning.lab.ui.folders.FolderSheet.Move)?.ids?.size == 2 }
            val sheet = c.ui.value.sheet as dev.jeromeswannack.chineselearning.lab.ui.folders.FolderSheet.Move
            assertEquals(setOf("d2", "d3"), sheet.ids.toSet())
            assertNull(sheet.currentFolderId)
            f.server.enqueue(ok())
            c.moveTo("hsk")
            kotlinx.coroutines.withTimeout(5_000) { while (c.ui.value.toast == null) kotlinx.coroutines.delay(10) }
            assertEquals("Moved 2 decks to HSK 2", c.ui.value.toast)
            assertEquals(false, c.ui.value.selecting)
            assertEquals(setOf("d2", "d3"), dao.decks().filter { it.folderId == "hsk" }.map { it.id }.toSet() - "d1")
            // Collapsed groups are remembered (per device, per kind).
            c.toggle("hsk")
            kotlinx.coroutines.withTimeout(5_000) { while ("hsk" !in c.ui.value.collapsed) kotlinx.coroutines.delay(10) }
            c.toggle(null)
            kotlinx.coroutines.withTimeout(5_000) { while ("unfiled" !in c.ui.value.collapsed) kotlinx.coroutines.delay(10) }
        } finally {
            scope.cancel()
        }
    }
}
