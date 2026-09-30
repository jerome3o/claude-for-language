package dev.jeromeswannack.chineselearning.lab.ui.connections

import dev.jeromeswannack.chineselearning.lab.data.api.startCall
import dev.jeromeswannack.chineselearning.lab.data.api.liveCalls
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.QuestionThreads
import dev.jeromeswannack.chineselearning.lab.data.api.FlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.FlagsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeChatQuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyClaudeChatsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.PracticeConversationBody
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.SharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentSharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.acceptRelationship
import dev.jeromeswannack.chineselearning.lab.data.api.cancelInvitation
import dev.jeromeswannack.chineselearning.lab.data.api.myCardFlags
import dev.jeromeswannack.chineselearning.lab.data.api.chatConversations
import dev.jeromeswannack.chineselearning.lab.data.api.startConversation
import dev.jeromeswannack.chineselearning.lab.data.api.createLessonNote
import dev.jeromeswannack.chineselearning.lab.data.api.createRelationship
import dev.jeromeswannack.chineselearning.lab.data.api.deleteCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.deleteLessonNote
import dev.jeromeswannack.chineselearning.lab.data.api.lessonNotes
import dev.jeromeswannack.chineselearning.lab.data.api.myClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.myRelationships
import dev.jeromeswannack.chineselearning.lab.data.api.openConversation
import dev.jeromeswannack.chineselearning.lab.data.api.relationship
import dev.jeromeswannack.chineselearning.lab.data.api.removeRelationship
import dev.jeromeswannack.chineselearning.lab.data.api.reopenCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.resolveCardFlag
import dev.jeromeswannack.chineselearning.lab.data.api.sharedDecks
import dev.jeromeswannack.chineselearning.lab.data.api.studentSharedDecks
import dev.jeromeswannack.chineselearning.lab.data.api.upload
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private data class Busy(val busy: Boolean = false, val notice: String? = null, val error: Boolean = false)

private class VmFactory<T : ViewModel>(private val make: () -> T) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <V : ViewModel> create(modelClass: Class<V>): V = make() as V
}

fun <T : ViewModel> factory(make: () -> T): ViewModelProvider.Factory = VmFactory(make)

/** `/connections` for a student. The relationships double as the shell's cached copy (NavKeys). */
class ConnectionsViewModel(private val app: LabApp) : ViewModel() {
    private val rel = app.cachedResource<MyRelationshipsDto>(viewModelScope, NavKeys.RELATIONSHIPS, NavKeys.KIND) { myRelationships() }
    private val me = MutableStateFlow<String?>(null)
    private val status = MutableStateFlow(Busy())

    val ui: StateFlow<ConnectionsUi> = combine(rel.state, me, status, app.online) { r, m, s, online ->
        ConnectionsUi(r, m, online, s.busy, s.notice, s.error)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, ConnectionsUi())

    init {
        viewModelScope.launch { me.value = Connections.myId(app.cache) }
    }

    private fun act(success: String? = null, block: suspend () -> String?) {
        status.value = Busy(true)
        viewModelScope.launch {
            try {
                val msg = block() ?: success
                rel.refresh().join()
                status.value = Busy(false, msg)
                app.haptics.correct()
            } catch (e: Exception) {
                status.value = Busy(false, e.userMessage(), error = true)
            }
        }
    }

    fun accept(id: String) = act { app.repo.api.acceptRelationship(id); null }
    fun remove(id: String) = act { app.repo.api.removeRelationship(id); null }
    fun cancelInvitation(id: String) = act { app.repo.api.cancelInvitation(id); null }
    fun invite(email: String, role: String) = act {
        val r = app.repo.api.createRelationship(email, role)
        if (r.type == "invitation") "Invitation sent to ${r.data?.recipient_email ?: email}" else "Request sent to $email"
    }
    fun dismissNotice() { status.value = status.value.copy(notice = null) }
    fun retry() { rel.refresh() }
}

