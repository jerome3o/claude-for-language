package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import org.junit.Test
import org.robolectric.annotation.Config

class CallsScreenshots : LabScreenshotTest() {
    @Test fun list() = shootInShell("calls-01-list", active = TabId.MORE) {
        CallsListScreen(CallsListUi(calls = Loadable(CallsSamples.list), people = CallsSamples.people), CallsListActions(onBack = {}))
    }

    @Test fun listEmptyOffline() = shoot("calls-02-list-empty-offline") {
        CallsListScreen(CallsListUi(calls = Loadable(emptyList(), offline = true, updatedAt = CallsSamples.T0), people = emptyList(), online = false), CallsListActions(onBack = {}))
    }

    @Test fun review() = shoot("calls-03-review") { CallReviewScreen(CallsSamples.reviewUi(), CallReviewActions()) }

    @Config(qualifiers = "w412dp-h2600dp-xxhdpi")
    @Test fun reviewWhole() = shoot("calls-04-review-whole") { CallReviewScreen(CallsSamples.reviewUi().copy(playingId = "s03"), CallReviewActions()) }

    @Config(qualifiers = "w412dp-h1400dp-xxhdpi")
    @Test fun processingTutor() = shoot("calls-05-review-processing-homework") {
        CallReviewScreen(CallsSamples.reviewUi(CallsSamples.processing, homework = CallHomeworkUi("r1", "李明"), pending = 3), CallReviewActions())
    }

    @Config(qualifiers = "w412dp-h1300dp-xxhdpi")
    @Test fun homeworkRunning() = shoot("calls-06-review-homework-running") {
        CallReviewScreen(
            CallsSamples.reviewUi(CallsSamples.detail.copy(report = null), homework = CallHomeworkUi("r1", "李明", jobs = listOf(CallsSamples.homeworkJob))),
            CallReviewActions(),
        )
    }

    @Test fun cardsAdded() = shoot("calls-07-cards-added", dark = true) {
        CallReviewScreen(CallsSamples.reviewUi().copy(cardsResult = CardsResult("d9", 4, 0)), CallReviewActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun reviewUnfolded() = shoot("calls-08-review-unfolded") { CallReviewScreen(CallsSamples.reviewUi(), CallReviewActions()) }
}
