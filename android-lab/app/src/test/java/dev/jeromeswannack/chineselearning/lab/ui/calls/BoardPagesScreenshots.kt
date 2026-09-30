package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPageMeta
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPagesState
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.core.calls.RemoteCaret
import dev.jeromeswannack.chineselearning.lab.data.api.BoardPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallBoardPageDto
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config
import java.time.ZoneId

/** Board pages (video calls round 3): the page strip in the call, following, the page menu, the lesson board outside a call. */
class BoardPagesScreenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier ->
        androidx.compose.runtime.LaunchedEffect(handle) { onFrameSize(1280, 720) }
        Box(modifier.background(Color(0xFF34495E)), contentAlignment = Alignment.Center) { Text(if (handle == "them") "👩‍🏫" else "🧑", fontSize = 48.sp) }
    }

    private val t0 = CallsSamples.T0
    private val day = 24 * 3_600_000L
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "王老师", null, PeerMediaState(mic = true, cam = true))
    private val info = CallScreenInfo(otherName = "王老师", myName = "Jerome Swannack", relationshipId = "r1")

    private val texts = listOf(
        "第一课 · 自我介绍\n\n我叫 Jerome。\n我是英国人。\n我住在伦敦。",
        "声调 tones\n\nmā má mǎ mà\n妈 麻 马 骂\n\n买 mǎi / 卖 mài",
        "点菜\n\n我想要一杯咖啡。\n微辣 wēi là = a little spicy\n服务员，买单！",
        "把字句\n\n把书放在桌子上。\n请把门关上。\n他把我的咖啡喝了！",
        "今天的作业\n\n1. 写五个“把”字句\n2. 听录音",
    )
    private val titles = listOf(null, "Tones", null, "把字句", null)
    private val metas = texts.mapIndexed { i, t -> BoardPageMeta("p$i", titles[i], t.take(140), t.length, t0 - (5 - i) * 7 * day, t0 - (5 - i) * 7 * day, "call$i") }

    /** I'm on page 4 (把字句), 王老师 is on page 2 (Tones). */
    private val pages = BoardPagesState(pages = metas, current = "p3", opening = "p4", views = mapOf("c-a" to "p1"), other = "c-a")

    private val live = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me",
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME,
        remote = RemoteParticipant(tutor, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        textBoard = TextBoardUi(text = texts[3], version = 2, page = "p3"),
        pages = pages,
    )
    private val now = { t0 + 12 * 60_000 + 34_000 }

    @Composable
    private fun Board(s: CallState) = CallScreen(s, info, CallActions(), fakeVideo, now, initialPanel = CallPanel.TEXT)

    @Test fun strip() = shoot("calls-80-board-pages") { Board(live) }

    @Config(qualifiers = UNFOLDED)
    @Test fun stripUnfolded() = shoot("calls-81-board-pages-unfolded") { Board(live) }

    /** Following: my page jumps with theirs; they write on it with me (their caret). */
    @Test fun following() = shoot("calls-82-board-pages-following") {
        Board(
            live.copy(
                textBoard = TextBoardUi(texts[1], 2, remote = listOf(RemoteCaret("c-a", CallsSamples.TUTOR, "王老师", "#e11d48", 28, 32, 32)), page = "p1"),
                pages = pages.copy(current = "p1", following = true),
            ),
        )
    }

    /** "王老师 brought you to page 2". */
    @Test fun summoned() = shoot("calls-83-board-pages-summoned", settleMs = 1_000) {
        Board(live.copy(textBoard = TextBoardUi(texts[1], 2, page = "p1"), pages = pages.copy(current = "p1"), boardNotice = BoardNotice(1, "王老师 brought you to page 2")))
    }

    @OptIn(ExperimentalRoborazziApi::class)
    private fun shootScreen(name: String, content: @Composable () -> Unit) {
        compose.setContent { LabTheme { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/$name.png")
    }

    @Test fun pageMenu() = shootScreen("calls-84-board-page-menu") {
        Board(live)
        BoardPageSheet(index = 3, title = "把字句", onlyPage = false, onDismiss = {}, onRename = {}, onDuplicate = {}, onDelete = {})
    }

    @Test fun deleteConfirm() = shootScreen("calls-85-board-page-delete") {
        Board(live)
        BoardPageSheet(index = 3, title = "把字句", onlyPage = false, onDismiss = {}, onRename = {}, onDuplicate = {}, onDelete = {}, initialConfirm = true)
    }

    @Test fun onlyPageMenu() = shootScreen("calls-86-board-page-menu-only-page") {
        Board(live.copy(pages = BoardPagesState(pages = metas.take(1), current = "p0", opening = "p0", other = "c-a", views = mapOf("c-a" to "p0")), textBoard = TextBoardUi(texts[0], 1, page = "p0")))
        BoardPageSheet(index = 0, title = null, onlyPage = true, onDismiss = {}, onRename = {}, onDuplicate = {}, onDelete = {})
    }

    // ---- the lesson board outside a call: /connections/:relId/board (read-only, offline)

    private val boardPages = texts.mapIndexed { i, t -> BoardPageDto("p$i", i + 1, titles[i], t, t.length, t0 - (5 - i) * 7 * day, t0 - (5 - i) * 7 * day + 3_600_000, "call$i", "r1") }
    private val utc = ZoneId.of("Europe/London")

    @Test fun lessonBoard() = shootInShell("calls-87-lesson-board", active = dev.jeromeswannack.chineselearning.lab.ui.nav.TabId.TUTOR) {
        LessonBoardScreen(Loadable(boardPages, updatedAt = t0), "王老师", LessonBoardActions(), zone = utc)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun lessonBoardUnfolded() = shoot("calls-88-lesson-board-unfolded") {
        LessonBoardScreen(Loadable(boardPages, updatedAt = t0), "王老师", LessonBoardActions(), initialSelected = "p2", zone = utc)
    }

    @Test fun lessonBoardOffline() = shoot("calls-89-lesson-board-offline") {
        LessonBoardScreen(Loadable(boardPages, offline = true, updatedAt = t0), "王老师", LessonBoardActions(), initialSelected = "p1", zone = utc)
    }

    @Test fun lessonBoardEmpty() = shoot("calls-90-lesson-board-empty") {
        LessonBoardScreen(Loadable(emptyList(), updatedAt = t0), "王老师", LessonBoardActions(), zone = utc)
    }

    // ---- the review page: the call's pages, one block each

    @Config(qualifiers = "w412dp-h1600dp-xxhdpi")
    @Test fun review() = shoot("calls-91-review-board-pages") {
        CallReviewScreen(
            CallsSamples.reviewUi(CallsSamples.detail.copy(transcript = emptyList(), report = null)).copy(
                boardPages = listOf(
                    CallBoardPageDto("p3", 4, "把字句", texts[3], edited = true),
                    CallBoardPageDto("p4", 5, null, texts[4], edited = true),
                    CallBoardPageDto("px", null, null, "旧的一页\n\n这页后来删掉了。", edited = true),
                    CallBoardPageDto("p1", 2, "Tones", "", edited = false),
                ),
            ),
            CallReviewActions(),
        )
    }
}
