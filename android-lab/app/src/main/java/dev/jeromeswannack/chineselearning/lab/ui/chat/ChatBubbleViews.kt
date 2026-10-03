package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.ViewConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ChatBubbles
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatReplyToDto
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaSizing
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatWaveforms
import dev.jeromeswannack.chineselearning.lab.data.chat.LinkPreviewDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/*
 * Chat round 2 (docs/CHAT.md "Round 2"): a normal chat app. Bubbles carry no buttons — every tool
 * is in the long-press menu (ChatMenuSheet.kt). Signal-like colours and groups (ChatBubbles,
 * parity-tested), time + ticks inside the last bubble of a group, reactions overlapping the
 * bubble, the reply quote inside it, link previews, swipe right to reply.
 */

/** The chat's own colours: Signal's blue / grey bubbles over a plain background. */
@Immutable
data class ChatColors(
    val dark: Boolean,
    val screen: Color,
    val mine: Color,
    val onMine: Color,
    val theirs: Color,
    val onTheirs: Color,
    val metaMine: Color,
    val metaTheirs: Color,
    val dayPill: Color,
    val dayText: Color,
    val reactionPill: Color,
    val reactionBorder: Color,
)

@Composable
fun chatColors(): ChatColors {
    val c = Lab.colors
    val dark = c.background.luminance() < 0.4f
    return if (dark) ChatColors(
        dark = true, screen = c.background,
        mine = Color(0xFF3B7BF0), onMine = Color.White, theirs = Color(0xFF2B2B2E), onTheirs = c.ink,
        metaMine = Color.White.copy(alpha = 0.72f), metaTheirs = c.ink.copy(alpha = 0.55f),
        dayPill = Color(0xFF26262A), dayText = c.ink.copy(alpha = 0.7f),
        reactionPill = Color(0xFF2B2B2E), reactionBorder = c.background,
    ) else ChatColors(
        dark = false, screen = Color.White,
        mine = Color(0xFF2C6BED), onMine = Color.White, theirs = Color(0xFFE9E9EB), onTheirs = Color(0xFF1B1B1D),
        metaMine = Color.White.copy(alpha = 0.78f), metaTheirs = Color(0xFF1B1B1D).copy(alpha = 0.5f),
        dayPill = Color(0xFFF0F0F2), dayText = Color(0xFF5E5E66),
        reactionPill = Color(0xFFF2F2F4), reactionBorder = Color.White,
    )
}

private val BIG = 18.dp
private val SMALL = 4.dp
val MAX_BUBBLE = 480.dp
private const val BUBBLE_FRACTION = 0.78f

/** 18 dp corners; inside a group the corners facing the neighbouring bubbles are 4 dp. */
fun bubbleShape(mine: Boolean, first: Boolean, last: Boolean): RoundedCornerShape {
    val top = if (first) BIG else SMALL
    val bottom = if (last) BIG else SMALL
    return if (mine) RoundedCornerShape(topStart = BIG, topEnd = top, bottomEnd = bottom, bottomStart = BIG)
    else RoundedCornerShape(topStart = top, topEnd = BIG, bottomEnd = BIG, bottomStart = bottom)
}

/** What sits in the bubble's bottom-right corner: 📌 · edited · 9:41 · ✓✓. */
data class BubbleMeta(
    val time: String,
    val tick: ChatBubbles.Tick = ChatBubbles.Tick.NONE,
    val edited: Boolean = false,
    val pinned: Boolean = false,
    /** The ✎ "could be better" mark's accessible label ([SayBetter.label]); null = no mark. */
    val sayBetter: String? = null,
    /** false = only the ✎ (a bubble that isn't the last of its group, time not tapped open). */
    val showTime: Boolean = true,
)

private val META_STYLE = TextStyle(fontSize = 11.sp, lineHeight = 13.sp)

/** The ✎ mark's colour: a soft amber, calm on the blue bubble (not red, not alarming). */
val SayBetterAmber = Color(0xFFFFD58A)

/** Annotation tag carrying the ✎ mark's label, read back by [MetaLabel] for TalkBack. */
private const val SAY_BETTER_TAG = "say_better"

fun metaText(meta: BubbleMeta, base: Color, read: Color): AnnotatedString = buildAnnotatedString {
    meta.sayBetter?.let { label ->
        pushStringAnnotation(SAY_BETTER_TAG, label)
        withStyle(SpanStyle(color = SayBetterAmber, fontWeight = FontWeight.Bold)) { append(if (meta.showTime) "✎  " else "✎") }
        pop()
    }
    if (!meta.showTime) return@buildAnnotatedString
    withStyle(SpanStyle(color = base)) {
        if (meta.pinned) append("📌 ")
        if (meta.edited) append("edited  ")
        append(meta.time)
    }
    when (meta.tick) {
        ChatBubbles.Tick.NONE -> {}
        ChatBubbles.Tick.PENDING -> withStyle(SpanStyle(color = base)) { append(" 🕓") }
        ChatBubbles.Tick.SENT -> withStyle(SpanStyle(color = base)) { append(" ✓") }
        ChatBubbles.Tick.READ -> withStyle(SpanStyle(color = read, fontWeight = FontWeight.Bold)) { append(" ✓✓") }
        ChatBubbles.Tick.FAILED -> withStyle(SpanStyle(color = Palette.Again, fontWeight = FontWeight.Bold)) { append(" !") }
    }
}

