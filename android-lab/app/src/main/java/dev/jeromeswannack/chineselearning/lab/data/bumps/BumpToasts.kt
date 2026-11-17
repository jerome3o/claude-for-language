package dev.jeromeswannack.chineselearning.lab.data.bumps

import dev.jeromeswannack.chineselearning.lab.core.OpenLinks

/**
 * Where a "⚡ … added to today" toast's "Open ›" goes (core OpenLinks, docs/STUDY_SESSION.md "Open ›").
 * Every ⚡ goes through [BumpStore.bumpNotes], whose toast LINE travels to the sheets as a plain String
 * (`BumpHanzi`, the explorer's / word sheets' `bumped` text); the line's link is kept here by that text, so
 * a sheet shows "Open ›" next to the very line it shows ([ui.bumps.BumpedNotice]) without every bump
 * lambda in the app changing its type. The last few lines only — a toast is shown right after its tap.
 */
object BumpToasts {
    private const val KEEP = 16
    private val links = LinkedHashMap<String, OpenLinks.Link>()

    @Synchronized
    fun remember(message: String, link: OpenLinks.Link?) {
        links.remove(message)
        if (link == null) return
        links[message] = link
        while (links.size > KEEP) links.remove(links.keys.first())
    }

    @Synchronized
    fun linkFor(message: String?): OpenLinks.Link? = message?.let { links[it] }
}
