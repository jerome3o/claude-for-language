package dev.jeromeswannack.chineselearning.lab.core

/**
 * Drafts per conversation and the "waiting to send" header line — chat round 2 PR 3
 * (docs/CHAT.md). Port of frontend/src/services/chatDrafts.ts (`loadDraft` / `saveDraft` /
 * `queueLabel`), parity-tested (parity/fixtures/chat-round2.ts → ChatRound2ParityTest): what was
 * typed but not sent stays in that chat's box on this device; the newest [MAX] conversations are
 * kept. The app stores the list in JsonCache, in the order [save] returns (ties on `at` keep it, like
 * the web's stable sort over Object.entries); this file is the pure rule.
 */
object ChatDrafts {
    const val MAX = 50

    data class Draft(val conversationId: String, val text: String, val at: Long)

    /** Port of loadDraft. */
    fun load(drafts: List<Draft>, conversationId: String?): String {
        if (conversationId.isNullOrEmpty()) return ""
        return drafts.firstOrNull { it.conversationId == conversationId }?.text ?: ""
    }

    /** Port of saveDraft: a blank text removes the draft; newest [MAX] kept. Returns the new list. */
    fun save(drafts: List<Draft>, conversationId: String?, text: String, now: Long): List<Draft> {
        if (conversationId.isNullOrEmpty()) return drafts
        val all = LinkedHashMap<String, Draft>()
        for (d in drafts) all[d.conversationId] = d
        if (NoteSearch.jsTrim(text).isNotEmpty()) all[conversationId] = Draft(conversationId, text, now) else all.remove(conversationId)
        return all.values.sortedByDescending { it.at }.take(MAX)
    }

    /** Port of queueLabel: "🕓 1 message waiting for a connection" / "🕓 Sending 3 messages…", or null. */
    fun queueLabel(waiting: Int, online: Boolean): String? {
        if (waiting <= 0) return null
        val n = if (waiting == 1) "1 message" else "$waiting messages"
        return if (online) "🕓 Sending $n…" else "🕓 $n waiting for a connection"
    }
}