/** The room the meta needs at the end of the last line. */
@Composable
private fun rememberMetaWidth(text: AnnotatedString?): Dp {
    if (text == null) return 0.dp
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    return remember(text, density) { with(density) { measurer.measure(text, META_STYLE, maxLines = 1).size.width.toDp() } + 8.dp }
}

@Composable
private fun MetaLabel(text: AnnotatedString, modifier: Modifier = Modifier) {
    // With the ✎ mark, TalkBack reads its label first ("Could be better — hold to see"), then the time.
    val label = text.getStringAnnotations(SAY_BETTER_TAG, 0, text.length).firstOrNull()?.item
    val rest = if (label == null) "" else text.text.replace("✎", "").trim()
    Text(
        text, style = META_STYLE, maxLines = 1,
        modifier = modifier.testTag("chat-meta").then(
            if (label == null) Modifier else Modifier.semantics { contentDescription = if (rest.isEmpty()) label else "$label · $rest" },
        ),
    )
}

/** A long press after 450 ms (docs/CHAT.md), not the platform's default. */
@Composable
private fun ChatLongPress(content: @Composable () -> Unit) {
    val base = LocalViewConfiguration.current
    val vc = remember(base) { object : ViewConfiguration by base { override val longPressTimeoutMillis: Long = LONG_PRESS_MS } }
    CompositionLocalProvider(LocalViewConfiguration provides vc) { content() }
}

const val LONG_PRESS_MS = 450L
val SWIPE_MAX = 72.dp
val SWIPE_THRESHOLD = 56.dp

/**
 * Swipe right on a bubble → reply: it follows the finger up to 72 dp, a ↩ fades in, a haptic tick
 * at 56 dp; let go past it and [onReply] runs. The bubble springs back either way.
 */
@Composable
fun SwipeToReply(enabled: Boolean, onReply: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val maxPx = with(density) { SWIPE_MAX.toPx() }
    val thresholdPx = with(density) { SWIPE_THRESHOLD.toPx() }
    val offset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    var armed by remember { mutableStateOf(false) }
    val reply by androidx.compose.runtime.rememberUpdatedState(onReply)
    Box(
        modifier.then(
            if (!enabled) Modifier else Modifier.pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragEnd = {
                        if (offset.value >= thresholdPx) reply()
                        armed = false
                        scope.launch { offset.animateTo(0f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessMedium)) }
                    },
                    onDragCancel = {
                        armed = false
                        scope.launch { offset.animateTo(0f, spring(Spring.DampingRatioMediumBouncy)) }
                    },
                ) { change, dx ->
                    val next = (offset.value + dx).coerceIn(0f, maxPx)
                    change.consume()
                    scope.launch { offset.snapTo(next) }
                    if (!armed && next >= thresholdPx) { armed = true; haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
                    else if (armed && next < thresholdPx) armed = false
                }
            },
        ),
    ) {
        val p = (offset.value / thresholdPx).coerceIn(0f, 1f)
        if (p > 0f) {
            Box(
                Modifier.align(Alignment.CenterStart).offset { IntOffset((offset.value - with(density) { 34.dp.toPx() }).roundToInt().coerceAtLeast(0), 0) }
                    .size(28.dp).alpha(p).clip(CircleShape).background(Lab.colors.ink.copy(alpha = 0.08f)),
                contentAlignment = Alignment.Center,
            ) { Text("↩", fontSize = 15.sp, color = Lab.colors.ink, fontWeight = FontWeight.Bold) }
        }
        Box(Modifier.offset { IntOffset(offset.value.roundToInt(), 0) }) { content() }
    }
}

/** The day separator: a centred pill (not sticky). */
@Composable
fun DayPill(label: String) {
    val c = chatColors()
    Box(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 4.dp).testTag("chat-day"), contentAlignment = Alignment.Center) {
        Text(
            label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = c.dayText,
            modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(c.dayPill).padding(horizontal = 12.dp, vertical = 4.dp),
        )
    }
}

/** Room above a bubble: 10 dp between groups, 2 dp inside one. */
fun groupGap(first: Boolean): Dp = if (first) 10.dp else 2.dp

