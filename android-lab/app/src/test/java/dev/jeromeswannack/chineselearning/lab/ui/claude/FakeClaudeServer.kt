package dev.jeromeswannack.chineselearning.lab.ui.claude

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.Repository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest

/**
 * A fake `/api/claude/threads*` (worker routes/claude-threads.ts) for the Lab's Claude thread tests:
 * one thread per client id, idempotent creates and sends, a reply that stays pending until [finish],
 * 409 while a reply is being written, and every request recorded in [requests].
 */
class FakeClaudeServer {
    val server = MockWebServer()
    val requests = mutableListOf<String>()
    /** A follow-up while a reply is pending: 409 (the worker's rule). */
    var busyIs409 = true
    /** Every request answers 503 (a server that isn't there yet). */
    @Volatile var down = false

    private data class Msg(val id: String, val clientId: String?, val role: String, var content: String, var status: String?, val createdAt: String, val contentType: String = "text", val intent: String? = null, val answerLang: String? = "zh")
    private data class Thread(val id: String, val clientId: String, val kind: String, val title: String, val context: String, val messages: MutableList<Msg> = mutableListOf())

    private val threads = LinkedHashMap<String, Thread>()
    /** Threads changed since the last list call (what a `?since=` list returns). */
    private val dirty = LinkedHashSet<String>()
    private val deleted = LinkedHashSet<String>()
    /** Unread replies per thread, as the list reports them (cleared when the thread is fetched). */
    private val unread = HashMap<String, Int>()
    /** The list requests' `since` values (null = a whole list). */
    val listSince = mutableListOf<String?>()
    private var n = 0
    private var clock = 0

    private fun at(): String = "2026-01-01T10:00:%02d.000Z".format(clock++ % 60)

