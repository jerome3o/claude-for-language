package dev.jeromeswannack.chineselearning.lab.ui.idioms

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomSummary
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.explorer.MyWord
import dev.jeromeswannack.chineselearning.lab.ui.explorer.WordView
import dev.jeromeswannack.chineselearning.lab.ui.explorer.WordViewActions
import dev.jeromeswannack.chineselearning.lab.ui.explorer.WordViewUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** 成语 Idioms (beta): `idioms-*.png` → docs/pr-screenshots/chengyu-explorer/lab-*.png. */
class IdiomsScreenshots : LabScreenshotTest() {
    private val entry = IdiomSamples.sample

    private fun listUi() = IdiomsUi(
        starter = IdiomsUi().starter.map { if (it.hanzi in setOf("画蛇添足", "守株待兔", "一举两得")) it.copy(status = "ready") else it },
        opened = listOf(IdiomSummary("多此一举", "duō cǐ yì jǔ", "do something superfluous", "ready")),
        onDevice = setOf("画蛇添足", "守株待兔", "一举两得", "多此一举"),
    )

    private fun ready(vararg patch: (IdiomUi) -> IdiomUi): IdiomUi {
        var ui = IdiomUi("画蛇添足", IdiomState.Ready(entry), picked = entry.quiz.map { null }, card = IdiomCard("", ""), cardLoaded = true)
        for (p in patch) ui = p(ui)
        return ui
    }

    @Test fun list() = shoot("idioms-01-list") { IdiomsScreen(listUi(), IdiomsActions(onBack = {})) }

    @Test fun listDark() = shoot("idioms-02-list-dark", dark = true) { IdiomsScreen(listUi(), IdiomsActions(onBack = {})) }

    @Test fun listOffline() = shoot("idioms-03-list-offline") {
        IdiomsScreen(listUi().copy(online = false, query = "画蛇添脚"), IdiomsActions(onBack = {}))
    }

    @Test fun page() = shoot("idioms-04-page") { IdiomScreen(ready(), IdiomActions()) }

    @Test fun pageDark() = shoot("idioms-05-page-dark", dark = true) { IdiomScreen(ready(), IdiomActions()) }

    @Test fun story() = shoot("idioms-06-story-english") {
        IdiomScreen(ready({ it.copy(showEnglish = true, playing = "story:1") }), IdiomActions(), rememberLazyListState(initialFirstVisibleItemIndex = 2))
    }

    @Test fun usage() = shoot("idioms-07-usage") {
        IdiomScreen(ready({ it.copy(revealed = mapOf(0 to 3, 1 to 1)) }), IdiomActions(), rememberLazyListState(initialFirstVisibleItemIndex = 3))
    }

    @Test fun tryIt() = shoot("idioms-08-try-it") {
        IdiomScreen(ready({ it.copy(picked = listOf(0, 2)) }), IdiomActions(), rememberLazyListState(initialFirstVisibleItemIndex = 5))
    }

    @Test fun tryItDark() = shoot("idioms-09-try-it-dark", dark = true) {
        IdiomScreen(ready({ it.copy(picked = listOf(0, 0), card = IdiomCard("n1", "成语"), bumped = "⚡ 画蛇添足 is in today's study") }), IdiomActions(), rememberLazyListState(initialFirstVisibleItemIndex = 5))
    }

    @Test fun generating() = shoot("idioms-10-generating") { IdiomScreen(IdiomUi("守株待兔", IdiomState.Generating), IdiomActions()) }

    @Test fun notIdiom() = shoot("idioms-11-not-idiom") {
        IdiomScreen(IdiomUi("画蛇添脚", IdiomState.NotIdiom("This is not a set expression.", "画蛇添足")), IdiomActions())
    }

    @Test fun lowConfidence() = shoot("idioms-12-caution") {
        IdiomScreen(ready({ it.copy(state = IdiomState.Ready(entry.copy(confidence = "medium", confidence_note = "Sources differ on which state the story is set in."))) }), IdiomActions())
    }

    @Composable
    private fun sheet(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 12.dp)) { content() }
        }
    }

    /** The explorer's Word view of a 成语: "📜 Story & usage" under the head. */
    @Test fun explorerLink() = shoot("idioms-13-explorer-link") {
        sheet {
            WordView(
                WordViewUi(ExplorerItem.Word("画蛇添足", "huà shé tiān zú", "to ruin something by adding what isn’t needed"), lookup = WordDict.Lookup.Offline, mine = MyWord()),
                listOf(ExplorerItem.Word("画蛇添足")),
                canOpenCard = true,
                canBump = true,
                actions = WordViewActions(onIdiom = {}),
            )
        }
    }
}
