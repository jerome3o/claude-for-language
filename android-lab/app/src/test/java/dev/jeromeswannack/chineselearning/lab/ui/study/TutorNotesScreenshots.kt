package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.HomeHomework
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.HwMessage
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LongTermHomework
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.TutorNoteRow
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkActions
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkSection
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkUi
import dev.jeromeswannack.chineselearning.lab.ui.nav.ShellFrame
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import org.junit.Test
import org.robolectric.annotation.Config

/** The compact Home (homework card + tutor-notes row), the Tutor notes page, and the practice card. */
class TutorNotesScreenshots : LabScreenshotTest() {
    private val today = Homework.localDate()
    private val nowMs = Js.parseDate("2026-09-29T09:30:00.000Z")

    private fun a(id: String, title: String, kind: String, mode: String, due: String?, items: Int = 12) = HomeworkAssignment(
        id = id, kind = kind, target_id = "t-$id", title = title, mode = mode, due_date = due,
        item_ids = if (kind == "deck") (1..items).map { "$id-n$it" } else null, item_count = items,
        created_at = "2026-09-27T10:00:00Z", updated_at = "2026-09-27T10:00:00Z", tutor_name = "Mandarin Home 明慧老师",
    )

    private val homeUi: HomeHomeworkUi by lazy {
        val assignments = listOf(
            a("lesson", "把 sentences", "lesson", "one_off", Homework.addDays(today, -1)),
            a("rest", "餐厅点菜", "deck", "both", Homework.addDays(today, 1)),
        )
        val events = (1..5).map { HomeworkEvent("e$it", "rest", "rest-n$it", "right", "2026-09-28T10:0$it:00Z") }
        val todo = Homework.sortHomeworkItems(Homework.toHomeworkItems(assignments, events, today)).todo
        HomeHomeworkUi(
            card = HomeHomework.build(todo, listOf(LongTermHomework("deck", "hsk3", "HSK 3 词汇", "Mandarin Home 明慧老师", "2026-09-20T10:00:00Z", 5, 12)), unreadFrom = "Mandarin Home 明慧老师"),
            unread = HwMessage("c1", "rel1", "明天上课前把餐厅的词复习一下哦！", "2026-09-29T08:00:00Z"),
            unreadRelId = "rel1",
            unreadFrom = "Mandarin Home 明慧老师",
            notesLine = "3 new notes from Mandarin Home 明慧老师",
        )
    }

    private val decks = listOf(
        DeckSummary("d1", "餐厅点菜 (from tutor)", 12, QueueCounts(3, 0, 0, 0)),
        DeckSummary("d2", "HSK 3 词汇 (from tutor)", 12, QueueCounts(0, 2, 1, 7)),
        DeckSummary("d3", "Starter Chinese", 6, QueueCounts(0, 0, 0, 4)),
        DeckSummary("d4", "天气 Weather", 5, QueueCounts(0, 0, 0, 3)),
        DeckSummary("d5", "旅行 Travel", 4, QueueCounts(0, 0, 0, 0)),
        DeckSummary("d6", "家人 Family", 3, QueueCounts(0, 0, 0, 0)),
    )

