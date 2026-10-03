package dev.jeromeswannack.chineselearning.lab.data.chat

import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.core.ChatVoice
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationVoiceCache
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import dev.jeromeswannack.chineselearning.lab.data.api.CHAT_LISTENING_DEFAULT_PATH
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningBody
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningDefaultBody
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningRowDto
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningStateDto
import dev.jeromeswannack.chineselearning.lab.data.api.chatClips
import dev.jeromeswannack.chineselearning.lab.data.api.chatListening
import dev.jeromeswannack.chineselearning.lab.data.api.chatListeningPath
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
        Analytics.track("chat.listening_mode", mapOf("scope" to "conversation", "on" to on))
        lock.withLock {
            val next = withRow(state(app.cache), conversationId, on, since, Js.toIsoString(System.currentTimeMillis()))
            app.cache.put(STATE, KIND, next)
        }
        app.outbox.enqueueJson(KIND_SET, "PUT", chatListeningPath(conversationId), ListeningBody(on, since), id = "listening-${UUID.randomUUID()}")
        flush(app)
    }

    /** Settings → "Listening mode in new chats". */
    suspend fun setDefault(app: LabApp, on: Boolean) {
        Analytics.track("chat.listening_mode", mapOf("scope" to "default", "on" to on))
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
        Analytics.track("chat.listening_reveal")
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

    /** Registered in FeatureSyncs: the settings, then the newest clips of every chat into the read-aloud cache. */
    object Sync : FeatureSync {
        override suspend fun sync(ctx: SyncContext) {
            refresh(ctx.api, ctx.cache, ctx.outbox)
            val clips = ChatClips.current ?: return
            // The server already picked each clip's voice for me as the listener.
            clips.prefetch(ctx.api.chatClips().clips.map { ChatClips.Item(it.text, it.voice_id, it.speed) })
        }
    }
}

/**
 * Chat read-aloud's voice (docs/CHAT.md; core ChatVoice = shared/chats/voice.ts): the sender's
 * voice gender → the first voice of that gender in MY conversation voices; Claude's lines keep the
 * chat's persona voice. Read aloud, listening mode's tap and every prefetch use this one rule.
 */
object ChatReadAloud {
    suspend fun voice(app: LabApp, senderIsMe: Boolean, otherGender: String?, fromAi: Boolean, personaVoice: String?, personaSpeed: Double?): Pair<String, Double> {
        val gender = if (senderIsMe) app.prefs.voiceGender else otherGender
        val enabled = ConversationVoiceCache.get(app.cache)
        return ChatVoice.voice(gender, enabled, fromAi, personaVoice) to ChatVoice.speed(fromAi, personaSpeed)
    }

    /** A message from the other person in a chat with a person: its voice from the cached relationship's voice gender. */
    suspend fun voiceForIncoming(app: LabApp, relationshipId: String?, conversationId: String? = null): Pair<String, Double> {
        val me = Connections.myId(app.cache)
        // No relationship on the event (an update): the inbox knows the conversation's.
        val relId = relationshipId ?: conversationId?.let { c ->
            runCatching { app.cache.get<dev.jeromeswannack.chineselearning.lab.core.chat.ChatListResponse>(dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsKeys.LIST) }.getOrNull()
                ?.conversations?.firstOrNull { it.conversationId == c }?.relationshipId
        }
        val rel = relId?.let { runCatching { app.cache.get<RelationshipDto>(ConnectionsKeys.relationship(it)) }.getOrNull() }
        return voice(app, senderIsMe = false, otherGender = rel?.other(me)?.voice_gender, fromAi = false, personaVoice = null, personaSpeed = null)
    }
}

/**
 * Read-aloud clips on the phone (docs/CHAT.md "Client prefetch"): the lessons' cache-first TTS
 * (`POST /api/practice/tts`, files keyed by text + voice + speed — LessonMedia), so Read aloud and
 * a listening-mode tap play the same file at once, offline too.
 */
class ChatClips(private val app: LabApp) {
    data class Item(val text: String, val voice: String, val speed: Double)

    private val media get() = LessonRuntime.of(app).media
    private val gate = Semaphore(3)

    fun cached(text: String, voice: String, speed: Double): File? = media.cachedTts(media.ttsKey(text, speed, voice))

    /** Cache-first; else made and kept (null offline with nothing cached, or when the server can't). */
    suspend fun clip(text: String, voice: String, speed: Double): File? = media.tts(text, voice, speed = speed, online = app.online.value)

    /** Fetches the clips not on the phone yet (online only; quiet on failure). */
    suspend fun prefetch(items: List<Item>) = coroutineScope {
        if (!app.online.value) return@coroutineScope
        items.filter { it.text.isNotBlank() }.distinct().filter { cached(it.text, it.voice, it.speed) == null }.map { item ->
            async { gate.withPermit { runCatching { media.tts(item.text, item.voice, speed = item.speed, online = true) } } }
        }.awaitAll()
    }

    /** The newest messages a tap would play (`prefetchSelection(messages, me, 20)`), each in its voice. */
    suspend fun prefetchFor(messages: List<ChatMessageDto>, myId: String, voiceOf: suspend (ChatMessageDto) -> Pair<String, Double>) {
        val pick = ChatListening.prefetchSelection(messages, myId, ChatListening.LISTENING_PREFETCH_COUNT, ChatListeningStore::listeningMessage)
        prefetch(pick.map { m -> voiceOf(m).let { (v, s) -> Item(m.content, v, s) } })
    }

    companion object {
        @Volatile var current: ChatClips? = null
            private set

        /** The app's one instance (ChatDelivery.install makes it, so the background sync can prefetch). */
        fun of(app: LabApp): ChatClips = synchronized(this) {
            current?.takeIf { it.app === app } ?: ChatClips(app).also { current = it }
        }
    }
}
