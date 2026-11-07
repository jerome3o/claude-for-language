package dev.jeromeswannack.chineselearning.lab.ui.nav

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.MainActivity
import dev.jeromeswannack.chineselearning.lab.shell.ShellLinks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Links from outside the app reach only a short allowlist; the app's own links (internal alias) reach anything. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ExternalLinksTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private fun external(link: String) = ExternalLinks.safePath(deepLinkPath(Uri.parse(link)))

    @Test fun launcherShortcutsStillOpen() {
        assertEquals("/study", external("chineselearning-lab:///study"))
        assertEquals("/coach", external("chineselearning-lab:///coach"))
        assertEquals("/analyze", external("chineselearning-lab:///analyze"))
        assertEquals("/", external("chineselearning-lab:///"))
        assertEquals("/study", external("chineselearning-lab://study"))
        assertEquals("/study", ExternalLinks.safePath("/study/"))
    }

    @Test fun anythingElseOpensHome() {
        for (link in listOf(
            "chineselearning-lab:///decks/abc",
            "chineselearning-lab:///calls/c1",
            "chineselearning-lab:///settings",
            "chineselearning-lab:///join/token",
            "chineselearning-lab:///chats/claude/new?text=hi&intent=ask",
            "chineselearning-lab:///connections/r1/chat/c1",
            "chineselearning-lab:///homework/a1",
            "chineselearning-lab:///study/../settings",
            "chineselearning-lab:///studyx",
            "chineselearning-lab:///%2Fsettings",
        )) assertEquals(link, "/", external(link))
        assertEquals("/", ExternalLinks.safePath(null))
        assertEquals("/", ExternalLinks.safePath(""))
        assertEquals("/", ExternalLinks.safePath("settings"))
    }

    @Test fun onlyTheNeededQueryParametersSurvive() {
        // The widget-style focus is fine; text / action would start a Claude call from a link.
        assertEquals("/coach?focus=1", external("chineselearning-lab:///coach?focus=1"))
        assertEquals("/coach", external("chineselearning-lab:///coach?text=hello&action=translate"))
        assertEquals("/coach?focus=1", external("chineselearning-lab:///coach?text=hi&focus=1&focus=1"))
        assertEquals("/coach", external("chineselearning-lab:///coach?focus=0"))
        assertEquals("/study", external("chineselearning-lab:///study?deck=abc"))
        assertEquals("/", ExternalLinks.safePath("/?next=/settings"))
        assertEquals("/coach", ExternalLinks.safePath("/coach#x?focus=1"))
    }

    @Test fun theAppsOwnLinksAreInternal() {
        val own = ShellLinks.intent(context, "/calls/c1")
        assertTrue(ShellLinks.isInternal(own, context.packageName))
        assertEquals("/calls/c1", deepLinkPath(own.data!!))
        assertTrue(ShellLinks.isInternal(ShellLinks.viewIntent(context, "/audio-lessons/a"), context.packageName))
    }

    @Test fun anIntentToTheExportedActivityIsExternal() {
        val forged = Intent(Intent.ACTION_VIEW, Uri.parse("chineselearning-lab:///calls/c1"), context, MainActivity::class.java)
        assertFalse(ShellLinks.isInternal(forged, context.packageName))
        assertFalse(ShellLinks.isInternal(Intent(Intent.ACTION_VIEW, Uri.parse("chineselearning-lab:///calls/c1")), context.packageName))
        // Another app can't claim the alias of ours.
        val other = Intent().setComponent(ComponentName("evil.app", ShellLinks.INTERNAL_LINK_CLASS))
        assertFalse(ShellLinks.isInternal(other, context.packageName))
        assertFalse(ShellLinks.isInternal(null, context.packageName))
    }

    @Test fun theInternalAliasIsNotExported() {
        val info = context.packageManager.getActivityInfo(ComponentName(context.packageName, ShellLinks.INTERNAL_LINK_CLASS), 0)
        assertFalse(info.exported)
        assertEquals(MainActivity::class.java.name, info.targetActivity)
    }
}
