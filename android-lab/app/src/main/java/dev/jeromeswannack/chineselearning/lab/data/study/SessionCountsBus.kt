package dev.jeromeswannack.chineselearning.lab.data.study

import dev.jeromeswannack.chineselearning.lab.core.SessionCounts
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The study session's own numbers, published as they change (web services/sessionCounts.ts), so
 * Home paints them the moment Study is left — 0 after "All done" — instead of the counts it worked
 * out before the session; Home's own recount replaces them once done (core HomeCounts,
 * docs/STUDY_SESSION.md "Back on Home"). Process-wide: Home and Study are separate view models.
 */
object SessionCountsBus {
    private val _latest = MutableStateFlow<SessionCounts?>(null)
    val latest: StateFlow<SessionCounts?> = _latest.asStateFlow()

    fun publish(counts: SessionCounts) {
        _latest.value = counts
    }

    /** Tests: forget the last session. */
    fun clear() {
        _latest.value = null
    }
}
