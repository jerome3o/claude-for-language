package dev.jeromeswannack.chineselearning.lab.core.calls

/**
 * Port of shared/calls/transcript.ts. Each participant's microphone is recorded and
 * transcribed separately, so every segment already knows who spoke — merging is a sort
 * by time, not diarization. Parity-tested (CallsParityTest).
 */
object CallTranscript {
    /** What the transcript helpers need from a segment. */
    interface Segment {
        val id: String
        val userId: String
        val startMs: Long
        val endMs: Long
    }

    /** Port of mergeTranscript: both speakers' segments in speaking order (ties: earlier end first, then id). */
    fun <T : Segment> merge(segments: List<T>): List<T> =
        segments.sortedWith(compareBy<T> { it.startMs }.thenBy { it.endMs }.thenComparator { a, b -> localeCompare(a.id, b.id) })

    /** Port of groupTurns: consecutive segments by one speaker less than [gapMs] apart become one turn. */
    fun <T : Segment> groupTurns(merged: List<T>, gapMs: Long = 2500): List<List<T>> {
        val turns = ArrayList<MutableList<T>>()
        for (seg in merged) {
            val last = turns.lastOrNull()
            val prev = last?.lastOrNull()
            if (prev != null && prev.userId == seg.userId && seg.startMs - prev.endMs <= gapMs) last.add(seg) else turns += mutableListOf(seg)
        }
        return turns
    }

    /** Port of formatOffset: "4:05" / "1:02:09" for an offset in ms from the start of the call. */
    fun formatOffset(ms: Long): String {
        val total = maxOf(0L, Math.floorDiv(ms, 1000L))
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        val ss = s.toString().padStart(2, '0')
        return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$ss" else "$m:$ss"
    }

    /**
     * `a.localeCompare(b)` for the ids the server makes (hex / base64url): case-insensitive
     * first like ICU's root collation, then lower before upper. Ids only break exact ties.
     */
    internal fun localeCompare(a: String, b: String): Int {
        val ci = a.lowercase().compareTo(b.lowercase())
        if (ci != 0) return ci.coerceIn(-1, 1)
        for (i in 0 until minOf(a.length, b.length)) {
            val x = a[i]; val y = b[i]
            if (x != y) return if (x.isLowerCase()) -1 else 1
        }
        return a.length.compareTo(b.length).coerceIn(-1, 1)
    }
}
