package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/*
 * Claude threads — `/api/claude/threads*` (worker routes/claude-threads.ts; the shapes of
 * shared/claude/api.ts; the web's api/claudeThreads.ts). Every chat with Claude is a thread in a
 * context (general · card · practice · chat_message); a coach conversation IS a thread (same id).
 */

/** The thread's context descriptor + its badge snapshot (`StoredClaudeContext`). */
@Serializable
data class ClaudeContextDto(
    val kind: String = ClaudeChats.GENERAL,
    val note_id: String? = null,
    val card_type: String? = null,
    /** A card thread asked right after a typed answer: `{ answer, correct? }`. */
    val typed: JsonObject? = null,
    val conversation_id: String? = null,
    val scenario: String? = null,
    val message_id: String? = null,
    val label: String? = null,
    val sublabel: String? = null,
) {
    /** The core rules' view of it (chips, composer, header chip). */
    fun core() = ClaudeChats.Context(kind, noteId = note_id, messageId = message_id, conversationId = conversation_id, scenario = scenario, label = label, typed = typed != null)

    /** What the API takes (the descriptor without the snapshot). */
    fun descriptor() = copy(label = null, sublabel = null)
}

/** One inbox row (`ClaudeThreadSummary`). */
@Serializable
data class ClaudeThreadDto(
    val id: String,
    val client_id: String? = null,
    val title: String = "",
    val context_kind: String = ClaudeChats.GENERAL,
    val context: ClaudeContextDto = ClaudeContextDto(),
    val first_intent: String? = null,
    val preview: String? = null,
    val last_message_at: String? = null,
    val created_at: String = "",
    val unread: Int = 0,
    val pending: Boolean = false,
    val failed: Boolean = false,
    val read_only: Boolean = false,
    val archived: Boolean = false,
    val language: String? = null,
    val source: String? = null,
)

/**
 * One message (`ClaudeThreadMessage`). The last four fields are this phone's own: [queued] =
 * written without a connection (in the outbox), [held] = written in a thread that isn't on the
 * server yet (queued once it is, with [send_language]), [seq] = the highest live `claude_turn`
 * frame applied.
 */
@Serializable
data class ClaudeMessageDto(
    val id: String,
    val thread_id: String = "",
    val client_id: String? = null,
    val role: String = "assistant",
    /** text | analysis (a Coach check / explain / translate result, JSON) | mistake_lesson (JSON). */
    val content_type: String = "text",
    val content: String = "",
    val intent: String? = null,
    /** null = done; 'pending' = being written (see [streaming]); 'failed' (see [error]; Retry). */
    val status: String? = null,
    val streaming: Boolean = false,
    val error: String? = null,
    val answer_lang: String? = null,
    val translation: String? = null,
    val tool_results: String? = null,
    /** My message in a card thread: the chat's "check my Chinese" of it (✎, How to say it better), once the server ran it. */
    val auto_check: AutoCheckDto? = null,
    val created_at: String = "",
    val updated_at: String? = null,
    val queued: Boolean = false,
    val held: Boolean = false,
    val seq: Int? = null,
    /** A held message: the answer language it goes with. */
    val send_language: String? = null,
) {
    val isPending: Boolean get() = status == "pending"

    /** The Coach's own shape (its result cards read it). */
    fun asCoach() = CoachMessageDto(id, thread_id, role, content_type, content, tool_results, created_at, status, error, answer_lang, translation)
}

@Serializable
data class ClaudeThreadRes(
    val thread: ClaudeThreadDto,
    val messages: List<ClaudeMessageDto> = emptyList(),
    val server_time: String? = null,
    val existing: Boolean = false,
)

/** `POST /api/claude/threads`: [client_id] = the thread's, [message_client_id] = the first message's. */
@Serializable
data class ClaudeCreateBody(
    val client_id: String,
    val message_client_id: String,
    val context: ClaudeContextDto,
    val intent: String,
    val text: String,
    val language: String? = null,
    /** A suggestion chip (the app wrote it): not checked. */
    val quick: Boolean? = null,
)

/**
 * `POST /api/claude/threads/:id/messages`. [typed] (a card thread): the answer typed on this showing
 * of the card — a `{ answer, correct }` object, [kotlinx.serialization.json.JsonNull] = none (clears an
 * older one), null = leave it.
 */
@Serializable
data class ClaudeSendBody(
    val client_id: String,
    val text: String,
    val intent: String = "ask",
    val language: String? = null,
    val quick: Boolean? = null,
    val typed: JsonElement? = null,
)

/** `GET /api/claude/threads?…` (the rows only). */
@Serializable
data class ClaudeThreadListRes(val threads: List<ClaudeThreadDto> = emptyList(), val server_time: String? = null)

/** The live `claude_turn` frame (ChatHub, my sockets only): [text] is the WHOLE text so far; keep the highest [seq]. */
@Serializable
data class ClaudeTurnEvent(
    val thread_id: String,
    val message_id: String,
    val seq: Int = 0,
    /** thinking | tool | streaming | done | failed */
    val status: String = "streaming",
    val text: String? = null,
    val tool: String? = null,
    val error: String? = null,
)

const val CLAUDE_THREADS_PATH = "/api/claude/threads"
fun claudeThreadPath(id: String) = "$CLAUDE_THREADS_PATH/${enc(id)}"
fun claudeMessagesPath(id: String) = "${claudeThreadPath(id)}/messages"

suspend fun Api.createClaudeThread(body: ClaudeCreateBody): ClaudeThreadRes = post(CLAUDE_THREADS_PATH, body)

suspend fun Api.claudeThread(id: String, since: String? = null): ClaudeThreadRes =
    get(claudeThreadPath(id) + (since?.let { "?since=${enc(it)}" } ?: ""))

suspend fun Api.sendClaudeMessage(id: String, body: ClaudeSendBody): ClaudeThreadRes = post(claudeMessagesPath(id), body)

/** One card's threads (Ask Claude on a study card: the resume rule + "Earlier about 银行"). */
suspend fun Api.cardClaudeThreads(noteId: String): ClaudeThreadListRes =
    get("$CLAUDE_THREADS_PATH?context_kind=${ClaudeChats.CARD}&note_id=${enc(noteId)}&limit=50")

suspend fun Api.retryClaudeMessage(id: String, messageId: String): ClaudeThreadRes =
    exchange("POST", "${claudeMessagesPath(id)}/${enc(messageId)}/retry", "{}", ClaudeThreadRes.serializer())

/** `GET /api/claude/threads?since=&limit=` — the Chats tab's thread list: changed threads + the ids deleted since. */
@Serializable
data class ClaudeThreadListRes(
    val threads: List<ClaudeThreadDto> = emptyList(),
    val deleted_ids: List<String> = emptyList(),
    val server_time: String? = null,
)

suspend fun Api.claudeThreadList(since: String? = null, limit: Int = 200): ClaudeThreadListRes =
    get("$CLAUDE_THREADS_PATH?limit=$limit" + (since?.let { "&since=${enc(it)}" } ?: ""))
