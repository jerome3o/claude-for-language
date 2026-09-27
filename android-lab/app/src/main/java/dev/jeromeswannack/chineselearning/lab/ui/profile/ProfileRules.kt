package dev.jeromeswannack.chineselearning.lab.ui.profile

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The Profile screen's pure rules — ports of shared/profile/validate.ts (limits, normalising,
 * the checks, localTimeLabel) and frontend/src/services/profilePicture.ts (crop geometry).
 * The server re-checks everything (PUT /api/profile answers 400 + problems).
 */
object ProfileRules {
    const val NAME_MAX = 60
    const val ABOUT_MAX = 500
    const val BIO_MAX = 500
    /** Edge the picked photo is cropped / resized to (PROFILE_PICTURE_SIZE). */
    const val PICTURE_SIZE = 512

    private val CONTROL = Regex("[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]")

    /** Port of normalizeName: one line, controls gone, whitespace collapsed. */
    fun normalizeName(raw: String): String = raw.replace(CONTROL, "").replace(Regex("\\s+"), " ").trim()

    /** Port of normalizeText: controls gone, trailing spaces trimmed, at most one blank line in a row. */
    fun normalizeText(raw: String): String = raw
        .replace(Regex("\\r\\n?"), "\n")
        .replace('\t', ' ')
        .replace(CONTROL, "")
        .split('\n').joinToString("\n") { it.trimEnd() }
        .replace(Regex("\\n{3,}"), "\n\n")
        .trim()

    /** Characters as a person counts them (an emoji or 汉字 is one) — Array.from(s).length. */
    fun charCount(s: String): Int = s.codePointCount(0, s.length)

    /** The problems pickProfileUpdate would report for these (already normalised) values. */
    fun problems(name: String?, about: String?, bio: String?): List<String> = buildList {
        if (name != null) {
            if (name.isEmpty()) add("Name can't be empty (use your Google name instead)")
            else if (charCount(name) > NAME_MAX) add("Name must be at most $NAME_MAX characters")
        }
        if (bio != null && charCount(bio) > BIO_MAX) add("Bio must be at most $BIO_MAX characters")
        if (about != null && charCount(about) > ABOUT_MAX) add("About me must be at most $ABOUT_MAX characters")
    }

    /** "Asia/Shanghai" → "Shanghai", "America/Argentina/Buenos_Aires" → "Buenos Aires". */
    fun timeZoneCity(tz: String): String = tz.substringAfterLast('/').replace('_', ' ')

    fun zoneOrNull(tz: String?): ZoneId? = tz?.takeIf { it.isNotBlank() }?.let { runCatching { ZoneId.of(it) }.getOrNull() }

    /** Port of localTimeLabel: "9:04 pm in Shanghai" (null when unset / unknown). */
    fun localTimeLabel(tz: String?, now: Instant = Instant.now()): String? {
        val zone = zoneOrNull(tz) ?: return null
        val time = DateTimeFormatter.ofPattern("h:mm a", Locale.US).format(now.atZone(zone)).replace("AM", "am").replace("PM", "pm")
        return "$time in ${timeZoneCity(tz!!)}"
    }

    // ---------------- crop geometry (services/profilePicture.ts) ----------------

    const val MAX_ZOOM = 4f

    /** Natural image size, square viewport edge (px), zoom ≥ 1, image top-left offset in viewport px. */
    data class Crop(val w: Int, val h: Int, val view: Float, val zoom: Float = 1f, val ox: Float = 0f, val oy: Float = 0f) {
        val scale: Float get() = view / max(1, min(w, h)) * zoom
    }

    data class SourceRect(val sx: Int, val sy: Int, val side: Int)

    fun clamp(c: Crop): Crop {
        val zoom = c.zoom.coerceIn(1f, MAX_ZOOM)
        val scale = c.view / max(1, min(c.w, c.h)) * zoom
        return c.copy(zoom = zoom, ox = c.ox.coerceIn(c.view - c.w * scale, 0f), oy = c.oy.coerceIn(c.view - c.h * scale, 0f))
    }

    fun initial(w: Int, h: Int, view: Float): Crop {
        val scale = view / max(1, min(w, h))
        return clamp(Crop(w, h, view, 1f, (view - w * scale) / 2f, (view - h * scale) / 2f))
    }

    fun pan(c: Crop, dx: Float, dy: Float): Crop = clamp(c.copy(ox = c.ox + dx, oy = c.oy + dy))

    /** Zoom keeping the image point under (ax, ay) where it is (default: the centre). */
    fun zoom(c: Crop, zoom: Float, ax: Float = c.view / 2, ay: Float = c.view / 2): Crop {
        val before = c.scale
        val next = zoom.coerceIn(1f, MAX_ZOOM)
        val after = c.copy(zoom = next).scale
        val ix = (ax - c.ox) / before
        val iy = (ay - c.oy) / before
        return clamp(c.copy(zoom = next, ox = ax - ix * after, oy = ay - iy * after))
    }

    /** The square of the source image the viewport shows, inside the image. */
    fun sourceRect(c0: Crop): SourceRect {
        val c = clamp(c0)
        val side = min(min(c.w, c.h).toFloat(), c.view / c.scale)
        val sx = (-c.ox / c.scale).coerceIn(0f, c.w - side)
        val sy = (-c.oy / c.scale).coerceIn(0f, c.h - side)
        val s = side.roundToInt().coerceAtLeast(1)
        return SourceRect(sx.roundToInt().coerceIn(0, max(0, c.w - s)), sy.roundToInt().coerceIn(0, max(0, c.h - s)), s)
    }

    /** Output edge: 512, or smaller for a tiny crop (never upscaled past 2×, never below 64). */
    fun outputSize(side: Int, target: Int = PICTURE_SIZE): Int = max(64, min(target, side * 2))
}
