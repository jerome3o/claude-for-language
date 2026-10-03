package dev.jeromeswannack.chineselearning.lab.core

import java.text.Collator
import java.util.Locale

/**
 * Port of shared/folders/folders.ts: folders for decks, Lesson Library items and graded
 * readers — organisation only. One model for all three (server table `folders`, migration
 * 0099): a folder belongs to one user and one [kind], has a name, an optional parent (ONE
 * level of nesting) and a [position] among its siblings. Items carry a nullable folder id;
 * null = Unfiled. Folders never touch the study queue.
 *
 * Parity-tested against the TypeScript (parity/fixtures/folders.ts, FoldersParityTest).
 */
data class Folder(
    val id: String,
    val userId: String = "",
    /** deck | lesson | reader */
    val kind: String,
    val name: String,
    /** A top-level folder's id, or null. Never deeper than one level. */
    val parentId: String? = null,
    val position: Int = 0,
    val createdAt: String = "",
    val updatedAt: String = "",
)

/** `FolderGroup<T>`: one folder (null = Unfiled) with its items and subfolders. */
data class FolderGroup<T>(
    /** null = Unfiled. */
    val folder: Folder?,
    val items: List<T>,
    /** Subfolders (one level). Always empty on a subfolder and on Unfiled. */
    val children: List<FolderGroup<T>>,
    /** Items here and in the subfolders. */
    val total: Int,
)

data class FolderTree<T>(val groups: List<FolderGroup<T>>, val unfiled: FolderGroup<T>)

data class FolderOption(val folder: Folder, val depth: Int)

object Folders {
    const val DECK = "deck"
    const val LESSON = "lesson"
    const val READER = "reader"
    val KINDS = listOf(DECK, LESSON, READER)

    const val FOLDER_NAME_MAX = 60
    const val MAX_FOLDERS_PER_KIND = 200
    const val UNFILED_LABEL = "Unfiled"

    fun isFolderKind(v: String?): Boolean = v == DECK || v == LESSON || v == READER

    /** `folderItemNoun`: what a kind of folder holds. */
    fun folderItemNoun(kind: String, count: Int = 2): String {
        val one = when (kind) {
            DECK -> "deck"
            LESSON -> "lesson"
            else -> "reader"
        }
        return if (count == 1) one else "${one}s"
    }

    /** `cleanFolderName`: JS `\s+` → one space, then trimmed; '' when blank / null. */
    fun cleanFolderName(raw: String?): String {
        if (raw == null) return ""
        val sb = StringBuilder()
        var inSpace = false
        for (c in raw) {
            if (NoteSearch.isJsWhitespace(c)) {
                if (!inSpace) sb.append(' ')
                inSpace = true
            } else {
                sb.append(c)
                inSpace = false
            }
        }
        return NoteSearch.jsTrim(sb.toString())
    }

    /** `folderNameProblems` (empty = fine). Length counts code points, like `[...name]`. */
    fun folderNameProblems(raw: String?): List<String> {
        val name = cleanFolderName(raw)
        if (name.isEmpty()) return listOf("Give the folder a name")
        if (name.codePointCount(0, name.length) > FOLDER_NAME_MAX) return listOf("Folder names are at most $FOLDER_NAME_MAX characters")
        return emptyList()
    }

    /** `folderNameKey`: case- and space-insensitive name match. */
    fun folderNameKey(name: String): String = cleanFolderName(name).lowercase(Locale.ROOT)

    /**
     * `parentProblem`: where a folder may be placed — [parentId] must be a top-level folder of
     * the same kind, not the folder itself, and a folder with subfolders stays at the top.
     */
    fun parentProblem(folderId: String?, kind: String, parentId: String?, all: List<Folder>): String? {
        if (parentId == null) return null
        if (!folderId.isNullOrEmpty() && parentId == folderId) return "A folder can't go inside itself"
        val parent = all.firstOrNull { it.id == parentId }
        if (parent == null || parent.kind != kind) return "That folder does not exist"
        if (!parent.parentId.isNullOrEmpty()) return "Folders go one level deep: pick a top-level folder"
        if (!folderId.isNullOrEmpty() && all.any { it.parentId == folderId }) return "This folder has folders inside it, so it has to stay at the top level"
        return null
    }

    private val collator: Collator = Collator.getInstance(Locale.ROOT)

    /** `sortFolders`: position, then name (`localeCompare`), then id (UTF-16 order). */
    fun sortFolders(folders: List<Folder>): List<Folder> = folders.sortedWith { a, b ->
        when {
            a.position != b.position -> a.position.compareTo(b.position)
            else -> collator.compare(a.name, b.name).let { c -> if (c != 0) c else a.id.compareTo(b.id).coerceIn(-1, 1) }
        }
    }

