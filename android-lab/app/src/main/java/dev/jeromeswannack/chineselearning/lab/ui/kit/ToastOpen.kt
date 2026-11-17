package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import dev.jeromeswannack.chineselearning.lab.core.OpenLinks
import dev.jeromeswannack.chineselearning.lab.core.claude.CardTools
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpToasts
import dev.jeromeswannack.chineselearning.lab.ui.claude.rememberResultAvailable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LocalLabNav

/*
 * "Open ›" on a toast (web components/nav/ToastOpen.tsx; docs/STUDY_SESSION.md "Open ›: one tap to what
 * just happened"): "✓ Added to From readers · Change" → the card / the deck, "⚡ … added to today" → the
 * card / Up next — ONE rule, core [OpenLinks]. A plain navigation by path, so back returns to the screen
 * he was on (the sheet's host keeps its state in the back stack).
 */

/** Test tag of a toast's "Open ›". */
const val TOAST_OPEN_TAG = "toast-open"

/** Where "Open ›" navigates when there is no app navigator (screenshots / UI tests record the path). */
val LocalToastNavigate = staticCompositionLocalOf<((String) -> Unit)?> { null }

/**
 * What "Open ›" does here, or null (no link, nowhere to navigate — previews —, or offline with the target
 * not on this phone). [before] runs first (a sheet over the screen closes itself).
 */
@Composable
fun rememberToastOpen(link: OpenLinks.Link?, surface: String, before: () -> Unit = {}): (() -> Unit)? {
    val nav = LocalLabNav.current
    val fallback = LocalToastNavigate.current
    val available = if (link != null) rememberResultAvailable(CardTools.Link(link.kind, link.target, link.id, link.path, link.label, link.aria)) else true
    if (link == null || !available) return null
    if (nav == null && fallback == null) return null
    return {
        if (nav != null) runCatching { nav.app.analytics.track("nav.toast_open", mapOf("kind" to link.kind, "target" to link.target, "surface" to surface)) }
        before()
        if (nav != null) nav.open(link.path) else fallback?.invoke(link.path)
    }
}

/** A "⚡ … added to today" line with its "Open ›" (the link kept by [BumpToasts] for that very line). */
@Composable
fun BumpedNotice(text: String, surface: String, modifier: Modifier = Modifier, before: () -> Unit = {}) {
    val link = BumpToasts.linkFor(text)
    val open = rememberToastOpen(link, surface, before)
    InlineNotice(
        text, modifier, kind = NoticeKind.Success,
        secondLabel = if (open != null) link!!.label else null,
        onSecond = open,
        secondDescription = link?.aria,
        secondTag = TOAST_OPEN_TAG,
    )
}
