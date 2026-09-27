package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.TeachFlagsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeChatsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipHomeworkDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentSharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant

/** Everything the tutor's student page shows (web: ConnectionDetailPage, tutor view). */
data class StudentPageUi(
    val relId: String,
    /** From the cached relationships until the overview arrives. */
    val name: String,
    val email: String? = null,
    /** The student's About me and time zone (Profile screen), from the relationship. */
    val about: String? = null,
    val timeZone: String? = null,
    val overview: Loadable<StudentOverviewDto> = Loadable(loading = true),
    val homework: Loadable<RelationshipHomeworkDto> = Loadable(loading = true),
    val flags: Loadable<TeachFlagsDto> = Loadable(loading = true),
    val claude: Loadable<ClaudeChatsDto> = Loadable(loading = true),
    val conversations: Loadable<List<ConversationDto>> = Loadable(loading = true),
    val lessons: Loadable<List<StudentLessonDto>> = Loadable(loading = true),
    val lastLessonAt: String? = null,
    val studentDecks: List<StudentSharedDeckDto>? = null,
    val liveCallId: String? = null,
    /** One line about the last action ("Moved … to #1"), success or failure. */
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    val updatingShare: String? = null,
    /** null → "Send how-to"; "Sending…"; "How-to sent ✓". */
    val howTo: String? = null,
    val messageBusy: Boolean = false,
    val callBusy: Boolean = false,
    val removing: Boolean = false,
    val playingKey: String? = null,
    /** The lesson-notes section (package F, docs/HOMEWORK.md) — rendered by the caller between nav and homework. */
    val lessonNotes: (@Composable () -> Unit)? = null,
    /** The tutor's private student profile (StudentProfileSection) — rendered just before the lesson notes. */
    val studentProfile: (@Composable () -> Unit)? = null,
)

data class StudentPageActions(
    val open: (String) -> Unit = {},
    val back: () -> Unit = {},
    val message: () -> Unit = {},
    val sendHomework: () -> Unit = {},
    val videoCall: () -> Unit = {},
    val moveShare: (HomeworkDeckDto, String) -> Unit = { _, _ -> },
    val updateShare: (HomeworkDeckDto) -> Unit = {},
    val moveDate: (AssignmentDto, String) -> Unit = { _, _ -> },
    val cancelAssignment: (AssignmentDto) -> Unit = {},
    val flags: FlagActions = FlagActions(),
    val sendHowTo: () -> Unit = {},
    val copy: (String) -> Unit = {},
    val share: (String) -> Unit = {},
    val loadStudentDecks: () -> Unit = {},
    val removeConnection: () -> Unit = {},
    val playRecording: (String) -> Unit = {},
    val refresh: () -> Unit = {},
)

/** "Last studied today, 12:32 AM · 🔥 1 day · 7 active days / 30" (web: studentStatusLine). */
fun studentStatusLine(o: StudentOverviewDto, now: Instant = Instant.now()): String {
    if (o.is_new) return "${if (o.joined_via_invite) "Joined via your link" else "Connected"} · ${TeachingFormat.shortDateTime(o.joined_at, now)}"
    val s = o.status
    return listOf(
        s.last_studied_at?.let { "Last studied ${TeachingFormat.relativeDay(it, now)}, ${TeachingFormat.time(it)}" } ?: "Not studied yet",
        "🔥 ${s.streak_days} day${if (s.streak_days == 1) "" else "s"}",
        "${s.active_days_30} active day${if (s.active_days_30 == 1) "" else "s"} / 30",
    ).joinToString(" · ")
}

/**
 * The tutor's student page. Phone: one column in the web's order (status → Message / Send
 * homework → needs attention → flags → Asked Claude → links → lesson notes → homework →
 * conversations → activity). Unfolded (≥ 640dp): two panes — the student on the left, the
 * work (homework, conversations, activity) on the right.
 */
