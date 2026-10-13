package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityItem
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityKinds
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySpec
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityWord
import dev.jeromeswannack.chineselearning.lab.core.calls.CallActivities
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.CoveredLesson
import dev.jeromeswannack.chineselearning.lab.core.calls.KnownPair
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.core.calls.PreparedActivity
import dev.jeromeswannack.chineselearning.lab.core.calls.QuizQuestion
import dev.jeromeswannack.chineselearning.lab.core.calls.RolePair
import dev.jeromeswannack.chineselearning.lab.core.calls.RoleplayLine
import dev.jeromeswannack.chineselearning.lab.core.calls.StudentCoverage
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.teaching.CoverageSection
import dev.jeromeswannack.chineselearning.lab.ui.teaching.PreparedActivitiesSection
import dev.jeromeswannack.chineselearning.lab.ui.teaching.PreparedSectionActions
import dev.jeromeswannack.chineselearning.lab.ui.teaching.PreparedSectionUi
import dev.jeromeswannack.chineselearning.lab.ui.teaching.StudentPageActions
import dev.jeromeswannack.chineselearning.lab.ui.teaching.StudentPageScreen
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config

/** Prepared in-call activities: the student page's section + coverage, the call menu's first section, one running. */
class PreparedActivitiesScreenshots : LabScreenshotTest() {
    private fun w(h: String, p: String, e: String) = ActivityWord(h, p, e)
    private fun base(id: String, kind: String, title: String, zh: String, summary: String, roles: RolePair, tutorRole: String = "a") =
        ActivitySpec(id = "prepared:$id", kind = kind, title = title, titleZh = zh, level = "elementary", topic = "Last lesson", summary = summary, roleNames = roles, tutorRole = tutorRole)

    private val dictation = base("j1-1", ActivityKinds.DICTATION, "Dictation: last lesson's health words", "听写：看病", "The tutor says a word; the student types it in characters.", RolePair("Reader", "Writer"))
        .copy(items = listOf(w("头疼", "tóuténg", "headache"), w("发烧", "fāshāo", "to have a fever"), w("咳嗽", "késou", "to cough"), w("感冒", "gǎnmào", "a cold"), w("嗓子", "sǎngzi", "throat"), w("药", "yào", "medicine")).map { ActivityItem(hanzi = it.hanzi, pinyin = it.pinyin, english = it.english) })
    private val build = base("j1-2", ActivityKinds.BUILD, "Build the corrected sentences", "连词成句", "Put the words in order together, then each says it aloud.", RolePair("Builder", "Builder"))
        .copy(items = listOf(
            ActivityItem(tiles = listOf("我", "头", "很", "疼"), pinyin = "Wǒ tóu hěn téng.", english = "My head really hurts."),
            ActivityItem(tiles = listOf("我", "昨天", "发烧", "了"), pinyin = "Wǒ zuótiān fāshāo le.", english = "I had a fever yesterday."),
            ActivityItem(tiles = listOf("我", "把", "药", "吃", "了"), pinyin = "Wǒ bǎ yào chī le.", english = "I took the medicine."),
        ))
    private val quiz = base("j1-3", ActivityKinds.QUIZ, "Quick quiz: which is right?", "哪个对？", "The tutor asks; the student picks the right one.", RolePair("Asker", "Answerer"))
        .copy(questions = listOf(
            QuizQuestion("Which is right?", options = listOf("我很头疼", "我头很疼"), answer = 1, explanation = "The body part is the subject: 头很疼"),
            QuizQuestion("Which is right?", options = listOf("我发烧了", "我有发烧"), answer = 0, explanation = "发烧 is a verb"),
            QuizQuestion("", audio = "买", options = listOf("mǎi 买 (buy)", "mài 卖 (sell)"), answer = 0),
        ))
    private val roleplay = base("j1-4", ActivityKinds.ROLEPLAY, "Role-play: at the doctor’s", "看病", "A doctor and a patient — read your part, then swap.", RolePair("医生 Doctor", "病人 Patient"))
        .copy(setting = "A small clinic, morning.", speakers = RolePair("医生", "病人"), lines = listOf(
            RoleplayLine("a", "你哪儿不舒服？", "Nǐ nǎr bù shūfu?", "What’s wrong?"),
            RoleplayLine("b", "我头疼，还有点儿发烧。", "Wǒ tóuténg, hái yǒudiǎnr fāshāo.", "I have a headache and a bit of a fever."),
            RoleplayLine("a", "多长时间了？", "Duō cháng shíjiān le?", "For how long?"),
            RoleplayLine("b", "两天了。", "Liǎng tiān le.", "Two days."),
        ))
    private val describe = base("j0-1", ActivityKinds.DESCRIBE, "Describe & guess: breakfast", "猜一猜：早饭", "The student describes a food without saying it; the tutor guesses.", RolePair("Describer", "Guesser"), "b")
        .copy(items = listOf(ActivityItem(emoji = "🥟", hanzi = "包子", pinyin = "bāozi", english = "steamed bun"), ActivityItem(emoji = "🥛", hanzi = "豆浆", pinyin = "dòujiāng", english = "soy milk"), ActivityItem(emoji = "🥚", hanzi = "鸡蛋", pinyin = "jīdàn", english = "egg"), ActivityItem(emoji = "🍜", hanzi = "面条", pinyin = "miàntiáo", english = "noodles")))

