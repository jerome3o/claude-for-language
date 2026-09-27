package dev.jeromeswannack.chineselearning.lab.ui.teaching

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentPatchBody
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.localToday
import dev.jeromeswannack.chineselearning.lab.data.api.sharedDeckProgress
import dev.jeromeswannack.chineselearning.lab.data.api.studentCardDay
import dev.jeromeswannack.chineselearning.lab.data.api.studentDailyProgress
import dev.jeromeswannack.chineselearning.lab.data.api.studentDay
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.PlaceholderScreen

/**
 * Package F's routes — the tutor side of `/connections/…`. The `/connections` root itself is
 * E's (ui/connections/ConnectionsNav.kt), which renders [StudentsDashboardRoute] for an
 * account with students. `/connections/{relId}` is registered here: the student page when
 * the other person is my student, otherwise the student-side tutor page (E's, a placeholder
 * until it lands — replace the `else` with E's screen).
 */
fun NavGraphBuilder.teachingGraph(nav: LabNav) {
    composable(Routes.route("/connections/{relId}")) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val relationships by nav.app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collectAsStateWithLifecycle(null)
        val asStudent = relationships?.students?.firstOrNull { it.id == relId }
        when {
            asStudent != null -> StudentPageRoute(nav, relId, asStudent)
            relationships == null -> Unit // cache still loading (a frame)
            else -> PlaceholderScreen(Routes.connection(relId), onBack = nav::back) { nav.openInMainApp(Routes.connection(relId)) }
        }
    }
    tutorPage(nav, "/connections/{relId}/insights") { relId, name, _ -> InsightsRoute(nav, relId, name) }
    tutorPage(nav, "/connections/{relId}/history") { relId, name, _ -> HistoryRoute(nav, relId, name) }
    tutorPage(nav, "/connections/{relId}/recordings") { relId, name, _ -> RecordingsRoute(nav, relId, name) }
    tutorPage(nav, "/connections/{relId}/session-notes") { relId, name, _ -> SessionNotesRoute(nav, relId, name) }
    tutorPage(nav, "/connections/{relId}/progress") { relId, name, _ ->
        val r = cached(nav, "teaching/progress/$relId") { studentDailyProgress(relId) }
        val state by r.state.collectAsStateWithLifecycle()
        StudentProgressScreen(state.data?.student?.name ?: name, state, nav::back, { d -> nav.open("/connections/${Routes.seg(relId)}/progress/day/$d") }, { r.refresh() })
    }
    tutorPage(nav, "/connections/{relId}/progress/day/{date}") { relId, _, args ->
        val date = args?.getString("date").orEmpty()
        val r = cached(nav, "teaching/day/$relId/$date") { studentDay(relId, date) }
        val state by r.state.collectAsStateWithLifecycle()
        StudentDayScreen(date, state, nav::back, { card -> nav.open("/connections/${Routes.seg(relId)}/progress/day/$date/card/${Routes.seg(card)}") }, { r.refresh() })
    }
    tutorPage(nav, "/connections/{relId}/progress/day/{date}/card/{cardId}") { relId, _, args ->
        val date = args?.getString("date").orEmpty()
        val cardId = args?.getString("cardId").orEmpty()
        val r = cached(nav, "teaching/card-day/$relId/$date/$cardId") { studentCardDay(relId, date, cardId) }
        val state by r.state.collectAsStateWithLifecycle()
        val playing by nav.app.audio.playingKey.collectAsStateWithLifecycle()
        val online by nav.app.online.collectAsStateWithLifecycle()
        StudentCardDayScreen(date, state, playing, { url, text -> if (playing == url) nav.app.audio.stop() else nav.app.audio.play(url, text, online) }, nav::back, { r.refresh() })
    }
    tutorPage(nav, "/connections/{relId}/shared-decks/{sharedDeckId}/progress") { relId, _, args ->
        val id = args?.getString("sharedDeckId").orEmpty()
        val r = cached(nav, "teaching/shared-deck/$relId/$id") { sharedDeckProgress(relId, id, studentShared = false) }
        val state by r.state.collectAsStateWithLifecycle()
        SharedDeckProgressScreen(state, nav::back, { r.refresh() })
    }
    tutorPage(nav, "/connections/{relId}/student-shared-decks/{studentSharedDeckId}/progress") { relId, _, args ->
        val id = args?.getString("studentSharedDeckId").orEmpty()
        val r = cached(nav, "teaching/student-deck/$relId/$id") { sharedDeckProgress(relId, id, studentShared = true) }
        val state by r.state.collectAsStateWithLifecycle()
        SharedDeckProgressScreen(state, nav::back, { r.refresh() })
    }
    tutorPage(nav, "/connections/{relId}/claude-chats") { relId, name, _ -> StudentChatsRoute(nav, relId, name) }
    composable(Routes.route("/connections/{relId}/cards/{noteId}")) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val noteId = entry.arguments?.getString("noteId").orEmpty()
        val relationships by nav.app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collectAsStateWithLifecycle(null)
        val rel = relationships?.students?.firstOrNull { it.id == relId }
        StudentHubRoute(nav, relId, noteId, rel?.studentUser()?.let { it.name ?: it.email } ?: "Student")
    }
    composable(Routes.route("/connections/{relId}/homework/{jobId}")) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val jobId = entry.arguments?.getString("jobId").orEmpty()
        DraftRoute(nav, relId, jobId)
    }
}

