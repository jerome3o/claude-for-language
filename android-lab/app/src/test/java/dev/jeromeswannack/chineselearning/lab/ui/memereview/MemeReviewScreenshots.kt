package dev.jeromeswannack.chineselearning.lab.ui.memereview

import androidx.compose.foundation.lazy.rememberLazyListState
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeCovers
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssue
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssueSummary
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeItem
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeLessonJob
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeLine
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeMedia
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeOrigin
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeQuizQuestion
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeRegister
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeSayIt
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeSource
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/** 梗 Meme review (prototype): `meme-review-*.png` → docs/pr-screenshots/meme-review-prototype/lab-*.png. */
class MemeReviewScreenshots : LabScreenshotTest() {
    private fun item(id: String, hanzi: String, pinyin: String, english: String, verdict: String = "fine") = MemeItem(
        id = id, hanzi = hanzi, pinyin = pinyin, english = english,
        meaning = MemeLine("意思是“时髦不时髦”“洋气不洋气”。大家用它开玩笑地问一个地方酷不酷。", "yìsi shì “shímáo bù shímáo”“yángqì bù yángqì”.", "It means “trendy or not”. People use it to jokingly ask whether a place is cool."),
        origin = MemeOrigin("From a foreign travel vlogger asking “City不City?” in his videos about Chinese cities; it spread on Douyin and Bilibili.", "mid-2024", "high"),
        examples = listOf(
            MemeLine("这家咖啡店好City啊！", "zhè jiā kāfēidiàn hǎo City a!", "This café is so cool!"),
            MemeLine("周末去爬山，City不City？", "zhōumò qù pá shān, City bù City?", "Hiking this weekend — cool or not?"),
        ),
        register = MemeRegister("Everyone online, Gen Z first", "Playful, teasing", "both", false, "Often answered with “太City了！”."),
        say_it = MemeSayIt(verdict, "Coming from a foreigner it lands as a fun in-joke."),
        related = listOf(MemeLine("洋气", "yángqì", "stylish")),
        sources = listOf(MemeSource("https://baike.baidu.com/item/x", "City不City · 百度百科", "baidu")),
        media = listOf(
            MemeMedia("https://www.bilibili.com/video/BV1", "“City不City”原视频合集", "bilibili", "video"),
            MemeMedia("https://www.youtube.com/watch?v=abc", "City不City compilation", "youtube", "video", "https://img.youtube.com/vi/abc/hqdefault.jpg"),
        ),
    )

    private val issue = MemeIssue(
        month = "2026-10",
        title = "十月梗回顾",
        title_en = "October on the Chinese internet",
        intro = MemeLine("这个月网上大家都在说什么？我们一起看看。", "zhège yuè wǎngshàng dàjiā dōu zài shuō shénme? wǒmen yìqǐ kànkan.", "What was everyone saying online this month? Let’s have a look."),
        covers = MemeCovers("2026-08-23", "2026-10-18"),
        items = listOf(
            item("m1", "City不City", "City bù City", "Is it cool / cosmopolitan?", "cute"),
            item("m2", "搭子", "dāzi", "An activity buddy"),
            item("m3", "班味", "bānwèi", "Office-worker vibe (tired)"),
            item("m4", "显眼包", "xiǎnyǎnbāo", "A show-off / attention magnet", "cringe"),
        ),
        quiz = listOf(
            MemeQuizQuestion("“这家店好City啊！” means…", listOf("This shop is really cool!", "This shop is in the city centre.", "This shop is very expensive."), 0, "City here is an adjective: trendy.", "m1"),
            MemeQuizQuestion("Your 饭搭子 is…", listOf("your cook", "someone you regularly eat with", "your best friend"), 1, "A 搭子 is a buddy for one activity.", "m2"),
            MemeQuizQuestion("Which one describes someone tired from work?", listOf("松弛感", "显眼包", "班味"), 2, "班味 = the office-worn look.", "m3"),
        ),
    )

    private val listUi = MemeListUi(
        loading = false,
        issues = listOf(
            MemeIssueSummary("2026-10", "ready", "十月梗回顾", "October on the Chinese internet", 8, listOf("City不City", "搭子", "班味", "显眼包")),
            MemeIssueSummary("2026-09", "ready", "九月梗回顾", "September", 7, listOf("情绪价值", "松弛感", "牛马", "i人")),
        ),
        onPhone = setOf("2026-10"),
        currentMonth = "2026-10",
    )

    private fun ready(vararg patch: (MemeIssueUi) -> MemeIssueUi): MemeIssueUi {
        var ui = MemeIssueUi("2026-10", MemeIssueState.Ready(issue), picked = issue.quiz.map { null })
        for (p in patch) ui = p(ui)
        return ui
    }

    @Test fun list() = shoot("meme-review-01-list") { MemeReviewListScreen(listUi, MemeListActions(onBack = {})) }

    @Test fun listAdmin() = shoot("meme-review-02-list-admin") {
        MemeReviewListScreen(MemeListUi(loading = false, canGenerate = true, currentMonth = "2026-11", issues = listUi.issues), MemeListActions(onBack = {}))
    }

    @Test fun listDark() = shoot("meme-review-03-list-dark", dark = true) { MemeReviewListScreen(listUi, MemeListActions(onBack = {})) }

    @Test fun issue() = shoot("meme-review-04-issue") { MemeIssueScreen(ready({ it.copy(stats = "Admin: 14 model calls · 25 searches · 8 pictures · ≈ $1.92") }), MemeIssueActions()) }

    @Test fun expanded() = shoot("meme-review-05-expanded") {
        MemeIssueScreen(ready({ it.copy(openId = "m1", english = setOf("m1")) }), MemeIssueActions(), rememberLazyListState(initialFirstVisibleItemIndex = 1))
    }

    @Test fun expandedLower() = shoot("meme-review-06-expanded-links") {
        MemeIssueScreen(ready({ it.copy(openId = "m1", cards = mapOf("m1" to "Slang")) }), MemeIssueActions(), rememberLazyListState(initialFirstVisibleItemIndex = 1, initialFirstVisibleItemScrollOffset = 1400))
    }

    @Test fun expandedDark() = shoot("meme-review-07-expanded-dark", dark = true) {
        MemeIssueScreen(ready({ it.copy(openId = "m4") }), MemeIssueActions(), rememberLazyListState(initialFirstVisibleItemIndex = 4))
    }

    @Test fun quiz() = shoot("meme-review-08-quiz") {
        MemeIssueScreen(ready({ it.copy(picked = listOf(0, 2, 2)) }), MemeIssueActions(), rememberLazyListState(initialFirstVisibleItemIndex = 5))
    }

    @Test fun lesson() = shoot("meme-review-09-lesson") {
        MemeIssueScreen(ready({ it.copy(lesson = MemeLessonJob("j1", "2026-10", "ready", "l1")) }), MemeIssueActions(), rememberLazyListState(initialFirstVisibleItemIndex = 6))
    }

    @Test fun generating() = shoot("meme-review-10-generating") {
        MemeIssueScreen(MemeIssueUi("2026-11", MemeIssueState.Generating("Researching… (12 searches)")), MemeIssueActions())
    }
}