@Composable
fun StudentPageScreen(ui: StudentPageUi, actions: StudentPageActions, now: Instant = Instant.now()) {
    var menu by remember { mutableStateOf(false) }
    var showStudentDecks by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }
    var showQr by remember { mutableStateOf(false) }
    val overview = ui.overview.data
    val name = overview?.let { studentName(it) } ?: ui.name

    Box(
        Modifier.fillMaxSize().background(Lab.colors.background)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .imePadding(),
        contentAlignment = Alignment.TopCenter,
    ) {
        BoxWithConstraints(Modifier.fillMaxSize().widthIn(max = 1180.dp)) {
            val wide = maxWidth >= 640.dp
            Column(Modifier.fillMaxSize()) {
                ScreenTitle(name, subtitle = headerLine(ui, now), onBack = actions.back) {
                    IconButton(onClick = { menu = true }) { Text("⋯", fontSize = 24.sp, color = Lab.colors.ink) }
                }
                val pad = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 28.dp)
                if (wide) {
                    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        LazyColumn(Modifier.weight(1f), contentPadding = pad, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            studentColumn(ui, actions, now, onShowQr = { showQr = true })
                        }
                        LazyColumn(Modifier.weight(1f), contentPadding = pad, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            workColumn(ui, actions, now, showStudentDecks)
                        }
                    }
                } else {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = pad, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        studentColumn(ui, actions, now, onShowQr = { showQr = true })
                        workColumn(ui, actions, now, showStudentDecks)
                    }
                }
            }
        }
    }

    if (menu) {
        LabBottomSheet(onDismiss = { menu = false }, title = name) {
            NavRow("🗂️", if (showStudentDecks) "Hide decks the student shared with you" else "Decks the student shared with you" + (ui.studentDecks?.takeIf { it.isNotEmpty() }?.let { " (${it.size})" } ?: ""), onClick = {
                menu = false
                showStudentDecks = !showStudentDecks
                if (showStudentDecks) actions.loadStudentDecks()
            })
            NavRow("📈", "Progress (30-day summary)", onClick = { menu = false; actions.open(Routes.studentProgress(ui.relId)) })
            NavRow("📚", "Assign from lesson library", onClick = { menu = false; actions.open(Routes.LIBRARY) })
            NavRow("🗑️", if (ui.removing) "Removing…" else "Remove connection", danger = true, enabled = !ui.removing, onClick = { menu = false; confirmRemove = true })
        }
    }
    if (confirmRemove) {
        ConfirmDialog("Remove $name as your student?", "Their decks and progress stay in their account.", "Remove", onConfirm = actions.removeConnection, onDismiss = { confirmRemove = false }, danger = true)
    }
    val invite = overview?.setup?.invite
    if (showQr && invite != null) {
        InviteQrSheet(invite.url, "Invite link", "Scanning this again on their phone just opens the app for them.", actions.copy, actions.share) { showQr = false }
    }
}

private fun headerLine(ui: StudentPageUi, now: Instant): String {
    val o = ui.overview.data
    val base = when {
        o != null -> studentStatusLine(o, now)
        ui.overview.error != null -> "Could not load activity"
        else -> "Loading…"
    }
    return base + (ui.lastLessonAt?.let { " · last lesson ${TeachingFormat.shortDate(it, now)}" } ?: "")
}