/**
 * One message row: the bubble (with the reply quote inside, the meta in its corner, reactions over
 * its bottom edge), then what hangs under it (voice transcript, the tutor's correction, statuses).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubbleRow(m: ChatMessageDto, layout: ChatBubbles.Layout, ui: ChatUi, actions: ChatActions, onView: (ViewerTarget) -> Unit) {
    val mine = layout.mine
    val c = chatColors()
    val selecting = ui.selection != null
    val highlighted = ui.highlightId == m.id
    val ring by animateColorAsState(if (highlighted) Palette.Gold else Color.Transparent, tween(250), label = "hl")
    val shape = bubbleShape(mine, layout.firstInGroup, layout.lastInGroup)
    val bg = if (m.isDeleted) Color.Transparent else if (mine) c.mine else c.theirs
    val fg = if (m.isDeleted) Lab.colors.muted else if (mine) c.onMine else c.onTheirs
    val metaColor = if (mine && !m.isDeleted) c.metaMine else c.metaTheirs
    val showMeta = layout.lastInGroup || m.id in ui.timeShown
    // ✎ on my own message when it could be better (auto-check) or my tutor corrected it — shown even
    // without the time; the other side never sees it (auto_check only reaches the sender).
    val better = ui.sayBetter(m)?.let { dev.jeromeswannack.chineselearning.lab.core.SayBetter.label(it, ui.otherName) }
    val meta = if (!showMeta && better == null) null else metaText(
        BubbleMeta(
            ChatLogic.formatTime(m.created_at), layout.tick, edited = !m.edited_at.isNullOrEmpty() && !m.isDeleted, pinned = !m.pinned_at.isNullOrEmpty() && !m.isDeleted,
            sayBetter = better, showTime = showMeta,
        ),
        metaColor, if (mine) Color.White else Lab.colors.accent,
    )
    val haptic = LocalHapticFeedback.current
    val openMenu: () -> Unit = {
        if (!m.isDeleted) {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            if (selecting) actions.onToggleSelect(m.id) else actions.onOpenSheet(ChatSheet.Actions(m))
        }
    }
    RequestWordsOnScreen(m, actions)
    val invite = if (!m.isDeleted && !m.isVoice && !m.isImage) ChatLogic.callInvite(m.content) else null
    val link = if (!m.isDeleted && !m.isVoice && invite == null) ChatBubbles.firstLink(m.content) else null
    if (link != null) LaunchedEffect(link) { actions.onRequestLinkPreview(link) }
    if (m.isVoice) LaunchedEffect(m.id) { actions.onRequestWaveform(m.id, m, null) }

    val body: @Composable () -> Unit = {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            SwipeToReply(enabled = !selecting && !m.isDeleted, onReply = { actions.onReply(m) }) {
                Reactions(m, mine, ui, actions) {
                    ChatLongPress {
                        Box(
                            Modifier
                                .border(2.dp, ring, shape)
                                .clip(shape)
                                .background(bg)
                                .then(if (m.isDeleted) Modifier.border(1.dp, Lab.colors.ink.copy(alpha = 0.15f), shape) else Modifier)
                                .combinedClickable(
                                    onClick = {
                                        when {
                                            selecting -> actions.onToggleSelect(m.id)
                                            m.isImage -> onView(ViewerTarget(m, null))
                                            m.isFile -> actions.onOpenFile(m)
                                            m.isVideo -> actions.onToggleVideo(m.id)
                                            else -> actions.onToggleTime(m.id)
                                        }
                                    },
                                    onLongClick = openMenu,
                                    onLongClickLabel = "Message actions",
                                )
                                .testTag("chat-bubble"),
                        ) {
                            Column {
                                // Round 2 PR 3: "↪ Forwarded" on top of the bubble.
                                if (m.isForwarded) ForwardedLabel(mine, Modifier.padding(start = 12.dp, end = 12.dp, top = 6.dp))
                                when {
                                    m.isDeleted -> DeletedContent(fg, meta)
                                    m.isImage -> PhotoContent(m, fg, meta, ui, actions)
                                    m.isVoice -> VoiceContent(m.id, m, null, m.attachment!!.duration_ms, mine, meta, ui, actions)
                                    m.isFile -> FileContent(m, mine, fg, meta, ui, actions)
                                    m.isVideo -> VideoContent(m, fg, meta, ui, actions)
                                    else -> TextContent(m, mine, fg, meta, invite, link, ui, actions, openMenu)
                                }
                            }
                        }
                    }
                }
            }
            if (m.isVoice) Transcript(m, ui, actions, openMenu)
            m.correction?.takeIf { !m.isDeleted }?.let { cor ->
                CorrectionCard(
                    m, cor,
                    tutorView = !mine && ui.viewerRole == "tutor" && !ui.isAi && !selecting,
                    learnerView = false,
                    by = ui.otherName.ifEmpty { "Your tutor" },
                    onEdit = { actions.onOpenSheet(ChatSheet.Correct(m)) },
                    onCard = { actions.onCorrectionCard(m) },
                )
            }
            if (ui.checkingId == m.id) Status("Checking…")
            if (ui.translatingId == m.id) Status("Translating…")
        }
    }

    val rowModifier = Modifier.fillMaxWidth().padding(top = groupGap(layout.firstInGroup))
    if (selecting) {
        val ok = ui.pickable().firstOrNull { it.id == m.id }?.eligible == true
        Row(
            Modifier.testTag("chat-select-row").then(rowModifier).clickable(enabled = ok, onClickLabel = "Select") { actions.onToggleSelect(m.id) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SelectCircle(m.id in ui.selection!!.selected, ok)
            Row(Modifier.weight(1f), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                Box(Modifier.fillMaxWidth(BUBBLE_FRACTION).widthIn(max = MAX_BUBBLE), contentAlignment = if (mine) Alignment.TopEnd else Alignment.TopStart) { body() }
            }
        }
    } else {
        Row(rowModifier.testTag("chat-message"), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.CenterVertically) {
            val status = ui.checkStatus(m)
            if (mine && status != null && !m.isDeleted) CheckBadge(status) { actions.onViewCheck(m) }
            Box(Modifier.fillMaxWidth(BUBBLE_FRACTION).widthIn(max = MAX_BUBBLE), contentAlignment = if (mine) Alignment.TopEnd else Alignment.TopStart) { body() }
        }
    }
}

/** A small ✓ / ⚠ beside my checked message (tap = the check result). */
@Composable
private fun CheckBadge(status: String, onClick: () -> Unit) {
    val ok = status == "correct"
    Box(
        Modifier.padding(end = 6.dp).size(26.dp).clip(CircleShape).background((if (ok) Palette.Good else Palette.Hard).copy(alpha = 0.16f))
            .clickable(onClickLabel = "Check result", onClick = onClick).testTag("chat-check-badge"),
        contentAlignment = Alignment.Center,
    ) { Text(if (ok) "✓" else "⚠", color = if (ok) Palette.Good else Palette.Hard, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
}

/** The reactions pill over the bubble's bottom edge (`❤️ 2`); a tap on an emoji toggles mine. */
@Composable
private fun Reactions(m: ChatMessageDto, mine: Boolean, ui: ChatUi, actions: ChatActions, bubble: @Composable () -> Unit) {
    val list = if (m.isDeleted) emptyList() else m.reactions.filter { it.count > 0 || it.users.isNotEmpty() }
    if (list.isEmpty()) { bubble(); return }
    val c = chatColors()
    Box {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            bubble()
            Spacer(Modifier.height(20.dp))
        }
        Row(
            Modifier.align(if (mine) Alignment.BottomStart else Alignment.BottomEnd).padding(horizontal = 10.dp)
                .clip(RoundedCornerShape(14.dp)).background(c.reactionBorder).padding(2.dp)
                .clip(RoundedCornerShape(12.dp)).background(c.reactionPill).testTag("chat-reactions"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            list.forEach { r ->
                val isMine = r.users.any { it.id == ui.myId }
                val count = maxOf(r.count, r.users.size)
                Text(
                    r.emoji + if (count > 1) " $count" else "",
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    color = if (isMine) Lab.colors.accent else Lab.colors.ink,
                    fontWeight = if (isMine) FontWeight.SemiBold else FontWeight.Normal,
                    modifier = Modifier.clip(RoundedCornerShape(12.dp))
                        .then(if (isMine) Modifier.background(Lab.colors.accent.copy(alpha = 0.12f)) else Modifier)
                        .clickable(onClickLabel = if (isMine) "Remove your ${r.emoji}" else "React ${r.emoji}") { actions.onReact(m, r.emoji) }
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }
        }
    }
}

/** The reply quote inside the bubble: a 3 dp bar, the name and one line; tap jumps to it. */
@Composable
private fun ReplyQuote(r: ChatReplyToDto, mine: Boolean, ui: ChatUi, onJump: () -> Unit) {
    val c = chatColors()
    val original = ui.messages.firstOrNull { it.id == r.id }
    val name = if (r.sender.id.isNotEmpty() && r.sender.id == ui.myId) "You" else r.sender.name ?: "Unknown"
    val line = when {
        !r.deleted_at.isNullOrEmpty() -> "Message deleted"
        original != null -> previewOf(original)
        else -> r.content.ifEmpty { "📎 Attachment" }
    }
    val tint = if (mine) Color.White.copy(alpha = 0.18f) else (if (c.dark) Color.White.copy(alpha = 0.07f) else Color.Black.copy(alpha = 0.06f))
    val bar = if (mine) Color.White else Lab.colors.accent
    Row(
        Modifier.padding(bottom = 6.dp).height(IntrinsicSize.Min).clip(RoundedCornerShape(8.dp)).background(tint)
            .clickable(onClickLabel = "Jump to the message", onClick = onJump).testTag("chat-reply-quote"),
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(bar))
        Column(Modifier.padding(horizontal = 8.dp, vertical = 5.dp)) {
            Text(name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (mine) Color.White else Lab.colors.accent, maxLines = 1)
            Text(line, fontSize = 14.sp, color = (if (mine) Color.White else Lab.colors.ink).copy(alpha = 0.82f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun BoxScope.MetaCorner(meta: AnnotatedString?) {
    if (meta != null) MetaLabel(meta, Modifier.align(Alignment.BottomEnd).padding(end = 10.dp, bottom = 5.dp))
}

@Composable
private fun DeletedContent(fg: Color, meta: AnnotatedString?) {
    val reserve = rememberMetaWidth(meta)
    Box {
        ReservedText(AnnotatedString("Message deleted"), reserve, color = fg, fontSize = 16.sp, lineHeight = 22.sp, fontStyle = FontStyle.Italic, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
        MetaCorner(meta)
    }
}

@Composable
private fun TextContent(m: ChatMessageDto, mine: Boolean, fg: Color, meta: AnnotatedString?, invite: Pair<String, String>?, link: String?, ui: ChatUi, actions: ChatActions, openMenu: () -> Unit) {
    val query = ui.search?.query?.takeIf { it.isNotBlank() && ui.highlightId == m.id }
    val preview = link?.let { ui.linkPreviews[it] }
    val translation = ui.translationOf(m)?.takeIf { ui.aids.translation(m.id) && ui.selection == null }
    val seg = ui.segmentations[m.id]
    val wordByWord = !mine && m.id in ui.wordByWord && seg != null
    // The meta sits at the end of the last line of text, unless a card / link ends the bubble.
    val inline = preview == null && invite == null && !wordByWord
    val reserve = if (inline) rememberMetaWidth(meta) else 0.dp
    Box {
        Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 7.dp, bottom = 7.dp)) {
            m.reply_to?.let { r -> ReplyQuote(r, mine, ui) { actions.onJumpTo(r.id) } }
            if (wordByWord) WordByWord(m, seg!!, ui, actions)
            else {
                val shown = invite?.first ?: m.content
                ChineseText(
                    m, shown, if (invite == null && query == null) ui.words(m) else null, mine, fg, ui,
                    onChip = { i -> actions.onChip(m, i) },
                    reserve = if (translation == null) reserve else 0.dp,
                    onLongPress = openMenu,
                    plain = { r -> ReservedText(highlight(shown, query), r, color = fg, fontSize = 17.sp, lineHeight = 24.sp) },
                )
                translation?.let { TranslationLine(it, mine, reserve) }
            }
            if (preview != null) LinkPreviewCard(link, preview, mine, actions)
            invite?.let { (_, callId) ->
                Text(
                    "📹 Join the call", color = if (mine) Color.White else Lab.colors.accent, fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 6.dp).clip(RoundedCornerShape(10.dp)).clickable { actions.onJoinCall(callId) }.padding(vertical = 4.dp),
                )
            }
            if (!inline && meta != null) Spacer(Modifier.height(14.dp))
        }
        if (meta != null) MetaLabel(meta, Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 6.dp))
    }
}

/** The Claude practice chat's "Word by word": tappable chunks + the translation. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun WordByWord(m: ChatMessageDto, seg: dev.jeromeswannack.chineselearning.lab.data.api.SegmentedDto, ui: ChatUi, actions: ChatActions) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            seg.segmentation.chunks.forEach { chunk ->
                Text(
                    chunk.hanzi, fontSize = 18.sp, color = Lab.colors.ink,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Lab.colors.card.copy(alpha = 0.7f)).clickable { actions.onWord(chunk.hanzi, m.content) }.padding(horizontal = 5.dp, vertical = 2.dp),
                )
            }
        }
        Text(m.translation ?: seg.translation.ifEmpty { seg.segmentation.english }, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink.copy(alpha = 0.65f))
    }
}

/** The search query marked in the text (case-insensitive). */
fun highlight(text: String, query: String?): AnnotatedString = buildAnnotatedString {
    val q = query?.trim()?.lowercase()
    if (q.isNullOrEmpty()) { append(text); return@buildAnnotatedString }
    val lower = text.lowercase()
    var i = 0
    while (i < text.length) {
        val j = lower.indexOf(q, i)
        if (j < 0 || lower.length != text.length) { append(text.substring(i)); break }
        append(text.substring(i, j))
        withStyle(SpanStyle(background = Palette.Gold.copy(alpha = 0.55f), color = Color.Black)) { append(text.substring(j, j + q.length)) }
        i = j + q.length
    }
}

/** The link preview under the text: picture on top, site, title, two lines of description; tap opens it. */
@Composable
private fun LinkPreviewCard(url: String, p: LinkPreviewDto, mine: Boolean, actions: ChatActions) {
    val tint = if (mine) Color.White.copy(alpha = 0.16f) else Lab.colors.ink.copy(alpha = 0.06f)
    val fg = if (mine) Color.White else Lab.colors.ink
    val image by produceState<ImageBitmap?>(null, p.image) { value = p.image?.takeIf { it.isNotBlank() }?.let { runCatching { actions.loadLinkImage(it, 720) }.getOrNull() } }
    Column(
        Modifier.padding(top = 8.dp).widthIn(max = 300.dp).clip(RoundedCornerShape(10.dp)).background(tint)
            .clickable(onClickLabel = "Open the link") { actions.onOpenLink(url) }.testTag("chat-link-preview"),
    ) {
        image?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(1.91f)) }
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            val site = p.site_name?.takeIf { it.isNotBlank() } ?: runCatching { java.net.URI(url).host?.removePrefix("www.") }.getOrNull()
            site?.let { Text(it, fontSize = 12.sp, color = fg.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis) }
            p.title?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 19.sp) }
            p.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = fg.copy(alpha = 0.8f), maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 17.sp) }
        }
    }
}

