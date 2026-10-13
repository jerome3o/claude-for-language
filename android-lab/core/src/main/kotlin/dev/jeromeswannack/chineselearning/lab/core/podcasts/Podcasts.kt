package dev.jeromeswannack.chineselearning.lab.core.podcasts

/**
 * The podcast player's rules (docs/PODCASTS.md) — Lab app only for now (the web app has no
 * podcast player yet, android-lab/PARITY.md "Podcasts"), so there is no TypeScript to be
 * parity-tested against; core/src/test/…/PodcastsTest.kt pins them.
 *
 * A transcribed episode is a list of segments (≈ 3–15 s each). Listen first: a segment starts
 * covered, and each tap uncovers one more line — the Chinese, then its pinyin, then the English —
 * a tap on a fully open one covers it again (like the study card's example-sentence rows).
 */
object Podcasts {
    /** How much of a segment shows. */
    enum class Reveal(val label: String, val analytics: String) {
        LISTEN("Listen first", "listen"),
        HANZI("Chinese", "hanzi"),
        PINYIN("Chinese + pinyin", "pinyin"),
        ENGLISH("Everything", "english");
    }

    /**
     * The next reveal after a tap. Steps the segment hasn't got are skipped (no pinyin for an
     * English-only line; no English yet while it is being translated); past the last → LISTEN.
     */
    fun nextReveal(current: Reveal, hasPinyin: Boolean, hasEnglish: Boolean): Reveal {
        var r = current
        repeat(Reveal.entries.size) {
            r = Reveal.entries[(r.ordinal + 1) % Reveal.entries.size]
            val available = when (r) {
                Reveal.PINYIN -> hasPinyin
                Reveal.ENGLISH -> hasEnglish
                else -> true
            }
            if (available) return r
        }
        return Reveal.LISTEN
    }

    /** The segment playing at [ms]: the last one starting at or before it (−1 before the first). */
    fun segmentAt(starts: List<Long>, ms: Long): Int {
        var lo = 0
        var hi = starts.size - 1
        var found = -1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (starts[mid] <= ms) {
                found = mid
                lo = mid + 1
            } else hi = mid - 1
        }
        return found
    }

    /**
     * One segment played on its own stops a little after its end (speech recognition puts the end
     * at the last syllable; the voice trails off) — but never into the next segment's speech.
     */
    fun stopAt(endMs: Long, nextStartMs: Long?): Long {
        val tail = endMs + TAIL_MS
        return if (nextStartMs != null && nextStartMs > endMs) minOf(tail, nextStartMs) else tail
    }

    const val TAIL_MS = 250L
    /** ▶ starts a little before the segment's first syllable. */
    const val LEAD_MS = 120L

    fun startAt(startMs: Long): Long = maxOf(0L, startMs - LEAD_MS)

    /** "4:05" / "1:02:03". */
    fun clock(ms: Long): String {
        val total = (maxOf(0L, ms) / 1000)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format(java.util.Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(java.util.Locale.ROOT, "%d:%02d", m, s)
    }

    /** "31 min" / "1 h 05 min" / "45 s" — an episode's length in the feed. */
    fun minutes(seconds: Long?): String? {
        if (seconds == null || seconds <= 0) return null
        if (seconds < 60) return "$seconds s"
        val m = (seconds + 30) / 60
        return if (m >= 60) String.format(java.util.Locale.ROOT, "%d h %02d min", m / 60, m % 60) else "$m min"
    }

    /** "71 MB" / "800 KB". */
    fun size(bytes: Long?): String? {
        if (bytes == null || bytes <= 0) return null
        return if (bytes >= 1024 * 1024) "${(bytes + 512 * 1024) / (1024 * 1024)} MB" else "${maxOf(1, bytes / 1024)} KB"
    }

    /** The transcription's state as the feed / player say it. */
    fun statusLine(status: String?, progress: String?, done: Int?, total: Int?, error: String?): String = when (status) {
        null, "" -> "Not transcribed yet"
        "queued" -> "Waiting to start…"
        "downloading" -> "Downloading the audio…"
        "transcribing" -> progress?.takeIf { it.isNotBlank() } ?: "Transcribing…"
        "translating" -> if (done != null && total != null && total > 0) "Translating $done / $total — you can start listening" else "Translating…"
        "ready" -> if (total != null && total > 0) "Transcribed · $total segments" else "Transcribed"
        "failed" -> "Couldn't transcribe" + (error?.takeIf { it.isNotBlank() }?.let { ": $it" } ?: "")
        else -> progress ?: status
    }

    /** Still being made: the screens poll while this is true. */
    fun isWorking(status: String?): Boolean = status == "queued" || status == "downloading" || status == "transcribing" || status == "translating"

    /** Segments exist (while translating, without all their English yet). */
    fun isListenable(status: String?): Boolean = status == "translating" || status == "ready"

    /** 0..1 for a progress bar; null = indeterminate. */
    fun fraction(status: String?, done: Int?, total: Int?): Float? = when {
        status == "translating" && done != null && total != null && total > 0 -> (done.toFloat() / total).coerceIn(0f, 1f)
        status == "ready" -> 1f
        else -> null
    }

    /** "Speaker 1" — null when the transcript has one voice (no label worth showing). */
    fun speakerLabel(speaker: String?, speakers: Int): String? = if (speaker.isNullOrBlank() || speakers < 2) null else "Speaker $speaker"

    /** The feed's date: "6 Oct 2026" from an ISO time (null when unreadable). */
    fun date(iso: String?): String? {
        if (iso.isNullOrBlank()) return null
        val m = Regex("^(\\d{4})-(\\d{2})-(\\d{2})").find(iso) ?: return null
        val (y, mo, d) = m.destructured
        val month = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec").getOrNull(mo.toInt() - 1) ?: return null
        return "${d.toInt()} $month $y"
    }

    /** The first segment of the stretch a "Make a mini lesson" covers (the one on screen, else the start). */
    fun lessonFrom(current: Int, count: Int): Int = if (current in 0 until count) current else 0

    /** The words a lesson stretch covers in the button: "from 4:05". */
    fun lessonFromLabel(startMs: Long?): String = if (startMs == null || startMs <= 0) "from the start" else "from ${clock(startMs)}"
}
