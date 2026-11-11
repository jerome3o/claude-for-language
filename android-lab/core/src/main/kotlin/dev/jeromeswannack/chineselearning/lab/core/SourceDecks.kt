package dev.jeromeswannack.chineselearning.lab.core

/**
 * Source decks — port of shared/decks/source-decks.ts (parity-tested, parity/fixtures/source-decks.ts).
 *
 * A card added from around the app goes straight into a deck PER SOURCE ("From readers", "From
 * chats", …) with no deck to choose. The server makes the deck on first use and finds it again by
 * its stable `decks.source_key` (never by name); the note-create routes take the ref
 * `source:<key>` in place of a deck id; "Change" moves the just-added note(s).
 */
object SourceDecks {
    data class Def(val key: String, val name: String, val description: String, val legacyNames: List<String>)

    val KEYS: List<String> = listOf("readers", "chats", "sentences", "claude", "explorer", "practice")

    val DECKS: Map<String, Def> = linkedMapOf(
        "readers" to Def("readers", "From readers", "Words added while reading graded readers.", listOf("From my readers")),
        "chats" to Def("chats", "From chats", "Words and sentences added from your chats.", emptyList()),
        "sentences" to Def("sentences", "From example sentences", "Words and sentences added from the example sentences on your cards.", emptyList()),
        "claude" to Def("claude", "From Claude", "Cards Claude made for you, and words added from your chats with Claude.", emptyList()),
        "explorer" to Def("explorer", "From the explorer", "Words added from the word and character explorer.", emptyList()),
        "practice" to Def("practice", "From lessons & practice", "Words added from lessons, video calls, picture hunts, clips, idioms, podcasts and other practice.", emptyList()),
    )

    fun isKey(value: String?): Boolean = value != null && value in KEYS

    fun name(key: String): String = DECKS[key]?.name ?: "From the explorer"

    private const val REF_PREFIX = "source:"

    /** `sourceDeckRef`: the deck ref the note-create routes take in place of a deck id. */
    fun ref(key: String): String = REF_PREFIX + key

    /** `parseSourceDeckRef`: `source:readers` (or URL-encoded `source%3Areaders`) → readers, else null. */
    fun parseRef(ref: String?): String? {
        if (ref == null) return null
        var s = ref.trim()
        if (s.length >= 9 && s.substring(0, 9).equals("source%3a", ignoreCase = true)) s = REF_PREFIX + s.substring(9)
        if (!s.startsWith(REF_PREFIX)) return null
        val key = s.substring(REF_PREFIX.length)
        return if (isKey(key)) key else null
    }

    /** `findSourceDeck`: the deck carrying this key (by key, never by name). */
    fun <T> find(decks: List<T>, key: String, sourceKey: (T) -> String?): T? = decks.firstOrNull { sourceKey(it) == key }

    /** `EXPLORER_SOURCE_DECKS`: where the explorer was opened from → its source deck. */
    val EXPLORER: Map<String, String> = mapOf(
        "reader" to "readers", "read_aloud" to "readers",
        "chat" to "chats",
        "ask_claude" to "claude", "claude_chat" to "claude", "coach" to "claude",
        "breakdown" to "sentences", "sentence_round" to "sentences",
        "lesson" to "practice", "idioms" to "practice", "audio_lesson" to "practice", "meme_review" to "practice",
        "clips" to "practice", "phone" to "practice", "podcast" to "practice", "call" to "practice", "picture_hunt" to "practice",
    )

    /** `BUMP_SOURCE_DECKS`: an add sheet's bump source → its source deck. */
    val BUMP: Map<String, String> = mapOf(
        "reader" to "readers",
        "chat" to "chats", "chat_discuss" to "chats",
        "coach" to "claude", "coach_chat" to "claude", "ask_claude" to "claude",
        "breakdown" to "sentences", "homework_pass" to "sentences",
        "picture_hunt" to "practice", "idioms" to "practice",
    )

    /** `sourceDeckForExplorer`. */
    fun forExplorer(source: String?): String = source?.let { EXPLORER[it] } ?: "explorer"

    /** `sourceDeckForBump`. */
    fun forBump(source: String?): String = source?.let { BUMP[it] } ?: "explorer"

    /** `addedToDeckLine`: "Added to From readers" / "3 cards added to From chats". */
    fun addedLine(deckName: String, count: Int = 1): String {
        val name = deckName.trim().ifEmpty { "your deck" }
        return if (count > 1) "$count cards added to $name" else "Added to $name"
    }

    /** `movedToDeckLine`: "Moved to HSK 2". */
    fun movedLine(deckName: String, count: Int = 1): String {
        val name = deckName.trim().ifEmpty { "your deck" }
        return if (count > 1) "$count cards moved to $name" else "Moved to $name"
    }
}
