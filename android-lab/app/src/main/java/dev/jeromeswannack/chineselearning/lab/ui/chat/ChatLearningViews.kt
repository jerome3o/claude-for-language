package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.core.MessageTools
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.data.api.ChatCorrectionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPinyin
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * docs/CHAT.md PR 3 in the Lab chat: word chips (+ pinyin over each word), the 拼 / EN toggles,
 * the tutor's correction under a bubble, "Make flashcards" selection mode and the composer's
 * ✓ "Check my Chinese" panel.
 */

/**
 * A message's Chinese as word chips (the reader's chips, lighter for a chat bubble): each word
 * with hanzi is tappable (→ the word sheet), a word already in a deck is quieter (no tint, a
 * green underline), punctuation / English stay plain. With pinyin on, each word carries its
 * pinyin above it. Without words yet: the plain text (+ the phone's own pinyin line).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChineseText(
    m: ChatMessageDto,
    text: String,
    words: List<ReaderWordDto>?,
    isMe: Boolean,
    color: Color,
    ui: ChatUi,
    onChip: (Int) -> Unit,
    fontSize: TextUnit = 17.sp,
    /** Room kept free at the end of the last line (round 2: the time + ticks sit there). */
    reserve: Dp = 0.dp,
    /** A long press on a word chip opens the message's menu like one anywhere on the bubble. */
    onLongPress: (() -> Unit)? = null,
    plain: (@Composable (reserve: Dp) -> Unit)? = null,
) = ChineseWords(
    text = text,
    // Picking messages: the plain text (taps select the message).
    words = if (ui.selection != null) null else words,
    isMe = isMe,
    color = color,
    showPinyin = ui.aids.pinyin(m.id) && ui.selection == null,
    known = ui.known,
    onChip = onChip,
    fontSize = fontSize,
    reserve = reserve,
    onLongPress = onLongPress,
    plain = plain,
)

/**
 * [ChineseText] without the chat screen's state — the word chips of any message list (the chat,
 * Ask Claude on the study card): [words] null = the plain text (+ the phone's pinyin line when
 * [showPinyin]); [known] = hanzi already in a deck (quieter chips).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChineseWords(
    text: String,
    words: List<ReaderWordDto>?,
    isMe: Boolean,
    color: Color,
    showPinyin: Boolean,
    known: Set<String>,
    onChip: (Int) -> Unit,
    fontSize: TextUnit = 17.sp,
    reserve: Dp = 0.dp,
    onLongPress: (() -> Unit)? = null,
    plain: (@Composable (reserve: Dp) -> Unit)? = null,
) {
    val pinyinColor = if (isMe) Color.White.copy(alpha = 0.82f) else Lab.colors.accent
    if (words == null) {
        val line = if (showPinyin) ChatPinyin.line(text) else null
        val plainReserve = if (line == null) reserve else 0.dp
        if (plain != null) plain(plainReserve) else ReservedText(AnnotatedString(text), plainReserve, color = color, fontSize = fontSize, lineHeight = fontSize * 1.42f)
        if (line != null) ReservedText(AnnotatedString(line), reserve, color = pinyinColor, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 2.dp).testTag("chat-pinyin"))
        return
    }
    FlowRow(
        Modifier.testTag("chat-words"),
        horizontalArrangement = Arrangement.spacedBy(1.dp),
        verticalArrangement = Arrangement.spacedBy(if (showPinyin) 4.dp else 3.dp),
    ) {
        words.forEachIndexed { i, w ->
            when {
                w.text.contains('\n') -> Spacer(Modifier.fillMaxWidth())
                else -> Segment(w, chip = MessageTools.looksLikeChinese(w.text) && ReaderWords.isTappable(w.text), known = w.text.trim() in known, showPinyin, isMe, color, pinyinColor, fontSize, onLongPress) { onChip(i) }
            }
        }
        if (reserve > 0.dp) Spacer(Modifier.width(reserve).height(16.dp))
    }
}

/**
 * Text that keeps [reserve] free after its last character (an inline placeholder), so a bubble's
 * time + ticks can sit at the end of the last line — or wrap onto a line of their own when the
 * line is full (Signal's look).
 */