@Composable
private fun playToggle(nav: LabNav): (String) -> Unit {
    val playing by nav.app.audio.playingKey.collectAsStateWithLifecycle()
    val online by nav.app.online.collectAsStateWithLifecycle()
    return { url -> if (playing == url) nav.app.audio.stop() else nav.app.audio.play(url, "", online) }
}

@Composable
private fun InsightsRoute(nav: LabNav, relId: String, name: String) {
    val vm: InsightsViewModel = viewModel(key = "insights-$relId", factory = InsightsViewModel.Factory(nav.app, relId))
    val report by vm.report.collectAsStateWithLifecycle()
    val log by vm.lessonLog.state.collectAsStateWithLifecycle()
    val summaries by vm.summaries.state.collectAsStateWithLifecycle()
    val t by vm.transient.collectAsStateWithLifecycle()
    val playing by nav.app.audio.playingKey.collectAsStateWithLifecycle()
    InsightsScreen(
        InsightsUi(relId, name, t.range, report, log, summaries.data.orEmpty(), t.latest, t.writing, t.summaryError, t.lessonError, t.savingLesson, playing),
        InsightsActions(
            back = nav::back, open = nav::open, setRange = vm::setRange, writeSummary = { vm.writeSummary() },
            logLesson = { d, n, done -> vm.logLesson(d, n, done) }, deleteLesson = { vm.deleteLesson(it) },
            play = playToggle(nav), refresh = vm::refresh,
        ),
    )
}

@Composable
private fun HistoryRoute(nav: LabNav, relId: String, name: String) {
    val vm: HistoryViewModel = viewModel(key = "history-$relId", factory = HistoryViewModel.Factory(nav.app, relId))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val playing by nav.app.audio.playingKey.collectAsStateWithLifecycle()
    HistoryScreen(
        ui.copy(studentName = name, playingKey = playing),
        HistoryActions(back = nav::back, open = nav::open, setFilters = vm::setFilters, setByWord = { vm.setByWord(it) }, loadMore = vm::loadMore, play = playToggle(nav), retry = { vm.reload() }),
    )
}

@Composable
private fun RecordingsRoute(nav: LabNav, relId: String, name: String) {
    val vm: RecordingsViewModel = viewModel(key = "recordings-$relId", factory = RecordingsViewModel.Factory(nav.app, relId))
    val report by vm.report.collectAsStateWithLifecycle()
    val t by vm.transient.collectAsStateWithLifecycle()
    val playing by nav.app.audio.playingKey.collectAsStateWithLifecycle()
    RecordingsScreen(
        RecordingsUi(relId, name, t.range, t.filter, report.data?.recordings, report.loading, report.error, report.offline, playing, t.saving, t.markError),
        RecordingsActions(back = nav::back, open = nav::open, setRange = vm::setRange, setFilter = { vm.setFilter(it) }, play = playToggle(nav), mark = { r, s, c -> vm.mark(r, s, c) }, retry = { vm.retry() }),
    )
}

