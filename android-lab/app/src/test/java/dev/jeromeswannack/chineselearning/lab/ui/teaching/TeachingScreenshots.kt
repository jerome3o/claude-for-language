package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S
import org.junit.Test
import org.robolectric.annotation.Config

/** Package F: the tutor's Students tab, student page and Send homework. */
class TeachingScreenshots : LabScreenshotTest() {
    private val tutorTabs = NavRules.tabsFor(NavRole(hasStudents = true, isTutorOnly = true, loaded = true, isTutorAccount = true))

    @Test fun dashboard() = shootInShell("teaching-01-dashboard", TabId.STUDENTS, tabs = tutorTabs) {
        StudentsDashboardScreen(S.loaded(S.dashboard), canInvite = true, actions = DashboardActions(), now = S.now)
    }

    @Config(qualifiers = TALL)
    @Test fun dashboardFull() = shoot("teaching-02-dashboard-full") {
        StudentsDashboardScreen(S.loaded(S.dashboard), canInvite = true, actions = DashboardActions(), now = S.now)
    }

    @Test fun dashboardOffline() = shootInShell("teaching-03-dashboard-offline", TabId.STUDENTS, tabs = tutorTabs) {
        StudentsDashboardScreen(Loadable(S.dashboard, offline = true, updatedAt = System.currentTimeMillis() - 3 * 3_600_000L), canInvite = true, actions = DashboardActions(), now = S.now)
    }

    @Test fun dashboardDark() = shootInShell("teaching-04-dashboard-dark", TabId.STUDENTS, tabs = tutorTabs, dark = true) {
        StudentsDashboardScreen(S.loaded(S.dashboard), canInvite = true, actions = DashboardActions(), now = S.now)
    }

    @Test fun studentPage() = shoot("teaching-05-student") { StudentPageScreen(S.studentPage(), StudentPageActions(), S.now) }

