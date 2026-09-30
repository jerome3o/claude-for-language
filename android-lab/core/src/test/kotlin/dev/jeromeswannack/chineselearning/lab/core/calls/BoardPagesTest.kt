package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Board pages: the page reducer (following, summon, delete, rejoin) and the room messages. */
class BoardPagesTest {
    private fun p(id: String, title: String? = null) = BoardPageMeta(id, title)
    private val abc = listOf(p("a"), p("b"), p("c"))

    /** I'm on [mine], the other person (client "o") on [theirs]. */
    private fun state(mine: String = "a", theirs: String = "a", following: Boolean = false) =
        BoardPagesState(pages = abc, current = mine, opening = "a", views = mapOf("o" to theirs), other = "o", following = following)

    // ------------------------------------------------------------ welcome / rejoin

    @Test fun firstWelcomeShowsTheOpeningPage() {
        val s = BoardPages.welcome(BoardPagesState(), abc, "c", mapOf("o" to "b"), rejoin = false, other = "o")
        assertEquals("c", s.state.current)
        assertEquals("c", s.state.opening)
        assertEquals("b", s.state.otherPage)
        assertTrue(s.loadWelcomeText)
        assertTrue(s.effects.isEmpty())
    }

    @Test fun olderRoomHasNoPages() {
        val s = BoardPages.welcome(BoardPagesState(), emptyList(), null, emptyMap(), rejoin = false, other = null)
        assertNull(s.state.current)
        assertTrue(s.loadWelcomeText)
        assertNull(BoardPages.followBar(s.state, "Minghui"))
    }

    @Test fun rejoinGoesBackToMyPage() {
        val prev = state(mine = "b")
        val s = BoardPages.welcome(prev, abc, "a", emptyMap(), rejoin = true, other = null)
        assertEquals(listOf<PageEffect>(PageEffect.Open("b")), s.effects)
        assertFalse(s.loadWelcomeText, "the welcome's text is the opening page's, not mine")
        assertEquals("b", s.state.shown)
    }

    @Test fun rejoinOnTheOpeningPageOrADeletedPageLoadsTheWelcome() {
        val same = BoardPages.welcome(state(mine = "a"), abc, "a", emptyMap(), rejoin = true, other = null)
        assertTrue(same.loadWelcomeText); assertTrue(same.effects.isEmpty())
        val gone = BoardPages.welcome(state(mine = "b"), listOf(p("a"), p("c")), "a", emptyMap(), rejoin = true, other = null)
        assertTrue(gone.loadWelcomeText); assertTrue(gone.effects.isEmpty())
        assertEquals("a", gone.state.current)
    }

    @Test fun followingSurvivesARejoinButNotANewCall() {
        val s = BoardPages.welcome(state(following = true), abc, "a", mapOf("o2" to "c"), rejoin = true, other = "o2")
        assertTrue(s.state.following)
        assertEquals(listOf<PageEffect>(PageEffect.Open("c")), s.effects)
        assertFalse(BoardPages.welcome(state(following = true), abc, "a", emptyMap(), rejoin = false, other = null).state.following)
    }

    // ------------------------------------------------------------ views / following

    @Test fun followBar() {
        assertNull(BoardPages.followBar(state(theirs = "a"), "Minghui"), "same page: no bar")
        assertEquals(FollowBar("Minghui is on page 3", following = false), BoardPages.followBar(state(theirs = "c"), "Minghui"))
        assertEquals(FollowBar("Following Minghui", following = true), BoardPages.followBar(state(theirs = "a", following = true), "Minghui"))
        assertNull(BoardPages.followBar(state().copy(other = null), "Minghui"), "nobody else here")
        assertNull(BoardPages.followBar(state(theirs = "zz"), "Minghui"), "a page I don't know")
    }

    @Test fun followingJumpsWhenTheyTurn() {
        val s = BoardPages.pageView(state(following = true), "o", "b")
        assertEquals(listOf<PageEffect>(PageEffect.Open("b")), s.effects)
        assertEquals("b", s.state.shown)
        // Not following: only where they are changes.
        val t = BoardPages.pageView(state(), "o", "b")
        assertTrue(t.effects.isEmpty())
        assertEquals("b", t.state.otherPage)
        assertEquals("a", t.state.shown)
        // Someone else's view never moves me.
        assertTrue(BoardPages.pageView(state(following = true), "x", "c").effects.isEmpty())
    }

    @Test fun followOnJumpsNowAndTurningAPageStopsIt() {
        val on = BoardPages.setFollowing(state(theirs = "c"), true)
        assertTrue(on.state.following)
        assertEquals(listOf<PageEffect>(PageEffect.Open("c")), on.effects)
        val turned = BoardPages.turnTo(BoardPages.docLoaded(on.state, "c"), "b")
        assertFalse(turned.state.following)
        assertEquals(listOf<PageEffect>(PageEffect.Open("b")), turned.effects)
        assertFalse(BoardPages.madePage(state(following = true)).following)
        assertFalse(BoardPages.setFollowing(state(following = true), false).state.following)
    }