/** The tutor's pages about one student (only when the relationship is one where I am the tutor). */
private fun NavGraphBuilder.tutorPage(nav: LabNav, pattern: String, content: @Composable (relId: String, studentName: String, args: android.os.Bundle?) -> Unit) {
    composable(Routes.route(pattern)) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val relationships by nav.app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collectAsStateWithLifecycle(null)
        val rel = relationships?.students?.firstOrNull { it.id == relId }
        val path = "/" + pattern.removePrefix("/").replace(Regex("\\{([^}]+)\\}")) { m -> Routes.seg(entry.arguments?.getString(m.groupValues[1]).orEmpty()) }
        when {
            rel != null -> content(relId, rel.studentUser()?.let { it.name ?: it.email } ?: "Student", entry.arguments)
            relationships == null -> Unit
            else -> PlaceholderScreen(path, onBack = nav::back) { nav.openInMainApp(path) }
        }
    }
}

/** The student in a relationship where I am the tutor. */
fun RelationshipDto.studentUser() = if (requester_role == "student") requester else recipient

fun Context.copyToClipboard(text: String) {
    getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Invite link", text))
}

fun Context.shareLink(url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, "Learn Chinese with me")
        putExtra(Intent.EXTRA_TEXT, url)
    }
    startActivity(Intent.createChooser(send, "Share invite link").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** `/connections` for an account with students (web: ConnectionsPage → StudentsDashboard). */
@Composable
fun StudentsDashboardRoute(nav: LabNav) {
    val app = nav.app
    val context = LocalContext.current
    val vm: DashboardViewModel = viewModel(factory = DashboardViewModel.Factory(app))
    val state by vm.dashboard.state.collectAsStateWithLifecycle()
    val me by vm.me.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var homeworkFor by remember { mutableStateOf<StudentOverviewDto?>(null) }
    var inviting by remember { mutableStateOf(false) }
    val online by app.online.collectAsStateWithLifecycle()
    val decks by vm.send.decks.collectAsStateWithLifecycle()
    val canInvite = me.data?.let { it.can_invite || it.is_admin } ?: app.prefs.isAdmin

    StudentsDashboardScreen(
        state = state,
        canInvite = canInvite,
        notice = notice,
        actions = DashboardActions(
            open = nav::open,
            message = { o -> vm.message(o) { conv -> nav.open(Routes.chat(o.relationship_id, conv)) } },
            sendHomework = { homeworkFor = it; vm.send.loadDecks() },
            invite = { inviting = true; vm.send.loadDecks() },
            revokeInvite = vm::revoke,
            copy = { context.copyToClipboard(it); app.haptics.tick() },
            share = context::shareLink,
            createDeck = { name -> vm.createDeck(name) { id -> nav.open(Routes.deck(id)) } },
            refresh = { vm.dashboard.refresh() },
        ),
    )
    if (inviting) {
        InviteSheet(
            decks = decks, online = online,
            create = { req, step, done -> vm.createInvite(req, step, done) },
            onCopy = { context.copyToClipboard(it); app.haptics.tick() },
            onShare = context::shareLink,
            onDismiss = { inviting = false },
        )
    }
    homeworkFor?.let { o -> SendHomeworkFor(nav, vm.send, o.relationship_id, studentName(o), o) { homeworkFor = null } }
}

@Composable
internal fun SendHomeworkFor(nav: LabNav, send: SendHomeworkController, relId: String, name: String, overview: StudentOverviewDto?, onDismiss: () -> Unit) {
    val decks by send.decks.collectAsStateWithLifecycle()
    val online by nav.app.online.collectAsStateWithLifecycle()
    val library by send.library.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { send.loadDecks() }
    SendHomeworkSheet(
        studentName = name,
        decks = decks,
        library = library,
        sharedDecks = overview?.homework?.decks.orEmpty(),
        assignedLessons = overview?.homework?.lessons.orEmpty(),
        online = online,
        today = localToday(),
        actions = SendHomeworkActions(
            sendDeck = { d, o, done -> send.sendDeck(relId, name, d, o, done) },
            updateCopy = { d, share, done -> send.updateCopy(relId, name, d, share, done) },
            assignLesson = { item, o, done -> send.assignLesson(relId, name, item, o, done) },
            loadLibrary = { send.loadLibrary() },
            open = { onDismiss(); nav.open(it) },
        ),
        onDismiss = onDismiss,
    )
}

@Composable
private fun StudentPageRoute(nav: LabNav, relId: String, rel: RelationshipDto) {
    val app = nav.app
    val context = LocalContext.current
    val vm: StudentPageViewModel = viewModel(key = "student-$relId", factory = StudentPageViewModel.Factory(app, relId))
    val overview by vm.overview.state.collectAsStateWithLifecycle()
    val homework by vm.homework.state.collectAsStateWithLifecycle()
    val flags by vm.flags.state.collectAsStateWithLifecycle()
    val claude by vm.claude.state.collectAsStateWithLifecycle()
    val conversations by vm.conversations.state.collectAsStateWithLifecycle()
    val lessons by vm.lessons.state.collectAsStateWithLifecycle()
    val lessonLog by vm.lessonLog.state.collectAsStateWithLifecycle()
    val t by vm.transient.collectAsStateWithLifecycle()
    val playing by app.audio.playingKey.collectAsStateWithLifecycle()
    val online by app.online.collectAsStateWithLifecycle()
    var showSend by remember { mutableStateOf(false) }
    var showNotesSheet by remember { mutableStateOf(false) }
    val notesEntries by vm.lessonNotes.entries.state.collectAsStateWithLifecycle()
    val drafting by vm.lessonNotes.drafting.collectAsStateWithLifecycle()
    val student = rel.studentUser()
    val name = overview.data?.let { studentName(it) } ?: student?.name ?: student?.email ?: "Student"

    StudentPageScreen(
        StudentPageUi(
            relId = relId,
            name = name,
            email = student?.email,
            overview = overview,
            homework = homework,
            flags = flags,
            claude = claude,
            conversations = conversations,
            lessons = lessons,
            lastLessonAt = lessonLog.data?.firstOrNull()?.lesson_at,
            studentDecks = t.studentDecks,
            liveCallId = t.liveCallId,
            notice = t.notice,
            noticeIsError = t.noticeIsError,
            updatingShare = t.updatingShare,
            howTo = t.howTo,
            messageBusy = t.messageBusy,
            callBusy = t.callBusy,
            removing = t.removing,
            playingKey = playing,
            lessonNotes = {
                LessonNotesSection(
                    relId, name, notesEntries.data, notesEntries.error, drafting,
                    LessonNotesActions(
                        add = { showNotesSheet = true },
                        draft = { e -> vm.lessonNotes.draft(e, { job -> nav.open(Routes.homeworkDraft(relId, job)) }) { vm.say(it, true) } },
                        openDraft = { job -> nav.open(Routes.homeworkDraft(relId, job)) },
                        open = nav::open,
                    ),
                )
            },
        ),
        StudentPageActions(
            open = nav::open,
            back = nav::back,
            message = { vm.message { conv -> nav.open(Routes.chat(relId, conv)) } },
            sendHomework = { showSend = true },
            videoCall = { vm.videoCall { id -> nav.open(Routes.call(id)) } },
            moveShare = { d, to -> vm.moveShare(d, to) },
            updateShare = { vm.updateShare(it) },
            moveDate = { a, date -> vm.patchAssignment(a, AssignmentPatchBody(due_date = date)) },
            cancelAssignment = { a -> vm.patchAssignment(a, AssignmentPatchBody(status = "cancelled")) },
            flags = FlagActions(
                reply = { f, text, done -> vm.replyFlag(f, text, done) },
                toggleResolved = { f, done -> vm.toggleFlag(f, done) },
                openCard = { noteId -> nav.open(Routes.studentCardHub(relId, noteId)) },
            ),
            sendHowTo = { vm.sendHowTo() },
            copy = { context.copyToClipboard(it); app.haptics.tick() },
            share = context::shareLink,
            loadStudentDecks = { vm.loadStudentDecks() },
            removeConnection = { vm.remove { nav.open(Routes.CONNECTIONS) } },
            playRecording = { url -> if (playing == url) app.audio.stop() else app.audio.play(url, "", online) },
            refresh = vm::refresh,
        ),
    )
    if (showSend) SendHomeworkFor(nav, vm.send, relId, name, overview.data) { showSend = false }
    if (showNotesSheet) {
        LessonNotesSheet(name, online, save = { notes, title, at, draft, done ->
            vm.lessonNotes.add(notes, title, at, draft, go = { job -> nav.open(Routes.homeworkDraft(relId, job)) }) { e -> done(e); if (e == null) showNotesSheet = false }
        }) { showNotesSheet = false }
    }
}

@Composable
private fun DraftRoute(nav: LabNav, relId: String, jobId: String) {
    val vm: DraftViewModel = viewModel(key = "draft-$relId-$jobId", factory = DraftViewModel.Factory(nav.app, relId, jobId))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val online by nav.app.online.collectAsStateWithLifecycle()
    HomeworkDraftScreen(
        ui.copy(online = online),
        DraftActions(
            back = nav::back, open = nav::open, updatePlan = vm::updatePlan, removeWord = { vm.removeWord(it) }, assign = { vm.assign() },
            cancelJob = { vm.cancelJob() }, retryJob = { vm.retryJob() }, send = { m, done -> vm.send(m, done) }, retry = { vm.reload() },
        ),
    )
}

@Composable
private fun SessionNotesRoute(nav: LabNav, relId: String, name: String) {
    val vm: SessionNotesViewModel = viewModel(key = "session-notes-$relId", factory = SessionNotesViewModel.Factory(nav.app, relId))
    val jobs by vm.jobs.state.collectAsStateWithLifecycle()
    val online by nav.app.online.collectAsStateWithLifecycle()
    SessionNotesScreen(
        SessionNotesUi(relId, name, jobs.data, jobs.error, online),
        JobActions(retry = { vm.retry(it) }, cancel = { vm.cancel(it) }, delete = { vm.delete(it) }, open = nav::open),
        back = nav::back,
        submit = { notes, title, at, priority, auto, log, done ->
            vm.submit(dev.jeromeswannack.chineselearning.lab.data.api.SubmitSessionNotesBody(notes, title, at, priority, auto, log), done)
        },
    )
}

@Composable
private fun StudentHubRoute(nav: LabNav, relId: String, noteId: String, name: String) {
    val vm: StudentHubViewModel = viewModel(key = "hub-$relId-$noteId", factory = StudentHubViewModel.Factory(nav.app, relId, noteId))
    val hub by vm.hub.state.collectAsStateWithLifecycle()
    val playing by nav.app.audio.playingKey.collectAsStateWithLifecycle()
    val online by nav.app.online.collectAsStateWithLifecycle()
    StudentCardHubScreen(
        StudentHubUi(relId, name, hub, playing),
        StudentHubActions(
            back = nav::back, open = nav::open,
            play = { url, text -> if (playing == url) nav.app.audio.stop() else nav.app.audio.play(url, text, online) },
            flags = FlagActions(reply = { f, t, done -> vm.reply(f, t, done) }, toggleResolved = { f, done -> vm.toggle(f, done) }),
            retry = { vm.hub.refresh() },
        ),
    )
}

@Composable
private fun StudentChatsRoute(nav: LabNav, relId: String, name: String) {
    val vm: StudentChatsViewModel = viewModel(key = "chats-$relId", factory = StudentChatsViewModel.Factory(nav.app, relId))
    val ui by vm.ui.collectAsStateWithLifecycle()
    StudentClaudeChatsScreen(ui.copy(studentName = name), back = nav::back, open = nav::open, loadMore = vm::loadMore)
}

/** A cache-first read-only page: one CachedResource living in its own ViewModel (keyed by the cache key). */
class ResourceViewModel<T>(make: (kotlinx.coroutines.CoroutineScope) -> dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource<T>) : androidx.lifecycle.ViewModel() {
    val resource = make(viewModelScope)
}

@Composable
private inline fun <reified T> cached(nav: LabNav, key: String, noinline fetch: suspend dev.jeromeswannack.chineselearning.lab.data.Api.() -> T): dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource<T> {
    val vm: ResourceViewModel<T> = viewModel(
        key = key,
        factory = object : androidx.lifecycle.ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <V : androidx.lifecycle.ViewModel> create(modelClass: Class<V>): V =
                ResourceViewModel { scope -> nav.app.cachedResource<T>(scope, key, TeachingKeys.KIND, fetch = fetch) } as V
        },
    )
    return vm.resource
}