@Composable
private fun PhotoContent(m: ChatMessageDto, fg: Color, meta: AnnotatedString?, ui: ChatUi, actions: ChatActions) {
    val a = m.attachment!!
    val reserve = rememberMetaWidth(meta)
    Column {
        m.reply_to?.let { r -> Box(Modifier.padding(start = 6.dp, end = 6.dp, top = 6.dp)) { ReplyQuote(r, m.sender_id == ui.myId, ui) { actions.onJumpTo(r.id) } } }
        Box {
            ChatPhoto(key = m.id, width = a.width, height = a.height) { side -> actions.loadImage(m, side) }
            if (m.content.isBlank() && meta != null) PhotoMeta(meta)
        }
        if (m.content.isNotBlank()) Box {
            val query = ui.search?.query?.takeIf { it.isNotBlank() && ui.highlightId == m.id }
            ReservedText(highlight(m.content, query), reserve, color = fg, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
            MetaCorner(meta)
        }
    }
}

/** A document: the reply quote, the file card, the caption, the meta in the corner. */
@Composable
private fun FileContent(m: ChatMessageDto, mine: Boolean, fg: Color, meta: AnnotatedString?, ui: ChatUi, actions: ChatActions) {
    val a = m.attachment!!
    val reserve = rememberMetaWidth(meta)
    Box {
        Column(Modifier.padding(start = 10.dp, end = 12.dp, top = 9.dp, bottom = 7.dp)) {
            m.reply_to?.let { r -> ReplyQuote(r, mine, ui) { actions.onJumpTo(r.id) } }
            FileCard(a.name ?: "file", a.bytes, mine, opening = ui.openingFile == m.id, failed = m.id in ui.fileErrors)
            val query = ui.search?.query?.takeIf { it.isNotBlank() && ui.highlightId == m.id }
            if (m.content.isNotBlank()) ReservedText(highlight(m.content, query), reserve, color = fg, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(top = 6.dp))
            else if (meta != null) Spacer(Modifier.height(14.dp))
        }
        MetaCorner(meta)
    }
}

/** A video clip: the reply quote, the player (first frame + ▶ until tapped), the caption, the meta. */
@Composable
private fun VideoContent(m: ChatMessageDto, fg: Color, meta: AnnotatedString?, ui: ChatUi, actions: ChatActions) {
    val a = m.attachment!!
    val reserve = rememberMetaWidth(meta)
    // The clip's width holds the quote and the caption too (a tall clip never sits in a wider bubble).
    val (vw, _) = dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaSizing.videoSize(a.width, a.height)
    Column(Modifier.width(vw.dp)) {
        m.reply_to?.let { r -> Box(Modifier.padding(start = 6.dp, end = 6.dp, top = 6.dp)) { ReplyQuote(r, m.sender_id == ui.myId, ui) { actions.onJumpTo(r.id) } } }
        Box {
            ChatVideo(m.id, a.width, a.height, a.duration_ms, playing = ui.playingVideo == m.id, loadFile = { actions.loadVideo(m) }, loadPoster = actions.loadPoster)
            if (m.content.isBlank() && meta != null && ui.playingVideo != m.id) PhotoMeta(meta)
        }
        if (m.content.isNotBlank()) Box {
            val query = ui.search?.query?.takeIf { it.isNotBlank() && ui.highlightId == m.id }
            ReservedText(highlight(m.content, query), reserve, color = fg, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
            MetaCorner(meta)
        }
    }
}

/** On a photo without a caption: the time on a dark scrim. */
@Composable
private fun BoxScope.PhotoMeta(meta: AnnotatedString) {
    val plain = AnnotatedString(meta.text)
    Text(
        plain, style = META_STYLE, color = Color.White, maxLines = 1,
        modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp).clip(RoundedCornerShape(10.dp)).background(Color.Black.copy(alpha = 0.45f)).padding(horizontal = 7.dp, vertical = 2.dp).testTag("chat-meta"),
    )
}

/** A photo sized by its aspect ratio; a soft placeholder until the cache / download has it. */
@Composable
fun ChatPhoto(key: String, width: Int, height: Int, load: suspend (Int) -> ImageBitmap?) {
    val (w, h) = ChatMediaSizing.bubbleSize(width, height)
    val bitmap by produceState<ImageBitmap?>(null, key) { value = runCatching { load(720) }.getOrNull() }
    Box(Modifier.size(w.dp, h.dp).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
        val b = bitmap
        if (b != null) Image(b, contentDescription = "Photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text("📷", fontSize = 28.sp, modifier = Modifier.alpha(0.5f))
    }
}

/**
 * A voice message: ▶/⏸, the real waveform (40 bars from the decoded clip, seeded until then),
 * elapsed / total, the speed chip (1× → 1.5× → 2×, remembered) and the meta.
 */
@Composable
fun VoiceContent(playId: String, m: ChatMessageDto?, localPath: String?, durationMs: Long, mine: Boolean, meta: AnnotatedString?, ui: ChatUi, actions: ChatActions, width: Dp = 252.dp) {
    val c = chatColors()
    val v = ui.voice?.takeIf { it.id == playId }
    val fg = if (mine) Color.White else Lab.colors.accent
    val track = if (mine) Color.White.copy(alpha = 0.38f) else Lab.colors.ink.copy(alpha = 0.2f)
    val total = (v?.durationMs ?: durationMs).coerceAtLeast(1)
    val progress by animateFloatAsState(((v?.positionMs ?: 0).toFloat() / total).coerceIn(0f, 1f), tween(80), label = "voice")
    val bars = ui.waveforms[playId] ?: remember(playId) { ChatWaveforms.seeded(playId) }
    Column(Modifier.width(width).padding(start = 8.dp, end = 10.dp, top = 8.dp, bottom = 6.dp)) {
        m?.reply_to?.let { r -> ReplyQuote(r, mine, ui) { actions.onJumpTo(r.id) } }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(42.dp).clip(CircleShape).background(if (mine) Color.White.copy(alpha = 0.22f) else Lab.colors.accent.copy(alpha = 0.14f))
                    .clickable(onClickLabel = if (v?.playing == true) "Pause" else "Play") { actions.onToggleVoice(playId, m, localPath, durationMs) }.testTag("chat-voice-play"),
                contentAlignment = Alignment.Center,
            ) {
                if (v?.loading == true) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = fg)
                else Text(if (v?.playing == true) "⏸" else "▶", color = fg, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Waveform(bars, progress, fg, track, Modifier.fillMaxWidth().height(30.dp).testTag(if (ui.waveforms.containsKey(playId)) "chat-wave-real" else "chat-wave-seeded"))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (v != null && (v.playing || v.positionMs > 0)) ChatRich.duration(v.positionMs) + " / " + ChatRich.duration(total) else ChatRich.duration(durationMs),
                        fontSize = 12.sp, color = if (mine) c.metaMine else c.metaTheirs,
                    )
                    Spacer(Modifier.width(6.dp))
                    SpeedChip(ui.voiceSpeed, mine, actions.onCycleSpeed)
                    Spacer(Modifier.weight(1f))
                    meta?.let { MetaLabel(it) }
                }
            }
        }
    }
}

