package dev.jeromeswannack.chineselearning.lab.core.claude

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant

/**
 * Claude's card tools in a card thread (Ask Claude on a study card) — port of
 * shared/claude/cardTools.ts, parity-tested by parity/fixtures/claude-card-tools.ts. The server
 * applies them when the reply finishes; the app brings its own study state in line ONCE per reply
 * ([effects]) and draws one line per result under the reply ([lines]): "✓ Claude edited this card ·
 * Undo". Undo puts back the fields the edit changed ([undoEditFields]).
 */
object CardTools {
    data class Result(val tool: String, val success: Boolean, val data: JsonObject? = null, val error: String? = null)

    /** The note fields edit_current_card may change, in the order the line lists them. */
    val EDIT_FIELDS = listOf("hanzi", "pinyin", "english", "fun_facts", "sentence_clue", "sentence_clue_pinyin", "sentence_clue_translation")
    private val KEPT_FIELDS = EDIT_FIELDS + listOf("sentence_clue_audio_url", "audio_url", "updated_at")
    private val FIELD_LABELS = mapOf(
        "hanzi" to "characters", "pinyin" to "pinyin", "english" to "meaning", "fun_facts" to "notes",
        "sentence_clue" to "example sentence", "sentence_clue_pinyin" to "example sentence", "sentence_clue_translation" to "example sentence",
    )

