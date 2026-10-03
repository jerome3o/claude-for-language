package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.core.ProposedCard
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatCorrectionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ProposeFlashcardsBody
import dev.jeromeswannack.chineselearning.lab.data.api.ProposedCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** docs/CHAT.md PR 3 in the Lab chat: the ⋯ tools, chips, toggles' storage, the propose / batch shapes. */
class ChatLearningUiTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false; explicitNulls = false }
    private val words = listOf(ReaderWordDto("我", "wǒ", "I"), ReaderWordDto("昨天", "zuótiān", "yesterday"), ReaderWordDto("去", "qù", "go"), ReaderWordDto("了", "le", ""), ReaderWordDto("。", "", ""))
    private fun msg(id: String, sender: String, content: String, at: String = "2026-10-02T09:00:00.000Z") =
        ChatMessageDto(id, conversation_id = "c1", sender_id = sender, content = content, created_at = at)

    private val student = ChatUi(loading = false, myId = "me", viewerRole = "student", otherName = "Minghui")
    private val tutor = ChatUi(loading = false, myId = "t1", viewerRole = "tutor", otherName = "Jerome")

    @Test fun wordsOnlyWhenTheyStillMatchTheText() {
        val m = msg("m1", "t1", "我昨天去了。").copy(words = words, words_source = "content")
        assertEquals(words, student.words(m))
        assertNull("stale (edited since)", student.words(m.copy(content = "我今天去了。")))
        assertNull("deleted", student.words(m.copy(deleted_at = "x")))
        val voice = msg("v1", "t1", "").copy(
            attachment = ChatAttachmentDto("voice", transcript_status = "done", transcript = "我昨天去了。", translation = "I went yesterday."),
            words = words, words_source = "transcript",
        )
        assertEquals(words, student.words(voice))
        assertEquals("I went yesterday.", student.translationOf(voice))
        assertEquals("I went.", student.translationOf(m.copy(translation = "I went.")))
        assertNull(student.translationOf(m))
    }

    private fun ChatUi.ids(m: ChatMessageDto) = menu(m).items.map { it.id }

    @Test fun theLongPressMenuForTheTutorAndTheStudent() {
        val theirs = msg("m1", "me", "我昨天去商店买东西了")
        val ids = tutor.ids(theirs)
        assertTrue(MessageMenu.CORRECT in ids)
        assertTrue(MessageMenu.SELECT_CARDS in ids)
        assertFalse(MessageMenu.REMOVE_CORRECTION in ids)
        val corrected = theirs.copy(correction = ChatCorrectionDto("我昨天去商店买了东西", "了 after the verb", "t1", "x"))
        val ids2 = tutor.ids(corrected)
        assertTrue(MessageMenu.REMOVE_CORRECTION in ids2)
        assertEquals("Edit correction", tutor.menu(corrected).items.first { it.id == MessageMenu.CORRECT }.label)
        assertFalse("a tutor doesn't make cards from a correction", MessageMenu.CORRECTION_CARD in ids2)
        // The student sees "Make a card from the correction" on their corrected message, never "Correct".
        val sIds = student.ids(corrected)
        assertTrue(MessageMenu.CORRECTION_CARD in sIds)
        assertFalse(MessageMenu.CORRECT in sIds)
        // Their own message can't be corrected by the tutor; a photo neither.
        assertFalse(MessageMenu.CORRECT in tutor.ids(msg("m2", "t1", "很好！")))
        assertFalse(MessageMenu.CORRECT in tutor.ids(theirs.copy(attachment = ChatAttachmentDto("image"))))
    }

    @Test fun theMenuFollowsTheTogglesAndTheCheck() {
        val m = msg("m1", "t1", "我昨天去了。").copy(translation = "I went yesterday.")
        val on = student.copy(aids = ChatLearning.Aids().togglePinyin("m1").toggleTranslation("m1"))
        assertEquals("Hide pinyin", on.menu(m).items.first { it.id == MessageMenu.PINYIN }.label)
        assertEquals("Hide translation", on.menu(m).items.first { it.id == MessageMenu.TRANSLATE }.label)
        assertEquals("Translate", student.menu(m).items.first { it.id == MessageMenu.TRANSLATE }.label)
        // A check result learnt here wins over the server's copy.
        val mine = msg("m2", "me", "我很好")
        assertTrue(MessageMenu.CHECK in student.ids(mine))
        assertTrue(MessageMenu.VIEW_CORRECTIONS in student.copy(checkStatuses = mapOf("m2" to "needs_improvement")).ids(mine))
        // The Claude practice chat: Word by word, no pin / edit / delete.
        val ai = student.copy(conversation = dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto("c1", "rel1", "Practice", is_ai_conversation = true))
        assertTrue(MessageMenu.WORD_BY_WORD in ai.ids(m))
        assertFalse(MessageMenu.PIN in ai.ids(mine))
        // Voice: the tools work on the transcript.
        val voice = msg("v1", "t1", "").copy(attachment = ChatAttachmentDto("voice", transcript_status = "done", transcript = "我昨天去了。"))
        assertEquals("我昨天去了。", student.menuText(voice))
        assertFalse(MessageMenu.PLAY in student.ids(voice))
    }

    @Test fun pickableMarksWhatCanBeSent() {
        val ui = student.copy(messages = listOf(msg("a", "t1", "你好"), msg("b", "t1", "").copy(deleted_at = "x"), msg("c", "me", "").copy(attachment = ChatAttachmentDto("voice", transcript_status = "pending"))))
        assertEquals(listOf(true, false, false), ui.pickable().map { it.eligible })
    }

    @Test fun togglesSurviveAsJson() {
        val a = ChatLearning.Aids().setPinyinAll(true).togglePinyin("m1").toggleTranslation("v1")
        val back = json.decodeFromString(ChatAidsDto.serializer(), json.encodeToString(ChatAidsDto.serializer(), ChatAidsDto.of(a))).toAids()
        assertEquals(a, back)
        assertFalse(back.pinyin("m1"))
        assertTrue(back.pinyin("m2"))
        assertTrue(back.translation("v1"))
    }

    @Test fun proposeBodyAndBatchNotes() {
        assertEquals("""{"message_ids":["a","b"]}""", json.encodeToString(ProposeFlashcardsBody.serializer(), ProposeFlashcardsBody(message_ids = listOf("a", "b"))))
        assertEquals("""{"message_ids":["a"],"focus":"correction"}""", json.encodeToString(ProposeFlashcardsBody.serializer(), ProposeFlashcardsBody(message_ids = listOf("a"), focus = "correction")))
        val dto = json.decodeFromString(
            ProposedCardDto.serializer(),
            """{"hanzi":"商店","pinyin":"shāngdiàn","english":"shop","fun_facts":"商 trade + 店 shop","sentence_clue":"我去商店。","sentence_clue_pinyin":"wǒ qù shāngdiàn","sentence_clue_translation":"I go to the shop.","already_have":true,"source_message_id":"m3"}""",
        )
        val card = ChatViewModel.proposed(dto)
        assertTrue(card.alreadyHave)
        assertEquals("m3", card.sourceMessageId)
        val note = ChatViewModel.noteOf(card)
        assertEquals("我去商店。", note.sentence_clue)
        assertEquals("I go to the shop.", note.sentence_clue_translation)
        // Blank optional fields are left out; a clue's pinyin / translation only with a clue.
        val bare = ChatViewModel.noteOf(ProposedCard(" 东西 ", "dōngxi", "thing", sentenceCluePinyin = "x"))
        assertEquals("东西", bare.hanzi)
        assertNull(bare.fun_facts)
        assertNull(bare.sentence_clue)
        assertNull(bare.sentence_clue_pinyin)
    }
}
