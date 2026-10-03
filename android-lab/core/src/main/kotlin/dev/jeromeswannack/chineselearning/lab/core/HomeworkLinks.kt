package dev.jeromeswannack.chineselearning.lab.core

/*
 * Link homework (docs/HOMEWORK.md §8): an external link — a YouTube video, a song, a
 * TV-drama clip, an article — with a title and instructions. Nothing is hosted or embedded:
 * the app only links out; a YouTube link gets its public thumbnail (i.ytimg.com).
 * Port of shared/homework/link.ts (normalizeLinkUrl, linkHost, youtubeVideoId, linkThumbnail,
 * linkSiteName, cleanLinkNote) — parity-tested (parity/fixtures/homework-library.ts).
 *
 * JS semantics: `\s` is JS whitespace (spelled out, Android's ICU `\s` differs), `.` never
 * matches a line terminator, `/i` is ASCII-only case folding.
 */
object HomeworkLinks {
    const val LINK_TITLE_MAX = 160
    const val LINK_INSTRUCTIONS_MAX = 2000
    const val LINK_URL_MAX = 2000
    const val LINK_NOTE_MAX = 1000

    /** JS `\s`: whitespace + line terminators. */
    private const val WS = "\\t\\n\\u000B\\u000C\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private val ANY_WS = Regex("[$WS]")
    private val HAS_SCHEME = Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE)
    /** `/^(https?):\/\/([^/?#\s]+)(.*)$/i` — JS `.` excludes \n \r     only. */
    private val HTTP_URL = Regex("(https?)://([^/?#$WS]+)([^\\n\\r\\u2028\\u2029]*)", RegexOption.IGNORE_CASE)
    private val PORT = Regex(":[0-9]+\\z")
    private val BARE_HOST = Regex("[a-z0-9.-]+")
    private val HOST = Regex("^https?://([^/?#:]+)", RegexOption.IGNORE_CASE)
    private val WWW = Regex("^(www|m)\\.")
    private val PATH_QUERY = Regex("^https?://[^/?#]+([^?#]*)(\\?[^#]*)?", RegexOption.IGNORE_CASE)
    private val V_PARAM = Regex("[?&]v=([^&]+)")
    private val ID_PATH = Regex("^/(shorts|embed|live|v)/([^/]+)")
    private val YOUTUBE_ID = Regex("[A-Za-z0-9_-]{11}")

    /**
     * Port of normalizeLinkUrl: a pasted link as a canonical http(s) URL, or null.
     * "youtu.be/abc" → "https://youtu.be/abc"; other schemes are refused.
     */
    fun normalizeLinkUrl(raw: String?): String? {
        if (raw == null) return null
        var text = NoteSearch.jsTrim(raw)
        if (text.isEmpty() || text.length > LINK_URL_MAX || ANY_WS.containsMatchIn(text)) return null
        if (!HAS_SCHEME.containsMatchIn(text)) text = "https://$text"
        val m = HTTP_URL.matchEntire(text) ?: return null
        val host = NoteSearch.jsLower(m.groupValues[2])
        if (host.contains('@')) return null
        val bare = PORT.replaceFirst(host, "")
        if (bare.isEmpty() || (!bare.contains('.') && bare != "localhost")) return null
        if (!BARE_HOST.matches(bare) || bare.startsWith(".") || bare.endsWith(".")) return null
        return "${NoteSearch.jsLower(m.groupValues[1])}://$host${m.groupValues[3]}"
    }

    /** Port of linkHost: the hostname without "www." / "m.", or '' for a bad URL. */
    fun linkHost(url: String): String {
        val m = HOST.find(url) ?: return ""
        return WWW.replaceFirst(NoteSearch.jsLower(m.groupValues[1]), "")
    }

    /** Port of youtubeVideoId: watch, youtu.be, shorts, embed, live; else null. */
    fun youtubeVideoId(url: String): String? {
        val host = linkHost(url)
        val m = PATH_QUERY.find(url) ?: return null
        val path = m.groupValues[1]
        val query = m.groupValues[2]
        var id: String? = null
        if (host == "youtu.be") {
            id = path.split("/").getOrNull(1)
        } else if (host == "youtube.com" || host == "music.youtube.com" || host == "youtube-nocookie.com") {
            if (path == "/watch") {
                id = V_PARAM.find(query)?.groupValues?.get(1)
            } else {
                id = ID_PATH.find(path)?.groupValues?.get(2)
            }
        }
        return id?.takeIf { YOUTUBE_ID.matches(it) }
    }

    /** Port of linkThumbnail: YouTube's public thumbnail, else null (no fetching). */
    fun linkThumbnail(url: String): String? = youtubeVideoId(url)?.let { "https://i.ytimg.com/vi/$it/hqdefault.jpg" }

    private val SITE_NAMES = mapOf(
        "youtube.com" to "YouTube",
        "youtu.be" to "YouTube",
        "music.youtube.com" to "YouTube Music",
        "bilibili.com" to "Bilibili",
        "b23.tv" to "Bilibili",
        "open.spotify.com" to "Spotify",
        "music.163.com" to "NetEase Music",
        "y.qq.com" to "QQ Music",
        "v.qq.com" to "Tencent Video",
        "iqiyi.com" to "iQIYI",
        "netflix.com" to "Netflix",
    )

    /** Port of linkSiteName: "YouTube" / "Bilibili" / the bare host. */
    fun linkSiteName(url: String): String {
        val host = linkHost(url)
        return SITE_NAMES[host] ?: host
    }

    /** Port of cleanLinkNote: trimmed and capped at 1000; null when empty. */
    fun cleanLinkNote(raw: String?): String? {
        if (raw == null) return null
        val text = NoteSearch.jsTrim(raw)
        return if (text.isEmpty()) null else text.take(LINK_NOTE_MAX)
    }
}
