package dev.jeromeswannack.chineselearning.lab.ui.today

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.TodayPlan
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** A locked lesson in "Ready to unlock": what unlocks it and whether its podcast was heard already. */
data class TodayLockedRow(
    val id: String,
    val title: String,
    val unlock: dev.jeromeswannack.chineselearning.lab.core.LessonUnlock,
    val audioTitle: String? = null,
    val listened: Boolean = false,
) {
    val line: String get() = dev.jeromeswannack.chineselearning.lab.core.LessonUnlocks.lockedLine(unlock, audioTitle)
    val button: String get() = dev.jeromeswannack.chineselearning.lab.core.LessonUnlocks.buttonLabel(unlock)
}

/** Today's reader row. */
data class TodayReaderRow(val state: State, val title: String? = null, val pages: Int = 0) {
    enum class State { TO_READ, READ, WRITING, NONE }
}

/**
 * Home's "Today": flashcards and the graded reader side by side (Lab "today split"). Mini lessons
 * are not today's study any more (Oct 2026): they are on Home's homework / to-do card.
 */
data class TodayHome(
    val cardsDue: Int = 0,
    val cardsReviewed: Int = 0,
    val reader: TodayReaderRow = TodayReaderRow(TodayReaderRow.State.NONE),
    /** "Ready to unlock" (locked lessons; never counted as today's work). */
    val locked: List<TodayLockedRow> = emptyList(),
) {
    val cardsDone: Boolean get() = cardsDue == 0
    val readerLeft: Boolean get() = reader.state == TodayReaderRow.State.TO_READ
    val extrasLeft: Int get() = if (readerLeft) 1 else 0
    val allClear: Boolean get() = cardsDue == 0 && extrasLeft == 0
    /** Kinds of work today that aren't finished ("2 to go"). */
    val kindsLeft: Int get() = (if (cardsDue > 0) 1 else 0) + (if (readerLeft) 1 else 0)

    companion object {
        /** From the plan: the story, the card numbers, the locked lessons. */
        fun from(
            snapshot: TodaySnapshot,
            cardsDue: Int,
            cardsReviewed: Int,
            /** An audio lesson's title and whether it was heard to the end (for the locked rows). */
            audio: (String) -> Pair<String?, Boolean> = { null to false },
        ): TodayHome {
            val reader = when {
                snapshot.readerEntry != null -> TodayReaderRow(TodayReaderRow.State.TO_READ, snapshot.readerEntry.reader.titleChinese.ifBlank { snapshot.readerEntry.reader.titleEnglish }, snapshot.readerEntry.reader.pages.size)
                snapshot.reader == TodayPlan.Reader.Done -> TodayReaderRow(TodayReaderRow.State.READ, snapshot.readerDone?.reader?.let { it.titleChinese.ifBlank { it.titleEnglish } })
                snapshot.writing -> TodayReaderRow(TodayReaderRow.State.WRITING)
                else -> TodayReaderRow(TodayReaderRow.State.NONE)
            }
            val locked = snapshot.locked.mapNotNull { e ->
                val unlock = e.unlock ?: return@mapNotNull null
                val (audioTitle, heard) = if (unlock.isAudio) audio(unlock.audioLessonId.orEmpty()) else (null to false)
                TodayLockedRow(e.id, e.lesson.title.ifBlank { e.lesson.spec.title }, unlock, audioTitle, heard)
            }
            return TodayHome(cardsDue, cardsReviewed, reader, locked)
        }
    }
}

class TodayActions(
    val onFlashcards: () -> Unit = {},
    val onReader: () -> Unit = {},
)

val LessonViolet = Color(0xFF8B5CF6)

/**
 * Home's "Today" card: compact rows (the #453 deck-queue style) — Flashcards, Graded reader —
 * each with its count, a thin progress bar and ✓ when done.
 */
