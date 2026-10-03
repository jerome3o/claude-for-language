package dev.jeromeswannack.chineselearning.lab.data.chat

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.CHAT_LISTENING_DEFAULT_PATH
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningBody
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningDefaultBody
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningRowDto
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningStateDto
import dev.jeromeswannack.chineselearning.lab.data.api.chatClips
import dev.jeromeswannack.chineselearning.lab.data.api.chatListening
import dev.jeromeswannack.chineselearning.lab.data.api.chatListeningPath
import dev.jeromeswannack.chineselearning.lab.data.api.messageAudio
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Chat listening mode's data on the phone (docs/CHAT.md "Listening mode"):
 *  - the account's settings (`GET /api/me/chat-listening`) in JsonCache [STATE], so the chat,
 *    the inbox and notifications follow them offline; a change is written to the cache at once
 *    and sent through the Outbox (the PUTs are idempotent — the whole setting);
 *  - the revealed message ids per conversation, device-local ([revealedKey], newest 500, never synced).
 */
object ChatListeningStore {
    const val KIND = "chat-listening"
    const val STATE = "chat/listening/state"
    /** Outbox kinds (the PUTs). */
    const val KIND_SET = "chat-listening-set"
    const val KIND_DEFAULT = "chat-listening-default"
    /** The 0.75× chip on hidden bubbles (remembered on this phone). */
    const val SLOW_KEY = "chat/listening/slow"

    fun revealedKey(conversationId: String) = "chat/listening/revealed/$conversationId"
    const val REVEALED_KIND = "chat-listening-revealed"

    private val lock = Mutex()

    fun observe(cache: JsonCache): Flow<ListeningStateDto?> = cache.observe<ListeningStateDto>(STATE)

    suspend fun state(cache: JsonCache): ListeningStateDto = runCatching { cache.get<ListeningStateDto>(STATE) }.getOrNull() ?: ListeningStateDto()

    /** The setting in force for [conversationId]: its row, else the account default (undecided). */
    fun settingFor(state: ListeningStateDto?, conversationId: String): ChatListening.Setting {
        val row = state?.conversations?.firstOrNull { it.conversation_id == conversationId }
        return ChatListening.effectiveListening(row?.let { ChatListening.Setting(it.on, it.since) }, state?.default_on ?: false)
    }

    suspend fun setting(cache: JsonCache, conversationId: String): ChatListening.Setting = settingFor(state(cache), conversationId)

    /** Pure: [state] with [conversationId]'s row replaced. */
    fun withRow(state: ListeningStateDto, conversationId: String, on: Boolean, since: String?, nowIso: String): ListeningStateDto =
        state.copy(conversations = listOf(ListeningRowDto(conversationId, on, since, nowIso)) + state.conversations.filter { it.conversation_id != conversationId })

    /** Sets one conversation's mode: cached now, sent through the outbox (offline-safe). */
    suspend fun setConversation(app: LabApp, conversationId: String, on: Boolean, since: String?) {
        lock.withLock {
            val next = withRow(state(app.cache), conversationId, on, since, Js.toIsoString(System.currentTimeMillis()))
            app.cache.put(STATE, KIND, next)
        }
        app.outbox.enqueueJson(KIND_SET, "PUT", chatListeningPath(conversationId), ListeningBody(on, since), id = "listening-${UUID.randomUUID()}")
        flush(app)
    }

    /** Settings → "Listening mode in new chats". */
    suspend fun setDefault(app: LabApp, on: Boolean) {
        lock.withLock { app.cache.put(STATE, KIND, state(app.cache).copy(default_on = on)) }
        app.outbox.enqueueJson(KIND_DEFAULT, "PUT", CHAT_LISTENING_DEFAULT_PATH, ListeningDefaultBody(on), id = "listening-default-${UUID.randomUUID()}")
        flush(app)
    }

