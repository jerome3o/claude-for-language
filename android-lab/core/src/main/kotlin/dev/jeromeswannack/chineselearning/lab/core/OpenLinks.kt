package dev.jeromeswannack.chineselearning.lab.core

/**
 * "Open ›" on a toast — port of shared/decks/open-links.ts (docs/STUDY_SESSION.md "Open ›: one tap to
 * what just happened"): "✓ Added to From readers · Change" opens the card (one note) or the deck (several);
 * "⚡ … added to today" opens the card (one word) or Up next (several). Parity-tested in
 * parity/fixtures/study-today.ts. [path] = the app path (the Lab navigates by the web's paths).
 */
object OpenLinks {
    /** [kind] added | bumped (analytics `nav.toast_open`), [target] card | deck | up_next, [id] null for Up next. */
    data class Link(val kind: String, val target: String, val id: String?, val path: String, val label: String, val aria: String)

    const val LABEL = "Open"

    private fun enc(s: String) = Js.encodeURIComponent(s)

    private fun clean(ids: List<String?>): List<String> {
        val out = ArrayList<String>()
        for (raw in ids) {
            val id = raw?.trim().orEmpty()
            if (id.isNotEmpty() && id !in out) out += id
        }
        return out
    }

    /** `addedToDeckOpenLink`. */
    fun addedToDeck(noteIds: List<String?>, deckId: String?, deckName: String?, hanzi: String? = null): Link? {
        val ids = clean(noteIds)
        if (ids.isEmpty()) return null
        if (ids.size == 1) {
            val what = hanzi?.trim().orEmpty()
            return Link("added", "card", ids[0], "/cards/${enc(ids[0])}", LABEL, "Open the card" + (if (what.isNotEmpty()) " $what" else ""))
        }
        val deck = deckId?.trim().orEmpty()
        if (deck.isEmpty()) return null
        val name = deckName?.trim().orEmpty()
        return Link("added", "deck", deck, "/decks/${enc(deck)}", LABEL, "Open the deck" + (if (name.isNotEmpty()) " $name" else "") + " with the new cards")
    }

    /** `studyTodayOpenLink`: [notes] = (note id, hanzi). */
    fun studyToday(notes: List<Pair<String?, String?>>): Link? {
        val ids = clean(notes.map { it.first })
        if (ids.isEmpty()) return null
        if (ids.size == 1) {
            val what = notes.firstOrNull { it.first?.trim() == ids[0] }?.second?.trim().orEmpty()
            return Link("bumped", "card", ids[0], "/cards/${enc(ids[0])}", LABEL, "Open the card" + (if (what.isNotEmpty()) " $what" else ""))
        }
        return Link("bumped", "up_next", null, "/up-next", LABEL, "See today’s study list")
    }
}