    fun start(app: LabApp): FakeClaudeServer {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = synchronized(this@FakeClaudeServer) { handle(request) }
        }
        server.start()
        val old = app.repo
        app.repo = Repository(app, old.db, Api(server.url("").toString().removeSuffix("/")) { "test-session" }, app.prefs)
        return this
    }

    fun shutdown() = server.shutdown()

    @Synchronized fun threadIds(): List<String> = threads.keys.toList()

    @Synchronized fun userTexts(threadId: String): List<String> = threads[threadId]?.messages?.filter { it.role == "user" }?.map { it.content }.orEmpty()

    @Synchronized fun pendingReplyId(threadId: String): String? = threads[threadId]?.messages?.lastOrNull { it.role == "assistant" && it.status == "pending" }?.id

    /** Claude's reply is written: [text], done (one unread reply on the list until the thread is opened). */
    @Synchronized fun finish(threadId: String, text: String) {
        val m = threads.getValue(threadId).messages.last { it.role == "assistant" && it.status == "pending" }
        m.content = text
        m.status = null
        unread[threadId] = (unread[threadId] ?: 0) + 1
        dirty += threadId
    }

    /** The thread is deleted elsewhere: a `?since=` list reports its id. */
    @Synchronized fun delete(threadId: String) {
        threads.remove(threadId)
        dirty.remove(threadId)
        deleted += threadId
    }

    /** Text so far on the server's row (the row is written less often than the socket). */
    @Synchronized fun partial(threadId: String, text: String) {
        threads.getValue(threadId).messages.last { it.role == "assistant" && it.status == "pending" }.content = text
    }

    private fun ok(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setBody(body).setHeader("Content-Type", "application/json")

    private fun handle(r: RecordedRequest): MockResponse {
        val path = r.path.orEmpty()
        val body = r.body.readUtf8()
        requests += "${r.method} $path"
        if (down) return ok("""{"error":"down"}""", 503)
        val parts = path.substringBefore('?').removePrefix("/api/claude/threads").trim('/').split('/').filter { it.isNotEmpty() }
        if (!path.startsWith("/api/claude/threads")) return ok("""{"error":"not here"}""", 404)
        val json = if (body.isNotBlank()) Json.parseToJsonElement(body).jsonObject else JsonObject(emptyMap())
        fun str(k: String) = json[k]?.jsonPrimitive?.content
        return when {
            r.method == "POST" && parts.isEmpty() -> {
                val clientId = str("client_id")!!
                threads.values.firstOrNull { it.clientId == clientId }?.let { return ok(res(it, it.messages, existing = true)) }
                val id = "t${++n}"
                val ctx = json["context"]?.jsonObject ?: JsonObject(emptyMap())
                val kind = ctx["kind"]?.jsonPrimitive?.content ?: "general"
                val intent = str("intent") ?: "ask"
                val t = Thread(id, clientId, kind, str("text")!!, ctx.toString())
                val mine = Msg("m${++n}", str("message_client_id"), "user", str("text")!!, null, at(), intent = intent)
                val reply = Msg("m${++n}", null, "assistant", "", "pending", at(), contentType = if (intent == "ask") "text" else "analysis")
                t.messages += listOf(mine, reply)
                threads[id] = t
                dirty += id
                ok(res(t, listOf(mine, reply)), 202)
            }
            r.method == "GET" && parts.isEmpty() -> {
                val since = Regex("[?&]since=([^&]+)").find(path)?.groupValues?.get(1)?.let { java.net.URLDecoder.decode(it, "UTF-8") }
                listSince += since
                val rows = if (since == null) threads.values.toList() else dirty.mapNotNull { threads[it] }
                val gone = if (since == null) emptyList() else deleted.toList()
                dirty.clear()
                deleted.clear()
                ok("""{"threads":[${rows.joinToString(",") { threadJson(it) }}],"deleted_ids":[${gone.joinToString(",") { "\"$it\"" }}],"server_time":"${at()}"}""")
            }
            r.method == "GET" && parts.size == 1 -> {
                val t = threads[parts[0]] ?: return ok("""{"error":"Chat not found"}""", 404)
                unread.remove(t.id)
                ok(res(t, t.messages))
            }
            r.method == "POST" && parts.size == 2 && parts[1] == "messages" -> {
                val t = threads[parts[0]] ?: return ok("""{"error":"Chat not found"}""", 404)
                val clientId = str("client_id")
                t.messages.firstOrNull { clientId != null && it.clientId == clientId }?.let { return ok(res(t, listOf(it))) }
                if (busyIs409 && t.messages.any { it.status == "pending" }) return ok("""{"error":"Claude is still answering your last message."}""", 409)
                val mine = Msg("m${++n}", clientId, "user", str("text")!!, null, at(), intent = "ask")
                val reply = Msg("m${++n}", null, "assistant", "", "pending", at())
                t.messages += listOf(mine, reply)
                ok(res(t, listOf(mine, reply)), 202)
            }
            else -> ok("""{"error":"not here"}""", 404)
        }
    }

    private fun threadJson(t: Thread): String {
        val title = kotlinx.serialization.json.JsonPrimitive(t.title).toString()
        val last = t.messages.lastOrNull { it.status == null }
        val preview = last?.let { kotlinx.serialization.json.JsonPrimitive(it.content).toString() } ?: "null"
        val intent = t.messages.firstOrNull { it.role == "user" }?.intent?.let { "\"$it\"" } ?: "null"
        return """{"id":"${t.id}","client_id":"${t.clientId}","title":$title,"context_kind":"${t.kind}","context":${t.context},"first_intent":$intent,"preview":$preview,"last_message_at":${t.messages.lastOrNull()?.let { "\"${it.createdAt}\"" } ?: "null"},"created_at":"2026-01-01T10:00:00.000Z","unread":${unread[t.id] ?: 0},"pending":${t.messages.any { it.status == "pending" }}}"""
    }

    private fun res(t: Thread, messages: List<Msg>, existing: Boolean = false): String {
        val ms = messages.joinToString(",") { m ->
            """{"id":"${m.id}","thread_id":"${t.id}","client_id":${m.clientId?.let { "\"$it\"" } ?: "null"},"role":"${m.role}","content_type":"${m.contentType}","content":${kotlinx.serialization.json.JsonPrimitive(m.content).toString()},"intent":${m.intent?.let { "\"$it\"" } ?: "null"},"status":${m.status?.let { "\"$it\"" } ?: "null"},"streaming":${m.status == "pending" && m.content.isNotEmpty()},"answer_lang":${if (m.role == "assistant") "\"${m.answerLang}\"" else "null"},"created_at":"${m.createdAt}"}"""
        }
        val title = kotlinx.serialization.json.JsonPrimitive(t.title).toString()
        return """{"thread":{"id":"${t.id}","client_id":"${t.clientId}","title":$title,"context_kind":"${t.kind}","context":${t.context},"created_at":"2026-01-01T10:00:00.000Z","pending":${t.messages.any { it.status == "pending" }}},"messages":[$ms],"server_time":"${at()}","existing":$existing}"""
    }

    companion object {
        /** Robolectric has no validated network: say whether we're online. */
        fun setOnline(app: LabApp, online: Boolean) {
            @Suppress("UNCHECKED_CAST")
            (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as MutableStateFlow<Boolean>).value = online
        }
    }
}