@Composable
fun TodaySection(today: TodayHome, actions: TodayActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp, start = 2.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Today", style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted, modifier = Modifier.weight(1f))
            Text(
                if (today.allClear) "All done ✓" else "${today.kindsLeft} to go",
                style = MaterialTheme.typography.labelLarge,
                color = if (today.allClear) Palette.Good else Lab.colors.muted,
                fontWeight = if (today.allClear) FontWeight.SemiBold else FontWeight.Normal,
            )
        }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card)) {
            val reviewed = today.cardsReviewed
            TodayRow(
                icon = "🃏", tint = Lab.colors.accent, title = "Flashcards",
                subtitle = if (today.cardsDone) (if (reviewed > 0) "$reviewed reviews today" else "Nothing due today") else "${today.cardsDue} due · about ${TodayPlan.minutes(today.cardsDue)} min",
                trailing = if (today.cardsDone) null else "${today.cardsDue}",
                done = today.cardsDone && reviewed > 0,
                progress = if (reviewed + today.cardsDue == 0) null else reviewed.toFloat() / (reviewed + today.cardsDue),
                tag = TAG_CARDS, onClick = actions.onFlashcards,
            )
            HorizontalDivider(Modifier.padding(start = 64.dp, end = 16.dp), color = Lab.colors.faint)
            val r = today.reader
            TodayRow(
                icon = "📖", tint = Palette.Review, title = "Graded reader",
                subtitle = when (r.state) {
                    TodayReaderRow.State.TO_READ -> listOfNotNull(r.title, if (r.pages > 0) "${r.pages} pages" else null).joinToString(" · ")
                    TodayReaderRow.State.READ -> "Read today" + (r.title?.let { " · $it" } ?: "")
                    TodayReaderRow.State.WRITING -> "Today's story is being written…"
                    TodayReaderRow.State.NONE -> "No story today"
                },
                trailing = if (r.state == TodayReaderRow.State.TO_READ) "To read" else null,
                done = r.state == TodayReaderRow.State.READ,
                progress = null,
                muted = r.state == TodayReaderRow.State.NONE || r.state == TodayReaderRow.State.WRITING,
                tag = TAG_READER, onClick = actions.onReader,
            )
        }
    }
}

@Composable
private fun TodayRow(
    icon: String,
    tint: Color,
    title: String,
    subtitle: String,
    trailing: String?,
    done: Boolean,
    progress: Float?,
    tag: String,
    muted: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable(onClick = onClick).testTag(tag).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(tint.copy(alpha = if (done) 0.10f else 0.16f)), contentAlignment = Alignment.Center) {
            Text(icon, fontSize = 18.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = if (muted) Lab.colors.muted else Lab.colors.ink, maxLines = 1)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (progress != null && !done && progress > 0f) {
                Spacer(Modifier.height(5.dp))
                val shown by animateFloatAsState(progress.coerceIn(0f, 1f), spring(dampingRatio = 0.9f, stiffness = 120f), label = "todayProgress")
                Box(Modifier.fillMaxWidth(0.85f).height(3.dp).clip(CircleShape).background(Lab.colors.faint)) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(shown).clip(CircleShape).background(tint))
                }
            }
        }
        Spacer(Modifier.width(8.dp))
        when {
            done -> Text("✓", color = Palette.Good, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            trailing != null -> Text(trailing, color = tint, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge, maxLines = 1)
        }
        Text("  ›", color = Lab.colors.muted.copy(alpha = 0.6f), fontSize = 18.sp)
    }
}

const val TAG_CARDS = "today-cards"
const val TAG_READER = "today-reader"

@Composable
fun LockedLessonRow(l: TodayLockedRow, onUnlock: () -> Unit, onListen: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().testTag("locked-lesson-${l.id}").padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(LessonViolet.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Text("🔒", fontSize = 17.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(l.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                l.line + if (l.listened) " · listened ✓" else "",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 3, overflow = TextOverflow.Ellipsis,
            )
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (onListen != null) {
                    Box(
                        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(Lab.colors.faint).clickable(onClick = onListen)
                            .testTag("locked-listen-${l.id}").padding(horizontal = 14.dp, vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("▶ Listen", color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge) }
                }
                Box(
                    Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(LessonViolet).clickable(onClick = onUnlock)
                        .testTag("unlock-${l.id}").padding(horizontal = 14.dp, vertical = 10.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(l.button, color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge) }
            }
        }
    }
}

