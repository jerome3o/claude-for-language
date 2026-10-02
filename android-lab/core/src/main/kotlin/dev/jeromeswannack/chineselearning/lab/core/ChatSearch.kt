package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of searchMessages() in shared/chats/search.ts — search inside one chat (docs/CHAT.md
 * "Search"), so the web chat and the Lab app find exactly the same messages. Parity-tested
 * (parity/fixtures/chat-search.ts → ChatSearchParityTest).
 */
object ChatSearch {
    /** A `words` segment (PR 3): `{ text, pinyin }`. */
    data class Word(val text: String, val pinyin: String? = null)

    /** `SearchableMessage`: what a message is searched by. */
    data class Message(
        val id: String,
        val content: String?,
        val translation: String? = null,
        val deletedAt: String? = null,
        val transcript: String? = null,
        val attachmentTranslation: String? = null,
        val words: List<Word>? = null,
    )

    /** `haystacks`: the text fields, lower-cased (blank ones skipped). */
    private fun haystacks(m: Message): List<String> = listOf(m.content, m.translation, m.transcript, m.attachmentTranslation)
        .filter { s -> s != null && NoteSearch.jsTrim(s).isNotEmpty() }
        .map { NoteSearch.jsLower(it!!) }

    /** `/\s+/g` → [with] (JS `\s` = the JS whitespace set). */
    private fun collapseSpaces(s: String, with: String): String {
        val sb = StringBuilder(s.length)
        var inRun = false
        for (c in s) {
            if (NoteSearch.isJsWhitespace(c)) {
                if (!inRun) sb.append(with)
                inRun = true
            } else {
                sb.append(c)
                inRun = false
            }
        }
        return sb.toString()
    }

    /** `pinyinForms`: the message's pinyin, tone-free, spaced and compact. */
    private fun pinyinForms(m: Message): List<String> {
        val words = m.words ?: return emptyList()
        if (words.isEmpty()) return emptyList()
        val syllables = words.map { NoteSearch.jsTrim(it.pinyin.orEmpty()) }.filter { it.isNotEmpty() }
        if (syllables.isEmpty()) return emptyList()
        val spaced = NoteSearch.stripTones(syllables.joinToString(" "))
        return listOf(spaced, collapseSpaces(spaced, ""))
    }

    /** `messageMatches`: empty query → false; deleted messages never match. */
    fun matches(m: Message, query: String): Boolean {
        val q = NoteSearch.jsLower(NoteSearch.jsTrim(query))
        if (q.isEmpty() || !m.deletedAt.isNullOrEmpty()) return false
        if (haystacks(m).any { it.contains(q) }) return true
        val qStripped = NoteSearch.stripTones(q)
        if (qStripped.isEmpty()) return false
        val forms = pinyinForms(m)
        if (forms.isEmpty()) return false
        val qCompact = collapseSpaces(qStripped, "")
        return forms[0].contains(qStripped) || (qCompact.isNotEmpty() && forms[1].contains(qCompact))
    }

    /** `searchMessages`: ids of the matches, newest first (input oldest first, as the chat holds it). */
    fun search(messages: List<Message>, query: String): List<String> {
        val out = ArrayList<String>()
        for (i in messages.indices.reversed()) if (matches(messages[i], query)) out += messages[i].id
        return out
    }
}
