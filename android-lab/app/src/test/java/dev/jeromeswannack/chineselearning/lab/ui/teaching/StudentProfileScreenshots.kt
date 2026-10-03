package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.StudentProfile
import dev.jeromeswannack.chineselearning.lab.core.StudentProfileFields
import dev.jeromeswannack.chineselearning.lab.data.api.StudentProfileDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S
import org.junit.Test
import org.robolectric.annotation.Config

/** The tutor's private student profile: the section (empty / written), the editor, the page and the dashboard hint. */
class StudentProfileScreenshots : LabScreenshotTest() {
    private val written = StudentProfileDto(
        relationship_id = "rel-jerome",
        body = StudentProfile.EXAMPLES[0].profile.body,
        level = "beginner",
        handwriting = false,
        words_per_lesson = 15,
        updated_at = "2026-09-26T18:00:00Z",
    )

    @Composable
    private fun Page(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(20.dp)) { content() }
    }

    @Test fun empty() = shoot("student-profile-01-empty") {
        Page { StudentProfileSection("Jerome", null, loaded = true, error = null, actions = StudentProfileActions(), now = S.now) }
    }

    @Test fun written() = shoot("student-profile-02-written") {
        Page { StudentProfileSection("Jerome", written, loaded = true, error = null, actions = StudentProfileActions(), now = S.now) }
    }

    @Test fun writtenDark() = shoot("student-profile-03-written-dark", dark = true) {
        Page { StudentProfileSection("Jerome", written, loaded = true, error = null, actions = StudentProfileActions(), now = S.now) }
    }

    @Config(qualifiers = TeachingScreenshots.TALL)
    @Test fun editorFromExample() = shoot("student-profile-04-editor") {
        Box(Modifier.fillMaxSize().background(Lab.colors.card).padding(top = 16.dp)) {
            var draft by remember { mutableStateOf(StudentProfile.EXAMPLES[1].profile) }
            StudentProfileForm("Lily", StudentProfileFields(), draft, { draft = it }, online = true, save = { _, _ -> }, cancel = {}, done = {})
        }
    }

    @Config(qualifiers = TeachingScreenshots.TALL)
    @Test fun editorEmpty() = shoot("student-profile-05-editor-empty") {
        Box(Modifier.fillMaxSize().background(Lab.colors.card).padding(top = 16.dp)) {
            var draft by remember { mutableStateOf(StudentProfileFields()) }
            StudentProfileForm("Jerome", StudentProfileFields(), draft, { draft = it }, online = false, save = { _, _ -> }, cancel = {}, done = {})
        }
    }

    @Config(qualifiers = TeachingScreenshots.TALL)
    @Test fun onTheStudentPage() = shoot("student-profile-06-student-page") {
        StudentPageScreen(
            S.studentPage().copy(studentProfile = { StudentProfileSection("Jerome", null, loaded = true, error = null, actions = StudentProfileActions(), now = S.now) }),
            StudentPageActions(), S.now,
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun onTheStudentPageUnfolded() = shoot("student-profile-07-student-page-unfolded") {
        StudentPageScreen(
            S.studentPage().copy(studentProfile = { StudentProfileSection("Jerome", written, loaded = true, error = null, actions = StudentProfileActions(), now = S.now) }),
            StudentPageActions(), S.now,
        )
    }

    @Test fun dashboardHint() = shoot("student-profile-08-dashboard-hint") {
        Page {
            Column {
                StudentCard(S.jeromeOverview.copy(has_profile = false), DashboardActions(), S.now)
                Box(Modifier.padding(top = 12.dp)) { StudentCard(S.lilyOverview.copy(has_profile = false), DashboardActions(), S.now) }
            }
        }
    }
}