    /**
     * `groupIntoFolders`: top-level folders in order, each with its items (in the order
     * given) and its subfolders; then Unfiled. An item whose folder is unknown is Unfiled, a
     * subfolder whose parent is unknown (or itself a subfolder) shows at the top level —
     * nothing is ever hidden. Other kinds are ignored; empty folders are kept.
     */
    fun <T> groupIntoFolders(items: List<T>, folderIdOf: (T) -> String?, folders: List<Folder>, kind: String): FolderTree<T> {
        val mine = folders.filter { it.kind == kind }
        val byId = LinkedHashMap<String, Folder>()
        for (f in mine) byId[f.id] = f // last wins, like `new Map(...)`
        fun isTop(f: Folder): Boolean {
            val p = f.parentId
            if (p.isNullOrEmpty()) return true
            val parent = byId[p] ?: return true
            return parent.parentId != null // TS: `!= null`, not truthiness
        }
        val itemsOf = HashMap<String, MutableList<T>>()
        for (f in mine) itemsOf.getOrPut(f.id) { ArrayList() }
        val unfiled = ArrayList<T>()
        for (item in items) {
            val fid = folderIdOf(item)
            val list = if (!fid.isNullOrEmpty()) itemsOf[fid] else null
            (list ?: unfiled).add(item)
        }
        val tops = sortFolders(mine.filter(::isTop))
        val groups = tops.map { top ->
            val children = sortFolders(mine.filter { !isTop(it) && it.parentId == top.id }).map { c ->
                val its = itemsOf[c.id].orEmpty().toList()
                FolderGroup(c, its, emptyList(), its.size)
            }
            val its = itemsOf[top.id].orEmpty().toList()
            FolderGroup(top, its, children, its.size + children.sumOf { it.total })
        }
        return FolderTree(groups, FolderGroup(null, unfiled.toList(), emptyList(), unfiled.size))
    }

    /** `folderOptions`: each top-level folder followed by its subfolders (depth 0 / 1). */
    fun folderOptions(folders: List<Folder>, kind: String): List<FolderOption> {
        val tree = groupIntoFolders(emptyList<Unit>(), { null }, folders, kind)
        val out = ArrayList<FolderOption>()
        for (g in tree.groups) {
            out += FolderOption(g.folder!!, 0)
            for (c in g.children) out += FolderOption(c.folder!!, 1)
        }
        return out
    }

    /** `folderPath`: "HSK 2 › Week 1". */
    fun folderPath(folder: Folder, folders: List<Folder>): String {
        val parent = if (!folder.parentId.isNullOrEmpty()) folders.firstOrNull { it.id == folder.parentId } else null
        return if (parent != null) "${parent.name} › ${folder.name}" else folder.name
    }

    /** `spliceGroupOrder`: the group's slots in [all] keep their places, refilled in [groupOrder]. */
    fun spliceGroupOrder(all: List<String>, groupOrder: List<String>): List<String> {
        val inGroup = groupOrder.toHashSet()
        var i = 0
        return all.map { id -> if (id in inGroup) (groupOrder.getOrNull(i++) ?: id) else id }
    }

    /** `collapseKey`: Unfiled is `unfiled`. */
    fun collapseKey(folderId: String?): String = folderId ?: "unfiled"

    /** `toggleCollapsed`: a new sorted list without duplicates (UTF-16 order, like `.sort()`). */
    fun toggleCollapsed(collapsed: List<String>, key: String): List<String> {
        val set = LinkedHashSet(collapsed)
        if (!set.remove(key)) set.add(key)
        return set.sorted()
    }

    // ---- Copy (the same words as the web) ----

    /** `deleteFolderMessage`: the body of the delete confirmation. */
    fun deleteFolderMessage(kind: String, name: String, itemCount: Int, subfolderCount: Int = 0): String {
        val items = if (itemCount == 0) {
            "“$name” is empty."
        } else {
            "${if (itemCount == 1) "Its" else "All $itemCount"} ${folderItemNoun(kind, itemCount)} ${if (itemCount == 1) "moves" else "move"} to $UNFILED_LABEL."
        }
        val subs = if (subfolderCount > 0) " ${if (subfolderCount == 1) "Its folder moves" else "Its $subfolderCount folders move"} to the top level." else ""
        return "$items$subs Nothing is deleted."
    }

    /** `movedMessage`: "Moved 3 decks to HSK 2" / "Moved 1 lesson to Unfiled". */
    fun movedMessage(kind: String, count: Int, folderName: String?): String =
        "Moved $count ${folderItemNoun(kind, count)} to ${folderName ?: UNFILED_LABEL}"

    /** `folderCountLabel`: "3 decks" / "1 lesson" / "Empty". */
    fun folderCountLabel(kind: String, count: Int): String = if (count == 0) "Empty" else "$count ${folderItemNoun(kind, count)}"
}
