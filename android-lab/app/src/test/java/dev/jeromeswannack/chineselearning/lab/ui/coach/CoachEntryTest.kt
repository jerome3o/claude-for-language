package dev.jeromeswannack.chineselearning.lab.ui.coach

import android.net.Uri
import dev.jeromeswannack.chineselearning.lab.ui.chats.chatsCompose
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** `/coach` → the Chats tab (web pages/CoachEntry.tsx coachEntryTarget, case by case). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CoachEntryTest {
    private fun target(c: String? = null, text: String? = null, action: String? = null, draft: String? = null, fromMessage: String? = null, from: String? = null) =
        CoachEntry.target(c, text, action, draft, fromMessage, from)

    @Test fun theCoachIsTheChatsBox() {
        assertEquals("/chats?compose=1", target())
        assertEquals("/chats?compose=1", Routes.chatsCompose())
        // A coach conversation IS a thread (same id).
        assertEquals("/chats/claude/c%201", target(c = "c 1"))
        // Chinese without an action waits in the box; ?draft= too.
        assertEquals("/chats?compose=1&text=${Uri.encode("我昨天去了商店")}", target(text = " 我昨天去了商店 "))
        assertEquals("/chats?compose=1&text=${Uri.encode("我们走吧")}", target(draft = "我们走吧"))
    }

    @Test fun anActionOrEnglishStartsAThread() {
        val check = target(text = "我昨天去了商店", action = "check")!!
        assertEquals("/chats/claude/new?text=${Uri.encode("我昨天去了商店")}&intent=check&source=coach_link", check)
        // English can only be translated: at once.
        assertEquals("/chats/claude/new?text=${Uri.encode("I'm running late")}&intent=translate&source=coach_link", target(text = "I'm running late"))
    }

    @Test fun fromAChatMessageOrAStudyCardTheCoachStays() {
        assertNull(target(text = "我好", action = "check", fromMessage = "m1"))
        assertNull(target(text = "我好", action = "check", from = CoachEntry.CARD))
        assertNull(target(draft = "我们走吧", from = CoachEntry.CARD))
        // The Coach page's own conversations stay on it for that visit.
        assertNull(target(c = "c1", from = CoachEntry.COACH))
        assertEquals("/coach?c=c1&from=coach", Routes.coachConversation("c1"))
    }
}