    /** `parseCardToolResults`: the stored JSON; anything unreadable → []. */
    fun parse(raw: String?): List<Result> {
        if (raw.isNullOrEmpty()) return emptyList()
        val v = runCatching { Json.parseToJsonElement(raw) }.getOrNull() as? JsonArray ?: return emptyList()
        return v.mapNotNull { r ->
            val o = r as? JsonObject ?: return@mapNotNull null
            val tool = (o["tool"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
            Result(
                tool = tool,
                success = (o["success"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true,
                data = o["data"] as? JsonObject,
                error = (o["error"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
            )
        }
    }

    private fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun strings(e: JsonElement?): List<String> = (e as? JsonArray)?.mapNotNull { str(it)?.takeIf { s -> s.trim().isNotEmpty() } }.orEmpty()

    /** `data.created` (a card thread) when it is a list, else `data.notes` (every other Claude chat). */
    private fun createdList(data: JsonObject?): JsonArray? = (data?.get("created") as? JsonArray) ?: (data?.get("notes") as? JsonArray)

    private fun createdHanzi(data: JsonObject?): List<String> =
        createdList(data)?.mapNotNull { (it as? JsonObject)?.let { o -> str(o["hanzi"]) }?.takeIf { h -> h.isNotEmpty() } }.orEmpty()

    /** A card create_flashcards made, as the tappable word under the reply (→ the language explorer). */
    data class AddedCard(
        val noteId: String,
        val hanzi: String,
        val pinyin: String? = null,
        val english: String? = null,
        val deckId: String? = null,
        val deckName: String? = null,
    )

    /**
     * `addedCards`: the cards ONE create_flashcards result made, in order, each once — `data.created`
     * (a card thread) or `data.notes` (any other chat); entries without an id or hanzi left out.
     */
    fun addedCards(data: JsonObject?): List<AddedCard> {
        val list = createdList(data) ?: return emptyList()
        val deckId = str(data?.get("deck_id")) ?: str(data?.get("targetDeckId"))
        val deckName = str(data?.get("deck_name"))
        val seen = HashSet<String>()
        val out = ArrayList<AddedCard>()
        for (c in list) {
            val o = c as? JsonObject ?: continue
            val id = str(o["id"])?.trim()
            val hanzi = str(o["hanzi"])?.trim()
            if (id.isNullOrEmpty() || hanzi.isNullOrEmpty() || !seen.add(id)) continue
            out += AddedCard(id, hanzi, str(o["pinyin"])?.trim()?.ifEmpty { null }, str(o["english"])?.trim()?.ifEmpty { null }, deckId, deckName)
        }
        return out
    }

    /** `addedCardsHead`: "✓ Added 2 cards" (the added line's start when its words follow as chips). */
    fun addedCardsHead(n: Int): String = "✓ Added $n card${if (n == 1) "" else "s"}"

    private fun createdCount(data: JsonObject?): Int {
        val n = (data?.get("count") as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
        if (n != null && n.isFinite() && n >= 0) return kotlin.math.floor(n).toInt()
        return createdHanzi(data).size
    }

    /** `editedFields`: the fields the edit asked for, in [EDIT_FIELDS] order. */
    fun editedFields(data: JsonObject?): List<String> {
        val c = data?.get("changes") as? JsonObject ?: return emptyList()
        return EDIT_FIELDS.filter { str(c[it]) != null }
    }

    /** What the device does about one reply's results. [edited] = field → value (null = cleared). */
    data class Effects(
        val edited: Map<String, String?>? = null,
        val deleted: Boolean = false,
        val cardsAdded: Int = 0,
        val lessons: Int = 0,
        val bumped: List<String> = emptyList(),
    )

    fun effects(results: List<Result>): Effects {
        var out = Effects()
        for (r in results) {
            if (!r.success) continue
            when (r.tool) {
                "edit_current_card" -> {
                    val note = r.data?.get("note") as? JsonObject ?: continue
                    val edited = LinkedHashMap<String, String?>()
                    for (k in KEPT_FIELDS) {
                        if (!note.containsKey(k)) continue
                        when (val v = note[k]) {
                            is JsonNull -> edited[k] = null
                            is JsonPrimitive -> if (v.isString) edited[k] = v.content
                            else -> Unit
                        }
                    }
                    out = out.copy(edited = edited)
                }
                "delete_current_card" -> out = out.copy(deleted = true)
                "create_flashcards" -> out = out.copy(cardsAdded = out.cardsAdded + createdCount(r.data))
                "create_custom_lesson" -> out = out.copy(lessons = out.lessons + 1)
                "bump_cards" -> {
                    val b = out.bumped.toMutableList()
                    for (h in strings(r.data?.get("bumped"))) if (h !in b) b += h
                    out = out.copy(bumped = b)
                }
            }
        }
        return out
    }

    /**
     * One line under the reply; [undo] = it offers Undo (an edit). [kind]: edited | added | deleted |
     * lesson | bumped | failed. An added line also has [head] ("✓ Added 2 cards") and [cards] (with
     * note ids; empty for an old row): shown as [head] + a tappable chip per card, else [text].
     */
    data class Line(val kind: String, val text: String, val undo: Boolean, val head: String? = null, val cards: List<AddedCard> = emptyList())

    private val FAILED_LABELS = mapOf(
        "edit_current_card" to "Couldn’t edit this card",
        "delete_current_card" to "Couldn’t delete this card",
        "create_flashcards" to "Couldn’t add the cards",
        "create_custom_lesson" to "Couldn’t make the mini lesson",
        "bump_cards" to "Couldn’t bump those words",
    )

    fun lines(results: List<Result>): List<Line> {
        val out = ArrayList<Line>()
        for (r in results) {
            if (!r.success) {
                FAILED_LABELS[r.tool]?.let { label -> out += Line("failed", "✗ $label${r.error?.takeIf { it.isNotEmpty() }?.let { ": $it" } ?: ""}", false) }
                continue
            }
            when (r.tool) {
                "edit_current_card" -> {
                    val fields = editedFields(r.data).map { FIELD_LABELS.getValue(it) }.distinct()
                    out += Line("edited", "✓ Claude edited this card${if (fields.isNotEmpty()) " · ${fields.joinToString(", ")}" else ""}", true)
                }
                "delete_current_card" -> out += Line("deleted", "🗑 Claude deleted this card", false)
                "create_flashcards" -> {
                    val n = createdCount(r.data)
                    val hanzi = createdHanzi(r.data)
                    out += Line("added", "${addedCardsHead(n)}${if (hanzi.isNotEmpty()) ": ${hanzi.joinToString("、")}" else ""}", false, addedCardsHead(n), addedCards(r.data))
                }
                "create_custom_lesson" -> {
                    val title = str(r.data?.get("title"))?.trim()
                    out += Line("lesson", "🎓 Mini lesson made${if (!title.isNullOrEmpty()) ": $title" else ""} — it’s on your Mini Lessons page", false)
                }
                "bump_cards" -> {
                    val bumped = strings(r.data?.get("bumped"))
                    val already = strings(r.data?.get("already_bumped"))
                    if (bumped.isNotEmpty()) out += Line("bumped", "⚡ Study it today: ${bumped.joinToString("、")}", false)
                    else if (already.isNotEmpty()) out += Line("bumped", "⚡ Already in today’s study: ${already.joinToString("、")}", false)
                }
            }
        }
        return out
    }

    /** `undoEditFields`: the fields the edit changed, back to what the card said before it (old empty → ""). */
    fun undoEditFields(before: Map<String, String?>, edited: Map<String, String?>): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (f in EDIT_FIELDS) {
            if (!edited.containsKey(f)) continue
            val was = before[f] ?: ""
            val now = edited[f] ?: ""
            if (was != now) out[f] = was
        }
        return out
    }

    // ---------- The sheet's "Earlier about 银行" ----------

    data class ThreadRef(val id: String, val contextKind: String, val noteId: String?, val lastMessageAt: String?, val createdAt: String, val archived: Boolean = false)

    private fun at(t: ThreadRef): Long = runCatching { Instant.parse(t.lastMessageAt ?: t.createdAt).toEpochMilli() }.getOrDefault(0L)

    /** `earlierCardThreads`: the card's other threads (not archived, not [currentId]), newest activity first. */
    fun earlierCardThreads(threads: List<ThreadRef>, noteId: String, currentId: String?): List<ThreadRef> =
        threads.filter { it.contextKind == ClaudeChats.CARD && it.noteId == noteId && !it.archived && it.id != currentId }
            .sortedWith(compareByDescending<ThreadRef> { at(it) }.thenByDescending { it.id })

    /** "Earlier about 银行 · 2 chats" (null with none). */
    fun earlierLabel(hanzi: String, count: Int): String? = if (count <= 0) null else "Earlier about $hanzi · $count chat${if (count == 1) "" else "s"}"
}
