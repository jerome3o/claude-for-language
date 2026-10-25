package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.background
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeHomework
import dev.jeromeswannack.chineselearning.lab.core.HomeLesson
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.HomeworkRowActions
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonRevision
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.LongTermHomework
import dev.jeromeswannack.chineselearning.lab.core.RetryBars
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.api.CustomLessonDto
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonSamples
import dev.jeromeswannack.chineselearning.lab.ui.lessons.MiniLessonsActions
import dev.jeromeswannack.chineselearning.lab.ui.lessons.MiniLessonsScreen
import dev.jeromeswannack.chineselearning.lab.ui.lessons.MiniLessonsUi
import dev.jeromeswannack.chineselearning.lab.ui.lessons.SkipHandwritingSettingsView
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Row bars + the row menu + Skip handwriting (docs/HOMEWORK.md §3d; `./gradlew :app:recordRoborazziDebug` →
 * app/screenshots/rowmenu-*.png): Home's card with bars only on started rows (orange = still owed), the menu
 * sheet, /homework with a skipped item ("Bring back"), Mini Lessons with a started lesson's bar, the setting.
 */
class RowMenuScreenshots : LabScreenshotTest() {
    private val today = "2026-10-25"

    private fun a(id: String, title: String, kind: String, items: Int = 1, due: String? = today) = HomeworkAssignment(
        id = id, kind = kind, target_id = "t-$id", title = title, mode = "one_off", due_date = due,
        item_ids = if (kind == "deck") (1..items).map { "$id-n$it" } else null, item_count = items,
        created_at = "2026-10-20T10:00:00Z", updated_at = "2026-10-20T10:00:00Z", tutor_name = "明慧老师",
    )

    private val assignments = listOf(
        a("deck", "餐厅点菜", "deck", items = 8),
        a("fresh", "天气和季节", "deck", items = 6, due = "2026-10-27"),
        a("writing", "写汉字：把字句", "lesson", due = "2026-10-26"),
        a("reader", "小明在巴黎", "reader", due = "2026-10-24"),
    )
    // Three Got it + two Not yet on the first deck; a skip on the writing lesson (then not a row).
    private val events = listOf(
        HomeworkEvent("e1", "deck", "deck-n1", "right", "2026-10-25T09:00:00.000Z"),
        HomeworkEvent("e2", "deck", "deck-n2", "wrong", "2026-10-25T09:01:00.000Z"),
        HomeworkEvent("e3", "deck", "deck-n3", "right", "2026-10-25T09:02:00.000Z"),
        HomeworkEvent("e4", "deck", "deck-n4", "wrong", "2026-10-25T09:03:00.000Z"),
        HomeworkEvent("e5", "deck", "deck-n5", "right", "2026-10-25T09:04:00.000Z"),
    )
    private val skip = HomeworkEvent("k1", "writing", "t-writing", "skip", "2026-10-25T09:10:00.000Z")
    private val sorted = Homework.sortHomeworkItems(Homework.toHomeworkItems(assignments, events, today))
    private val sortedSkipped = Homework.sortHomeworkItems(Homework.toHomeworkItems(assignments, events + skip, today))

    private val lessons = listOf(
        HomeLesson("rev", "China trip 1 · 在机场", "2026-10-10T00:00:00Z", "revision", false, true, 1, 1L, "5 questions · ~4 min", null),
        HomeLesson("lt", "了 — finished actions", "2026-10-12T00:00:00Z", "new", false, false, 0, null, "12 exercises · ~8 min", null),
    )
    private val longTerm = listOf(LongTermHomework("lesson", "lt", "了 — finished actions", "明慧老师", "2026-10-12T00:00:00Z", null, null, "a-lt"))
    // The revision is half done (2 answered, 1 to put right); the long-term lesson isn't started.
    private val runBars = mapOf(
        "rev" to RetryBars.retryBar(answered = 3, fresh = 2, retries = 1, itemsDone = 2, items = 5),
        "t-writing" to RetryBars.retryBar(answered = 4, fresh = 6, retries = 2, itemsDone = 2, items = 10),
    )

    private val homeUi = HomeHomeworkUi(card = HomeHomework.build(sorted.todo, longTerm, limit = 6, lessons = lessons, runBars = runBars))

    @Test fun rowsMatchTheRules() {
        val rows = homeUi.card.rows.associateBy { it.key }
        // Started deck: the pass's bar with its orange; never-started deck: no bar.
        assertEquals(2, rows.getValue("deck").bar?.retries)
        assertNull(rows.getValue("fresh").bar)
        assertEquals(4, rows.getValue("writing").bar?.answered)
        assertEquals(1, rows.getValue("revision:rev").bar?.retries)
        assertNull(rows.getValue("lesson:lt").bar)
        assertEquals("a-lt", rows.getValue("lesson:lt").assignmentId)
        // Skipped: not a row, in `skipped`.
        assertEquals(listOf("writing"), sortedSkipped.skipped.map { it.assignment.id })
        assertEquals(listOf(HomeworkRowActions.SKIP_HOMEWORK, HomeworkRowActions.SKIP_HANDWRITING), HomeworkRowActions.actions("assignment", "writing", "t-writing", true, false))
    }

