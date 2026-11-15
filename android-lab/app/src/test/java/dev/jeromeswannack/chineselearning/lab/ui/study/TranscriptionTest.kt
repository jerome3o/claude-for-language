package dev.jeromeswannack.chineselearning.lab.ui.study

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** compareTranscription (hooks/useTranscription.ts) with the device's pinyin. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class TranscriptionTest {
    @Test fun exactMatchAndHomophones() {
        val r = Transcription.compare(" 打算。", "打算")
        assertTrue(r.isMatch)
        assertEquals("打算。", r.transcribedHanzi)
        // Whisper writes a same-sounding character: still right (compared in pinyin, tones kept).
        assertTrue(Transcription.compare("大蒜", "打算").let { !it.isMatch }) // dà suàn ≠ dǎ suàn (tone)
        assertTrue(Transcription.compare("他", "她").isMatch)
    }

    @Test fun sameSyllablesOtherTonesAreClose() {
        val r = Transcription.compare("她是我最喜欢的老伴。", "他是我最喜欢的老板。")
        assertFalse(r.isMatch)
        assertTrue(r.tonesOff) // lǎobàn vs lǎobǎn; 他 / 她 are one sound
        assertTrue(Transcription.compare("她是我最喜欢的老板。", "他是我最喜欢的老板。").isMatch)
        assertTrue(Transcription.compare("买", "卖").tonesOff)
        assertFalse(Transcription.compare("音响", "银行").tonesOff)
        assertFalse(Transcription.compare("再见", "再见").tonesOff)
        assertFalse(Transcription.compare("我说银行这个词", "银行").tonesOff)
    }

    @Test fun containsAndNumbers() {
        val r = Transcription.compare("我打算明天去", "打算")
        assertFalse(r.isMatch)
        assertTrue(r.containsExpected)
        assertTrue(Transcription.compare("5", "五").isMatch)
        assertTrue(Transcription.compare("两百", "200").isMatch)
        assertFalse(Transcription.compare("你好", "打算").containsExpected)
    }

    /** The typing cards' spoken rule (AnswerKey.answerWithin) also finds the answer — as the web's compareTranscription. */
    @Test fun containsUsesTheSpokenRule() {
        assertTrue(Transcription.compare("他长得很好。", "长得").containsExpected)
        assertTrue(Transcription.compare("我想去銀行", "银行").containsExpected)
        assertTrue(Transcription.compare("我想去银航取钱", "银行").containsExpected)
        assertFalse(Transcription.compare("他很高", "长得").containsExpected)
    }

    /** Jerome, Nov 2026: the recogniser's quote marks (英语很"繁琐") — punctuation of any kind never matters. */
    @Test fun quotesNeverMatter() {
        val card = "我越学中文，越觉得英文很繁琐。"
        for (said in listOf("我越学中文，越觉得英文很\"繁琐\"。", "我越学中文越觉得英文很“繁琐”", "我越学中文。 越觉得英文很「繁琐」！")) {
            val r = Transcription.compare(said, card)
            assertTrue(said, r.isMatch)
            assertEquals(null, r.droppedWord)
        }
        // 英语 for 英文 is not a device match: it goes to Claude (core ReadTakeCheck).
        val r = Transcription.compare("我越学中文，越觉得英语很\"繁琐\"。", card)
        assertFalse(r.isMatch || r.containsExpected || r.tonesOff)
    }

    /** A sentence read with one little word swallowed is a match (core AnswerKey.droppedFunctionChar). */
    @Test fun oneSwallowedLittleWordInASentence() {
        val r = Transcription.compare("虾饺我最喜欢的“点心”。", "虾饺是我最喜欢的点心。")
        assertTrue(r.isMatch)
        assertEquals("是", r.droppedWord)
        assertFalse(Transcription.compare("好", "好的").isMatch)
        assertFalse(Transcription.compare("虾饺是我喜欢的点心", "虾饺是我最喜欢的点心。").isMatch)
    }

    @Test fun normalizePinyin() {
        assertEquals("dǎsuàn", Transcription.normalizePinyin("Dǎ suàn."))
    }
}