    private fun flush(app: LabApp) {
        runCatching { app.scheduleBackgroundUpload() }
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } }
    }

    /** The server's settings, unless a change of ours is still in the outbox (then ours stand until it is sent). */
    suspend fun refresh(api: Api, cache: JsonCache, outbox: Outbox) {
        val fresh = api.chatListening()
        val waiting = outbox.all().any { (it.kind == KIND_SET || it.kind == KIND_DEFAULT) && it.state == Outbox.PENDING }
        if (waiting) return
        lock.withLock { cache.put(STATE, KIND, fresh) }
    }

    suspend fun revealed(cache: JsonCache, conversationId: String): List<String> =
        runCatching { cache.get<List<String>>(revealedKey(conversationId)) }.getOrNull().orEmpty()

    suspend fun reveal(cache: JsonCache, conversationId: String, messageId: String): List<String> = lock.withLock {
        val next = ChatListening.addRevealed(revealed(cache, conversationId), messageId)
        cache.put(revealedKey(conversationId), REVEALED_KIND, next)
        next
    }

    /** The revealed lists change (any conversation) — the inbox re-reads its rows' lists. */
    fun observeRevealed(cache: JsonCache): Flow<List<List<String>>> =
        cache.observeAll(REVEALED_KIND, kotlinx.serialization.builtins.ListSerializer(kotlinx.serialization.serializer<String>()))

    /** The inbox line for a row: "🎧 New message" while its newest message is hidden, else null (the normal preview). */
    fun inboxPreview(row: dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow, myId: String?, state: ListeningStateDto?, revealed: Collection<String>): String? {
        if (myId == null || row.isAi) return null
        val last = row.lastMessage ?: return null
        return ChatListening.listeningPreview(
            ChatListening.LastMessage(last.id, last.senderId, last.createdAt, last.preview, last.attachmentKind),
            myId, settingFor(state, row.conversationId), row.myReadAt, revealed,
        )
    }

    /** What a notification may show for a new message from the other person: "🎧 New message" while their mode hides it. */
    suspend fun notificationText(cache: JsonCache, conversationId: String, message: ChatListening.Message, myId: String?, text: String): String {
        if (myId == null || !ChatListening.listeningCandidate(message, myId)) return text
        return if (setting(cache, conversationId).on) ChatListening.LISTENING_PREVIEW else text
    }

    /**
     * A notification built here from the message itself (live socket, inbox check) follows the
     * worker's `notificationPreviewFor`: [chat] with "🎧 New message" when my mode hides it.
     */
    suspend fun masked(cache: JsonCache, chat: IncomingChat, content: String, attachmentKind: String?, deletedAt: String?, myId: String?): IncomingChat {
        val msg = ChatListening.Message(chat.messageId, chat.senderId, content, chat.createdAt, deletedAt, attachmentKind?.takeIf { it.isNotEmpty() })
        val text = runCatching { notificationText(cache, chat.conversationId, msg, myId, chat.content) }.getOrDefault(chat.content)
        return if (text == chat.content) chat else chat.copy(content = text)
    }

    fun listeningMessage(m: ChatMessageDto) = ChatListening.Message(
        id = m.id, senderId = m.sender_id.ifEmpty { m.sender.id }, content = m.content, createdAt = m.created_at,
        deletedAt = m.deleted_at, attachmentKind = m.attachment?.kind?.takeIf { it.isNotEmpty() },
    )

    /** Registered in FeatureSyncs: the settings, then the newest clips of every chat into the audio cache. */
    object Sync : FeatureSync {
        override suspend fun sync(ctx: SyncContext) {
            refresh(ctx.api, ctx.cache, ctx.outbox)
            val clips = ChatClips.current ?: return
            clips.prefetch(ctx.api.chatClips().clips.mapNotNull { c -> c.clip?.let { c.message_id to it } })
        }
    }
}

/**
 * Message clips on the phone (docs/CHAT.md "Client prefetch"): cached by `audio_clip` in
 * files/chat-clips/, so a tap plays at once and offline. A message without a clip id yet is
 * fetched on tap (`GET /api/messages/:id/audio`) and kept under its `X-Clip-Id`.
 */
class ChatClips(private val api: () -> Api, val dir: File, private val online: () -> Boolean) {
    /** Messages fetched on tap → their clip id (`X-Clip-Id`), for this process. */
    private val byMessage = ConcurrentHashMap<String, String>()
    private val gate = Semaphore(3)
    private val inFlight = ConcurrentHashMap<String, kotlinx.coroutines.Deferred<File>>()

    private fun fileFor(clip: String) = File(dir, clip.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".mp3")

    fun cached(clip: String?): File? = clip?.takeIf { it.isNotBlank() }?.let(::fileFor)?.takeIf { it.exists() && it.length() > 0 }

    /** The clip of [messageId] when it is on the phone ([clip] = the message's `audio_clip`). */
    fun cachedFor(messageId: String, clip: String?): File? = cached(clip) ?: cached(byMessage[messageId]) ?: cached("msg-$messageId")

    /** Cache-first; else downloads it (throws when offline / the server can't make it). */
    suspend fun file(messageId: String, clip: String?): File {
        cachedFor(messageId, clip)?.let { return it }
        return withContext(Dispatchers.IO) {
            val audio = api().messageAudio(messageId)
            val id = audio.clipId ?: clip ?: "msg-$messageId"
            byMessage[messageId] = id
            write(id, audio.bytes)
        }
    }

    private fun write(clip: String, bytes: ByteArray): File {
        dir.mkdirs()
        val dest = fileFor(clip)
        val tmp = File(dir, dest.name + ".part")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(dest)) { tmp.copyTo(dest, overwrite = true); tmp.delete() }
        return dest
    }

    /** Downloads the clips not on the phone yet: ([messageId], clip) pairs; quiet on failure. */
    suspend fun prefetch(items: List<Pair<String, String>>) = coroutineScope {
        if (!online()) return@coroutineScope
        items.distinctBy { it.second }.filter { cached(it.second) == null }.map { (messageId, clip) ->
            async {
                gate.withPermit {
                    if (cached(clip) != null) return@withPermit
                    runCatching {
                        val audio = withContext(Dispatchers.IO) { api().messageAudio(messageId) }
                        write(audio.clipId ?: clip, audio.bytes)
                    }
                }
            }
        }.awaitAll()
    }

    /** The newest clips of [messages] a tap would play (`prefetchSelection(messages, me, 20)`). */
    suspend fun prefetchFor(messages: List<ChatMessageDto>, myId: String) {
        val pick = ChatListening.prefetchSelection(messages, myId, ChatListening.LISTENING_PREFETCH_COUNT, ChatListeningStore::listeningMessage)
        prefetch(pick.mapNotNull { m -> m.audio_clip?.let { m.id to it } })
    }

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
        byMessage.clear()
    }

    companion object {
        @Volatile var current: ChatClips? = null
            private set

        @Volatile private var owner: LabApp? = null

        /** The app's one cache (files/chat-clips/, emptied on sign-out); ChatDelivery.install makes it. */
        fun of(app: LabApp): ChatClips = synchronized(this) {
            current?.takeIf { owner === app } ?: ChatClips({ app.repo.api }, File(app.filesDir, "chat-clips"), { app.online.value }).also { c ->
                current = c
                owner = app
                app.repo.beforeSignOut += { c.clear() }
            }
        }
    }
}
