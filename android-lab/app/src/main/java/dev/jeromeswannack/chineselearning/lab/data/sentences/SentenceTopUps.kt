package dev.jeromeswannack.chineselearning.lab.data.sentences

import android.content.SharedPreferences
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import kotlinx.coroutines.CancellationException

/**
 * The Sentence round's asks for more sentences (the web's `requestMoreSentences` / `flushPendingTopUps` in
 * frontend/src/services/sentencePractice.ts; what to ask in core [SentenceHistory.moreWanted]; docs/STUDY_SESSION.md
 * "Fresh sentences first"): a word asks at most once per [SentenceHistory.TOPUP_RETRY_MS] (one top-up in flight —
 * the round re-checks after every take, so this guard is what dedupes), offline (or a failed ask) waits as
 * PENDING for the next sync. Kept in [prefs]: `asked:<note>` = epoch ms of the last ask, `pending:<note>` =
 * "<reason>:<count>". Pure bookkeeping — the posting is the caller's ([SentencePracticeStore]).
 */
class SentenceTopUps(private val prefs: SharedPreferences, private val now: () -> Long = System::currentTimeMillis) {
    /** One ask: [reason] "few" | "fresh", [count] sentences to make. */
    data class Want(val reason: String, val count: Int)

    enum class Decision {
        /** Asked within the last ten minutes, or already waiting for a connection. */
        SKIP,
        /** Post it now (marked asked). */
        SEND,
        /** Offline: kept for the next sync. */
        QUEUE,
    }

    private fun askedAt(noteId: String): Long? = prefs.getLong(ASKED + noteId, -1L).takeIf { it >= 0 }

    /** This word asked within [SentenceHistory.TOPUP_RETRY_MS]. */
    fun askedRecently(noteId: String): Boolean = askedAt(noteId)?.let { now() - it < SentenceHistory.TOPUP_RETRY_MS } == true

    /** The asks waiting for a connection (only "few" / "fresh" ones; anything else is dropped by [flush]). */
    fun pending(): Map<String, Want> = prefs.all.entries
        .filter { it.key.startsWith(PENDING) }
        .mapNotNull { (k, v) -> parse(v as? String)?.let { k.removePrefix(PENDING) to it } }
        .toMap()

    /** Decide (and record) one ask for [noteId]. */
    @Synchronized
    fun claim(noteId: String, want: Want, online: Boolean): Decision {
        if (askedRecently(noteId) || prefs.contains(PENDING + noteId)) return Decision.SKIP
        val edit = prefs.edit()
        pruneAsked(edit)
        return if (online) {
            edit.putLong(ASKED + noteId, now()).apply()
            Decision.SEND
        } else {
            edit.putString(PENDING + noteId, format(want)).apply()
            Decision.QUEUE
        }
    }

    /** The post of a [Decision.SEND] failed: wait for the next sync. */
    @Synchronized
    fun failed(noteId: String, want: Want) {
        prefs.edit().putString(PENDING + noteId, format(want)).apply()
    }

    /**
     * The sync step: the waiting asks, one post per reason ("few" first, ≤ 50 notes each) with their counts; the
     * sent ones are marked asked. An entry of another shape is dropped (the round asks again when it opens).
     * Returns the notes sent.
     */
    suspend fun flush(post: suspend (noteIds: List<String>, reason: String, counts: Map<String, Int>) -> Unit): List<String> {
        val entries = prefs.all.entries.filter { it.key.startsWith(PENDING) }.map { it.key.removePrefix(PENDING) to parse(it.value as? String) }
        if (entries.isEmpty()) return emptyList()
        val sent = ArrayList<String>()
        for (reason in REASONS) {
            val batch = entries.filter { it.second?.reason == reason }.take(BATCH)
            if (batch.isEmpty()) continue
            try {
                post(batch.map { it.first }, reason, batch.associate { (id, w) -> id to w!!.count })
                val at = now()
                synchronized(this) {
                    val edit = prefs.edit()
                    for ((id) in batch) edit.remove(PENDING + id).putLong(ASKED + id, at)
                    edit.apply()
                }
                sent += batch.map { it.first }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The next sync.
            }
        }
        val junk = entries.filter { it.second == null }
        if (junk.isNotEmpty()) synchronized(this) { prefs.edit().apply { junk.forEach { remove(PENDING + it.first) } }.apply() }
        return sent
    }

    /** Only recent asks are worth keeping. */
    private fun pruneAsked(edit: SharedPreferences.Editor) {
        val cutoff = now() - SentenceHistory.TOPUP_RETRY_MS
        for ((k, v) in prefs.all) if (k.startsWith(ASKED) && (v as? Long ?: Long.MIN_VALUE) <= cutoff) edit.remove(k)
    }

    companion object {
        const val PREFS = "lab-sentence-topups-v2"
        private const val ASKED = "asked:"
        private const val PENDING = "pending:"
        private const val BATCH = 50
        private val REASONS = listOf("few", "fresh")

        private fun format(w: Want) = "${w.reason}:${w.count}"
        private fun parse(v: String?): Want? {
            val (reason, count) = v?.split(':')?.takeIf { it.size == 2 } ?: return null
            if (reason !in REASONS) return null
            return Want(reason, count.toIntOrNull() ?: return null)
        }
    }
}