/** 1× / 1.5× / 2×. */
@Composable
private fun SpeedChip(speed: Float, mine: Boolean, onClick: () -> Unit) {
    val label = when (speed) { 1.5f -> "1.5×"; 2f -> "2×"; else -> "1×" }
    Box(
        Modifier.heightIn(min = 28.dp).clip(RoundedCornerShape(10.dp)).clickable(onClickLabel = "Playback speed", onClick = onClick).testTag("chat-voice-speed"),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label, fontSize = 11.sp, fontWeight = FontWeight.Bold,
            color = if (mine) Color.White else Lab.colors.ink.copy(alpha = 0.75f),
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (mine) Color.White.copy(alpha = 0.22f) else Lab.colors.ink.copy(alpha = 0.09f)).padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

/** Bars (0..1) filled up to [progress]. */
@Composable
fun Waveform(bars: List<Float>, progress: Float, fg: Color, track: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        if (bars.isEmpty()) return@Canvas
        val n = bars.size
        val gap = 2.dp.toPx()
        val w = ((size.width - gap * (n - 1)) / n).coerceAtLeast(1f)
        val r = CornerRadius(w / 2, w / 2)
        bars.forEachIndexed { i, f ->
            val h = (size.height * (0.12f + 0.88f * f.coerceIn(0f, 1f))).coerceAtLeast(w)
            val x = i * (w + gap)
            val on = (i + 0.5f) / n <= progress
            drawRoundRect(if (on) fg else track, Offset(x, (size.height - h) / 2), Size(w, h), r)
        }
    }
}

