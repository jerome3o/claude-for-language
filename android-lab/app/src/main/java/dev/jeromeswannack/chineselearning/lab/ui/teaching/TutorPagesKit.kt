package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * Pieces shared by the tutor insight pages (web: pages/tutor/tutor-shared.tsx): rating dot,
 * card-type chip, recording play button, typed-answer diff and the page formatters.
 */

object TutorPageFormat {
    private val MONTH_DAY = DateTimeFormatter.ofPattern("MMM d", Locale.US)
    private val MONTH_DAY_YEAR = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
    private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    /** "12m", "1h 5m", "<1m" (web: formatDuration). */
    fun duration(ms: Long): String {
        val minutes = Js.round(ms / 60000.0).toLong()
        if (minutes < 1) return if (ms > 0) "<1m" else "0m"
        if (minutes < 60) return "${minutes}m"
        val hours = minutes / 60
        val rest = minutes % 60
        return if (rest > 0) "${hours}h ${rest}m" else "${hours}h"
    }

    /** "Today", "Yesterday", "Sep 3" (+ year when not this year) — web: formatDay. */
    fun day(iso: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d = TeachingFormat.parse(iso)?.atZone(zone) ?: return iso
        val today = now.atZone(zone).toLocalDate()
        val date = d.toLocalDate()
        return when (date) {
            today -> "Today"
            today.minusDays(1) -> "Yesterday"
            else -> if (date.year != today.year) MONTH_DAY_YEAR.format(d) else MONTH_DAY.format(d)
        }
    }

    fun dateTime(iso: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d = TeachingFormat.parse(iso)?.atZone(zone) ?: return iso
        return "${day(iso, now, zone)} ${TIME.format(d)}"
    }

    /** "4.2s", "12s" (web: formatSeconds). */
    fun seconds(ms: Long?): String {
        if (ms == null || ms <= 0) return ""
        return "${Js.toFixed(ms / 1000.0, if (ms < 10000) 1 else 0)}s"
    }

    /** N days before today on this phone, as 'YYYY-MM-DD' (web: toDateInputValue(Date.now() - n days)). */
    fun daysAgo(n: Int, today: LocalDate = LocalDate.now()): String = today.minusDays(n.toLong()).toString()

    val RATING_LABELS = listOf("Forgot", "Hard", "Good", "Easy")
    val CARD_TYPE_SHORT = mapOf("hanzi_to_meaning" to "读 Read", "meaning_to_hanzi" to "写 Write", "audio_to_hanzi" to "听 Listen")
    val CARD_TYPE_LONG = mapOf("hanzi_to_meaning" to "Hanzi → meaning (spoken)", "meaning_to_hanzi" to "Meaning → hanzi (typed)", "audio_to_hanzi" to "Audio → hanzi (typed)")

    private val ANSWER_PUNCT = Regex("[\\s。，！？、；：,.!?;:'\"“”‘’…—·\\-()（）]")
    private fun normalize(s: String) = s.replace(ANSWER_PUNCT, "").lowercase()

    /** Same equivalence as the server: whitespace and punctuation are not mistakes. */
    fun answersMatch(userAnswer: String, correct: String): Boolean = normalize(userAnswer) == normalize(correct)

    enum class DiffKind { CORRECT, WRONG, EXPECTED }

    /**
     * The typed answer against the hanzi, position by position (web: AnswerDiff): wrong characters,
     * then "→" and the expected answer with the missed characters highlighted. Empty for a blank answer.
     */
    fun answerDiff(userAnswer: String, correct: String): Pair<List<Pair<Char, DiffKind>>, List<Pair<Char, DiffKind>>?> {
        val typed = userAnswer.trim()
        if (typed.isEmpty()) return emptyList<Pair<Char, DiffKind>>() to null
        if (answersMatch(typed, correct)) return typed.map { it to DiffKind.CORRECT } to null
        val max = maxOf(typed.length, correct.length)
        val user = ArrayList<Pair<Char, DiffKind>>()
        val expected = ArrayList<Pair<Char, DiffKind>>()
        for (i in 0 until max) {
            val u = typed.getOrNull(i)
            val c = correct.getOrNull(i)
            val ok = u == c
            if (u != null) user += u to if (ok) DiffKind.CORRECT else DiffKind.WRONG
            if (c != null) expected += c to if (ok) DiffKind.CORRECT else DiffKind.EXPECTED
        }
        return user to expected
    }
}

