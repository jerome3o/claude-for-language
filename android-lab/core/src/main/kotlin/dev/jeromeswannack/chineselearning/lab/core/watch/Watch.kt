package dev.jeromeswannack.chineselearning.lab.core.watch

import dev.jeromeswannack.chineselearning.lab.core.Js

/**
 * 📺 Watch (追剧, docs/WATCH.md): Chinese TV on YouTube, played in YouTube's own embedded player
 * with a timed, tappable transcript. Port of shared/watch/video.ts (which video a link means) and
 * shared/watch/lines.ts (the player's line rules), parity-tested by WatchParityTest against
 * android-lab/parity/fixtures/watch.ts — change both together.
 *
 * JS semantics kept on purpose: `\s` is JS whitespace (not Java's ASCII class), the link is read
 * the way `new URL` reads it (case-insensitive scheme / host, slashes after the scheme, user info,
 * dot segments, `searchParams` decoding) — never java.net.URI, which throws on the Chinese text a
 * share carries.
 */
object Watch {
    // ---------------------------------------------------------------- video.ts

    private val ID = Regex("^[A-Za-z0-9_-]{11}$")

    private val YT_HOSTS = setOf(
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    )

    /** JS `\s` (WhiteSpace + LineTerminator), as a regex class body. */
    private const val JS_WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private val FIRST_URL = Regex("https?://[^${JS_WS}<>\"'“”]+", RegexOption.IGNORE_CASE)
    private val TRAILING = Regex("[),.;!?，。）]+$")
    private val BARE = Regex("(?:^|[$JS_WS])((?:[a-z]+\\.)?(?:youtube(?:-nocookie)?\\.com|youtu\\.be)/[^$JS_WS]+)", RegexOption.IGNORE_CASE)

    private fun isJsSpace(c: Char): Boolean =
        c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' || c == ' ' || c == ' ' || c == ' ' ||
            c in ' '..' ' || c == ' ' || c == ' ' || c == ' ' || c == ' ' || c == '　' || c == '﻿'

    /** `String.prototype.trim`. */
    fun jsTrim(s: String): String = s.trim(::isJsSpace)

    /** Port of firstUrlIn(): the first http(s) link inside a piece of text. */
    fun firstUrlIn(text: String): String? {
        val m = FIRST_URL.find(text) ?: return null
        return m.value.replace(TRAILING, "")
    }

    /** Port of parseYouTubeVideoId(): the video id of a YouTube link / share text / bare id, or null. */
    fun parseYouTubeVideoId(input: String?): String? {
        val raw = jsTrim(input ?: "")
        if (raw.isEmpty()) return null
        if (ID.matches(raw)) return raw
        var candidate = firstUrlIn(raw)
        if (candidate == null) {
            val bare = BARE.find(raw) ?: return null
            candidate = "https://${bare.groupValues[1]}"
        }
        val url = JsUrl.parse(candidate) ?: return null
        val host = url.host
        val parts = url.path.split('/').filter { it.isNotEmpty() }
        var id: String? = null
        if (host == "youtu.be" || host == "www.youtu.be") {
            id = parts.getOrNull(0)
        } else if (host in YT_HOSTS) {
            id = when {
                parts.isEmpty() || parts[0] == "watch" -> JsUrl.searchParam(url.query, "v")
                parts[0] in setOf("shorts", "embed", "live", "v", "e") -> parts.getOrNull(1)
                parts[0] == "attribution_link" -> JsUrl.searchParam(url.query, "u")?.let { inner -> JsUrl.relativeQuery(inner)?.let { JsUrl.searchParam(it, "v") } }
                else -> null
            }
        }
        return id?.takeIf { ID.matches(it) }
    }

    /** The video's page on YouTube. */
    fun youtubeWatchUrl(videoId: String): String = "https://www.youtube.com/watch?v=$videoId"

    /** YouTube's public thumbnail (the only picture of a video we show; 320×180). */
    fun youtubeThumbnailUrl(videoId: String): String = "https://i.ytimg.com/vi/$videoId/mqdefault.jpg"

    /** A YouTube search ("Find on YouTube"). */
    fun youtubeSearchUrl(query: String): String = "https://www.youtube.com/results?search_query=${Js.encodeURIComponent(query)}"

    data class Show(val title: String, val english: String, val year: Int, val query: String, val note: String)

