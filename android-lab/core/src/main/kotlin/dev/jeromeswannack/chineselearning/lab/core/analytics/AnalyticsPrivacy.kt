package dev.jeromeswannack.chineselearning.lab.core.analytics

import dev.jeromeswannack.chineselearning.lab.core.Js

/**
 * Port of shared/analytics/privacy.ts — the privacy filter every usage event goes through
 * on the device before it is queued (and again on the server before it is stored).
 *
 * Rule: ids, enums, counts, durations and booleans only. Never message text, card content,
 * typed answers, recordings, transcripts, tokens, URLs or e-mail addresses:
 *  1. allow-list — a prop key not declared for the event in [AnalyticsEvents] is dropped;
 *  2. deny-list — [FORBIDDEN_PROP_KEYS] never pass, whatever the catalogue says;
 *  3. value shapes — finite numbers, booleans, null, and strings that are a short id / enum
 *     token ([isSafeToken]: ASCII letters, digits, `_ - . : /`, ≤ 64 chars), so a sentence,
 *     an address, a name or Chinese text can never pass.
 * Parity-tested against the TypeScript (AnalyticsParityTest). Regex classes are spelled out
 * in ASCII: Android's ICU regex makes `\d` / `\w` Unicode, JS keeps them ASCII.
 */
object AnalyticsPrivacy {
    /** Port of FORBIDDEN_PROP_KEYS. */
    val FORBIDDEN_PROP_KEYS: List<String> = listOf(
        "text", "content", "body", "message", "answer", "typed", "hanzi", "pinyin", "english", "translation",
        "transcript", "recording", "audio", "email", "token", "password", "secret", "name", "title", "url",
        "query", "q", "prompt", "notes", "comment", "sentence", "fun_facts",
    )

    const val MAX_PROP_STRING = 64
    const val MAX_PROPS = 12

    private val TOKEN_RE = Regex("^[A-Za-z0-9_.:/-]+$")
    private val UUID_RE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val DIGITS_RE = Regex("^[0-9]+$")
    private val DATE_RE = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
    private val HAS_DIGIT_RE = Regex("[0-9]")
    private val ID_CHARS_RE = Regex("^[A-Za-z0-9_-]+$")
    private val ROUTE_WORD_RE = Regex("^[a-z][a-z0-9-]*$")
    private val BRACED_RE = Regex("^\\{.+\\}$")

    /** Port of isSafeToken: a short id / enum token. */
    fun isSafeToken(value: String): Boolean =
        value.isNotEmpty() && value.length <= MAX_PROP_STRING && TOKEN_RE.matches(value)

    /**
     * Port of sanitizeProps: keeps only the props the catalogue allows for [event], with safe
     * values, in catalogue order. Unknown events get no props at all. Values come out as
     * String, Double (rounded to 6 decimals like `Math.round(v * 1e6) / 1e6`), Boolean or null.
     */
    fun sanitizeProps(event: String, props: Map<String, Any?>?): LinkedHashMap<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        val def = AnalyticsEvents.BY_NAME[event] ?: return out
        if (props == null) return out
        var n = 0
        for (key in def.props) {
            if (n >= MAX_PROPS) break
            if (key in FORBIDDEN_PROP_KEYS) continue
            if (!props.containsKey(key)) continue
            when (val v = props[key]) {
                null -> out[key] = null
                is Boolean -> out[key] = v
                is Number -> {
                    val d = v.toDouble()
                    if (!d.isFinite()) continue
                    out[key] = Js.round(d * 1e6) / 1e6
                }
                is String -> {
                    if (!isSafeToken(v)) continue
                    out[key] = v
                }
                // Enums are written by their name (lowercase in the catalogue's terms) by callers.
                else -> continue
            }
            n++
        }
        return out
    }

    /** Port of isIdSegment: a path segment that is an id rather than part of the route's shape. */
    fun isIdSegment(seg: String): Boolean {
        if (seg.isEmpty()) return false
        if (UUID_RE.matches(seg)) return true
        if (DIGITS_RE.matches(seg)) return true
        if (DATE_RE.matches(seg)) return true
        // Mixed letters + digits, 8+ long (nanoid / hex / base64url ids); words like "v2" stay.
        if (seg.length >= 8 && HAS_DIGIT_RE.containsMatchIn(seg) && ID_CHARS_RE.matches(seg)) return true
        // Anything that is not a plain lowercase route word (encoded text, Chinese, e-mails…).
        return !ROUTE_WORD_RE.matches(seg)
    }

    /**
     * Port of screenName: the route pattern of a path with ids replaced by `:id`, no query or
     * hash. Lab route patterns written with `{id}` map the same way (`/decks/{id}` → `/decks/:id`).
     */
    fun screenName(path: String?): String {
        val p = if (path.isNullOrEmpty()) "/" else path
        val cut = p.indexOfFirst { it == '?' || it == '#' }
        val clean = (if (cut >= 0) p.substring(0, cut) else p).ifEmpty { "/" }
        val segs = clean.split('/').filter { it.isNotEmpty() }.map { s ->
            when {
                BRACED_RE.matches(s) || s.startsWith(":") -> ":id"
                isIdSegment(s) -> ":id"
                else -> s
            }
        }
        return if (segs.isEmpty()) "/" else "/" + segs.joinToString("/")
    }
}
