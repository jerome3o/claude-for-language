package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.core.SayBetter
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkBody
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * "✨ How to say it better" (docs/CHAT.md "Auto-check"): the first item of the long-press menu on my
 * own message when the background check found something, or my tutor corrected it. Everything renders
 * from what is stored on the message (works offline); adding a card goes through the chat's usual
 * add-card sheet (deck picker, duplicate warning, `POST /api/decks/:id/notes`).
 */

/** One mistake row: "你说 去了 → 去" (or "Missing: …") + why, with a card when one is worth having. */
data class SayBetterMistake(val line: String, val why: String, val card: Chunk?)

data class SayBetterAlternative(val hanzi: String, val pinyin: String, val english: String, val note: String?)

/** What the sheet shows for one message. */
data class SayBetterView(
    /** [SayBetter.CORRECTED] | [SayBetter.IMPROVABLE]. */
    val state: String,
    /** "✏️ Minghui corrected this" when the tutor's correction is shown. */
    val header: String?,
    /** The tutor's note on her correction. */
    val note: String?,
    val original: String,
    val corrected: String,
    val pinyin: String,
    val english: String,
    val mistakes: List<SayBetterMistake>,
    val alternative: SayBetterAlternative?,
    /** "+ Add as flashcard". */
    val card: Chunk,
) {
    val diff: ChatLearning.CorrectionDiff get() = ChatLearning.correctionDiff(original, corrected)

    companion object {
        fun chunk(c: AutoCheckCardDto) = Chunk(c.hanzi, c.pinyin, c.english, c.fun_facts.takeIf { it.isNotBlank() })

        /** The mistake line: "你说 <quote> → <fix>", or "Missing: <fix>" when nothing was written there. */
        fun mistakeLine(quote: String, fix: String): String = if (quote.isBlank()) "Missing: $fix" else "你说 $quote → $fix"

        /**
         * The sheet for [m] as its sender sees it, or null when there is nothing to say. The tutor's
         * correction takes precedence (header + her note; pinyin made on the phone unless the check
         * reached the same sentence); else the background check's corrected sentence. The check's
         * mistakes / alternative are shown whenever the check is about the current text and (with a
         * correction) reached the same sentence — so the rows never contradict the tutor.
         */
        fun of(m: ChatMessageDto, myId: String?, tutorName: String?, pinyinOf: (String) -> String = { dev.jeromeswannack.chineselearning.lab.core.ToneChange.autoPinyin(it) }): SayBetterView? {
            val state = SayBetter.state(
                m.sender_id, m.content, m.deleted_at, m.attachment?.kind, m.correction != null, m.correction?.text,
                m.auto_check?.status, m.auto_check?.text, myId ?: "", m.attachment?.transcript, m.attachment?.transcript_status,
            ) ?: return null
            // A photo's caption / a voice message's transcript is what was checked (SayBetter.autoCheckText).
            val checkedText = SayBetter.autoCheckText(m.content, m.attachment?.kind, m.attachment?.transcript, m.attachment?.transcript_status)
            val check = m.auto_check?.takeIf { it.text == checkedText }
            val correction = m.correction?.takeIf { state == SayBetter.CORRECTED }
            val corrected = correction?.text ?: check?.corrected.orEmpty()
            val sameAsCheck = check != null && check.corrected == corrected && check.corrected.isNotEmpty()
            val pinyin = if (sameAsCheck) check!!.corrected_pinyin.ifBlank { pinyinOf(corrected) } else pinyinOf(corrected)
            val english = when {
                sameAsCheck -> check!!.corrected_english
                correction != null -> m.translation.orEmpty()
                else -> ""
            }
            val useCheck = check != null && (correction == null || sameAsCheck)
            val mistakes = if (!useCheck) emptyList() else check!!.mistakes.map { x -> SayBetterMistake(mistakeLine(x.quote, x.fix), x.why, x.card?.let(::chunk)) }
            val alt = if (!useCheck) null else check!!.alternative?.takeIf { it.hanzi.isNotBlank() }?.let { SayBetterAlternative(it.hanzi, it.pinyin, it.english, it.note?.takeIf { n -> n.isNotBlank() }) }
            val card = if (correction != null) {
                Chunk(correction.text, pinyin, english, correction.note?.takeIf { it.isNotBlank() })
            } else {
                check?.card?.takeIf { it.hanzi.isNotBlank() }?.let(::chunk) ?: Chunk(corrected, pinyin, english)
            }
            val first = tutorName?.takeIf { it.isNotBlank() }?.split(" ")?.get(0) ?: "Your tutor"
            return SayBetterView(
                state = state,
                header = if (correction != null) "✏️ $first corrected this" else null,
                note = correction?.note?.takeIf { it.isNotBlank() },
                original = checkedText,
                corrected = corrected,
                pinyin = pinyin,
                english = english,
                mistakes = mistakes,
                alternative = alt,
                card = card,
            )
        }
    }
}