    /** Port of WATCH_SHOWS — the list page's "Find on YouTube" links (小欢喜 first, the easiest). */
    val SHOWS: List<Show> = listOf(
        Show("小欢喜", "A Little Reunion", 2019, "小欢喜 第1集", "Start here — three families in an exam year; everyday Mandarin at home and school."),
        Show("欢乐颂", "Ode to Joy", 2016, "欢乐颂 第1集", "Five neighbours on one floor in Shanghai; office and flat-share Mandarin."),
        Show("三十而已", "Nothing But Thirty", 2020, "三十而已 第1集", "Three friends turning thirty; fast, natural conversation."),
        Show("开端", "Reset", 2022, "开端 第1集", "A time-loop thriller on a bus; short episodes, lots of repeated lines."),
        Show("繁花", "Blossoms Shanghai", 2023, "繁花 普通话版 第1集", "Mostly spoken in Shanghainese (沪语) — look for the 普通话版 (Mandarin) version, or lean on the subtitles."),
    )

    // ---------------------------------------------------------------- lines.ts

    /** A line's times (WatchLine's start_ms / end_ms). */
    data class Span(val startMs: Long, val endMs: Long)

    const val LINE_LEAD_MS = 250L
    const val LINE_TAIL_MS = 200L
    const val FOCUS_SLACK_MS = 300L
    const val FOCUS_HOLD_MS = 1500L
    const val MAX_TICK_MS = 2000L