    @Test fun home() = shoot("tutor-notes-01-home") {
        ShellFrame(NavRules.tabsFor(NavRole()), TabId.STUDY, showBar = true, onSelect = {}) {
            HomeScreen(
                ui = HomeUi(loaded = true, userName = "Jerome Swannack", due = QueueCounts(3, 2, 1, 19), decks = decks, reviewedToday = 12),
                sync = Samples.sync(), online = true, actions = HomeActions(),
                homework = { HomeHomeworkSection(homeUi, HomeHomeworkActions()) },
            )
        }
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun homeUnfolded() = shoot("tutor-notes-02-home-unfolded") {
        HomeScreen(
            ui = HomeUi(loaded = true, userName = "Jerome Swannack", due = QueueCounts(3, 2, 1, 19), decks = decks, reviewedToday = 12),
            sync = Samples.sync(), online = true, actions = HomeActions(),
            homework = { HomeHomeworkSection(homeUi, HomeHomeworkActions()) },
        )
    }

    private fun row(id: String, kind: String, hanzi: String, pinyin: String, english: String, comment: String, at: String, rec: Boolean = kind == "recording", asked: String? = null) =
        TutorNoteRow(id, kind, "c-$id", "hanzi_to_meaning", "n-$id", "d1", hanzi, pinyin, english, comment, "Mandarin Home 明慧老师", at, null, if (rec) "recordings/$id.webm" else null, asked)

    private val fresh = listOf(
        row("f1", "flag", "刮风", "guā fēng", "windy", "刮 is \"to blow / scrape\" — 刮风 = the wind blows. 下 is \"to fall\": 下雨, 下雪.", "2026-09-29T08:00:00Z", asked = "I keep mixing up 刮风 and 下雨"),
        row("r1", "recording", "中国", "Zhōngguó", "China", "中国 — 国 is second tone (guó), not fourth.", "2026-09-29T07:00:00Z"),
        row("r2", "recording", "感兴趣", "gǎn xìngqù", "to be interested", "感 is third tone: gǎn, then xìngqù. Say 对…感兴趣 as one phrase.", "2026-09-29T06:00:00Z"),
    )
    private val earlier = listOf(row("r3", "recording", "喜欢", "xǐhuan", "to like", "喜欢 — the 欢 is neutral tone, keep it short.", "2026-09-25T10:00:00Z"))

    @Test fun notesPage() = shootInShell("tutor-notes-03-page", active = TabId.MORE) {
        TutorNotesScreen(TutorNotesUi(true, fresh, earlier), playingKey = null, actions = TutorNotesActions(), nowMs = nowMs)
    }

    @Test fun notesEmpty() = shoot("tutor-notes-04-empty") { TutorNotesScreen(TutorNotesUi(true), null, TutorNotesActions(), nowMs) }

    private fun practiceView(queue: Int): CardView {
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-09-10T08:00:00.000Z")
        state = CardScheduler.applyReview(state, 2, "2026-09-10T08:12:00.000Z")
        if (queue == CardQueue.REVIEW) state = CardScheduler.applyReview(state, 2, "2026-09-13T08:00:00.000Z")
        val note = NoteEntity(
            id = "n-r1", deckId = "d3", hanzi = "中国", pinyin = "Zhōngguó", english = "China", audioUrl = null,
            funFacts = "**中** (zhōng) middle · **国** (guó) country\nTogether: the Middle Kingdom.", context = null,
            sentenceClue = "我对中国文化感兴趣。", sentenceCluePinyin = "Wǒ duì Zhōngguó wénhuà gǎn xìngqù.", sentenceClueTranslation = "I'm interested in Chinese culture.",
            sentenceClueAudioUrl = null, alternatives = null, createdAt = "2026-09-01 10:00:00",
        )
        return CardView(QueueCard("c-r1", "n-r1", "d3", CardTypes.HANZI_TO_MEANING, state), note, emptyList(), CardScheduler.intervalPreviews(state, nowMs), emptyList(), 1, "Starter Chinese")
    }

    private fun practiceUi(counts: Boolean) = StudyUi(
        phase = StudyPhase.Showing(practiceView(CardQueue.REVIEW)),
        counts = QueueCounts(0, 0, 0, 3),
        practice = PracticeUi(counts = counts),
        extras = CardExtras(tutorNotes = listOf(TutorNotes.asCardNote(fresh[1]))),
    )

    @Test fun practiceBack() = shoot("tutor-notes-05-practice-only") {
        StudyScreen(practiceUi(counts = false), playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = true), autoplay = false)
    }

    @Test fun practiceCounts() = shoot("tutor-notes-06-practice-counts") {
        StudyScreen(practiceUi(counts = true), playingKey = null, actions = StudyActions(), cardStart = CardStartState(), autoplay = false)
    }

    @Test fun practiceDone() = shoot("tutor-notes-07-practice-done") {
        StudyScreen(StudyUi(phase = StudyPhase.Done, stats = SessionStats(reviews = 4, correct = 3), practice = PracticeUi(counted = 1, practiceOnly = 3)), null, StudyActions(), autoplay = false)
    }
}
