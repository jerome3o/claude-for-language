package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Folders reproduce shared/folders/folders.ts exactly (parity/fixtures/folders.ts). */
class FoldersParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "folders.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun JsonElement.strings(): List<String> = jsonArray.map { it.jsonPrimitive.content }

    private fun folder(e: JsonElement): Folder = e.jsonObject.let {
        Folder(
            id = it["id"].str!!,
            userId = it["user_id"].str.orEmpty(),
            kind = it["kind"].str!!,
            name = it["name"].str!!,
            parentId = it["parent_id"].str,
            position = it["position"]!!.jsonPrimitive.int,
        )
    }

    @Test
    fun names() {
        for (c in data["names"]!!.jsonArray) {
            val o = c.jsonObject
            val raw = o["raw"].str
            assertEquals(o["clean"].str, Folders.cleanFolderName(raw), "clean $raw")
            assertEquals(o["problems"]!!.strings(), Folders.folderNameProblems(raw), "problems $raw")
            if (raw != null) assertEquals(o["key"].str, Folders.folderNameKey(raw), "key $raw")
        }
    }

    private data class Item(val id: String, val folderId: String?)

    private fun shape(g: FolderGroup<Item>): JsonObject = JsonObject(
        mapOf(
            "folder" to (g.folder?.id?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: JsonNull),
            "items" to JsonArray(g.items.map { kotlinx.serialization.json.JsonPrimitive(it.id) }),
            "total" to kotlinx.serialization.json.JsonPrimitive(g.total),
            "children" to JsonArray(g.children.map(::shape)),
        ),
    )

    @Test
    fun groupingOptionsSortingAndPaths() {
        val cases = data["groupings"]!!.jsonArray
        assertTrue(cases.size >= 100)
        for (c in cases) {
            val o = c.jsonObject
            val kind = o["kind"].str!!
            val folders = o["folders"]!!.jsonArray.map(::folder)
            val items = o["items"]!!.jsonArray.map { Item(it.jsonObject["id"].str!!, it.jsonObject["folder_id"].str) }
            val tree = Folders.groupIntoFolders(items, { it.folderId }, folders, kind)
            assertEquals(o["groups"], JsonArray(tree.groups.map(::shape)), "groups $o")
            assertEquals(o["unfiled"], shape(tree.unfiled), "unfiled $o")
            val opts = Folders.folderOptions(folders, kind)
            assertEquals(o["options"]!!.jsonArray.map { it.jsonObject["id"].str!! to it.jsonObject["depth"]!!.jsonPrimitive.int }, opts.map { it.folder.id to it.depth }, "options $o")
            assertEquals(o["sorted"]!!.strings(), Folders.sortFolders(folders).map { it.id }, "sorted $o")
            assertEquals(o["paths"]!!.strings(), folders.map { Folders.folderPath(it, folders) }, "paths $o")
        }
    }

    @Test
    fun parentRules() {
        val base = listOf(
            Folder("a", "u", "deck", "A"),
            Folder("b", "u", "deck", "B", parentId = "a"),
            Folder("l", "u", "lesson", "Lessons"),
            Folder("c", "u", "deck", "C"),
            Folder("e", "u", "deck", "E", parentId = ""),
        )
        for (c in data["parents"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["problem"].str, Folders.parentProblem(o["id"].str, o["kind"].str!!, o["parent"].str, base), "$o")
        }
    }

    @Test
    fun spliceAndCollapsed() {
        for (c in data["splices"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"]!!.strings(), Folders.spliceGroupOrder(o["all"]!!.strings(), o["order"]!!.strings()), "$o")
        }
        for (c in data["toggles"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["after"]!!.strings(), Folders.toggleCollapsed(o["before"]!!.strings(), o["key"].str!!), "$o")
        }
        assertEquals(data["collapse_null"].str, Folders.collapseKey(null))
    }

    @Test
    fun copy() {
        for (c in data["copy"]!!.jsonArray) {
            val o = c.jsonObject
            val kind = o["kind"].str!!
            val n = o["n"]!!.jsonPrimitive.int
            assertEquals(o["noun"].str, Folders.folderItemNoun(kind, n))
            assertEquals(o["count"].str, Folders.folderCountLabel(kind, n))
            assertEquals(o["moved"].str, Folders.movedMessage(kind, n, "HSK 2"))
            assertEquals(o["moved_unfiled"].str, Folders.movedMessage(kind, n, null))
            assertEquals(o["del"]!!.strings(), (0..2).map { Folders.deleteFolderMessage(kind, "HSK 2", n, it) })
        }
    }
}
