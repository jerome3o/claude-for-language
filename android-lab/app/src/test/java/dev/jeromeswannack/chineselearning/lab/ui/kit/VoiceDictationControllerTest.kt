package dev.jeromeswannack.chineselearning.lab.ui.kit

import dev.jeromeswannack.chineselearning.lab.ui.study.LiveStream
import dev.jeromeswannack.chineselearning.lab.ui.study.SonioxProtocol
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The voice-first box's controller with a fake microphone + transcriber (the web's VoiceTextInput.test.tsx). */
@OptIn(ExperimentalCoroutinesApi::class)
class VoiceDictationControllerTest {
    private class FakeStream : LiveStream {
        val text = CompletableDeferred<String>()
        var aborted = false
        override fun send(pcm: ByteArray, length: Int) {}
        override suspend fun finish(timeoutMs: Long): String = text.await()
        override fun abort() { aborted = true }
    }

    private class FakeEngine : DictationEngine {
        var micOk = true
        var stream: FakeStream? = FakeStream()
        var onUpdate: ((SonioxProtocol.Transcript) -> Unit)? = null
        var uploadResult: () -> String = { "我喜欢猫" }
        var uploads = 0
        override fun open(languageHints: List<String>, onUpdate: (SonioxProtocol.Transcript) -> Unit): LiveStream? {
            this.onUpdate = onUpdate
            return stream
        }
        override fun start(live: LiveStream?) = micOk
        override fun stop(): File? = File.createTempFile("take", ".wav").apply { writeBytes(byteArrayOf(1, 2)) }
        override val mime = "audio/wav"
        override suspend fun upload(take: File, mime: String, liveError: String?): String { uploads++; return uploadResult() }
    }

    private class Rig(scope: kotlinx.coroutines.CoroutineScope, var online: Boolean = true) {
        val engine = FakeEngine()
        val tracked = mutableListOf<Map<String, Any?>>()
        val answers = mutableListOf<DictatedAnswer>()
        var box = ""
        val c = VoiceDictationController(scope, engine, "test", online = { online }, track = { _, p -> tracked += p }).also {
            it.onSubmit = { a -> answers += a }
            it.onFill = { t -> box = t }
        }
    }

    @Test fun saysStreamsReviewsAndSubmits() = runTest(UnconfinedTestDispatcher()) {
        val r = Rig(backgroundScope)
        assertEquals("voice", r.c.ui.value.state.mode)
        r.c.say()
        assertEquals("listening", r.c.ui.value.phase)
        r.engine.onUpdate!!(SonioxProtocol.Transcript("我喜欢", "猫"))
        assertEquals("我喜欢", r.c.ui.value.finalText)
        assertEquals("猫", r.c.ui.value.partialText)
        r.c.stop()
        assertEquals("finishing", r.c.ui.value.phase)
        r.engine.stream!!.text.complete("我喜欢猫")
        assertEquals("review", r.c.ui.value.phase)
        assertEquals("我喜欢猫", r.c.ui.value.finalText)
        r.c.submit("")
        assertEquals(listOf(DictatedAnswer("我喜欢猫", "spoken", "我喜欢猫", "live")), r.answers)
        assertEquals("submitted", r.tracked.last()["outcome"])
        assertEquals("live", r.tracked.last()["via"])
        assertEquals("idle", r.c.ui.value.phase)
    }

    @Test fun editPutsTheTranscriptInTheBox() = runTest(UnconfinedTestDispatcher()) {
        val r = Rig(backgroundScope)
        r.engine.stream = null // no live key: the upload
        r.c.say()
        r.c.stop()
        assertEquals("我喜欢猫", r.c.ui.value.finalText)
        r.c.edit()
        assertEquals("我喜欢猫", r.box)
        assertEquals("type", r.c.ui.value.state.mode)
        r.c.submit("我喜欢狗")
        assertEquals(DictatedAnswer("我喜欢狗", "edited", "我喜欢猫"), r.answers.single())
        assertEquals("edited", r.tracked.last()["outcome"])
    }

    @Test fun neverSilentAndTheSameTakeAgain() = runTest(UnconfinedTestDispatcher()) {
        val r = Rig(backgroundScope)
        r.engine.stream = null
        r.engine.uploadResult = { throw java.io.IOException("502") }
        r.c.say()
        r.c.stop()
        assertEquals("failed", r.c.ui.value.phase)
        assertEquals("failed", r.c.ui.value.failure)
        assertTrue("retry_upload" in dev.jeromeswannack.chineselearning.lab.core.VoiceDictation.controls(r.c.ui.value.state))
        r.engine.uploadResult = { "你好" }
        r.c.retryUpload()
        assertEquals("review", r.c.ui.value.phase)
        assertEquals("你好", r.c.ui.value.finalText)
        assertEquals(2, r.engine.uploads)
    }

    @Test fun offlineAndMicProblemsFallBackToTyping() = runTest(UnconfinedTestDispatcher()) {
        val r = Rig(backgroundScope, online = false)
        assertEquals("offline", r.c.ui.value.blocked)
        assertEquals("type", r.c.ui.value.state.mode)
        r.online = true
        r.c.refreshBlocked()
        assertNull(r.c.ui.value.blocked)
        r.engine.micOk = false
        r.c.say()
        assertEquals("mic_error", r.c.ui.value.blocked)
        r.c.micUnavailable("denied")
        assertEquals("denied", r.c.ui.value.blocked)
        r.c.submit("我")
        assertEquals("typed", r.answers.single().source)
    }

    @Test fun typedTextBeforeTheMicIsKept() = runTest(UnconfinedTestDispatcher()) {
        val r = Rig(backgroundScope)
        r.c.type()
        r.c.say("我想")
        r.engine.stream!!.text.complete("喝咖啡")
        r.c.stop()
        assertEquals("我想喝咖啡", r.c.ui.value.finalText)
        r.c.cancel()
        assertEquals("cancelled", r.tracked.last()["outcome"])
        assertEquals("idle", r.c.ui.value.phase)
    }
}