    @Config(qualifiers = TALL)
    @Test fun studentPageFull() = shoot("teaching-06-student-full") {
        StudentPageScreen(S.studentPage().copy(notice = "第四周作业：交通 is now first in their queue — the next new words come from it."), StudentPageActions(), S.now)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun studentPageUnfolded() = shoot("teaching-07-student-unfolded") { StudentPageScreen(S.studentPage(), StudentPageActions(), S.now) }

    @Config(qualifiers = TALL_UNFOLDED)
    @Test fun studentPageUnfoldedFull() = shoot("teaching-08-student-unfolded-full") { StudentPageScreen(S.studentPage(), StudentPageActions(), S.now) }

    @Config(qualifiers = TALL)
    @Test fun newStudent() = shoot("teaching-09-student-new") {
        StudentPageScreen(
            S.studentPage(S.lilyOverview).copy(
                homework = S.loaded(S.homework.copy(assignments = emptyList(), load = S.load.copy(one_off = S.load.one_off.copy(by_day = S.load.one_off.by_day.map { it.copy(items = 0, words = 0) }, items = 0, words = 0, other = 0, overdue_items = 0, overdue_words = 0), level = "light", summary = "No one-off homework pending · 15 words to go in long-term review (~5 days at 3/day)"))),
                flags = S.loaded(S.flags.copy(flags = emptyList(), open = 0)),
                claude = S.loaded(S.claude.copy(questions = emptyList(), total = 0)),
                conversations = S.loaded(emptyList()),
                lessons = S.loaded(emptyList()),
                lastLessonAt = null,
            ),
            StudentPageActions(), S.now,
        )
    }

    @Test fun studentPageLoading() = shoot("teaching-10-student-loading") {
        StudentPageScreen(StudentPageUi("rel-jerome", "Jerome Swannack"), StudentPageActions(), S.now)
    }

    @Test fun sendHomeworkDecks() = shoot("teaching-11-send-decks") {
        Sheet { SendHomeworkContent("Jerome", S.deckOptions, Loadable(), S.homeworkDecks, emptyList(), online = true, today = S.TODAY, actions = SendHomeworkActions()) }
    }

    @Test fun sendHomeworkConfirm() = shoot("teaching-12-send-confirm") {
        Sheet { SendHomeworkContent("Jerome", S.deckOptions, Loadable(), S.homeworkDecks, emptyList(), online = true, today = S.TODAY, actions = SendHomeworkActions(), initialDeck = S.deckOptions[2]) }
    }

    @Test fun sendHomeworkOneOffSplit() = shoot("teaching-16-send-one-off-split") {
        Sheet { SendHomeworkContent("Jerome", S.deckOptions, Loadable(), S.homeworkDecks, emptyList(), online = true, today = S.TODAY, actions = SendHomeworkActions(), initialDeck = S.deckOptions[2], initialMode = HomeworkMode.BOTH, initialSplit = 3) }
    }

    @Test fun sendHomeworkAlreadySent() = shoot("teaching-13-send-already-sent") {
        Sheet { SendHomeworkContent("Jerome", S.deckOptions, Loadable(), S.homeworkDecks, emptyList(), online = true, today = S.TODAY, actions = SendHomeworkActions(), initialDeck = S.deckOptions[0]) }
    }

    @Test fun sendHomeworkLessons() = shoot("teaching-14-send-lessons") {
        Sheet { SendHomeworkContent("Jerome", S.deckOptions, S.loaded(S.library), S.homeworkDecks, S.jeromeOverview.homework.lessons, online = false, today = S.TODAY, actions = SendHomeworkActions(), initialTab = 1) }
    }

    @Test fun loadGauge() = shoot("teaching-15-load-gauge") {
        Sheet { LoadGauge(S.load, "Jerome", after = S.load.copy(level = "heavy", summary = "5 one-off items pending (30 words, 1 lesson / reader) · 1 overdue", one_off = S.load.one_off.copy(by_day = S.load.one_off.by_day.mapIndexed { i, d -> if (i in 1..3) d.copy(words = d.words + 4, items = d.items + 1) else d }))) }
    }

    @Test fun inviteForm() = shoot("teaching-17-invite") {
        Sheet { InviteForm(S.deckOptions, online = true, create = { _, _, _ -> }) {} }
    }

    @Test fun inviteResult() = shoot("teaching-18-invite-result") {
        Sheet {
            InviteResult(
                dev.jeromeswannack.chineselearning.lab.data.api.InviteDto("inv3", "https://chinese-learning-2x9.pages.dev/join/Qm9vay1sZWFybmVy", inviter_role = "tutor", share_deck_ids = "[\"d1\",\"d4\"]", welcome_message = "欢迎！"),
                {}, {}, {},
            )
        }
    }

    private val P = TutorPagesSamples

    @Config(qualifiers = TALL)
    @Test fun insights() = shoot("teaching-19-insights") {
        InsightsScreen(
            InsightsUi("rel-jerome", "Jerome Swannack", report = S.loaded(P.report), lessonLog = S.loaded(P.lessonLog), summaries = listOf(P.summary)),
            InsightsActions(), S.now,
        )
    }

    @Test fun insightsTop() = shoot("teaching-20-insights-top") {
        InsightsScreen(InsightsUi("rel-jerome", "Jerome Swannack", report = S.loaded(P.report), lessonLog = S.loaded(P.lessonLog), summaries = listOf(P.summary)), InsightsActions(), S.now)
    }

    @Test fun history() = shoot("teaching-21-history") {
        HistoryScreen(HistoryUi("rel-jerome", "Jerome Swannack", events = P.history, decks = P.decks, range = P.report.range, loading = false, hasMore = true), HistoryActions(), S.now)
    }

    @Test fun historyByWord() = shoot("teaching-22-history-by-word") {
        HistoryScreen(HistoryUi("rel-jerome", "Jerome Swannack", events = P.history, decks = P.decks, range = P.report.range, loading = false, byWord = true), HistoryActions(), S.now)
    }

    @Test fun recordings() = shoot("teaching-23-recordings") {
        RecordingsScreen(RecordingsUi("rel-jerome", "Jerome Swannack", recordings = P.report.recordings, loading = false, playingKey = "recordings/e7.webm"), RecordingsActions(), S.now)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun insightsUnfolded() = shoot("teaching-24-insights-unfolded") {
        InsightsScreen(InsightsUi("rel-jerome", "Jerome Swannack", report = S.loaded(P.report), lessonLog = S.loaded(P.lessonLog), summaries = listOf(P.summary)), InsightsActions(), S.now)
    }

    @androidx.compose.runtime.Composable
    private fun Sheet(content: @androidx.compose.runtime.Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(vertical = 16.dp)) { content() }
    }

    companion object {
        const val TALL = "w412dp-h2600dp-xxhdpi"
        const val TALL_UNFOLDED = "w841dp-h1700dp-xxhdpi"
    }
}