@Composable
fun ReservedText(
    text: AnnotatedString,
    reserve: Dp,
    color: Color,
    fontSize: TextUnit,
    lineHeight: TextUnit,
    modifier: Modifier = Modifier,
    fontStyle: FontStyle? = null,
) {
    if (reserve <= 0.dp) {
        Text(text, color = color, fontSize = fontSize, lineHeight = lineHeight, fontStyle = fontStyle, modifier = modifier)
        return
    }
    val density = androidx.compose.ui.platform.LocalDensity.current
    val width = with(density) { reserve.toSp() }
    val full = remember(text) { buildAnnotatedString { append(text); append(" "); appendInlineContent(RESERVE_ID, " ") } }
    val inline = remember(width) {
        mapOf(RESERVE_ID to androidx.compose.foundation.text.InlineTextContent(
            androidx.compose.ui.text.Placeholder(width, 1.sp, androidx.compose.ui.text.PlaceholderVerticalAlign.TextBottom),
        ) {})
    }
    Text(full, color = color, fontSize = fontSize, lineHeight = lineHeight, fontStyle = fontStyle, modifier = modifier, inlineContent = inline)
}

private const val RESERVE_ID = "meta-reserve"

@Composable
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
private fun Segment(w: ReaderWordDto, chip: Boolean, known: Boolean, showPinyin: Boolean, isMe: Boolean, color: Color, pinyinColor: Color, fontSize: TextUnit, onLongPress: (() -> Unit)?, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (showPinyin) Text(if (chip) w.pinyin else " ", color = pinyinColor, fontSize = 11.sp, lineHeight = 13.sp, maxLines = 1)
        if (!chip) {
            Text(w.text, color = color, fontSize = fontSize, lineHeight = fontSize * 1.42f)
            return@Column
        }
        val tint = if (isMe) Color.White.copy(alpha = 0.12f) else Lab.colors.accentSoft.copy(alpha = 0.42f)
        val line = if (isMe) Color.White.copy(alpha = 0.75f) else Palette.Good.copy(alpha = 0.75f)
        Text(
            w.text,
            color = color,
            fontSize = fontSize,
            lineHeight = fontSize * 1.42f,
            modifier = Modifier.clip(RoundedCornerShape(6.dp))
                .then(
                    if (onLongPress == null) Modifier.bouncyClickable(pressedScale = 0.88f, onClick = onClick)
                    else Modifier.combinedClickable(onClick = onClick, onLongClick = onLongPress),
                )
                .then(if (known) Modifier.drawBehind {
                    val h = 1.5.dp.toPx()
                    drawRect(line, topLeft = Offset(2.dp.toPx(), size.height - h - 1.dp.toPx()), size = Size(size.width - 4.dp.toPx(), h))
                } else Modifier.background(tint))
                .semantics { contentDescription = if (known) "${w.text}, in your decks" else w.text }
                .testTag("chat-word-chip")
                .padding(horizontal = 2.dp),
        )
    }
}

/** The translation under a message (when its EN toggle is on). */
@Composable
fun TranslationLine(text: String, isMe: Boolean, reserve: Dp = 0.dp) {
    Column(Modifier.padding(top = 6.dp).testTag("chat-translation")) {
        Box(Modifier.width(36.dp).height(1.dp).background(if (isMe) Color.White.copy(alpha = 0.45f) else Lab.colors.ink.copy(alpha = 0.12f)))
        Spacer(Modifier.height(5.dp))
        ReservedText(AnnotatedString(text), reserve, color = if (isMe) Color.White.copy(alpha = 0.88f) else Lab.colors.ink.copy(alpha = 0.62f), fontSize = 15.sp, lineHeight = 21.sp)
    }
}