/** Test tags. */
object SayBetterTags {
    const val SHEET = "say-better"
    const val PLAY = "say-better-play"
    const val ADD = "say-better-add"
    const val ASK = "say-better-ask"
    const val OPEN_COACH = "say-better-open-coach"
    fun mistake(i: Int) = "say-better-mistake-$i"
    fun mistakeCard(i: Int) = "say-better-mistake-card-$i"
}

/**
 * The sheet's content (stateless apart from which card is being added, so tests and screenshots
 * render it without a dialog). [adding] non-null shows the add-card step in place, like Explain.
 */
@Composable
fun SayBetterContent(
    v: SayBetterView,
    online: Boolean,
    playing: Boolean,
    cards: SentenceActions,
    onPlay: () -> Unit,
    onAsk: () -> Unit,
    onClose: () -> Unit,
    initialAdding: Chunk? = null,
    /** "🎓 Open in Coach": continue in the Sentence Coach with this result (docs/CHAT.md "Chat ↔ Coach"); null = hidden. */
    onOpenCoach: (() -> Unit)? = null,
) {
    var adding by remember(v.original, v.corrected) { mutableStateOf(initialAdding) }
    Column(Modifier.fillMaxWidth().testTag(SayBetterTags.SHEET)) {
        val a = adding
        if (a != null) {
            Text("Add as flashcard", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp))
            AddChunkBody(a, preferredDeck = "", cards, onDismiss = { adding = null }, bumpSource = "chat")
            Spacer(Modifier.height(12.dp))
            return@Column
        }
        Column(Modifier.padding(horizontal = 22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("How to say it better", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            v.header?.let { h ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(h, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = Palette.Good)
                    v.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic, color = Lab.colors.muted) }
                }
            }
            // You wrote: the original with what was taken out marked (the tutor correction's red pen).
            val diff = remember(v.original, v.corrected) { v.diff }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("You wrote", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                DiffLine(diff.original, added = false, fontSize = 17.sp, base = Lab.colors.muted)
            }
            // The corrected sentence, big, with ▶.
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Good.copy(alpha = 0.08f))
                    .border(1.dp, Palette.Good.copy(alpha = 0.35f), RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { DiffLine(diff.corrected, added = true, fontSize = 24.sp) }
                    PlayButton(playing, enabled = online, onPlay)
                }
                if (v.pinyin.isNotBlank()) Text(v.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
                if (v.english.isNotBlank()) Text(v.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
            }
            v.mistakes.forEachIndexed { i, x ->
                Row(Modifier.fillMaxWidth().testTag(SayBetterTags.mistake(i)), verticalAlignment = Alignment.Top) {
                    Text("•", color = SayBetterMark, fontSize = 18.sp, modifier = Modifier.padding(end = 8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(x.line, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                        if (x.why.isNotBlank()) Text(x.why, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    }
                    x.card?.let { c ->
                        Text(
                            "+ card", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent,
                            modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).clickable { adding = c }
                                .padding(horizontal = 10.dp, vertical = 12.dp).testTag(SayBetterTags.mistakeCard(i)),
                        )
                    }
                }
            }
            v.alternative?.let { alt ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.ink.copy(alpha = 0.04f)).padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text("More natural", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                    Text(alt.hanzi, fontSize = 19.sp, color = Lab.colors.ink)
                    if (alt.pinyin.isNotBlank()) Text(alt.pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent)
                    if (alt.english.isNotBlank()) Text(alt.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                    alt.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, color = Lab.colors.muted) }
                }
            }
            Spacer(Modifier.height(2.dp))
            PrimaryPill("+ Add as flashcard", Modifier.fillMaxWidth().height(52.dp).testTag(SayBetterTags.ADD)) { adding = v.card }
            SecondaryPill(
                if (online) "💬 Ask Claude about this" else "💬 Ask Claude about this · needs internet",
                Modifier.fillMaxWidth().height(48.dp).testTag(SayBetterTags.ASK), enabled = online,
            ) { onAsk() }
            onOpenCoach?.let { open ->
                SecondaryPill(
                    if (online) "🎓 Open in Coach" else "🎓 Open in Coach · needs internet",
                    Modifier.fillMaxWidth().height(48.dp).testTag(SayBetterTags.OPEN_COACH), enabled = online,
                ) { open() }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** The bullet colour of a mistake: the same calm amber family as the ✎ on the bubble, darker for paper. */
private val SayBetterMark = androidx.compose.ui.graphics.Color(0xFFE0A030)

@Composable
private fun PlayButton(playing: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).background(Lab.colors.accent.copy(alpha = 0.12f))
            .bouncyClickable(enabled = enabled, pressedScale = 0.85f, onClick = onClick).alpha(if (enabled) 1f else 0.4f)
            .semantics { contentDescription = if (playing) "Stop" else "Play the corrected sentence" }.testTag(SayBetterTags.PLAY),
        contentAlignment = Alignment.Center,
    ) { Text(if (playing) "■" else "▶", color = Lab.colors.accent, fontSize = 17.sp) }
    Spacer(Modifier.width(2.dp))
}
