package dev.jeromeswannack.chineselearning.lab.core.anki

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import java.security.MessageDigest

/**
 * Port of frontend/src/services/anki/hash.ts — the deterministic Anki identifiers.
 *
 * Anki matches models and decks by integer id and notes by GUID, so both apps derive them
 * from the same input with the same hash: an export from the Lab app UPDATES the notes an
 * export from the web app created (and vice versa). AnkiParityTest holds every function here
 * equal to the TypeScript.
 */
object AnkiHash {
    private val IMUL_1 = 2654435761L.toInt()
    private const val IMUL_2 = 1597334677
    private val IMUL_3 = 2246822507L.toInt()
    private val IMUL_4 = 3266489909L.toInt()

    /** `cyrb53(str, seed)` — 53-bit hash over UTF-16 code units (`Math.imul` = Int multiply). */
    fun cyrb53(str: String, seed: Long = 0): Long {
        val s = seed.toInt() // ToInt32, as `^` does in JS
        var h1 = 0xdeadbeef.toInt() xor s
        var h2 = 0x41c6ce57 xor s
        for (ch in str) {
            h1 = (h1 xor ch.code) * IMUL_1
            h2 = (h2 xor ch.code) * IMUL_2
        }
        h1 = (h1 xor (h1 ushr 16)) * IMUL_3
        h1 = h1 xor ((h2 xor (h2 ushr 13)) * IMUL_4)
        h2 = (h2 xor (h2 ushr 16)) * IMUL_3
        h2 = h2 xor ((h1 xor (h1 ushr 13)) * IMUL_4)
        return 4294967296L * (2097151 and h2).toLong() + (h1.toLong() and 0xffffffffL)
    }

    /** `stableId(namespace, name)`: a 31-bit id in [2^30, 2^31). */
    fun stableId(namespace: String, name: String): Long = cyrb53("$namespace::$name") % 1073741824L + 1073741824L

    private const val BASE91 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#\$%&()*+,-./:;<=>?@[]^_`{|}~"

    /** `guidFor(...parts)`: a 10 character base91 GUID. */
    fun guidFor(vararg parts: String): String {
        val input = parts.joinToString("|")
        val out = StringBuilder(10)
        for (seed in longArrayOf(0x9e3779b9L, 0x7f4a7c15L)) {
            var n = cyrb53(input, seed)
            repeat(5) {
                out.append(BASE91[(n % 91).toInt()])
                n /= 91
            }
        }
        return out.toString()
    }

    /** `new TextEncoder().encode(s)`: UTF-8 with lone surrogates as U+FFFD (the JVM would write '?'). */
    fun utf8(s: String): ByteArray {
        val sb = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1])) {
                sb.append(c).append(s[i + 1]); i += 2; continue
            }
            sb.append(if (Character.isSurrogate(c)) '�' else c)
            i++
        }
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    fun sha1Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    fun sha1Hex(s: String): String = sha1Hex(utf8(s))

    /** `fieldChecksum(field)`: the first 8 hex digits of sha1(field with HTML stripped). */
    fun fieldChecksum(field: String): Long = sha1Hex(stripHtmlMedia(field)).substring(0, 8).toLong(16)

    private val SOUND = Regex("\\[sound:[^\\]]+]")
    private val IMG = Regex("<img[^>]*>", RegexOption.IGNORE_CASE)
    private val TAG = Regex("<[^>]+>")

    /** `stripHtmlMedia`: drop [sound:] tags, <img>s and other markup; decode four entities; JS trim. */
    fun stripHtmlMedia(text: String): String = JsJson.trim(
        text.replace(SOUND, "")
            .replace(IMG, "")
            .replace(TAG, "")
            .replace("&nbsp;", " ")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&"),
    )
}