/** 拼 / EN next to the time: small toggles (44dp touch targets), tinted when on. */
@Composable
fun AidToggle(label: String, on: Boolean, description: String, tag: String, onClick: () -> Unit) {
    val bg by animateColorAsState(if (on) Lab.colors.accentSoft else Color.Transparent, label = "aid")
    val scale by animateFloatAsState(if (on) 1f else 0.94f, spring(Spring.DampingRatioMediumBouncy), label = "aidScale")
    Box(
        Modifier.size(width = 40.dp, height = 44.dp).clip(RoundedCornerShape(12.dp)).clickable(onClickLabel = description, onClick = onClick).testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontSize = 13.sp,
            fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
            color = if (on) Lab.colors.accent else Lab.colors.muted,
            modifier = Modifier.scale(scale).clip(RoundedCornerShape(8.dp)).background(bg).padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

/** The changed runs of a correction, coloured: taken out (red, on the ✗ line) or put in (green, on the ✓ line). */
@Composable
fun DiffLine(runs: List<ChatLearning.Run>, added: Boolean, fontSize: TextUnit = 17.sp, base: Color = Lab.colors.ink) {
    Text(
        buildAnnotatedString {
            for (r in runs) {
                if (r.same) append(r.text)
                else withStyle(
                    if (added) SpanStyle(color = Palette.Good, fontWeight = FontWeight.Bold, background = Palette.Good.copy(alpha = 0.14f))
                    else SpanStyle(color = Palette.Again, fontWeight = FontWeight.Bold, background = Palette.Again.copy(alpha = 0.12f)),
                ) { append(r.text) }
            }
        },
        color = base, fontSize = fontSize, lineHeight = fontSize * 1.4f,
    )
}

/**
 * The tutor's correction under a student's bubble: the character diff (what was taken out, what
 * was put in) and the note. The tutor taps it to edit; the student gets "🃏 Make a card".
 */
@Composable
fun CorrectionCard(m: ChatMessageDto, c: ChatCorrectionDto, tutorView: Boolean, learnerView: Boolean, by: String, onEdit: () -> Unit, onCard: () -> Unit) {
    val diff = remember(m.content, c.text) { ChatLearning.correctionDiff(m.content, c.text) }
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.padding(top = 4.dp).widthIn(max = 320.dp).clip(shape).background(Lab.colors.card).border(1.dp, Palette.Good.copy(alpha = 0.45f), shape)
            .then(if (tutorView) Modifier.clickable(onClickLabel = "Edit the correction", onClick = onEdit) else Modifier)
            .padding(horizontal = 12.dp, vertical = 9.dp)
            .testTag("chat-correction"),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("✏️ ${if (tutorView) "Your correction" else "$by's correction"}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Palette.Good, modifier = Modifier.weight(1f, fill = false))
            if (tutorView) Text("  Edit", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        }
        if (diff.identical) {
            Text(c.text, color = Lab.colors.ink, fontSize = 17.sp, lineHeight = 24.sp)
        } else {
            Row(verticalAlignment = Alignment.Top) {
                Text("✗ ", color = Palette.Again.copy(alpha = 0.8f), fontSize = 14.sp, modifier = Modifier.padding(top = 2.dp))
                DiffLine(diff.original, added = false, fontSize = 16.sp, base = Lab.colors.muted)
            }
            Row(verticalAlignment = Alignment.Top) {
                Text("✓ ", color = Palette.Good, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
                DiffLine(diff.corrected, added = true)
            }
        }
        c.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic, color = Lab.colors.muted) }
        if (learnerView) {
            Text(
                "🃏 Make a card from this",
                style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent,
                modifier = Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onCard).padding(vertical = 10.dp).testTag("chat-correction-card"),
            )
        }
    }
}

/** A round check at the start of a message in selection mode. */
@Composable
fun SelectCircle(selected: Boolean, enabled: Boolean) {
    val bg by animateColorAsState(if (selected) Lab.colors.accent else Color.Transparent, label = "sel")
    val scale by animateFloatAsState(if (selected) 1f else 0.9f, spring(Spring.DampingRatioMediumBouncy), label = "selScale")
    Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(24.dp).scale(scale).alpha(if (enabled) 1f else 0.25f).clip(CircleShape).background(bg)
                .border(2.dp, if (selected) Lab.colors.accent else Lab.colors.muted.copy(alpha = 0.6f), CircleShape),
            contentAlignment = Alignment.Center,
        ) { if (selected) Text("✓", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
    }
}