    /** Port of lineIndexAt(): the last line starting at or before [ms] (−1 before the first). */
    fun lineIndexAt(lines: List<Span>, ms: Long): Int {
        var lo = 0
        var hi = lines.size - 1
        var found = -1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (lines[mid].startMs <= ms) {
                found = mid
                lo = mid + 1
            } else hi = mid - 1
        }
        return found
    }

    /** Port of lineSeekMs(): where a jump to line [i] seeks to. */
    fun lineSeekMs(lines: List<Span>, i: Int): Long {
        val line = lines.getOrNull(i) ?: return 0
        return maxOf(0L, line.startMs - LINE_LEAD_MS)
    }

    /** Port of linePauseMs(): a little after its end, never past the next line's start. */
    fun linePauseMs(lines: List<Span>, i: Int): Long {
        val line = lines.getOrNull(i) ?: return 0
        val tail = line.endMs + LINE_TAIL_MS
        val next = lines.getOrNull(i + 1) ?: return tail
        return minOf(tail, maxOf(line.endMs, next.startMs))
    }

    /** Port of activeLineIndex(): the line on screen, holding the focused line from its seek to its pause point. */
    fun activeLineIndex(lines: List<Span>, ms: Long, focus: Int?, playing: Boolean): Int {
        if (focus != null && focus >= 0 && focus < lines.size) {
            val from = lineSeekMs(lines, focus) - FOCUS_SLACK_MS
            val to = linePauseMs(lines, focus) + (if (playing) 0 else FOCUS_HOLD_MS)
            if (ms in from..to) return focus
        }
        return lineIndexAt(lines, ms)
    }

    /** Port of focusStillHolds(). */
    fun focusStillHolds(lines: List<Span>, ms: Long, focus: Int?, playing: Boolean): Boolean =
        focus != null && activeLineIndex(lines, ms, focus, playing) == focus && focus >= 0 && focus < lines.size

    /** Port of lineEndCrossed(): the line whose pause point was played through between two ticks, or null. */
    fun lineEndCrossed(lines: List<Span>, prevMs: Long, ms: Long, focus: Int?): Int? {
        if (ms <= prevMs || ms - prevMs > MAX_TICK_MS) return null
        val at = activeLineIndex(lines, prevMs, focus, true)
        if (at < 0) return null
        val stop = linePauseMs(lines, at)
        return if (prevMs < stop && ms >= stop) at else null
    }

    /** Port of stepLine(): ⏮ / ⏭ from the line on screen. */
    fun stepLine(count: Int, current: Int, dir: Int): Int {
        if (count <= 0) return -1
        if (current < 0) return 0
        return minOf(count - 1, maxOf(0, current + dir))
    }

    // ---- listen first

    /** Port of WatchReveal: nothing, the Chinese, + pinyin, + English. */
    enum class Reveal(val wire: String) {
        LISTEN("listen"), HANZI("hanzi"), PINYIN("pinyin"), ENGLISH("english");

        companion object {
            fun of(wire: String?): Reveal = entries.firstOrNull { it.wire == wire } ?: LISTEN
        }
    }

    /** Port of nextWatchReveal(). */
    fun nextReveal(current: Reveal, hasPinyin: Boolean, hasEnglish: Boolean): Reveal {
        var at = current.ordinal
        repeat(Reveal.entries.size) {
            at = (at + 1) % Reveal.entries.size
            val r = Reveal.entries[at]
            if (r == Reveal.PINYIN && !hasPinyin) return@repeat
            if (r == Reveal.ENGLISH && !hasEnglish) return@repeat
            return r
        }
        return Reveal.LISTEN
    }

    // ---- speed

    val SPEEDS: List<Double> = listOf(1.0, 0.75, 0.5)

    /** Port of nextWatchSpeed(): 1× → 0.75× → 0.5× → 1×; anything else → 1×. */
    fun nextSpeed(speed: Double): Double {
        val at = SPEEDS.indexOf(speed)
        return if (at < 0) 1.0 else SPEEDS[(at + 1) % SPEEDS.size]
    }

    private val JS_DECIMAL = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")

    /** Port of parseWatchSpeed(): a stored speed (Number or String, JS `Number()` rules) → one of SPEEDS, else 1. */
    fun parseSpeed(raw: Any?): Double {
        val n: Double = when (raw) {
            is Number -> raw.toDouble()
            is String -> {
                val t = jsTrim(raw)
                when {
                    t.isEmpty() -> Double.NaN
                    JS_DECIMAL.matches(t) -> t.toDouble()
                    t.length > 2 && t[0] == '0' && t[1] in "xX" -> t.substring(2).toLongOrNull(16)?.toDouble() ?: Double.NaN
                    t.length > 2 && t[0] == '0' && t[1] in "bB" -> t.substring(2).toLongOrNull(2)?.toDouble() ?: Double.NaN
                    t.length > 2 && t[0] == '0' && t[1] in "oO" -> t.substring(2).toLongOrNull(8)?.toDouble() ?: Double.NaN
                    else -> Double.NaN
                }
            }
            else -> Double.NaN
        }
        return if (n in SPEEDS) n else 1.0
    }

    /** Port of watchSpeedLabel(): "1×", "0.75×". */
    fun speedLabel(speed: Double): String = "${Js.numberToString(speed)}×"

    // ---- labels

    /** Port of watchClock(): "4:05" / "1:02:03". */
    fun clock(ms: Long): String {
        val total = maxOf(0L, ms) / 1000
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        fun pad(n: Long) = n.toString().padStart(2, '0')
        return if (h > 0) "$h:${pad(m)}:${pad(s)}" else "$m:${pad(s)}"
    }

    /** Port of resumeAtMs(): the saved position, unless it was (nearly) finished or barely started. */
    fun resumeAtMs(positionMs: Long?, durationMs: Long?): Long {
        val pos = maxOf(0L, positionMs ?: 0L)
        if (durationMs != null && durationMs > 0 && pos >= durationMs - 30_000) return 0
        return if (pos < 5_000) 0 else pos
    }

    /** Port of watchedFraction(): 0..1 watched, for the list's progress bar. */
    fun watchedFraction(positionMs: Long?, durationMs: Long?): Double {
        if (positionMs == null || positionMs == 0L || durationMs == null || durationMs <= 0) return 0.0
        return minOf(1.0, maxOf(0.0, positionMs.toDouble() / durationMs.toDouble()))
    }

    /** Port of watchStatusLine(): the transcript's state, as the list and the player say it. */
    fun statusLine(
        status: String?,
        chunksDone: Int? = null,
        chunksTotal: Int? = null,
        progressDone: Int? = null,
        progressTotal: Int? = null,
        error: String? = null,
    ): String = when (status) {
        "queued" -> "Waiting to start the transcript…"
        "transcribing" -> {
            val total = chunksTotal ?: 0
            if (total > 0) "Making the transcript… (part ${minOf(total, (chunksDone ?: 0) + 1)} of $total)" else "Making the transcript…"
        }
        "translating" -> {
            val total = progressTotal ?: 0
            if (total > 0) "Translating ${progressDone ?: 0} / $total lines" else "Translating…"
        }
        "ready" -> if (progressTotal != null && progressTotal != 0) "Transcript ready · $progressTotal lines" else "Transcript ready"
        "failed" -> "Couldn't make the transcript" + (if (!error.isNullOrEmpty()) ": $error" else "")
        else -> "No transcript yet"
    }

    /** Port of watchIsWorking(): still being made — the screens poll while this is true. */
    fun isWorking(status: String?): Boolean = status == "queued" || status == "transcribing" || status == "translating"
}

/**
 * The bits of the WHATWG URL parser the link reader needs, for http(s) only: `new URL(s)` →
 * lower-cased host (percent-decoded), the path with dot segments resolved and `\` read as `/`, and
 * the raw query; `searchParams.get` decoding (`+` = space, %XX as UTF-8, bad bytes → U+FFFD).
 * Anything `new URL` would throw on returns null.
 */
internal object JsUrl {
    data class Parsed(val host: String, val path: String, val query: String?)

    private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")