/** Under a voice bubble: "Transcribing…", the transcript (word chips), then its translation once toggled. */
@Composable
@OptIn(ExperimentalFoundationApi::class)
private fun Transcript(m: ChatMessageDto, ui: ChatUi, actions: ChatActions, openMenu: () -> Unit) {
    val a = m.attachment ?: return
    Column(
        Modifier.padding(top = 4.dp).widthIn(max = 300.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.ink.copy(alpha = 0.05f))
            .combinedClickable(onClick = { actions.onToggleTime(m.id) }, onLongClick = openMenu)
            .padding(horizontal = 12.dp, vertical = 8.dp).testTag("chat-transcript"),
    ) {
        when (a.transcript_status) {
            "done" -> {
                val t = a.transcript?.trim().orEmpty()
                if (t.isEmpty()) Text("No speech heard", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, fontStyle = FontStyle.Italic)
                else {
                    val q = ui.search?.query?.takeIf { ui.highlightId == m.id && it.isNotBlank() }
                    ChineseText(
                        m, t, if (q == null && m.words_source == "transcript") ui.words(m) else null, false, Lab.colors.ink, ui,
                        onChip = { i -> actions.onChip(m, i) },
                        onLongPress = openMenu,
                        plain = { r -> ReservedText(highlight(t, q), r, color = Lab.colors.ink, fontSize = 17.sp, lineHeight = 24.sp) },
                    )
                }
                val tr = a.translation?.takeIf { it.isNotBlank() }
                if (tr != null && ui.aids.translation(m.id) && ui.selection == null) TranslationLine(tr, false)
            }
            "failed" -> Text("Couldn't transcribe this one", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, fontStyle = FontStyle.Italic)
            else -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = Lab.colors.accent)
                Text("  Transcribing…", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
        }
    }
}