/** The header in selection mode: ✕ · "N selected" · Today · Last 50. */
@Composable
fun SelectionHeader(ui: ChatUi, actions: ChatActions) {
    val n = ui.selection?.selected?.size ?: 0
    Column(Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 6.dp, bottom = 4.dp).testTag("chat-select-header")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = actions.onCancelSelecting) { Icon(Icons.Filled.Close, "Stop selecting", tint = Lab.colors.ink) }
            Column(Modifier.weight(1f)) {
                Text(if (n == 0) "Pick messages" else "$n selected", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Text("Claude makes cards from what you pick", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
        }
        Row(Modifier.padding(start = 12.dp, top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LabChip("Today", modifier = Modifier.testTag("chat-pick-today"), onClick = actions.onSelectToday)
            LabChip("Last ${ChatLearning.LAST_N} messages", modifier = Modifier.testTag("chat-pick-last"), onClick = actions.onSelectLast)
        }
    }
}

/** The bar in selection mode (docs/CHAT.md "Round 2"): "N selected" · Copy · Make flashcards. */
@Composable
fun SelectionFooter(ui: ChatUi, actions: ChatActions) {
    val n = ui.selection?.selected?.size ?: 0
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).testTag("chat-select-bar"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ui.notice?.let { InlineNotice(it.text, kind = if (it.error) NoticeKind.Error else NoticeKind.Success, actionLabel = "×", onAction = actions.onDismissNotice) }
        if (!ui.online) InlineNotice("You're offline — making cards needs a connection.", kind = NoticeKind.Offline)
        if (ui.proposingCards) ProposingRow()
        else Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (n == 0) "Tap messages" else "$n selected", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.testTag("chat-select-count"))
            // Copy · Forward · Make flashcards (round 2 PR 3; no Forward in the Claude practice chat).
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryPill("Copy", Modifier.weight(0.8f).height(48.dp).testTag("chat-select-copy"), enabled = n > 0, onClick = actions.onCopySelection)
                if (!ui.isAi) SecondaryPill("Forward", Modifier.weight(1f).height(48.dp).testTag("chat-select-forward"), enabled = n > 0 && ui.online, onClick = actions.onForwardSelection)
                PrimaryPill(
                    // With Forward beside it the label shortens, so it stays on one line at 412 dp.
                    if (ui.isAi) "🃏 Make flashcards" else "🃏 Flashcards",
                    Modifier.weight(1.4f).height(48.dp).testTag("chat-propose"),
                    enabled = n > 0 && ui.online,
                    onClick = actions.onPropose,
                )
            }
        }
    }
}

@Composable
fun ProposingRow() {
    Row(Modifier.fillMaxWidth().heightIn(min = 54.dp).clip(RoundedCornerShape(27.dp)).background(Lab.colors.accentSoft).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
        Spacer(Modifier.width(12.dp))
        Text("Claude is picking cards…", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold)
    }
}

/** The ✓ in the composer (the learner's draft has Chinese). */
@Composable
fun CheckDraftButton(busy: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(CircleShape).bouncyClickable(enabled = enabled && !busy, pressedScale = 0.85f, onClick = onClick).alpha(if (enabled) 1f else 0.4f).testTag("chat-check-draft"),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Palette.Good)
        else Box(Modifier.size(32.dp).clip(CircleShape).border(2.dp, Palette.Good, CircleShape).semantics { contentDescription = "Check my Chinese" }, contentAlignment = Alignment.Center) {
            Text("✓", color = Palette.Good, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }
    }
}

/**
 * Above the composer after ✓: the draft vs Claude's correction as a character diff, the short
 * critique, then "Send as is" / "Use this" (or "Send" when it was already right).
 */