    private fun prepared(id: String, spec: ActivitySpec, why: String, status: String = "ready", pos: Int = 0) = PreparedActivity(
        id = id, relationshipId = "r1", jobId = "j1", spec = spec, why = why, status = status, sourceLabel = "Lesson 5 Oct", position = pos,
        createdAt = "2026-10-05 13:10:00", usedAt = if (status == "used") "2026-10-03 10:20:00" else null,
    )
    private val list = listOf(
        prepared("j1-1", dictation, "New words from 5 Oct: 头疼, 发烧, 咳嗽…", pos = 0),
        prepared("j1-2", build, "Last lesson: 3 corrections said the better way", pos = 1),
        prepared("j1-3", quiz, "Mixed up 买 / 卖 twice; 很头疼 → 头很疼", pos = 2),
        prepared("j1-4", roleplay, "The doctor’s visit from 5 Oct, with its new words", pos = 3),
        prepared("j0-1", describe, "Breakfast words from 1 Oct", status = "used"),
    )
    private val coverage = StudentCoverage(
        lessons = listOf(
            CoveredLesson("2026-10-05", null, listOf("Health & body vocabulary", "Seeing a doctor", "把 sentences"), "call", 20, 9),
            CoveredLesson("2026-10-01", null, listOf("Breakfast habits", "Daily routine"), "call", 21, 10),
            CoveredLesson("2026-09-28", "Comparisons with 比", emptyList(), "notes", 0, 0),
        ),
        lessonCount = 9, words = KnownPair(140, 172), characters = KnownPair(300, 120),
        recentWords = listOf(w("头疼", "tóuténg", "headache"), w("发烧", "fāshāo", "fever"), w("咳嗽", "késou", "cough"), w("感冒", "gǎnmào", "a cold"), w("嗓子", "sǎngzi", "throat"), w("药", "yào", "medicine"), w("包子", "bāozi", "steamed bun"), w("豆浆", "dòujiāng", "soy milk")),
    )

    @Composable
    private fun Page(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(20.dp)) { content() }
    }

    @Test fun section() = shoot("lab-prepared-01-student-page-section") {
        Page { PreparedActivitiesSection("Jerome Swannack", PreparedSectionUi(activities = list), PreparedSectionActions()) }
    }

    @Test fun sectionPreparing() = shoot("lab-prepared-02-section-empty-preparing") {
        Page {
            Column {
                PreparedActivitiesSection("Jerome Swannack", PreparedSectionUi(activities = emptyList()), PreparedSectionActions())
                PreparedActivitiesSection("Jerome Swannack", PreparedSectionUi(activities = emptyList(), preparing = true), PreparedSectionActions())
            }
        }
    }

    @Test fun covered() = shoot("lab-prepared-03-coverage") {
        Page { CoverageSection("Jerome Swannack", coverage, loading = false, now = TeachingSamples.now) }
    }

    /** ⋯ → 🎲 Activities, the tutor's side: the prepared section first. */
    @Test fun picker() = shoot("lab-prepared-04-call-picker") {
        LabCard {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                ActivityPickerSheet(null, onPick = {}, prepared = PickerPreparedUi("Jerome Swannack", list.sortedBy { if (it.status == "ready") 0 else 1 }))
            }
        }
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun pickerUnfolded() = shoot("lab-prepared-05-call-picker-unfolded") {
        LabCard {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                ActivityPickerSheet(null, onPick = {}, prepared = PickerPreparedUi("Jerome Swannack", list.sortedBy { if (it.status == "ready") 0 else 1 }, preparing = true))
            }
        }
    }

    // ---- a prepared activity running in the call (the engine plays it like a catalogue one)
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        LaunchedEffect(handle) { onFrameSize(720, 960) }
        val colors = if (handle == "tutor") listOf(Color(0xFF7C9A92), Color(0xFF34495E)) else listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) { Text(if (handle == "tutor") "👩‍🏫" else "🧑", fontSize = 40.sp) }
    }

    @Test fun running() {
        val T = CallsSamples.TUTOR
        val S = CallsSamples.ME
        val t0 = CallsSamples.T0
        val names = mapOf(T to "王老师", S to "Jerome Swannack")
        val session = CallActivities.start(build, CallActivities.StartOptions("sess-prep", T, T, listOf(T, S), names, t0))
        val peer = CallPeer("c-other", S, "Jerome Swannack", null, PeerMediaState(mic = true, cam = true))
        val state = CallState(
            phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "tutor", recordSupported = true,
            startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = T,
            remote = RemoteParticipant(peer, video = "me", connection = "connected", tile = CallConnection.TileStatus.LIVE),
            activity = session,
        )
        shoot("lab-prepared-06-running-build-tutor") {
            CallScreen(state, CallScreenInfo(otherName = "Jerome Swannack", myName = "王老师", relationshipId = "r1"), CallActions(), fakeVideo, { t0 + 5 * 60_000 }, layout = CallLayoutHolder().apply { setActivity(session.sessionId) })
        }
    }

    @Config(qualifiers = "w412dp-h2400dp-xxhdpi")
    @Test fun onTheStudentPage() = shoot("lab-prepared-07-student-page") {
        StudentPageScreen(
            TeachingSamples.studentPage().copy(
                preparedActivities = { PreparedActivitiesSection("Jerome Swannack", PreparedSectionUi(activities = list), PreparedSectionActions()) },
                coverage = { CoverageSection("Jerome Swannack", coverage, loading = false, now = TeachingSamples.now) },
            ),
            StudentPageActions(), TeachingSamples.now,
        )
    }
}
