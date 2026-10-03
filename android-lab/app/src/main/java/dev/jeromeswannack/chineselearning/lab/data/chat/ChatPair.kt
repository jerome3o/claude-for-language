package dev.jeromeswannack.chineselearning.lab.data.chat

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.ChatDrafts
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListResponse
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.enc
import dev.jeromeswannack.chineselearning.lab.data.api.get
import dev.jeromeswannack.chineselearning.lab.data.api.openConversation
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatViewModel
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsKeys
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable

/**
 * `GET /api/conversations/:id` — the conversation; for an id merged away by migration 0102 the
 * server answers with the chat it was merged into and `merged_from` = the id asked for.
 */
@Serializable
data class ConversationLookupDto(
    val id: String,
    val relationship_id: String = "",
    val is_ai_conversation: Boolean = false,
    val title: String? = null,
    val merged_from: String? = null,
)

suspend fun Api.conversation(conversationId: String): ConversationLookupDto = get("/api/conversations/${enc(conversationId)}")

/**
 * One chat per pair (docs/CHAT.md "One chat per pair"): a tutor and a student have exactly ONE
 * conversation; older extra ones were merged into it on the server (`conversations.merged_into`).
 *
 * - [theChat]: THE chat with the person of a relationship — `POST …/conversations/open`
 *   (get-or-create) online, else what the phone already knows (offline).
 * - Merged ids: an id the server has merged away is remembered as an alias of its primary
 *   ([primaryOf] / [record]), so a stale link, notification or cached list opens the right chat
 *   offline too, and the draft / notification of the old id move to the primary.
 */
object ChatPair {
    /** JsonCache: old (merged-away) conversation id → the primary one. */
    const val MERGED_KEY = "chat/merged-ids"
    /** JsonCache: relationship id → its one chat (the last `/conversations/open` answer). */
    fun pairKey(relId: String) = "chat/pair/$relId"
    const val KIND = "chat"
    private val lock = Mutex()

    // ---------------- pure rules (ChatPairTest) ----------------

    /** Follows the alias chain (a → b → c) to the primary; stops on a cycle. */
    fun follow(map: Map<String, String>, id: String): String {
        var cur = id
        val seen = HashSet<String>()
        while (true) {
            val next = map[cur] ?: return cur
            if (!seen.add(cur) || next == cur) return cur
            cur = next
        }
    }

    /** Every id that resolves to [primary] (the primary itself first). */
    fun aliasesOf(map: Map<String, String>, primary: String): List<String> =
        listOf(primary) + map.keys.filter { it != primary && follow(map, it) == primary }.sorted()

    /**
     * The merged-into id the server revealed for [routeId], or null: a message of the page whose
     * `conversation_id` is another id (the server serves an old id's messages as the primary's),
     * else a lookup whose `merged_from` is set.
     */
    fun mergedInto(routeId: String, messages: List<ChatMessageDto>, lookup: ConversationLookupDto? = null): String? {
        messages.firstOrNull { it.conversation_id.isNotEmpty() }?.conversation_id?.let { if (it != routeId) return it }
        if (lookup != null && !lookup.merged_from.isNullOrEmpty() && lookup.id != routeId) return lookup.id
        return null
    }

    /**
     * THE chat of [relId] from what is cached (offline): the last `/open` answer, else the inbox's
     * (non-Claude) row for that relationship, else the newest non-Claude conversation of the
     * relationship's cached list. Already mapped through the aliases.
     */
    fun cachedChat(
        relId: String,
        pair: String?,
        inbox: ChatListResponse?,
        conversations: List<ChatConversationDto>?,
        merged: Map<String, String>,
    ): String? {
        val id = pair
            ?: inbox?.conversations?.filter { it.relationshipId == relId && !it.isAi }?.maxByOrNull { it.lastActivityAt }?.conversationId
            ?: conversations?.filter { !it.is_ai_conversation }?.maxByOrNull { it.last_message_at ?: it.created_at }?.id
        return id?.let { follow(merged, it) }
    }

    // ---------------- on the phone ----------------

    suspend fun merged(app: LabApp): Map<String, String> = runCatching { app.cache.get<Map<String, String>>(MERGED_KEY) }.getOrNull().orEmpty()

    /** The id to open for [id]: itself, or the chat it was merged into (as far as the phone knows). */
    suspend fun primaryOf(app: LabApp, id: String): String = follow(merged(app), id)

    /**
     * [old] was merged into [primary]: remember it, move its unsent draft (kept when the primary
     * already has one), drop its notification (new messages arrive under the primary's id) and
     * its cached history.
     */
    suspend fun record(app: LabApp, old: String, primary: String) {
        if (old == primary || old.isEmpty() || primary.isEmpty()) return
        lock.withLock {
            val map = merged(app)
            if (map[old] != primary) app.cache.put(MERGED_KEY, KIND, map + (old to primary))
        }
        runCatching {
            val drafts = ChatViewModel.loadDrafts(app)
            val oldText = ChatDrafts.load(drafts, old)
            if (oldText.isNotEmpty()) {
                if (ChatDrafts.load(drafts, primary).isEmpty()) ChatViewModel.saveDraft(app, primary, oldText)
                ChatViewModel.saveDraft(app, old, "")
            }
        }
        runCatching { ChatNotifier.cancel(app, old) }
        runCatching { app.cache.delete("chat/$old/messages") }
    }

    /**
     * THE chat with the person of [relId]. Cached first (instant, offline): the phone's last answer
     * is used at once and checked with the server in the background (a merged id is then caught by
     * the chat screen). Nothing cached → `POST …/conversations/open` (get-or-create).
     */
    suspend fun theChat(app: LabApp, relId: String): String {
        val merged = merged(app)
        cached(app, relId, merged)?.let { id ->
            if (app.online.value) app.scope.launch { runCatching { fetch(app, relId) } }
            return id
        }
        if (!app.online.value) throw IllegalStateException("You're offline. Open this chat once online first.")
        return follow(merged, fetch(app, relId))
    }

    private suspend fun fetch(app: LabApp, relId: String): String =
        app.repo.api.openConversation(relId).conversation_id.also { app.cache.put(pairKey(relId), KIND, it) }

    private suspend fun cached(app: LabApp, relId: String, merged: Map<String, String>): String? = cachedChat(
        relId,
        runCatching { app.cache.get<String>(pairKey(relId)) }.getOrNull(),
        runCatching { app.cache.get<ChatListResponse>(ChatsKeys.LIST) }.getOrNull(),
        runCatching { app.cache.get<List<ChatConversationDto>>(ConnectionsKeys.conversations(relId)) }.getOrNull(),
        merged,
    )
}