@Composable
private fun Status(text: String) {
    Row(Modifier.padding(top = 3.dp, start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(11.dp), strokeWidth = 1.5.dp, color = Lab.colors.accent)
        Text(" $text", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
    }
}

/** My unconfirmed send (the outbox row): 🕓 while it goes, a red "!" and "Not sent · Tap to retry" when it gave up. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PendingBubbleRow(p: PendingBubble, layout: ChatBubbles.Layout, ui: ChatUi, actions: ChatActions, onView: (ViewerTarget) -> Unit) {
    val c = chatColors()
    val shape = bubbleShape(true, layout.firstInGroup, layout.lastInGroup)
    val meta = if (layout.lastInGroup || p.failed || "p-" + p.clientId in ui.timeShown) metaText(BubbleMeta(ChatLogic.formatTime(dev.jeromeswannack.chineselearning.lab.core.Js.toIsoString(p.createdAtMs)), layout.tick), c.metaMine, Color.White) else null
    val reply = p.replyToId?.let { id -> ui.messages.firstOrNull { it.id == id } }
    if (p.kind == "voice") LaunchedEffect(p.clientId) { actions.onRequestWaveform("p-" + p.clientId, null, p.filePath) }
    Row(Modifier.fillMaxWidth().padding(top = groupGap(layout.firstInGroup)).testTag("chat-message"), horizontalArrangement = Arrangement.End) {
        Column(Modifier.fillMaxWidth(BUBBLE_FRACTION).widthIn(max = MAX_BUBBLE), horizontalAlignment = Alignment.End) {
            ChatLongPress {
                Box(
                    Modifier.clip(shape).background(c.mine.copy(alpha = if (p.failed) 0.55f else if (p.delivered) 1f else 0.85f))
                        .combinedClickable(
                            onClick = {
                                when {
                                    p.failed -> actions.onRetryPending(p.clientId)
                                    p.kind == "image" -> onView(ViewerTarget(null, p.filePath))
                                    p.kind == "file" -> actions.onOpenPendingFile(p)
                                    p.kind == "video" -> actions.onToggleVideo("p-" + p.clientId)
                                    else -> actions.onToggleTime("p-" + p.clientId)
                                }
                            },
                            onLongClick = { if (p.failed) actions.onDiscardPending(p.clientId) },
                        )
                        .testTag("chat-pending"),
                ) {
                    val reserve = rememberMetaWidth(meta)
                    when (p.kind) {
                        "image" -> Column {
                            Box {
                                ChatPhoto(key = "p-" + p.clientId, width = p.width, height = p.height) { side -> p.filePath?.let { actions.loadLocalImage(it, side) } }
                                if (p.content.isBlank() && meta != null) PhotoMeta(meta)
                            }
                            if (p.content.isNotBlank()) Box {
                                ReservedText(AnnotatedString(p.content), reserve, color = c.onMine, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                                MetaCorner(meta)
                            }
                        }
                        "voice" -> VoiceContent("p-" + p.clientId, null, p.filePath, p.durationMs ?: 0, true, meta, ui, actions)
                        "file" -> Box {
                            Column(Modifier.padding(start = 10.dp, end = 12.dp, top = 9.dp, bottom = 7.dp)) {
                                reply?.let { r -> ReplyQuote(ChatReplyToDto(r.id, r.content, r.sender, r.deleted_at), true, ui) { actions.onJumpTo(r.id) } }
                                FileCard(p.name ?: "file", p.bytes, mine = true, opening = false, failed = false)
                                if (meta != null) Spacer(Modifier.height(14.dp))
                            }
                            MetaCorner(meta)
                        }
                        "video" -> Box {
                            ChatVideo(
                                "p-" + p.clientId, p.width, p.height, p.durationMs ?: 0, playing = ui.playingVideo == "p-" + p.clientId,
                                loadFile = { p.filePath?.let { java.io.File(it) }?.takeIf { it.exists() } }, loadPoster = actions.loadPoster,
                            )
                            if (meta != null && ui.playingVideo != "p-" + p.clientId) PhotoMeta(meta)
                        }
                        else -> Box {
                            Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 7.dp, bottom = 7.dp)) {
                                reply?.let { r -> ReplyQuote(ChatReplyToDto(r.id, r.content, r.sender, r.deleted_at), true, ui) { actions.onJumpTo(r.id) } }
                                ReservedText(AnnotatedString(p.content), reserve, color = c.onMine, fontSize = 17.sp, lineHeight = 24.sp)
                            }
                            if (meta != null) MetaLabel(meta, Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 6.dp))
                        }
                    }
                }
            }
            if (p.failed) {
                Text(
                    "Not sent · Tap to retry", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Palette.Again,
                    modifier = Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(8.dp)).clickable { actions.onRetryPending(p.clientId) }.padding(horizontal = 4.dp, vertical = 6.dp).testTag("chat-not-sent"),
                )
            }
        }
    }
}

/** Three bouncing dots in a grey bubble (Claude thinking, or the other person typing). */
@Composable
fun TypingBubble() {
    val c = chatColors()
    val t = rememberInfiniteTransition(label = "typing")
    Row(Modifier.fillMaxWidth().padding(top = 10.dp).testTag("chat-typing")) {
        Row(Modifier.clip(RoundedCornerShape(BIG)).background(c.theirs).padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            repeat(3) { i ->
                val y by t.animateFloat(0f, -4f, infiniteRepeatable(tween(380, delayMillis = i * 130), RepeatMode.Reverse), label = "dot$i")
                val a by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(380, delayMillis = i * 130), RepeatMode.Reverse), label = "dota$i")
                Box(Modifier.offset(y = y.dp).size(8.dp).alpha(a).clip(CircleShape).background(c.onTheirs.copy(alpha = 0.55f)))
            }
        }
    }
}

/** The round ↓ jump-to-latest button, with the "N new" badge. */
@Composable
fun JumpToLatest(count: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = chatColors()
    Box(modifier.testTag("chat-new-pill").semantics { contentDescription = if (count > 0) "$count new messages — jump to the latest" else "Jump to the latest" }) {
        Box(
            Modifier.padding(top = 8.dp, end = 4.dp).size(46.dp).clip(CircleShape).background(if (c.dark) Color(0xFF2B2B2E) else Color.White)
                .border(1.dp, Lab.colors.ink.copy(alpha = 0.12f), CircleShape).clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { Text("↓", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink) }
        if (count > 0) {
            Text(
                if (count > 99) "99+" else "$count", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd).clip(RoundedCornerShape(10.dp)).background(c.mine).padding(horizontal = 6.dp, vertical = 1.dp),
            )
        }
    }
}

