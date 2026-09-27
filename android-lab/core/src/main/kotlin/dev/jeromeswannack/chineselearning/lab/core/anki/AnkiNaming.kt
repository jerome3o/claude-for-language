package dev.jeromeswannack.chineselearning.lab.core.anki

import dev.jeromeswannack.chineselearning.lab.core.Pinyin
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import java.text.Normalizer

/** Port of frontend/src/services/anki/naming.ts — the .apkg's file name and the media names. */
object AnkiNaming {
    private val CJK_RUN = Regex("[㐀-鿿]+")
    private val NON_PRINTABLE_ASCII = Regex("[^\\x20-\\x7e]")
    private val FORBIDDEN = Regex("[\\\\/:*?\"<>|]+")
    private val DASHES = Regex("-{2,}")
    private val EDGE_DASHES = Regex("^-+|-+$")

    /** `apkgFilename(title)`: `Readers::小猫的一天` → `Readers-xiao-mao-de-yi-tian.apkg` (ASCII only). */
    fun apkgFilename(title: String): String {
        val transliterated = title
            .replace("::", " ")
            .replace(CJK_RUN) { m -> " ${Pinyin.toPinyinToneless(m.value).split(' ').joinToString("-")} " }
        var base = Normalizer.normalize(transliterated, Normalizer.Form.NFKD)
            .replace(NON_PRINTABLE_ASCII, "")
            .replace(FORBIDDEN, " ")
        base = JsJson.replaceSpaceRuns(JsJson.trim(base), "-")
            .replace(DASHES, "-")
            .replace(EDGE_DASHES, "")
        base = base.take(60)
        return "${base.ifEmpty { "anki-export" }}.apkg"
    }

    /** `mediaExtension(type)`: the file extension for a clip's MIME type (mp3 when unknown). */
    fun mediaExtension(type: String): String {
        val t = type.lowercase()
        return when {
            "mpeg" in t || "mp3" in t -> "mp3"
            "wav" in t -> "wav"
            "ogg" in t -> "ogg"
            "webm" in t -> "webm"
            "aac" in t || "mp4" in t -> "m4a"
            else -> "mp3"
        }
    }

    /** `mediaFilename(data, type)`: named by a hash of the bytes, so identical clips dedupe. */
    fun mediaFilename(data: ByteArray, type: String): String = "${AnkiHash.sha1Hex(data).substring(0, 20)}.${mediaExtension(type)}"

    /**
     * The MIME type of a cached clip, sniffed from its first bytes (the Lab's cache keeps bytes,
     * not the response's Content-Type; the web reads the blob's type). Empty when unknown → mp3.
     */
    fun sniffAudioType(data: ByteArray): String {
        fun at(i: Int) = if (i < data.size) data[i].toInt() and 0xff else -1
        fun ascii(s: String, from: Int = 0) = s.indices.all { at(from + it) == s[it].code }
        return when {
            ascii("ID3") -> "audio/mpeg"
            at(0) == 0xff && (at(1) and 0xe0) == 0xe0 && (at(1) and 0x06) != 0 -> "audio/mpeg"
            ascii("RIFF") && ascii("WAVE", 8) -> "audio/wav"
            ascii("OggS") -> "audio/ogg"
            at(0) == 0x1a && at(1) == 0x45 && at(2) == 0xdf && at(3) == 0xa3 -> "audio/webm"
            ascii("ftyp", 4) -> "audio/mp4"
            at(0) == 0xff && (at(1) and 0xf6) == 0xf0 -> "audio/aac"
            else -> ""
        }
    }
}