@Composable
fun DraftCheckPanel(check: DraftCheckUi?, actions: ChatActions) {
    AnimatedVisibility(check != null, enter = expandVertically(spring(Spring.DampingRatioLowBouncy)) + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        val c = check ?: return@AnimatedVisibility
        val shape = RoundedCornerShape(16.dp)
        Column(
            Modifier.fillMaxWidth().clip(shape).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, shape).padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 12.dp).testTag("chat-check-panel"),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("✓ Check my Chinese", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted, modifier = Modifier.weight(1f))
                IconButton(onClick = actions.onDismissCheck) { Icon(Icons.Filled.Close, "Close", tint = Lab.colors.muted) }
            }
            Column(Modifier.padding(end = 10.dp).heightIn(max = 260.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val r = c.result
                when {
                    c.loading -> Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 6.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                        Text("  Claude is reading it…", color = Lab.colors.muted)
                    }
                    c.error != null -> InlineNotice(c.error, kind = NoticeKind.Error)
                    r != null && (r.isCorrect || r.corrected.hanzi.isBlank()) -> {
                        Text("✓ Looks natural!", color = Palette.Good, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        if (r.critique.isNotBlank()) MarkdownText(r.critique, style = MaterialTheme.typography.bodyMedium)
                    }
                    r != null -> {
                        val diff = remember(c.draft, r.corrected.hanzi) { ChatLearning.correctionDiff(c.draft, r.corrected.hanzi) }
                        Row(verticalAlignment = Alignment.Top) {
                            Text("✗ ", color = Palette.Again.copy(alpha = 0.8f), fontSize = 14.sp, modifier = Modifier.padding(top = 2.dp))
                            DiffLine(diff.original, added = false, fontSize = 16.sp, base = Lab.colors.muted)
                        }
                        Row(verticalAlignment = Alignment.Top) {
                            Text("✓ ", color = Palette.Good, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
                            Column {
                                DiffLine(diff.corrected, added = true, fontSize = 19.sp)
                                if (r.corrected.pinyin.isNotBlank()) Text(r.corrected.pinyin, color = Lab.colors.accent, fontSize = 13.sp)
                                if (r.corrected.english.isNotBlank()) Text(r.corrected.english, color = Lab.colors.muted, fontSize = 14.sp)
                            }
                        }
                        if (r.critique.isNotBlank()) MarkdownText(r.critique, Modifier.padding(top = 2.dp), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            val r = c.result
            if (r != null) {
                Spacer(Modifier.height(10.dp))
                Row(Modifier.padding(end = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (r.isCorrect || r.corrected.hanzi.isBlank()) {
                        PrimaryPill("Send", Modifier.weight(1f).height(48.dp).testTag("chat-check-send"), onClick = actions.onSendAsIs)
                    } else {
                        SecondaryPill("Send as is", Modifier.weight(1f).testTag("chat-check-send"), onClick = actions.onSendAsIs)
                        PrimaryPill("Use this", Modifier.weight(1f).height(48.dp).testTag("chat-check-use"), onClick = actions.onUseCheck)
                    }
                }
            }
        }
    }
}

/** Asks for a message's words once it is on screen (the VM decides whether and once). */
@Composable
fun RequestWordsOnScreen(m: ChatMessageDto, actions: ChatActions) {
    LaunchedEffect(m.id, m.words == null, m.attachment?.transcript_status) { if (m.words == null) actions.onRequestWords(m) }
}

/** Shows a correction's original line with what changed marked (for the tutor's sheet preview). */
@Composable
fun CorrectionPreview(original: String, corrected: String) {
    val diff = remember(original, corrected) { ChatLearning.correctionDiff(original, corrected) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.background).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (diff.identical) Text("No change yet — edit the text above.", color = Lab.colors.muted, style = MaterialTheme.typography.bodyMedium)
        else {
            Row { Text("✗ ", color = Palette.Again.copy(alpha = 0.8f)); DiffLine(diff.original, added = false, fontSize = 16.sp, base = Lab.colors.muted) }
            Row { Text("✓ ", color = Palette.Good, fontWeight = FontWeight.Bold); DiffLine(diff.corrected, added = true) }
        }
    }
}