/** `/connections/:relId` seen by the student. Each part is cached, so the page opens offline. */
class TutorPageViewModel(private val app: LabApp, private val relId: String) : ViewModel() {
    private val relationship = app.cachedResource<RelationshipDto>(viewModelScope, ConnectionsKeys.relationship(relId), ConnectionsKeys.KIND) { relationship(relId) }
    private val conversations = app.cachedResource<List<ChatConversationDto>>(viewModelScope, ConnectionsKeys.conversations(relId), ConnectionsKeys.KIND) { chatConversations(relId) }
    private val flags = app.cachedResource<FlagsDto>(viewModelScope, ConnectionsKeys.flags(relId), ConnectionsKeys.KIND) { myCardFlags(relId) }
    private val shared = app.cachedResource<List<SharedDeckDto>>(viewModelScope, ConnectionsKeys.sharedDecks(relId), ConnectionsKeys.KIND) { sharedDecks(relId) }
    private val studentShared = app.cachedResource<List<StudentSharedDeckDto>>(viewModelScope, ConnectionsKeys.studentSharedDecks(relId), ConnectionsKeys.KIND) { studentSharedDecks(relId) }
    private val me = MutableStateFlow<String?>(null)
    private val status = MutableStateFlow(Busy())
    /** A live video call in this relationship (Join banner), and "starting a call" (package J). */
    private val call = MutableStateFlow<Pair<String?, Boolean>>(null to false)

    private val parts = combine(relationship.state, conversations.state, flags.state, shared.state, studentShared.state) { r, c, f, s, ss -> arrayOf<Any>(r, c, f, s, ss) }

    @Suppress("UNCHECKED_CAST")
    val ui: StateFlow<TutorPageUi> = combine(parts, me, status, app.online, call) { p, m, s, online, c ->
        TutorPageUi(
            liveCallId = c.first,
            callBusy = c.second,
            relationship = p[0] as Loadable<RelationshipDto>,
            myId = m,
            conversations = p[1] as Loadable<List<ChatConversationDto>>,
            flags = p[2] as Loadable<FlagsDto>,
            sharedDecks = p[3] as Loadable<List<SharedDeckDto>>,
            studentSharedDecks = (p[4] as Loadable<List<StudentSharedDeckDto>>).data.orEmpty(),
            busy = s.busy,
            error = if (s.error) s.notice else null,
            online = online,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, TutorPageUi())

    init {
        viewModelScope.launch { me.value = Connections.myId(app.cache) }
        // A live call in this relationship shows a Join banner (web polls every 15 s).
        viewModelScope.launch {
            while (isActive) {
                if (app.online.value) runCatching { app.repo.api.liveCalls(relId) }.onSuccess { r -> call.update { it.copy(first = r.occupiedCallId()) } }
                delay(15_000)
            }
        }
    }

    /** 📹 Video call: join the live one, else start one (web: handleVideoCall). */
    fun videoCall(go: (String) -> Unit) {
        call.value.first?.let { go(it); return }
        if (call.value.second) return
        call.update { it.copy(second = true) }
        viewModelScope.launch {
            try {
                go(app.repo.api.startCall(relId).call.id)
            } catch (e: Exception) {
                status.value = Busy(false, e.userMessage(), error = true)
            }
            call.update { it.copy(second = false) }
        }
    }

    /** Message: the most recent conversation, created when there is none. */
    fun message(open: (String) -> Unit) {
        conversations.state.value.data?.firstOrNull()?.let { open(it.id); return }
        status.value = Busy(true)
        viewModelScope.launch {
            try {
                val c = app.repo.api.openConversation(relId)
                status.value = Busy()
                conversations.refresh()
                open(c.conversation_id)
            } catch (e: Exception) {
                status.value = Busy(false, e.userMessage(), error = true)
            }
        }
    }

    fun newPracticeConversation(body: PracticeConversationBody, open: (String) -> Unit) {
        status.value = Busy(true)
        viewModelScope.launch {
            try {
                val c = app.repo.api.startConversation(relId, body)
                status.value = Busy()
                conversations.refresh()
                open(c.id)
            } catch (e: Exception) {
                status.value = Busy(false, e.userMessage(), error = true)
            }
        }
    }

    fun toggleFlag(flag: FlagDto) = flagAction { if (flag.status == "open") app.repo.api.resolveCardFlag(flag.id) else app.repo.api.reopenCardFlag(flag.id) }
    fun deleteFlag(flag: FlagDto) = flagAction { app.repo.api.deleteCardFlag(flag.id) }

    private fun flagAction(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
                app.haptics.tick()
                flags.refresh()
            } catch (e: Exception) {
                status.value = Busy(false, e.userMessage(), error = true)
            }
        }
    }

    fun removeConnection(done: () -> Unit) {
        status.value = Busy(true)
        viewModelScope.launch {
            try {
                app.repo.api.removeRelationship(relId)
                runCatching { app.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, app.repo.api.myRelationships()) }
                done()
            } catch (e: Exception) {
                status.value = Busy(false, e.userMessage(), error = true)
            }
        }
    }

    fun retry() {
        relationship.refresh(); conversations.refresh(); flags.refresh(); shared.refresh(); studentShared.refresh()
    }
}

