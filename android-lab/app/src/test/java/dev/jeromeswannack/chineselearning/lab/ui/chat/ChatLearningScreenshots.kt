package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordPanel
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/** docs/CHAT.md PR 3 in the Lab app: chips + pinyin, the word sheet, select → review, corrections, ✓ check. */
class ChatLearningScreenshots : LabScreenshotTest() {
    private val actions = ChatActions()

    /** A bottom sheet's content as it sits in the sheet (the dialog window isn't captured). */
    @Composable
    private fun Sheet(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.ink.copy(alpha = 0.32f))) {
            Column(
                Modifier.padding(top = 56.dp).fillMaxSize().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)
                    .verticalScroll(rememberScrollState()).padding(top = 24.dp),
            ) { content() }
        }
    }

    @Test fun chipsAndPinyin() = shoot("chat-learn-01-chips-pinyin") {
        ChatScreen(S.student, actions)
    }

    @Test fun chipsDark() = shoot("chat-learn-02-chips-dark", dark = true) {
        ChatScreen(S.student.copy(aids = S.student.aids.setPinyinAll(true)), actions)
    }

    @Test fun wordSheet() = shoot("chat-learn-03-word-sheet") {
        Sheet {
            ReaderWordPanel(
                ReaderWordDto("商店", "shāngdiàn", "shop"), "我昨天去商店买东西了。", known = false,
                actions = ReaderWordActions(),
                initialExplanation = ReaderWordExplanationDto(
                    "商店", "shāngdiàn", "shop; store", "商 is trade and 店 a shop: 商店 is any shop you buy things in. 去商店 = go to the shop.",
                ),
            )
        }
    }

    @Test fun selecting() = shoot("chat-learn-04-select") {
        ChatScreen(S.student.copy(selection = SelectionUi(setOf("m2", "v1", "m4"))), actions)
    }

    @Test fun proposing() = shoot("chat-learn-05-proposing") {
        ChatScreen(S.student.copy(selection = SelectionUi(setOf("m2", "v1", "m4", "m5")), proposingCards = true), actions)
    }

    @Test fun review() = shoot("chat-learn-06-review") {
        Sheet { ReviewPanel(S.review, S.decks, online = true, actions = ReviewActions()) }
    }

    @Test fun reviewEditing() = shoot("chat-learn-07-review-edit") {
        Sheet { ReviewPanel(S.review.copy(editing = 2, newDeck = "Weekend chat"), S.decks, online = true, actions = ReviewActions()) }
    }

    @Test fun correctionStudent() = shoot("chat-learn-08-correction-student") {
        ChatScreen(S.student.copy(aids = dev.jeromeswannack.chineselearning.lab.core.ChatLearning.Aids(), scrollTo = ScrollRequest("m2", 1, animate = false)), actions)
    }

    @Test fun correctionTutor() = shoot("chat-learn-09-correction-tutor") {
        ChatScreen(S.tutor.copy(scrollTo = ScrollRequest("m2", 1, animate = false)), actions)
    }

    @Test fun tutorCorrectSheet() = shoot("chat-learn-10-tutor-correct-sheet") {
        Sheet { CorrectPanel(S.m4, S.tutor, ChatSheetActions()) }
    }

    @Test fun checkPanel() = shoot("chat-learn-11-check-panel") {
        ChatScreen(S.student.copy(draft = S.draft, draftCheck = S.check), actions)
    }

    @Test fun checkButton() = shoot("chat-learn-12-check-button") {
        ChatScreen(S.student.copy(draft = "我们下次一起去吧！"), actions)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("chat-learn-13-unfolded") {
        ChatScreen(S.student.copy(aids = S.student.aids.setTranslationAll(true)), actions)
    }
}
