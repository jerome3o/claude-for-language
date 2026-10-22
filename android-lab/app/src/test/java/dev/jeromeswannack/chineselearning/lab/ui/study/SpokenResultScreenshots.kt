package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test

/**
 * A typing card answered by SPEAKING, the answer side in every verdict, light and dark
 * (docs/STUDY_SESSION.md "Say the answer"): the card's answer once, big, with its pinyin and meaning,
 * then ONE compact "You said" row — ✓ Match (狼 said 狼), ✓ Sounded right — written differently (有
 * said 友: 友 marked yellow), ≈ Close — tones off (Jerome's 狼 said 朗: 朗 marked red), ✕ Didn't match
 * (狼 said 猫), ≈ Contains the answer (长得 said inside 他长得很好。) and Couldn't transcribe (the
 * question side's retry, unchanged). `study-spoken-result-NN-*`.
 */
class SpokenResultScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-10-22T09:30:00.000Z")
    private val wolf = Samples.note.copy(
        hanzi = "狼", pinyin = "láng", english = "wolf",
        funFacts = "**狼** (láng) wolf: 犭 (the animal radical) + 良 (liáng, sound).\n- 狼吞虎咽 wolf down one's food.\n- Not 朗 lǎng (bright, clear) — the same syllable in the 3rd tone.",
    )
    private val you = Samples.note.copy(
        hanzi = "有", pinyin = "yǒu", english = "to have; there is",
        funFacts = "**有** (yǒu) to have; there is.\n- Negated with 没 (méiyǒu), never 不.\n- Same sound as 友 (friend) and 酉: said aloud they can't be told apart.",
    )
    private val zhangde = Samples.note.copy(
        hanzi = "长得", pinyin = "zhǎng de", english = "to look; to appear",
        funFacts = "**长** (zhǎng) to grow + **得** (de) the complement marker — how someone has grown, i.e. looks.\n- 他长得很高。He is tall.",
    )

    private fun ui(note: NoteEntity, spoken: SpokenUi): StudyUi {
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c-${note.hanzi}", note.id, "d1", CardTypes.MEANING_TO_HANZI, state)
        val view = CardView(card, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "动物 · HSK", true, start = CardStartState())
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = true, forcedOffline = false, extras = CardExtras(spoken = spoken))
    }

    private fun said(text: String) = SpokenUi(result = SpokenResult(text, submit = true, seq = 1))
    private val actions = StudyActions(onYouSaidCoach = { _, _ -> }, onYouSaidPlay = {})

    private fun card(name: String, note: NoteEntity, spoken: SpokenUi, dark: Boolean) =
        shoot(name, dark = dark) { StudyScreen(ui(note, spoken), playingKey = null, actions = actions, autoplay = false) }

    @Test fun exact() = card("study-spoken-result-01-exact", wolf, said("狼"), dark = false)
    @Test fun exactDark() = card("study-spoken-result-02-exact-dark", wolf, said("狼"), dark = true)
    @Test fun sound() = card("study-spoken-result-03-sound", you, said("友"), dark = false)
    @Test fun soundDark() = card("study-spoken-result-04-sound-dark", you, said("友"), dark = true)
    @Test fun close() = card("study-spoken-result-05-close", wolf, said("朗"), dark = false)
    @Test fun closeDark() = card("study-spoken-result-06-close-dark", wolf, said("朗"), dark = true)
    @Test fun wrong() = card("study-spoken-result-07-wrong", wolf, said("猫"), dark = false)
    @Test fun wrongDark() = card("study-spoken-result-08-wrong-dark", wolf, said("猫"), dark = true)
    @Test fun contains() = card("study-spoken-result-09-contains", zhangde, said("他长得很好。"), dark = false)
    @Test fun containsDark() = card("study-spoken-result-10-contains-dark", zhangde, said("他长得很好。"), dark = true)
    @Test fun failed() = card("study-spoken-result-11-failed", wolf, SpokenUi(phase = SpokenPhase.FAILED, failure = SpokenFailure.FAILED), dark = false)
    @Test fun failedDark() = card("study-spoken-result-12-failed-dark", wolf, SpokenUi(phase = SpokenPhase.FAILED, failure = SpokenFailure.FAILED), dark = true)

    /** How far down the answer side the 🔊 Play row sits (printed; the PR quotes before / after). */
    private fun measure(note: NoteEntity, text: String, name: String) {
        compose.setContent { LabTheme { StudyScreen(ui(note, said(text)), playingKey = null, actions = actions, autoplay = false) } }
        compose.mainClock.advanceTimeBy(2_000)
        val back = compose.onNodeWithTag(CARD_BACK_TAG).getUnclippedBoundsInRoot()
        val play = compose.onNodeWithTag(PLAY_WORD_TAG).getUnclippedBoundsInRoot()
        println("SPOKEN-RESULT-SPACE $name=${(play.top - back.top).value.toInt()}dp")
    }

    @Test fun spaceExact() = measure(wolf, "狼", "exact")
    @Test fun spaceSound() = measure(you, "友", "sound")
    @Test fun spaceClose() = measure(wolf, "朗", "close")
    @Test fun spaceWrong() = measure(wolf, "猫", "wrong")
    @Test fun spaceContains() = measure(zhangde, "他长得很好。", "contains")
}