    @Test fun goThereKeepsFollowingAsItWas() {
        val s = BoardPages.goThere(state(theirs = "c"))
        assertEquals(listOf<PageEffect>(PageEffect.Open("c")), s.effects)
        assertFalse(s.state.following)
        assertTrue(BoardPages.goThere(state(theirs = "a")).effects.isEmpty())
    }

    @Test fun tappingTheCurrentPageDoesNothing() {
        assertTrue(BoardPages.turnTo(state(), "a").effects.isEmpty())
        assertTrue(BoardPages.turnTo(state(), "nope").effects.isEmpty())
    }

    @Test fun requestedPageIsShownUntilItsDocArrives() {
        val s = BoardPages.turnTo(state(), "b").state
        assertEquals("a", s.current)
        assertEquals("b", s.shown)
        val loaded = BoardPages.docLoaded(s, "b")
        assertEquals("b", loaded.current)
        assertNull(loaded.requested)
        // A quick second tap: the first doc arrives, the second is still on its way.
        val twice = BoardPages.turnTo(s, "c").state
        assertEquals("c", BoardPages.docLoaded(twice, "b").shown)
    }

    @Test fun peersJoinOnTheOpeningPageAndLeave() {
        val s = BoardPages.peerJoined(BoardPagesState(pages = abc, current = "b", opening = "a"), "o2")
        assertEquals("a", s.views["o2"])
        assertEquals("o2", s.other)
        assertNull(BoardPages.peerLeft(s, "o2").views["o2"])
        // An announced view is kept.
        assertEquals("c", BoardPages.peerJoined(s.copy(views = mapOf("o3" to "c")), "o3").views["o3"])
    }

    // ------------------------------------------------------------ summon / delete / previews

    @Test fun summonBringsMeThereWithANotice() {
        val s = BoardPages.summoned(state(following = false), "Minghui", "c")
        assertEquals(listOf(PageEffect.Open("c"), PageEffect.Notice("Minghui brought you to page 3")), s.effects)
        assertTrue(BoardPages.summoned(state(), "Minghui", "gone").effects.isEmpty())
    }

    @Test fun deletedPageSendsMeToTheFallback() {
        val before = state(mine = "b", theirs = "b")
        val afterList = BoardPages.pagesChanged(before, listOf(p("a"), p("c")))
        assertEquals(mapOf("b" to 2), afterList.removedNumbers)
        val s = BoardPages.deleted(afterList, "b", "c", "Minghui", mine = false)
        assertEquals(listOf(PageEffect.Open("c"), PageEffect.Notice("Minghui deleted page 2")), s.effects)
        assertEquals("c", s.state.otherPage, "they were on it too")
        assertEquals("c", s.state.shown)
        // I deleted it myself: no notice.
        assertEquals(listOf<PageEffect>(PageEffect.Open("c")), BoardPages.deleted(afterList, "b", "c", "Me", mine = true).effects)
        // Someone deleted a page I'm not on.
        assertTrue(BoardPages.deleted(BoardPages.pagesChanged(state(), listOf(p("a"), p("b"))), "c", "b", "Minghui", mine = false).effects.isEmpty())
    }

    @Test fun deletingTheOpeningPageMovesTheOpening() {
        val s = BoardPages.deleted(BoardPages.pagesChanged(state(mine = "b"), listOf(p("b"), p("c"))), "a", "b", "M", mine = false)
        assertEquals("b", s.state.opening)
    }

    @Test fun previewsUpdateTheThumbnail() {
        val s = BoardPages.preview(state(), "b", "你好", 2, 99)
        assertEquals(BoardPageMeta("b", preview = "你好", chars = 2, updatedAt = 99), s.pages[1])
    }

    // ------------------------------------------------------------ the text board across pages

    @Test fun opsGoOutTaggedWithTheirPageAndAreResentOnARejoin() {
        val out = ArrayList<String>()
        var open = true
        val b = CallTextBoard("u", { m -> if (open) { out += m; true } else false }, "r")
        b.load(null, emptyList(), "p1")
        b.localEdit("你")
        assertEquals(JsonPrimitive("p1"), o(out.last())["page"])
        // Turn to p2 (no rejoin): p1's op is not sent again.
        out.clear()
        b.load(null, emptyList(), "p2", resendOthers = false)
        assertTrue(out.isEmpty())
        assertEquals("p2", b.page)
        open = false
        b.localEdit("好") // lost with the socket
        open = true
        // Rejoin: the welcome is p1's page; everything unconfirmed goes out tagged with its own page.
        b.load(null, emptyList(), "p1", resendOthers = true)
        val pages = out.map { (o(it)["page"] as JsonPrimitive).content }
        assertEquals(setOf("p1", "p2"), pages.toSet())
        assertEquals("你", b.text)
    }

    @Test fun switchingPageMidCompositionDropsIt() {
        val b = CallTextBoard("u", { true }, "r")
        b.load(null, emptyList(), "p1")
        b.setComposing(true)
        b.applyRemote(emptyList())
        b.load(null, emptyList(), "p2", resendOthers = false)
        assertFalse(b.composing)
    }

    private fun o(s: String) = Json.parseToJsonElement(s) as JsonObject
}