    fun parse(input: String): Parsed? {
        // new URL strips leading / trailing C0 controls + space and every tab / newline.
        val s = input.trim { it <= ' ' }.filterNot { it == '\t' || it == '\n' || it == '\r' }
        val m = SCHEME.find(s) ?: return null
        val scheme = m.groupValues[1].lowercase()
        if (scheme != "http" && scheme != "https") return null
        var rest = s.substring(m.value.length)
        rest = rest.trimStart('/', '\\')
        val end = rest.indexOfFirst { it == '/' || it == '\\' || it == '?' || it == '#' }.let { if (it < 0) rest.length else it }
        var authority = rest.substring(0, end)
        val after = rest.substring(end)
        val at = authority.lastIndexOf('@')
        if (at >= 0) authority = authority.substring(at + 1)
        var hostPart = authority
        if (!hostPart.startsWith("[")) {
            val colon = hostPart.lastIndexOf(':')
            if (colon >= 0) {
                val port = hostPart.substring(colon + 1)
                if (port.any { it !in '0'..'9' } || (port.isNotEmpty() && port.toBigInteger() > 65535.toBigInteger())) return null
                hostPart = hostPart.substring(0, colon)
            }
        }
        if (hostPart.isEmpty()) return null
        val host = percentDecode(hostPart, plus = false).lowercase()
        if (host.any { it in " #%/:<>?@[\\]^|" || it < ' ' }) return null
        val hash = after.indexOf('#').let { if (it < 0) after.length else it }
        val beforeHash = after.substring(0, hash)
        val q = beforeHash.indexOf('?')
        val rawPath = if (q < 0) beforeHash else beforeHash.substring(0, q)
        val query = if (q < 0) null else beforeHash.substring(q + 1)
        return Parsed(host, resolvePath(rawPath.replace('\\', '/')), query)
    }

    private fun resolvePath(path: String): String {
        if (path.isEmpty()) return "/"
        val out = ArrayList<String>()
        val segs = path.removePrefix("/").split('/')
        for ((k, seg) in segs.withIndex()) {
            val last = k == segs.lastIndex
            when (seg.lowercase()) {
                "..", ".%2e", "%2e.", "%2e%2e" -> { if (out.isNotEmpty()) out.removeAt(out.lastIndex); if (last) out.add("") }
                ".", "%2e" -> if (last) out.add("")
                else -> out.add(seg)
            }
        }
        return "/" + out.joinToString("/")
    }

    /** `new URLSearchParams(query).get(name)`. */
    fun searchParam(query: String?, name: String): String? {
        if (query == null) return null
        for (pair in query.split('&')) {
            if (pair.isEmpty()) continue
            val eq = pair.indexOf('=')
            val k = percentDecode(if (eq < 0) pair else pair.substring(0, eq), plus = true)
            if (k == name) return percentDecode(if (eq < 0) "" else pair.substring(eq + 1), plus = true)
        }
        return null
    }

    /** The query of `new URL(inner, 'https://www.youtube.com')`, or null when that throws. */
    fun relativeQuery(inner: String): String? {
        val s = inner.trim { it <= ' ' }.filterNot { it == '\t' || it == '\n' || it == '\r' }
        val m = SCHEME.find(s)
        if (m != null && m.groupValues[1].lowercase().let { it == "http" || it == "https" }) {
            // An absolute http(s) link: its own query (or null if it isn't a valid URL).
            val p = parse(s) ?: return null
            return p.query ?: ""
        }
        val hash = s.indexOf('#').let { if (it < 0) s.length else it }
        val before = s.substring(0, hash)
        val q = before.indexOf('?')
        return if (q < 0) "" else before.substring(q + 1)
    }

    fun percentDecode(s: String, plus: Boolean): String {
        if ('%' !in s && !(plus && '+' in s)) return s
        val bytes = java.io.ByteArrayOutputStream()
        val src = s.toByteArray(Charsets.UTF_8)
        var i = 0
        while (i < src.size) {
            val b = src[i].toInt() and 0xFF
            if (b == '+'.code && plus) {
                bytes.write(' '.code); i++
            } else if (b == '%'.code && i + 2 < src.size && hex(src[i + 1]) >= 0 && hex(src[i + 2]) >= 0) {
                bytes.write(hex(src[i + 1]) * 16 + hex(src[i + 2])); i += 3
            } else {
                bytes.write(b); i++
            }
        }
        // UTF-8 decode with replacement (TextDecoder semantics).
        return String(bytes.toByteArray(), Charsets.UTF_8)
    }

    private fun hex(b: Byte): Int = when (val c = b.toInt().toChar()) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> -1
    }
}
