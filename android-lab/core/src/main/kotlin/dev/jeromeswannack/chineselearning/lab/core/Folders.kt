package dev.jeromeswannack.chineselearning.lab.core

import java.text.Collator
import java.util.Locale

/**
 * Port of shared/folders/folders.ts: folders for decks, Lesson Library items and graded
 * readers — organisation only. One model for all three (server table `folders`, migration
 * 0105): a folder belongs to one user and one [kind], has a name, an optional parent (folders
 * nest up to [Folders.MAX_FOLDER_DEPTH] levels) and a [position] among its siblings. Items carry a nullable folder id;
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
    /** The folder it sits in, or null = top level. */
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
    /** Subfolders in order, each with theirs (any depth). Always empty on Unfiled. */
    val children: List<FolderGroup<T>>,
    /** Items here and in every subfolder below. */
    val total: Int,
    /** 0 = top level (and Unfiled), 1 = inside a top-level folder, … */
    val depth: Int = 0,
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

    /** `MAX_FOLDER_DEPTH`: a top-level folder is level 1, its subfolders level 2, … */
    const val MAX_FOLDER_DEPTH = 5

    /** `folderAncestors`: the top-level ancestor first, not the folder itself; stops at an unknown parent or a cycle. */
    fun folderAncestors(folder: Folder, all: List<Folder>): List<Folder> {
        val byId = LinkedHashMap<String, Folder>()
        for (f in all) byId[f.id] = f
        val out = ArrayList<Folder>()
        val seen = hashSetOf(folder.id)
        var cur = if (!folder.parentId.isNullOrEmpty()) byId[folder.parentId] else null
        while (cur != null && cur.id !in seen) {
            seen += cur.id
            out.add(0, cur)
            cur = if (!cur.parentId.isNullOrEmpty()) byId[cur.parentId] else null
        }
        return out
    }

    /** `folderLevel`: 1 = top level. */
    fun folderLevel(folder: Folder, all: List<Folder>): Int = folderAncestors(folder, all).size + 1

    /** `folderDescendantIds`: every folder inside [folderId] at any depth, breadth-first. */
    fun folderDescendantIds(folderId: String, all: List<Folder>): List<String> {
        val out = ArrayList<String>()
        val seen = hashSetOf(folderId)
        val queue = ArrayDeque(listOf(folderId))
        while (queue.isNotEmpty()) {
            val id = queue.removeFirst()
            for (f in all) {
                if (f.parentId == id && f.id !in seen) {
                    seen += f.id
                    out += f.id
                    queue.addLast(f.id)
                }
            }
        }
        return out
    }

    /** `subtreeLevels`: levels in a folder's subtree, itself included (1 = no subfolders). */
    fun subtreeLevels(folderId: String, all: List<Folder>): Int {
        val seen = hashSetOf(folderId)
        var level = listOf(folderId)
        var levels = 0
        while (level.isNotEmpty()) {
            levels++
            val ids = level.toHashSet()
            level = all.filter { it.parentId != null && it.parentId in ids && it.id !in seen }.map { it.id }
            seen += level
        }
        return levels
    }

    /**
     * `parentProblem`: [parentId] must be a folder of the same kind, not the folder itself nor
     * one of its own subfolders, and the folder with everything inside it must fit within
     * [MAX_FOLDER_DEPTH] levels. [folderId] null / "" = a new folder.
     */
    fun parentProblem(folderId: String?, kind: String, parentId: String?, all: List<Folder>): String? {
        if (parentId == null) return null
        if (!folderId.isNullOrEmpty() && parentId == folderId) return "A folder can't go inside itself"
        val parent = all.firstOrNull { it.id == parentId }
        if (parent == null || parent.kind != kind) return "That folder does not exist"
        if (!folderId.isNullOrEmpty() && parentId in folderDescendantIds(folderId, all)) return "A folder can't go inside one of its own folders"
        val height = if (!folderId.isNullOrEmpty()) subtreeLevels(folderId, all) else 1
        if (folderLevel(parent, all) + height > MAX_FOLDER_DEPTH) {
            return if (height > 1) "Folders go $MAX_FOLDER_DEPTH levels deep: this folder and the folders inside it don't fit there"
            else "Folders go $MAX_FOLDER_DEPTH levels deep: pick a folder higher up"
        }
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

    /** `displayParents`: the parent a folder is drawn under, or null (unknown parent / a cycle → top level). */
    private fun displayParents(mine: List<Folder>): Map<String, String?> {
        val byId = LinkedHashMap<String, Folder>()
        for (f in mine) byId[f.id] = f
        val out = HashMap<String, String?>()
        for (f in mine) {
            val seen = hashSetOf(f.id)
            var cur = f
            var rooted = false
            while (true) {
                val p = if (!cur.parentId.isNullOrEmpty()) byId[cur.parentId] else null
                if (p == null) { rooted = true; break }
                if (p.id in seen) break
                seen += p.id
                cur = p
            }
            val parent = if (!f.parentId.isNullOrEmpty()) byId[f.parentId] else null
            out[f.id] = if (rooted && parent != null) parent.id else null
        }
        return out
    }

    /**
     * `groupIntoFolders`: the folder tree — top-level folders in order, each with its items (in
     * the order given) and its subfolders at any depth; then Unfiled. An item whose folder is
     * unknown is Unfiled, a folder whose parent is unknown (or in a cycle) shows at the top
     * level — nothing is ever hidden. Other kinds are ignored; empty folders are kept.
     */
    fun <T> groupIntoFolders(items: List<T>, folderIdOf: (T) -> String?, folders: List<Folder>, kind: String): FolderTree<T> {
        val mine = folders.filter { it.kind == kind }
        val parents = displayParents(mine)
        val itemsOf = HashMap<String, MutableList<T>>()
        for (f in mine) itemsOf[f.id] = ArrayList()
        val unfiled = ArrayList<T>()
        for (item in items) {
            val fid = folderIdOf(item)
            val list = if (!fid.isNullOrEmpty()) itemsOf[fid] else null
            (list ?: unfiled).add(item)
        }
        val childrenOf = LinkedHashMap<String?, MutableList<Folder>>()
        for (f in mine) childrenOf.getOrPut(parents[f.id]) { ArrayList() }.add(f)
        val built = HashSet<String>()
        fun build(f: Folder, depth: Int): FolderGroup<T> {
            built += f.id
            val children = sortFolders(childrenOf[f.id].orEmpty().filter { it.id !in built }).map { build(it, depth + 1) }
            val own = itemsOf[f.id].orEmpty().toList()
            return FolderGroup(f, own, children, own.size + children.sumOf { it.total }, depth)
        }
        val groups = sortFolders(childrenOf[null].orEmpty()).map { build(it, 0) }
        return FolderTree(groups, FolderGroup(null, unfiled.toList(), emptyList(), unfiled.size, 0))
    }

    /** `flattenFolderGroups`: every group, each before its subfolders (depth-first). */
    fun <T> flattenFolderGroups(groups: List<FolderGroup<T>>): List<FolderGroup<T>> {
        val out = ArrayList<FolderGroup<T>>()
        fun walk(g: FolderGroup<T>) { out += g; g.children.forEach(::walk) }
        groups.forEach(::walk)
        return out
    }

    /** `folderOptions`: depth-first, each folder followed by its subfolders, with their depth. */
    fun folderOptions(folders: List<Folder>, kind: String): List<FolderOption> {
        val tree = groupIntoFolders(emptyList<Unit>(), { null }, folders, kind)
        return flattenFolderGroups(tree.groups).map { FolderOption(it.folder!!, it.depth) }
    }

    /** `folderPath`: "HSK 2 › Week 1 › Monday". */
    fun folderPath(folder: Folder, folders: List<Folder>, separator: String = " › "): String =
        (folderAncestors(folder, folders).map { it.name } + folder.name).joinToString(separator)

    private val PATH_SPLIT = Regex("[/›>]")

    /** `parseFolderPath`: "HSK 2 / Week 1" → ["HSK 2", "Week 1"]. */
    fun parseFolderPath(path: String): List<String> = path.split(PATH_SPLIT).map(::cleanFolderName).filter { it.isNotEmpty() }

    /** `findFolderByPath`: from the top level down; a single name also matches at any depth. */
    fun findFolderByPath(folders: List<Folder>, kind: String, path: List<String>): Folder? {
        if (path.isEmpty()) return null
        val tree = groupIntoFolders(emptyList<Unit>(), { null }, folders, kind)
        var level = tree.groups
        var hit: FolderGroup<Unit>? = null
        for (name in path) {
            val key = folderNameKey(name)
            hit = level.firstOrNull { folderNameKey(it.folder!!.name) == key }
            if (hit == null) break
            level = hit.children
        }
        if (hit != null) return hit.folder
        if (path.size == 1) {
            val key = folderNameKey(path[0])
            return flattenFolderGroups(tree.groups).firstOrNull { folderNameKey(it.folder!!.name) == key }?.folder
        }
        return null
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

    /** `deleteFolderMessage`: the body of the delete confirmation; subfolders move up into [parentName] (null = the top level). */
    fun deleteFolderMessage(kind: String, name: String, itemCount: Int, subfolderCount: Int = 0, parentName: String? = null): String {
        val items = if (itemCount == 0) {
            "“$name” is empty."
        } else {
            "${if (itemCount == 1) "Its" else "All $itemCount"} ${folderItemNoun(kind, itemCount)} ${if (itemCount == 1) "moves" else "move"} to $UNFILED_LABEL."
        }
        val where = if (parentName != null) "into “$parentName”" else "to the top level"
        val subs = if (subfolderCount > 0) " ${if (subfolderCount == 1) "Its folder moves" else "Its $subfolderCount folders move"} $where." else ""
        return "$items$subs Nothing is deleted."
    }

    /** `movedMessage`: "Moved 3 decks to HSK 2" / "Moved 1 lesson to Unfiled". */
    fun movedMessage(kind: String, count: Int, folderName: String?): String =
        "Moved $count ${folderItemNoun(kind, count)} to ${folderName ?: UNFILED_LABEL}"

    /** `folderCountLabel`: "3 decks" / "1 lesson" / "Empty". */
    fun folderCountLabel(kind: String, count: Int): String = if (count == 0) "Empty" else "$count ${folderItemNoun(kind, count)}"
}
