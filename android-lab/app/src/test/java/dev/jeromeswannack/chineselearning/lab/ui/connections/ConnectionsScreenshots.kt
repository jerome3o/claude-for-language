package dev.jeromeswannack.chineselearning.lab.ui.connections

import dev.jeromeswannack.chineselearning.lab.core.QuestionThreads
import dev.jeromeswannack.chineselearning.lab.data.api.FlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.FlagsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeChatQuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonNoteFileDto
import dev.jeromeswannack.chineselearning.lab.data.api.MessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.PendingInvitationDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.SharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentSharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabTabBar
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import org.junit.Test
import org.robolectric.annotation.Config
import java.time.Instant

/** Package E screenshots: the student's Tutor tab. */
class ConnectionsScreenshots : LabScreenshotTest() {
    companion object {
        const val ME = "me"
        val me = UserSummaryDto(ME, "jerome@example.com", "Jerome")
        val wang = UserSummaryDto("t1", "wang.laoshi@example.com", "王老师")
        val claude = UserSummaryDto("claude-ai", null, "Claude")
        val tutorRel = RelationshipDto("rel1", "t1", ME, "tutor", "active", requester = wang, recipient = me)
        val claudeRel = RelationshipDto("rel2", "claude-ai", ME, "tutor", "active", requester = claude, recipient = me)
        val rels = MyRelationshipsDto(
            tutors = listOf(tutorRel, claudeRel),
            pending_incoming = listOf(RelationshipDto("rel3", "t3", ME, "tutor", "pending", requester = UserSummaryDto("t3", "li@example.com", "李明"), recipient = me)),
            pending_outgoing = listOf(RelationshipDto("rel4", ME, "t4", "student", "pending", requester = me, recipient = UserSummaryDto("t4", "zhang@example.com", "张老师"))),
            pending_invitations = listOf(PendingInvitationDto("inv1", "friend@example.com", "student")),
        )
        private val now = Instant.now()
        private fun ago(h: Long) = now.minusSeconds(h * 3600).toString()
        val conversations = listOf(
            ChatConversationDto("c1", "rel1", "Lesson questions", ago(30), ago(1), last_message = MessageDto("m1", content = "明天上课前把这些词复习一下，好吗？")),
            ChatConversationDto("c2", "rel1", null, ago(24 * 9), ago(24 * 3), last_message = MessageDto("m2", content = "Thanks! 我今天学了二十个新词。")),
        )
        val flags = FlagsDto(
            listOf(
                FlagDto("f1", "rel1", "n1", message = "Why is 了 at the end here and not after the verb?", status = "open", created_at = ago(20), hanzi = "我吃饭了", pinyin = "wǒ chī fàn le", english = "I have eaten", deck_name = "Week 3"),
                FlagDto("f2", "rel1", "n2", message = "Is 晴天 the same as 天晴?", status = "resolved", tutor_reply = "Almost — 晴天 is a noun (a sunny day), 天晴 describes the weather clearing.", replied_at = ago(5), created_at = ago(50), hanzi = "晴天", pinyin = "qíngtiān", english = "sunny day", deck_name = "天气", tutor_name = "王老师"),
            ),
            open = 1,
        )
        val pageUi = TutorPageUi(
            relationship = Loadable(tutorRel), myId = ME, conversations = Loadable(conversations), flags = Loadable(flags),
            sharedDecks = Loadable(listOf(SharedDeckDto("s1", "rel1", "d1", "d9", ago(48), "第三周作业：天气"), SharedDeckDto("s2", "rel1", "d2", "d8", ago(24 * 20), "Starter Chinese"))),
            studentSharedDecks = listOf(StudentSharedDeckDto("x1", "My restaurant words", 24, ago(24 * 6))),
        )
        val questions = listOf(
            ClaudeChatQuestionDto("q1", "n1", "Why 了 here?", "**了** marks a completed action. At the end of a sentence it signals a *change of state*.", ago(3), "我吃饭了", "wǒ chī fàn le", "I have eaten", "d1", "Week 3"),
            ClaudeChatQuestionDto("q2", "n1", "Can I say 我吃了饭?", "Yes — but it sounds unfinished on its own; add what comes next: 我吃了饭就走。", now.minusSeconds(3 * 3600 - 300).toString(), "我吃饭了", "wǒ chī fàn le", "I have eaten", "d1", "Week 3"),
            ClaudeChatQuestionDto("q3", "n2", "Mnemonic for 晴?", "日 (sun) + 青 (blue-green): the sun in a clear blue sky.", ago(30), "晴天", "qíngtiān", "sunny day", "d2", "天气"),
        )
    }

    @Test fun list() = shootInShell("connections-01-list", active = TabId.TUTOR) {
        ConnectionsScreen(ConnectionsUi(Loadable(rels), ME), ConnectionsActions())
    }

    @Test fun empty() = shootInShell("connections-02-empty", active = TabId.TUTOR) {
        ConnectionsScreen(ConnectionsUi(Loadable(MyRelationshipsDto()), ME, notice = "Invitation sent to friend@example.com"), ConnectionsActions())
    }

    @Test fun tutorPage() = shootInShell("connections-03-tutor-page", active = TabId.TUTOR) { TutorPageScreen(pageUi, TutorPageActions()) }

    @Test fun claudePage() = shootInShell("connections-04-claude-page", active = TabId.TUTOR) {
        TutorPageScreen(pageUi.copy(relationship = Loadable(claudeRel), conversations = Loadable(emptyList())), TutorPageActions())
    }

    @Test fun claudeChats() = shoot("connections-05-claude-chats") {
        ClaudeChatsScreen(ClaudeChatsUi(Loadable(QuestionThreads.group(questions)), total = 3), onBack = {}, onOpenCard = {}, onLoadMore = {}, onRetry = {})
    }

    @Test fun lessonNotes() = shoot("connections-06-lesson-notes") {
        LessonNotesScreen(
            LessonNotesUi(Loadable(listOf(LessonNoteDto("l1", "同学 — tóngxué — classmate\n同事 — tóngshì — colleague\n我们是同事。", "Tue lesson", "2026-09-22 10:00:00", listOf(LessonNoteFileDto("f", "whiteboard.jpg"))))), files = listOf("worksheet.pdf")),
            LessonNotesActions(),
        )
    }

    @Test fun offlineTutorPage() = shoot("connections-07-tutor-page-offline", dark = true) {
        TutorPageScreen(pageUi.copy(conversations = Loadable(conversations, offline = true, updatedAt = System.currentTimeMillis() - 7_200_000)), TutorPageActions())
    }

    @Test fun tabBadge() = shoot("connections-08-tab-badge") {
        LabTabBar(NavRules.tabsFor(NavRole()), TabId.STUDY, {}, badges = mapOf(TabId.TUTOR to 3))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun tutorPageUnfolded() = shootInShell("connections-09-tutor-page-unfolded", active = TabId.TUTOR) { TutorPageScreen(pageUi, TutorPageActions()) }
}
