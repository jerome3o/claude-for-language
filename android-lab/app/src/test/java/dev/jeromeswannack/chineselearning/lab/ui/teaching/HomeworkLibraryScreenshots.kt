package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkDetails
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.LibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.StudentCopyDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentCopyResultDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeworkListScreen
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeworkListUi
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeworkPassScreen
import dev.jeromeswannack.chineselearning.lab.ui.homework.LinkPassUi
import dev.jeromeswannack.chineselearning.lab.ui.homework.PassActions
import dev.jeromeswannack.chineselearning.lab.ui.homework.PassUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import java.time.Instant

/** The tutor homework hub (docs/HOMEWORK.md §8–10): library, most recent homework, update copies, link homework. */
class HomeworkLibraryScreenshots : LabScreenshotTest() {
    companion object {
        const val TODAY = "2026-10-03"
        val NOW: Instant = Instant.parse("2026-10-03T09:00:00Z")

        private fun item(
            key: String, kind: String, title: String, status: String, percent: Int, sent: String, due: String?,
            student: String = "Jerome Swannack", progress: String = "", note: String? = null, url: String? = null, behind: Int = 0,
        ) = LibraryItem(
            key = key, kind = kind, relationship_id = if (student.startsWith("Jerome")) "rel-jerome" else "rel-lily", student_name = student,
            title = title, source_id = "src-$key", target_id = "t-$key", share_id = if (kind == "deck" || kind == "reader") "sh-$key" else null,
            sent_at = sent, due_date = due, mode = if (kind == "link") "one_off" else "both", percent = percent, progress = progress, status = status,
            assignment_ids = listOf("as-$key"), due_assignment_id = if (status == "completed") null else "as-$key", behind = behind,
            url = url, thumbnail_url = url?.let { dev.jeromeswannack.chineselearning.lab.core.HomeworkLinks.linkThumbnail(it) }, student_note = note,
        )

        val items = listOf(
            item("d1", "deck", "第五周作业：交通", "in_progress", 42, "2026-10-02T20:10:00Z", "2026-10-04", progress = "5 / 12 words", behind = 3),
            item("l1", "lesson", "把字句 — 把东西放好", "not_started", 0, "2026-10-02T20:12:00Z", "2026-10-04", progress = "not started"),
            item("k1", "link", "《小幸运》— listen and sing along", "completed", 100, "2026-10-02T20:15:00Z", "2026-10-03", note = "我听懂了大部分！第二段有点快。", url = "https://youtu.be/dQw4w9WgXcQ"),
            item("r1", "reader", "小明在巴黎", "overdue", 0, "2026-09-28T18:00:00Z", "2026-10-01", progress = "not read yet"),
            item("d2", "deck", "HSK 1", "completed", 100, "2026-09-20T18:00:00Z", "2026-09-27", progress = "40 / 40 words"),
            item("d4", "deck", "HSK 3 · Plans & time", "long_term", 35, "2026-09-29T18:00:00Z", null, progress = "14 / 40 words met").copy(mode = "fsrs", due_assignment_id = null),
            item("d3", "deck", "餐厅点菜", "in_progress", 65, "2026-09-30T18:00:00Z", "2026-10-09", student = "Lily Chen", progress = "13 / 20 words"),
            item("k2", "link", "爸爸去哪儿 · episode 3 (first 10 minutes)", "not_started", 0, "2026-09-30T18:05:00Z", null, student = "Lily Chen", url = "https://www.bilibili.com/video/BV1xx411c7mD"),
        )
        val jeromeItems = items.filter { it.relationship_id == "rel-jerome" }
    }

