package dev.jeromeswannack.chineselearning.lab.ui.profile

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.asImageBitmap
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.data.api.ProfileDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.connections.TutorPageActions
import dev.jeromeswannack.chineselearning.lab.ui.connections.TutorPageScreen
import dev.jeromeswannack.chineselearning.lab.ui.connections.TutorPageUi
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config
import java.time.Instant

class ProfileScreenshots : LabScreenshotTest() {
    private val now = Instant.parse("2026-09-27T13:04:00Z")

    /** A drawn portrait (the real upload path is covered by the web E2E test). */
    private fun portrait(): Bitmap {
        val b = Bitmap.createBitmap(600, 420, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        c.drawColor(0xFFFBBF24.toInt())
        p.color = 0xFF111827.toInt(); c.drawOval(RectF(215f, 70f, 385f, 280f), p)
        p.color = 0xFFF5D0B5.toInt(); c.drawOval(RectF(235f, 110f, 365f, 265f), p)
        p.color = 0xFF111827.toInt(); c.drawRect(RectF(225f, 80f, 375f, 140f), p)
        c.drawCircle(275f, 190f, 7f, p); c.drawCircle(325f, 190f, 7f, p)
        p.color = 0xFFDC2626.toInt(); c.drawOval(RectF(170f, 280f, 430f, 520f), p)
        return b
    }

    private val google = ProfileDto(
        id = "u1", email = "minghui@example.com", name = "Minghui Zhang", picture_url = null, picture_source = "google",
        google_name = "Minghui Zhang", google_picture_url = null,
    )
    private val edited = google.copy(
        name = "明慧老师 Minghui", name_custom = true, picture_url = "https://api.example/api/audio/avatars/u1/a.jpg", picture_source = "upload",
        about = "你好！I’m Minghui, a Mandarin teacher from Shanghai. Lessons are relaxed and full of real conversation — message me here any time.",
        time_zone = "Asia/Shanghai",
    )
    private val tutorEnv = ProfileEnv(teaches = true, learns = false, deviceTimeZone = "Europe/London", now = now)

    @Test fun fresh() = shoot("profile-01-fresh") {
        ProfileScreen(ProfileUi(profile = google, draft = ProfileDraft.from(google)), tutorEnv, ProfileActions(onBack = {}))
    }

    @Test fun editing() = shoot("profile-02-editing") {
        val ui = ProfileUi(profile = edited.copy(about = null, time_zone = null), draft = ProfileDraft.from(edited))
        ProfileScreen(ui, tutorEnv.copy(previewPhoto = portrait().asImageBitmap()), ProfileActions(onBack = {}), listState = androidx.compose.foundation.lazy.rememberLazyListState(2))
    }

    @Test fun problem() = shoot("profile-03-problem") {
        val ui = ProfileUi(profile = edited, draft = ProfileDraft.from(edited).copy(name = "M".repeat(70)))
        ProfileScreen(ui, tutorEnv.copy(previewPhoto = portrait().asImageBitmap()), ProfileActions(onBack = {}))
    }

    @Test fun learner() = shoot("profile-04-learner") {
        val me = ProfileDto(id = "u2", email = "jerome@example.com", name = "Jerome", google_name = "Jerome", bio = "Software developer in Wellington; I like hiking and coffee.")
        ProfileScreen(ProfileUi(profile = me, draft = ProfileDraft.from(me)), ProfileEnv(teaches = false, learns = true, deviceTimeZone = "Pacific/Auckland", now = now), ProfileActions(onBack = {}), listState = androidx.compose.foundation.lazy.rememberLazyListState(3))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("profile-05-unfolded") {
        ProfileScreen(ProfileUi(profile = edited, draft = ProfileDraft.from(edited)), tutorEnv.copy(previewPhoto = portrait().asImageBitmap()), ProfileActions(onBack = {}))
    }

    @OptIn(ExperimentalRoborazziApi::class)
    private fun shootScreen(name: String, content: @Composable () -> Unit) {
        compose.setContent { LabTheme { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/$name.png")
    }

    @Test fun cropSheet() = shootScreen("profile-06-crop-sheet") {
        ProfileScreen(ProfileUi(profile = google, draft = ProfileDraft.from(google)), tutorEnv, ProfileActions(onBack = {}))
        PhotoCropSheet(portrait(), busy = false, error = null, onCancel = {}, onConfirm = {}, initialZoom = 1.3f)
    }

    @Test fun studentSeesTutor() = shootInShell("profile-07-student-sees-tutor", active = TabId.TUTOR) {
        val tutor = UserSummaryDto("t1", "minghui@example.com", edited.name, edited.picture_url, edited.about, edited.time_zone)
        val me = UserSummaryDto("me", "jerome@example.com", "Jerome")
        TutorPageScreen(
            TutorPageUi(
                relationship = Loadable(RelationshipDto("rel1", "t1", "me", "tutor", "active", requester = tutor, recipient = me)),
                myId = "me", conversations = Loadable(emptyList()), sharedDecks = Loadable(emptyList()),
                now = now, previewPhoto = portrait().asImageBitmap(),
            ),
            TutorPageActions(),
        )
    }
}
