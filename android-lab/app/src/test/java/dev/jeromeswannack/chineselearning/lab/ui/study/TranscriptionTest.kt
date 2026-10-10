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

    @Test fun normalizePinyin() {
        assertEquals("dǎsuàn", Transcription.normalizePinyin("Dǎ suàn."))
    }
}