    /** Like [shoot] but captures every window, so bottom sheets are in the picture. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun shootScreen(name: String, content: @Composable () -> Unit) {
        compose.setContent { LabTheme { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/$name.png")
    }

    private fun ui(list: List<LibraryItem>, student: String? = "Jerome Swannack", filter: LibraryFilter = LibraryFilter()) =
        HomeworkLibraryUi(studentName = student, state = Loadable(list), today = TODAY, filter = filter)

    @Test fun studentLibrary() = shoot("hwlib-01-student") { HomeworkLibraryScreen(ui(jeromeItems), HomeworkLibraryActions(), NOW) }

    @Test fun allStudents() = shoot("hwlib-02-all-students") { HomeworkLibraryScreen(ui(items, student = null), HomeworkLibraryActions(), NOW) }

    @Test fun filtered() = shoot("hwlib-03-filter-in-progress") {
        HomeworkLibraryScreen(ui(items, student = null, filter = LibraryFilter(status = "in_progress")), HomeworkLibraryActions(), NOW)
    }

    @Test fun rowActions() = shootScreen("hwlib-04-row-actions") {
        HomeworkLibraryScreen(ui(jeromeItems).copy(selected = jeromeItems[0]), HomeworkLibraryActions(), NOW)
    }

    @Test fun changeDue() = shootScreen("hwlib-05-change-due") {
        HomeworkLibraryScreen(ui(jeromeItems).copy(dueFor = jeromeItems[0]), HomeworkLibraryActions(), NOW)
    }

    @Test fun empty() = shoot("hwlib-06-empty") { HomeworkLibraryScreen(ui(emptyList()), HomeworkLibraryActions(), NOW) }

    /** The "Most recent homework" card in each status (completed / in progress / overdue / not started) + the dashboard line. */
    @Test fun mostRecentEachStatus() = shoot("hwlib-07-most-recent-statuses") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            MostRecentHomeworkCard(jeromeItems.take(3), TODAY, onSeeAll = {}, now = NOW)
            MostRecentHomeworkCard(listOf(items.first { it.key == "d2" }), TODAY, onSeeAll = {}, now = NOW)
            MostRecentHomeworkCard(listOf(items.first { it.key == "r1" }), TODAY, onSeeAll = {}, now = NOW)
            MostRecentHomeworkCard(listOf(items.first { it.key == "k2" }), TODAY, onSeeAll = {}, now = NOW)
        }
    }

    @Test fun studentPageTop() = shoot("hwlib-08-student-page") {
        StudentPageScreen(
            StudentPageUi(
                relId = "rel-jerome", name = "Jerome Swannack",
                overview = Loadable(TeachingSamples.jeromeOverview),
                recentHomework = { MostRecentHomeworkCard(jeromeItems, TODAY, onSeeAll = {}, now = NOW) },
            ),
            StudentPageActions(), TeachingSamples.now,
        )
    }

    @Test fun dashboardCards() = shoot("hwlib-09-dashboard") {
        StudentsDashboardScreen(
            Loadable(TeachingSamples.dashboard), canInvite = true, actions = DashboardActions(), now = TeachingSamples.now,
            recentHomework = mapOf(
                TeachingSamples.jeromeOverview.relationship_id to items[0],
                TeachingSamples.lilyOverview.relationship_id to items[3].copy(relationship_id = TeachingSamples.lilyOverview.relationship_id),
            ),
            today = TODAY,
        )
    }

    private val copies = listOf(
        StudentCopyDto("rel-jerome", "s1", "Jerome Swannack", "t1", "sh1", behind = 3),
        StudentCopyDto("rel-lily", "s2", "Lily Chen", "t2", "sh2", behind = 3),
    )

    @Test fun updateCopies() = shootScreen("hwlib-10-update-copies") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            UpdateCopiesSheet(CopiesSheetUi("deck", "d1", "a word in 第五周作业：交通", copies, checked = setOf("rel-jerome")), CopiesSheetActions())
        }
    }

    @Test fun updateCopiesDone() = shootScreen("hwlib-11-update-copies-done") {
        UpdateCopiesSheet(
            CopiesSheetUi(
                "lesson", "l1", "this lesson", copies,
                results = listOf(StudentCopyResultDto("rel-jerome", "Jerome Swannack", true, "lesson updated — history kept"), StudentCopyResultDto("rel-lily", "Lily Chen", false, error = "Lily deleted her copy")),
            ),
            CopiesSheetActions(),
        )
    }

    @Test fun editLink() = shootScreen("hwlib-12-edit-link") {
        EditLinkSheet(jeromeItems[2], online = true, save = { _, _, _, _, _, _ -> }, onDismiss = {})
    }

    @Test fun sendLinkForm() = shootScreen("hwlib-13-send-link") {
        LabBottomSheet(onDismiss = {}, title = "Send homework to Jerome Swannack") {
            Column(Modifier.padding(horizontal = 20.dp)) {
                LinkSendForm(
                    "Jerome Swannack", TODAY, "2026-10-05", "2026-10-05", online = true, busy = false, onSend = {},
                    initialUrl = "https://youtu.be/dQw4w9WgXcQ", initialTitle = "《小幸运》— listen and sing along",
                    initialInstructions = "Listen twice. Then write down three lines you can sing.",
                )
            }
        }
    }

    // ---- student side ----

    private val linkUi = LinkPassUi(
        title = "《小幸运》— listen and sing along",
        url = "https://youtu.be/dQw4w9WgXcQ",
        instructions = "Listen twice. Then write down three lines you can sing — bring them to Thursday's lesson.",
        thumbnailUrl = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        due = Homework.dueLabel("2026-10-04", TODAY),
        tutorName = "王老师",
        done = false,
        note = null,
    )

    @Test fun linkPass() = shoot("hwlink-01-student-page") { HomeworkPassScreen(PassUi.Link(linkUi), PassActions()) }

    @Test fun linkPassDone() = shoot("hwlink-02-student-done") {
        HomeworkPassScreen(PassUi.Link(linkUi.copy(done = true, justDone = true, note = "我听懂了大部分！第二段有点快。")), PassActions())
    }

    @Test fun studentListWithLinkAndStatus() = shoot("hwlink-03-student-list") {
        fun a(id: String, title: String, kind: String, due: String?, status: String = "active", items: Int = 6) = HomeworkAssignment(
            id = id, kind = kind, target_id = "t-$id", title = title, mode = "one_off", due_date = due,
            item_ids = if (kind == "deck") (1..items).map { "$id-n$it" } else null, item_count = items, status = status,
            created_at = "2026-10-01T10:00:00Z", updated_at = "2026-10-02T10:00:00Z", tutor_name = "王老师",
            details = if (kind == "link") HomeworkDetails("https://youtu.be/dQw4w9WgXcQ", "Listen twice.", null) else null,
        )
        val list = listOf(
            a("h1", "第五周作业：交通", "deck", "2026-10-04"),
            a("h2", "《小幸运》— listen and sing along", "link", "2026-10-03"),
            a("h3", "小明在巴黎", "reader", "2026-10-01"),
            a("h4", "把字句", "lesson", "2026-10-08"),
            a("h5", "爸爸去哪儿 · episode 3", "link", null, status = "done"),
        )
        val events = listOf(HomeworkEvent("e1", "h1", "h1-n1", "right", "2026-10-02T10:00:00Z"), HomeworkEvent("e2", "h1", "h1-n2", "wrong", "2026-10-02T10:01:00Z"))
        val sorted = Homework.sortHomeworkItems(Homework.toHomeworkItems(list, events, TODAY))
        HomeworkListScreen(HomeworkListUi(true, sorted.todo, sorted.done, TODAY), onBack = {}, onOpen = {})
    }
}
