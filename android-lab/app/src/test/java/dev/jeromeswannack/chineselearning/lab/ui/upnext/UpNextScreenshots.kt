package dev.jeromeswannack.chineselearning.lab.ui.upnext

import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import org.junit.Test
import org.robolectric.annotation.Config

/** "Up next" (web pages/UpNextPage.tsx): the list with ⚡ Today, search + a result dragged into place, the tutor's view, Home. */
class UpNextScreenshots : LabScreenshotTest() {
    private val rows = listOf(
        UpNextRowUi("n1", "银行", "yínháng", "bank", "HSK 2", "New word"),
        UpNextRowUi("n2", "医院", "yīyuàn", "hospital", "HSK 2", "New word"),
        UpNextRowUi("n3", "图书馆", "túshūguǎn", "library", "HSK 2", "New word", addedBy = "Minghui"),
        UpNextRowUi("n4", "米饭", "mǐfàn", "cooked rice", "Food", "Started · 2 new cards left"),
    )
    private val today = listOf(UpNextTodayUi("t1", "面条", "miàntiáo", "noodles", "Food"))
    private val hits = listOf(
        UpNextHitUi("h1", "火车站", "huǒchēzhàn", "railway station", "HSK 2"),
        UpNextHitUi("h2", "火锅", "huǒguō", "hotpot", "Food"),
        UpNextHitUi("h3", "火车", "huǒchē", "train", "HSK 1", studied = true),
    )

    @Test fun list() = shootInShell("upnext-01-list", active = TabId.MORE) {
        UpNextScreen(UpNextUi(rows = rows, today = today), UpNextActions(onBack = {}))
    }

    @Test fun searchAndDrag() = shootInShell("upnext-02-drag-a-result", active = TabId.MORE) {
        UpNextScreen(
            UpNextUi(rows = rows, query = "huoche", hits = hits.take(1)),
            UpNextActions(onBack = {}),
            previewOrder = listOf("n1", "h1", "n2", "n3", "n4"),
            previewDrag = "h1",
        )
    }

    @Test fun removedWithUndo() = shootInShell("upnext-03-undo", active = TabId.MORE) {
        UpNextScreen(UpNextUi(rows = rows.drop(1), toast = "Removed 银行 from Up next", toastUndo = true), UpNextActions(onBack = {}))
    }

    @Test fun empty() = shootInShell("upnext-04-empty", active = TabId.MORE) {
        UpNextScreen(UpNextUi(), UpNextActions(onBack = {}))
    }

    @Test fun tutorView() = shoot("upnext-05-tutor") {
        UpNextScreen(
            UpNextUi(
                title = "Jerome’s Up next",
                intro = "The words Jerome learns next: they take the first of Jerome’s daily new cards, in this order. Nothing is sent and nothing extra is added — only the order of Jerome’s own cards changes.",
                rows = rows.map { if (it.addedBy != null) it.copy(addedBy = "you") else it },
                learner = false,
                query = "火锅",
                hits = listOf(UpNextHitUi("h2", "火锅", "huǒguō", "hotpot", "Food")),
                searchPlaceholder = "Search Jerome’s cards…",
            ),
            UpNextActions(onBack = {}),
        )
    }

    @Test fun home() = shoot("upnext-06-home") {
        HomeScreen(
            ui = HomeUi(
                loaded = true, userName = "Jerome Swannack", due = QueueCounts(3, 2, 2, 17), reviewedToday = 12, bumped = 1,
                upNextCount = 4, upNextFirst = listOf("银行", "医院", "图书馆"),
                decks = listOf(
                    DeckSummary("d1", "HSK 2", 120, QueueCounts(3, 2, 2, 9)),
                    DeckSummary("d2", "Food", 24, QueueCounts(0, 0, 0, 6)),
                ),
            ),
            sync = SyncStatus(lastSyncAt = System.currentTimeMillis() - 120_000),
            online = true,
            actions = HomeActions(),
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("upnext-07-unfolded") {
        UpNextScreen(UpNextUi(rows = rows, today = today, query = "huo", hits = hits), UpNextActions(onBack = {}))
    }
}