private fun LazyListScope.studentColumn(ui: StudentPageUi, actions: StudentPageActions, now: Instant, onShowQr: () -> Unit) {
    val o = ui.overview.data
    if (!ui.about.isNullOrBlank() || !ui.timeZone.isNullOrBlank()) item(key = "about") {
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard {
            dev.jeromeswannack.chineselearning.lab.ui.profile.PersonAbout(ui.about, ui.timeZone, Modifier.padding(horizontal = 16.dp, vertical = 12.dp), now = now)
        }
    }
    if (ui.liveCallId != null) item(key = "live") {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Again.copy(alpha = 0.1f)).padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("🔴 Video call in progress", color = Lab.colors.ink, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            PrimaryPill("Join", Modifier.height(44.dp)) { actions.open(Routes.call(ui.liveCallId)) }
        }
    }
    item(key = "actions") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TeachButton("💬 Message", Modifier.weight(1f), primary = true, enabled = !ui.messageBusy, onClick = actions.message)
                TeachButton("📤 Send homework", Modifier.weight(1f).height(52.dp), onClick = actions.sendHomework)
            }
            TeachButton(if (ui.callBusy) "Starting…" else "📹 Video call (beta)", Modifier.fillMaxWidth(), enabled = !ui.callBusy, onClick = actions.videoCall)
            if (ui.notice != null) InlineNotice(ui.notice, kind = if (ui.noticeIsError) NoticeKind.Error else NoticeKind.Success)
        }
    }
    item(key = "state") {
        val ov = ui.overview
        when {
            ov.data != null && ov.offline -> OfflineNotice(updatedAt = ov.updatedAt)
            ov.data != null && ov.error != null -> InlineNotice(ov.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.refresh)
            ov.data == null && ov.loading -> LoadingState(text = "Loading activity…")
            ov.data == null && ov.offline -> InlineNotice("You're offline — this student's page hasn't been downloaded to this phone yet.", kind = NoticeKind.Offline, actionLabel = "Retry", onAction = actions.refresh)
            ov.data == null && ov.error != null -> InlineNotice(ov.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.refresh)
        }
    }
    if (o != null && o.is_new) item(key = "setup") {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SetupChecklistCard(o, ui.howTo, actions.sendHomework, actions.sendHowTo, actions.message, onShowQr, actions.copy, now)
        }
    }
    if (o != null && !o.is_new) item(key = "attention") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TeachSectionTitle("Needs attention")
            NeedsAttentionCard(ui.relId, o.needs_attention, o.pills.recordings_to_hear, ui.playingKey, actions.playRecording, actions.open)
        }
    }
    item(key = "flags") { FlaggedCardsSection(ui.flags.data?.flags, ui.flags.error, actions.flags, now) }
    val claude = ui.claude.data
    if (o != null && !(o.is_new && (claude?.total ?: 0) == 0)) item(key = "claude") {
        AskedClaudeSection(ui.relId, claude?.questions, claude?.total ?: 0, o.student.name, actions.open, now)
    }
    item(key = "links") { StudentNavLinks(ui.relId, o?.pills?.recordings_to_hear ?: 0, actions.open) }
}

private fun LazyListScope.workColumn(ui: StudentPageUi, actions: StudentPageActions, now: Instant, showStudentDecks: Boolean) {
    val o = ui.overview.data
    ui.studentProfile?.let { section -> item(key = "student-profile") { section() } }
    ui.lessonNotes?.let { section -> item(key = "lesson-notes") { section() } }
    item(key = "homework") {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            TeachSectionTitle("Homework")
            val hw = ui.homework.data
            if (hw != null) AssignedHomeworkCard(hw, o?.student?.name ?: o?.student?.email ?: "the student", actions.moveDate, actions.cancelAssignment)
            else if (ui.homework.error != null && !ui.homework.offline) MutedLine("Could not load the homework plan")
            if (o != null && o.homework.decks.isEmpty() && o.homework.lessons.isEmpty()) {
                TeachCard {
                    EmptyState("📚", "No homework yet", body = "Send a deck or a lesson — it lands on their home screen after their next sync.", actionLabel = "Send homework", onAction = actions.sendHomework)
                }
            }
        }
    }
    o?.homework?.decks?.forEach { d ->
        item(key = "deck-${d.shared_deck_id}") {
            HomeworkDeckRow(ui.relId, d, ui.updatingShare == d.shared_deck_id, { to -> actions.moveShare(d, to) }, { actions.updateShare(d) }, actions.open, now)
        }
    }
    item(key = "lessons") { StudentLessonsCard(ui.relId, ui.lessons.data, ui.lessons.error, actions.open, now) }
    if (showStudentDecks) item(key = "student-decks") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TeachSectionTitle("Decks the student shared with you")
            TeachCard {
                val decks = ui.studentDecks
                when {
                    decks == null -> MutedLine("Loading…")
                    decks.isEmpty() -> MutedLine("Nothing yet — the student can share a deck from its deck page.")
                    else -> decks.forEach { sd ->
                        NavRow("🃏", sd.deck_name, desc = "${sd.note_count} notes • Shared ${TeachingFormat.shortDate(sd.shared_at, now)}", onClick = {
                            actions.open("/connections/${Routes.seg(ui.relId)}/student-shared-decks/${Routes.seg(sd.id)}/progress")
                        })
                    }
                }
            }
        }
    }
    item(key = "conversations") { ConversationsCard(ui.relId, ui.conversations.data, actions.message, actions.open, now) }
    if (o != null && !o.is_new) item(key = "activity") { ActivityCard(ui.relId, o.activity, actions.open) }
    item(key = "end") { Spacer(Modifier.height(8.dp)) }
}
