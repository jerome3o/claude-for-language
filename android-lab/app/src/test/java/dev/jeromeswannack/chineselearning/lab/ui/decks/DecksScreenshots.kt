package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.foundation.background
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
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.cards.CardHubActions
import dev.jeromeswannack.chineselearning.lab.ui.cards.CardHubScreen
import dev.jeromeswannack.chineselearning.lab.ui.cards.MoveToDeckList
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditActions
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditForm
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config

/** Package C screens. Sheets are shot as their bodies on a sheet-coloured card. */
class DecksScreenshots : LabScreenshotTest() {
    private val now = java.time.Instant.parse("2026-09-27T12:00:00Z").toEpochMilli()

    @Composable
    private fun Sheet(content: @Composable () -> Unit) {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(top = 80.dp)) {
            Column(Modifier.fillMaxSize().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(top = 20.dp)) { content() }
        }
    }

    @Test fun list() = shootInShell("decks-01-list", TabId.MORE) { DecksTabScreen(DecksSamples.list, DecksActions()) }

    @Test fun dragging() = shootInShell("decks-02-drag-lifted", TabId.MORE) {
        DecksTabScreen(DecksSamples.list.copy(decks = DecksSamples.decks.let { listOf(it[0], it[2], it[1], it[3], it[4]) }), DecksActions(), liftedPreview = "d3")
    }

    @Test fun search() = shootInShell("decks-03-search-results", TabId.MORE) { DecksTabScreen(DecksSamples.search, DecksActions()) }

    @Test fun searchServer() = shootInShell("decks-04-search-server-fallback", TabId.MORE) { DecksTabScreen(DecksSamples.searchServer, DecksActions()) }

    @Test fun empty() = shootInShell("decks-05-empty", TabId.MORE) { DecksTabScreen(DecksUi(loaded = true), DecksActions()) }

    @Test fun newDeck() = shoot("decks-06-new-deck-sheet") { Sheet { NewDeckForm(false, true, null, { _, _ -> }, {}, {}, {}) } }

    @Test fun deckPage() = shoot("decks-07-deck-page") { DeckScreen(DecksSamples.deck, DeckActions()) }

    @Test fun deckPageTutor() = shoot("decks-08-deck-page-tutor-account") { DeckScreen(DecksSamples.deck.copy(isTutorAccount = true, notice = "Audio ready for 2 words."), DeckActions()) }

    @Test fun deckSelect() = shoot("decks-09-deck-select") {
        DeckScreen(DecksSamples.deck.copy(selected = setOf("n2", "n3")), DeckActions())
    }

    @Test fun deckAudioJob() = shoot("decks-10-deck-generating-audio") { DeckScreen(DecksSamples.deck.copy(audioJob = AudioJobUi(3, 7, false)), DeckActions()) }

    @Test fun deckEmpty() = shoot("decks-11-deck-empty") {
        DeckScreen(DecksSamples.deck.copy(notes = emptyList(), completion = DeckStats.Completion(0, 0, 0, 0), due = 0), DeckActions())
    }

    @Test fun deckDeleted() = shoot("decks-12-deck-deleted") { DeckScreen(DeckUi(loaded = true, deck = null), DeckActions()) }

    @Test fun editSheet() = shoot("decks-13-edit-card") {
        Sheet { NoteEditForm(DecksSamples.edit, NoteEditActions(onDelete = {}, onMove = {}, onOpenHub = {}, onPlay = {}, onGenerateSentence = {})) }
    }

    @Test fun editRefused() = shoot("decks-14-edit-card-refused") {
        Sheet {
            NoteEditForm(
                DecksSamples.edit.copy(error = "hanzi \"打算/计划\" contains \"/\": the card shows ONE clean form — move alternatives, optional characters or the pattern to fun_facts"),
                NoteEditActions(onDelete = {}, onGenerateSentence = {}),
            )
        }
    }

    @Test fun addOffline() = shoot("decks-15-add-word-offline") {
        Sheet { NoteEditForm(DecksSamples.edit.copy(noteId = null, initial = dev.jeromeswannack.chineselearning.lab.data.decks.NoteFields("", "", ""), online = false), NoteEditActions()) }
    }

    @Test fun moveSheet() = shoot("decks-16-move-to-deck") {
        Sheet { Column { MoveToDeckList(DecksSamples.decks.map { it.id to it.name }, "d1") {} } }
    }

    @Test fun settings() = shoot("decks-17-deck-settings") { Sheet { DeckSettingsForm(DecksSamples.deck, { _, _, _, _ -> }, {}) } }

    @Test fun settingsRefused() = shoot("decks-18-deck-settings-refused") {
        Sheet { DeckSettingsForm(DecksSamples.deck.copy(settingsError = "new_cards_per_day must be a number between 0 and 1000"), { _, _, _, _ -> }, {}) }
    }

    // Package K: one-off homework banner, tutor shares, share sheet, Try it.
    @Test fun oneOffBanner() = shoot("decks-30-one-off-homework-banner") {
        DeckScreen(DecksSamples.deck.copy(deck = DecksSamples.deck.deck!!.copy(newPerDay = 0, secondaryPerDay = 0), oneOffAssignmentId = "a1"), DeckActions())
    }

    @Test fun tutorShares() = shoot("decks-31-shared-with-tutors") {
        DeckScreen(DecksSamples.deck.copy(tutorShares = DecksSamples.tutorShares, tutors = DecksSamples.tutors), DeckActions())
    }

    @Test fun shareSheet() = shoot("decks-32-share-with-tutor-sheet") {
        Sheet { ShareWithTutorForm(DecksSamples.deck.copy(tutorShares = DecksSamples.tutorShares.take(1), tutors = DecksSamples.tutors), {}, {}) }
    }

    @Test fun shareSheetNoTutor() = shoot("decks-33-share-with-tutor-none") { Sheet { ShareWithTutorForm(DecksSamples.deck, {}, {}) } }

    @Test fun tryFront() = shoot("decks-34-try-it-front") { DeckTryScreen(DecksSamples.tryUi, DeckTryActions()) }

    @Test fun tryBack() = shoot("decks-35-try-it-back") { DeckTryScreen(DecksSamples.tryUi, DeckTryActions(), initialIndex = 1, initialRevealed = true) }

    @Test fun tryAudio() = shoot("decks-36-try-it-audio") { DeckTryScreen(DecksSamples.tryUi, DeckTryActions(), initialMode = TryMode.AUDIO_TO_HANZI) }

    @Test fun tryEmpty() = shoot("decks-37-try-it-empty") { DeckTryScreen(DeckTryUi(true, "新的一课"), DeckTryActions()) }

    @Config(qualifiers = LabScreenshotTest.UNFOLDED)
    @Test fun tryUnfolded() = shoot("decks-38-try-it-unfolded") { DeckTryScreen(DecksSamples.tryUi, DeckTryActions(), initialMode = TryMode.MEANING_TO_HANZI) }

    @Test fun hub() = shoot("cards-01-hub") { CardHubScreen(DecksSamples.hub, CardHubActions(), nowMs = now) }

    @Test fun hubOffline() = shoot("cards-02-hub-offline-from-phone") {
        CardHubScreen(
            DecksSamples.hub.copy(fromServer = false, flags = emptyList(), threads = emptyList(), loadable = dev.jeromeswannack.chineselearning.lab.data.platform.Loadable(offline = true)),
            CardHubActions(),
            nowMs = now,
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shootInShell("decks-19-unfolded", TabId.MORE) { DecksTabScreen(DecksSamples.list, DecksActions()) }

    @Test fun dark() = shootInShell("decks-20-dark", TabId.MORE, dark = true) { DecksTabScreen(DecksSamples.list, DecksActions()) }

    @Test fun deckDark() = shoot("decks-21-deck-page-dark", dark = true) { DeckScreen(DecksSamples.deck, DeckActions()) }
}