private fun ratingColor(r: Int): Color = when (r) {
    0 -> Palette.Again
    1 -> Palette.Hard
    3 -> Palette.Easy
    else -> Palette.Good
}

@Composable
fun RatingDot(rating: Int, withLabel: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(ratingColor(rating)))
        if (withLabel) {
            Text(" " + (TutorPageFormat.RATING_LABELS.getOrNull(rating) ?: ""), fontSize = 13.sp, color = ratingColor(rating), fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
fun CardTypeChip(cardType: String) {
    Text(
        TutorPageFormat.CARD_TYPE_SHORT[cardType] ?: cardType,
        fontSize = 12.sp, color = Lab.colors.ink,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(Lab.colors.faint).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** ▶ / ⏹ for a pronunciation recording; [compact] drops the word. */
@Composable
fun RecordingButton(url: String, playing: Boolean, onPlay: (String) -> Unit, compact: Boolean = false) {
    Text(
        if (playing) "⏹" + (if (compact) "" else " Stop") else "▶" + (if (compact) "" else " Play"),
        color = if (playing) Color.White else Palette.Secondary,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = Modifier
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(50))
            .bouncyClickable(pressedScale = 0.9f) { onPlay(url) }
            .background(if (playing) Palette.Secondary else Palette.Secondary.copy(alpha = 0.12f))
            .padding(horizontal = if (compact) 12.dp else 14.dp, vertical = 10.dp),
    )
}

fun answerDiffText(userAnswer: String, correct: String): AnnotatedString = buildAnnotatedString {
    val (user, expected) = TutorPageFormat.answerDiff(userAnswer, correct)
    fun put(list: List<Pair<Char, TutorPageFormat.DiffKind>>) = list.forEach { (ch, kind) ->
        when (kind) {
            TutorPageFormat.DiffKind.CORRECT -> withStyle(SpanStyle(color = Palette.Good)) { append(ch) }
            TutorPageFormat.DiffKind.WRONG -> withStyle(SpanStyle(color = Palette.Again, fontWeight = FontWeight.Bold, textDecoration = TextDecoration.LineThrough)) { append(ch) }
            TutorPageFormat.DiffKind.EXPECTED -> withStyle(SpanStyle(color = Palette.Easy, fontWeight = FontWeight.Bold, background = Palette.Easy.copy(alpha = 0.12f))) { append(ch) }
        }
    }
    put(user)
    if (expected != null) {
        withStyle(SpanStyle(color = Color(0xFF9CA3AF))) { append("  →  ") }
        put(expected)
    }
}

@Composable
fun AnswerDiff(userAnswer: String, correct: String) {
    if (userAnswer.isBlank()) return
    Text(answerDiffText(userAnswer, correct), fontSize = 18.sp)
}

/** Insights · History · Recordings as tabs between the three pages (web: TutorPageNav). */
@Composable
fun TutorPageTabs(relId: String, current: String, open: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("insights" to Routes.insights(relId), "history" to Routes.studentHistory(relId), "recordings" to Routes.recordings(relId)).forEach { (key, path) ->
            val active = key == current
            Text(
                key.replaceFirstChar { it.uppercase() },
                color = if (active) Lab.colors.ink else Lab.colors.muted,
                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                style = MaterialTheme.typography.labelLarge,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.weight(1f).heightIn(min = 40.dp).clip(RoundedCornerShape(11.dp))
                    .background(if (active) Lab.colors.card else Color.Transparent)
                    .bouncyClickable(enabled = !active) { open(path) }
                    .padding(vertical = 10.dp),
            )
        }
    }
}
