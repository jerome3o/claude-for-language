package dev.jeromeswannack.chineselearning.lab.ui.cards

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.api.NoteAudioRecordingDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceList
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import kotlin.test.assertEquals

/** Package K: the card editor's Sentence Set + Audio Recordings sections. */
class NoteMediaScreenshots : LabScreenshotTest() {
    private val recs = listOf(
        NoteAudioRecordingDto("r1", "n1", "generated/n1.mp3", "gtts", "Google TTS 0.6x", is_primary = true),
        NoteAudioRecordingDto("r2", "n1", "generated/n1-mm.mp3", "minimax", "Gentleman 0.8x"),
        NoteAudioRecordingDto("r3", "n1", "recordings/n1.webm", "upload", "My Recording"),
    )
    private val note = NoteEntity(
        "n1", "d1", "打算", "dǎsuàn", "to plan; to intend", "generated/n1.mp3", null, null,
        "你周末打算做什么？", "nǐ zhōumò dǎsuàn zuò shénme?", "What are you planning to do at the weekend?", null, null, "2026-09-01 10:00:00",
    )
    private val sentences = listOf(
        SentenceEntity("s1", "n1", 0, "我打算去北京。", "wǒ dǎsuàn qù Běijīng.", "I plan to go to Beijing.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "你有什么打算？", "nǐ yǒu shénme dǎsuàn?", "What are your plans?", null, "collocation", "打算 as a noun: plans"),
    )

    @Test fun recordings() = shoot("cards-10-audio-recordings") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(20.dp)) { NoteAudioPanel(NoteAudioUi(recs, loading = false), null, NoteAudioActions()) }
    }

    @Test fun miniMax() = shoot("cards-11-audio-minimax-options") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(20.dp)) { NoteAudioPanel(NoteAudioUi(recs.take(1), loading = false, recording = true), "generated/n1.mp3", NoteAudioActions(), startMiniMaxOpen = true) }
    }

    @Test fun offline() = shoot("cards-12-audio-offline") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(20.dp)) { NoteAudioPanel(NoteAudioUi(online = false, loading = false), null, NoteAudioActions()) }
    }

    @Test fun editorWithMedia() = shoot("cards-13-editor-sentence-set-and-audio") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(20.dp)) {
            androidx.compose.material3.Text("Sentence Set", style = androidx.compose.material3.MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
            SentenceList(note, sentences, 0, true, null, SentenceActions(), { _, _ -> }, startShowAll = true)
            NoteAudioPanel(NoteAudioUi(recs, loading = false), null, NoteAudioActions())
        }
    }

    @Test fun speedLabelMatchesTheWeb() {
        assertEquals(" 0.6x", NoteMediaController.speedLabel(0.6))
        assertEquals("", NoteMediaController.speedLabel(1.0))
        assertEquals(" 1.2x", NoteMediaController.speedLabel(1.2))
    }
}