/** `/claude-chats`: the first page cached for offline; older pages on demand. */
class ClaudeChatsViewModel(private val app: LabApp) : ViewModel() {
    private val first = app.cachedResource<MyClaudeChatsDto>(viewModelScope, ConnectionsKeys.CLAUDE_CHATS, ConnectionsKeys.KIND) { myClaudeChats(PAGE) }
    private val extra = MutableStateFlow<List<ClaudeChatQuestionDto>>(emptyList())
    private val cursor = MutableStateFlow<String?>(null)
    private val cursorSet = MutableStateFlow(false)
    private val loadingMore = MutableStateFlow(false)

    val ui: StateFlow<ClaudeChatsUi> = combine(first.state, extra, cursor, cursorSet, loadingMore) { f, more, cur, set, loading ->
        val data = f.data
        val next = if (set) cur else data?.next_cursor
        ClaudeChatsUi(
            threads = Loadable(data?.let { QuestionThreads.group(it.questions + more) }, f.loading, f.error, f.offline, f.updatedAt),
            total = data?.total ?: 0,
            hasMore = next != null,
            loadingMore = loading,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, ClaudeChatsUi())

    fun loadMore() {
        val next = if (cursorSet.value) cursor.value else first.state.value.data?.next_cursor
        if (next == null || loadingMore.value) return
        loadingMore.value = true
        viewModelScope.launch {
            runCatching { app.repo.api.myClaudeChats(PAGE, next) }.onSuccess { page ->
                extra.value = extra.value + page.questions
                cursor.value = page.next_cursor
                cursorSet.value = true
            }
            loadingMore.value = false
        }
    }

    fun retry() { first.refresh() }

    companion object { const val PAGE = 100 }
}

/** `/lesson-notes`: list cached; save (+ attached files) needs a connection, like the web. */
class LessonNotesViewModel(private val app: LabApp) : ViewModel() {
    private val notes = app.cachedResource<List<LessonNoteDto>>(viewModelScope, "connections/lesson-notes", ConnectionsKeys.KIND) { lessonNotes() }
    private val status = MutableStateFlow(Busy())
    private val files = MutableStateFlow<List<Pair<String, Uri>>>(emptyList())

    val ui: StateFlow<LessonNotesUi> = combine(notes.state, status, app.online, files) { n, s, online, f ->
        LessonNotesUi(n, s.busy, if (s.error) s.notice else null, online, f.map { it.first })
    }.stateIn(viewModelScope, SharingStarted.Eagerly, LessonNotesUi())

    fun setFiles(uris: List<Uri>) {
        val resolver = app.contentResolver
        files.value = uris.map { uri ->
            val name = runCatching {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
            }.getOrNull() ?: uri.lastPathSegment ?: "upload"
            name to uri
        }
    }

    fun save(text: String, givenAt: String) {
        status.value = Busy(true)
        val picked = files.value
        viewModelScope.launch {
            try {
                val id = app.repo.api.createLessonNote(text.trim(), givenAt.trim().ifEmpty { null }).id
                for ((name, uri) in picked) {
                    val tmp = withContext(Dispatchers.IO) {
                        File(app.cacheDir, "lesson-note-${System.nanoTime()}").also { f ->
                            app.contentResolver.openInputStream(uri)?.use { input -> f.outputStream().use { input.copyTo(it) } }
                        }
                    }
                    try {
                        app.repo.api.upload("/api/lesson-notes/$id/files", tmp, fileName = name, mime = app.contentResolver.getType(uri) ?: "application/octet-stream")
                    } finally {
                        tmp.delete()
                    }
                }
                files.value = emptyList()
                status.value = Busy()
                app.haptics.correct()
                notes.refresh()
            } catch (e: Exception) {
                status.value = Busy(false, e.userMessage(), error = true)
            }
        }
    }

    fun delete(id: String) {
        viewModelScope.launch {
            try {
                app.repo.api.deleteLessonNote(id)
                notes.refresh()
            } catch (e: Exception) {
                status.value = Busy(false, e.userMessage(), error = true)
            }
        }
    }

    fun retry() { notes.refresh() }
}