    @Test fun homeCardBars() = shoot("rowmenu-01-home-bars") {
        Column(Modifier.padding(16.dp)) { CompactHomeworkCard(homeUi, HomeHomeworkActions(onMenu = {})) }
    }

    @Test fun homeCardBarsDark() = shoot("rowmenu-01b-home-bars-dark", dark = true) {
        Column(Modifier.padding(16.dp)) { CompactHomeworkCard(homeUi, HomeHomeworkActions(onMenu = {})) }
    }

    @Test fun menuSheet() = shoot("rowmenu-02-menu") {
        Column(Modifier.padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            RowActionsSheetContent(
                RowActionTarget("revision", "China trip 1 · 在机场", null, null, null, "rev"),
                listOf(HomeworkRowActions.DONE_FOR_GOOD, HomeworkRowActions.DELETE_LESSON, HomeworkRowActions.SKIP_HANDWRITING),
            ) {}
            RowActionsSheetContent(
                RowActionTarget("assignment", "写汉字：把字句", "明慧老师", "writing", "lesson", "t-writing"),
                listOf(HomeworkRowActions.SKIP_HOMEWORK, HomeworkRowActions.SKIP_HANDWRITING),
            ) {}
            RowActionToastPill(HomeworkRowActions.toast(HomeworkRowActions.SKIP_HOMEWORK, "明慧老师"), undo = true) {}
        }
    }

    @Test fun homeworkSkipped() = shoot("rowmenu-03-homework-skipped") {
        HomeworkListScreen(
            HomeworkListUi(true, sortedSkipped.todo, sortedSkipped.done, today, skipped = sortedSkipped.skipped, runBars = runBars),
            onBack = {}, onOpen = {}, menus = HomeworkListMenus(onItemMenu = {}),
        )
    }

    private val spec = CustomLessonSpec(
        "写汉字：把字句", icon = "✍️",
        sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.choice, LessonSamples.translate, LessonSamples.match, LessonSamples.choice))),
    )

    private fun entry(id: String, title: String, icon: String, created: String) =
        LessonEntry(CustomLessonDto(id, title, null, icon, "chat", "active", created, null, spec.copy(title = title, icon = icon), emptyList()), emptyList(), LessonRevision.NEW)

    @Test fun miniLessonsBars() = shoot("rowmenu-04-mini-lessons") {
        MiniLessonsScreen(
            MiniLessonsUi(
                lessons = listOf(
                    entry("trip1", "China trip 1 · Arriving at Pudong", "✈️", "2026-10-06T22:43:00Z"),
                    entry("trip2", "China trip 2 · Checking in at a JI Hotel", "🏨", "2026-10-06T22:44:56Z"),
                ),
                cutoff = StudyCutoff(Js.parseDate("2026-10-25T23:59:59.999Z")),
                inProgress = mapOf("trip1" to "full"),
                runBars = mapOf("trip1" to RetryBars.retryBar(answered = 3, fresh = 2, retries = 1, itemsDone = 2, items = 5)),
            ),
            MiniLessonsActions(onBack = {}, onMenu = {}),
        )
    }

    /**
     * Home → "All ›" → /homework: ~10 revisions (several old test lessons of his own); long-press one →
     * Stop revising — done for good · Delete lesson (the sheet drawn over the list).
     */
    @Test fun homeworkListRevisionMenu() = shoot("rowmenu-06-homework-revision-menu") {
        val revisions = (1..10).map { i ->
            HomeLesson("rev$i", if (i % 3 == 0) "test lesson $i" else listOf("China trip $i · 在机场", "把 sentences $i", "了 — finished actions $i")[i % 3], "2026-10-0${i % 9 + 1}T00:00:00Z", "revision", false, true, i % 3 + 1, i.toLong(), "${i + 2} questions · ~${i} min", null)
        }
        val rows = HomeHomework.rows(sorted.todo, emptyList(), lessons = revisions, runBars = mapOf("rev2" to RetryBars.retryBar(answered = 2, fresh = 3, retries = 1, itemsDone = 1, items = 5)))
            .filter(HomeHomework::isLessonRow)
        androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.fillMaxSize()) {
            HomeworkListScreen(HomeworkListUi(true, sorted.todo, sorted.done, today, rows), onBack = {}, onOpen = {}, menus = HomeworkListMenus(onItemMenu = {}, onRowMenu = {}))
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.32f)))
            Column(
                Modifier.align(androidx.compose.ui.Alignment.BottomCenter).fillMaxWidth()
                    .background(dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.card, androidx.compose.foundation.shape.RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .padding(vertical = 20.dp),
            ) {
                RowActionsSheetContent(
                    RowActionTarget("revision", "test lesson 3", null, null, null, "rev3"),
                    listOf(HomeworkRowActions.DONE_FOR_GOOD, HomeworkRowActions.DELETE_LESSON),
                ) {}
            }
        }
    }

    @Test fun skipHandwritingSetting() = shoot("rowmenu-05-skip-handwriting") {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SkipHandwritingSettingsView(on = false) {}
            SkipHandwritingSettingsView(on = true) {}
        }
    }
}
