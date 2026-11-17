package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.ui.kit.buttonBorder
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.style.TextAlign
import dev.jeromeswannack.chineselearning.lab.ui.study.devicePinyinLine
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CoachAction
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.CoachBreakdownWord
import dev.jeromeswannack.chineselearning.lab.core.CoachMistakeLesson
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.data.api.CoachAnalysisDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachBreakdownDto
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceBreakdown
import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachLine
import dev.jeromeswannack.chineselearning.lab.data.api.CoachMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachToolResultDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

// ============ The Coach's actions (the thread screen's composer / results) ============

private val ACTION_LOADING = mapOf(
    CoachAction.CHECK to "Checking your sentence…",
    CoachAction.EXPLAIN to "Explaining your sentence…",
    CoachAction.TRANSLATE to "Translating your sentence…",
)

/** Test tags on the action buttons. */
fun coachActionTag(a: CoachAction) = "coach-action-" + a.id

// ============ Conversation ============

data class CoachChatUi(
    val thread: Loadable<CoachThreadDto> = Loadable(),
    val followUp: String = "",
    val sending: Boolean = false,
    /** What was sent and is waiting for the reply (shown as the user's bubble). */
    val pendingMessage: String? = null,
    val sendError: String? = null,
    val online: Boolean = true,
    /** A failed reply's Retry is on its way. */
    val retrying: Boolean = false,
    /** "🎯 Mini lesson on this mistake": the request is on its way. */
    val lessonRequesting: Boolean = false,
    /** The lesson message being saved ("Save to my mini lessons"). */
    val lessonSaving: String? = null,
    val lessonError: String? = null,
) {
    /** A reply is being written in the background: Send waits for it (a mini lesson being written doesn't). */
    val replyPending: Boolean get() = thread.data?.messages?.any { it.isPending && it.content_type != CoachMistakeLesson.CONTENT_TYPE } == true

    /** The conversation's lesson message (one per conversation), if any. */
    val lessonMessage: CoachMessageDto? get() = thread.data?.messages?.firstOrNull { it.content_type == CoachMistakeLesson.CONTENT_TYPE }

    /** The check found a mistake (core CoachMistakeLesson.offered): the 🎯 button shows on the check's card. */
    val mistakeLessonOffered: Boolean get() {
        val messages = thread.data?.messages.orEmpty()
        val coach = messages.firstOrNull { it.content_type == "analysis" && it.status == null }?.let { CoachAnalysisDto.parse(it.content) }?.takeIf { it.kind == "chinese" }?.coach ?: return false
        val wrote = coach.originalInput.ifBlank { messages.firstOrNull { it.role == "user" }?.content.orEmpty() }
        return CoachMistakeLesson.offered(wrote, coach.isCorrect, coach.corrected.hanzi)
    }

}

data class CoachChatActions(
    val onBack: () -> Unit = {},
    val onNew: () -> Unit = {},
    val onFollowUp: (String) -> Unit = {},
    val onSend: (String) -> Unit = {},
    val onRetryLoad: () -> Unit = {},
    /** Explain's word rows → a card (the study card's AddChunkSheet, when there is no explorer). */
    val cards: SentenceActions = SentenceActions(),
    /** The add-card sheet's "⚡ Study it today" (null = the app's real bump). */
    val bump: dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi? = null,
    /** Retry a reply that failed (its message id). */
    val onRetryReply: (String) -> Unit = {},
    /** "🎯 Mini lesson on this mistake": ask for it (also Retry on a failed one). */
    val onMistakeLesson: () -> Unit = {},
    /** ▶ Do it on the lesson card (message id, its content). */
    val onPlayLesson: (String, CoachMistakeLesson.Content) -> Unit = { _, _ -> },
    /** "Save to my mini lessons" on the lesson card (message id). */
    val onSaveLesson: (String) -> Unit = {},
)

/**
 * One message of a Coach conversation — the check / explain / translate result cards, the mistake
 * lesson, a pending / failed reply, a follow-up answer with its tool results. The Coach's own screen
 * and the Claude thread view (ui/claude, the web's CoachMessageView) draw them with this.
 */
@Composable
internal fun CoachMessageItem(m: CoachMessageDto, ui: CoachChatUi, actions: CoachChatActions, convAction: CoachAction, isFirstAnalysis: Boolean, onAdd: (Chunk) -> Unit) {
    when {
        m.content_type == CoachMistakeLesson.CONTENT_TYPE -> when {
            m.isPending -> ThinkingCard(CoachMistakeLesson.BUSY, note = "You can leave — it will be here when you come back.", modifier = Modifier.testTag(CoachLessonTags.PENDING))
            m.isFailed -> InlineNotice(
                m.error?.takeIf { it.isNotBlank() } ?: "Claude couldn’t write a lesson for this one — try again.",
                modifier = Modifier.testTag(CoachLessonTags.FAILED),
                kind = NoticeKind.Error,
                actionLabel = when { ui.lessonRequesting -> "Retrying…"; ui.online -> "Retry"; else -> null },
                onAction = { if (!ui.lessonRequesting) actions.onMistakeLesson() },
            )
            else -> CoachMistakeLesson.parse(m.content)?.let { content ->
                MistakeLessonCard(content, saving = ui.lessonSaving == m.id, error = null, onPlay = { actions.onPlayLesson(m.id, content) }, onSave = { actions.onSaveLesson(m.id) })
            }
        }
        m.isPending && m.content_type == "analysis" -> ThinkingCard(ACTION_LOADING.getValue(convAction), note = "You can leave — the answer will be here when you come back.", modifier = Modifier.testTag(COACH_REPLY_PENDING_TAG))
        m.isPending -> ThinkingBubble(Modifier.testTag(COACH_REPLY_PENDING_TAG))
        m.isFailed -> InlineNotice(
            m.error?.takeIf { it.isNotBlank() } ?: "Claude couldn’t answer — try again.",
            modifier = Modifier.testTag(COACH_REPLY_FAILED_TAG),
            kind = NoticeKind.Error,
            actionLabel = when { ui.retrying -> "Retrying…"; ui.online -> "Retry"; else -> null },
            onAction = { if (!ui.retrying) actions.onRetryReply(m.id) },
        )
        else -> MessageView(m, ui.online, lesson = if (isFirstAnalysis) ({ MistakeLessonButton(ui, actions) }) else null, onAdd = onAdd)
    }
}

/**
 * "🎯 Mini lesson on this mistake" on the check's card: write one, open the one there is, or say
 * it's being written (core CoachMistakeLesson).
 */
@Composable
private fun MistakeLessonButton(ui: CoachChatUi, actions: CoachChatActions) {
    if (!ui.mistakeLessonOffered) return
    val lesson = ui.lessonMessage
    val writing = ui.lessonRequesting || lesson?.isPending == true
    val ready = lesson != null && lesson.status == null
    SecondaryPill(
        if (writing) CoachMistakeLesson.BUSY else CoachMistakeLesson.LABEL,
        Modifier.fillMaxWidth().padding(top = 8.dp).height(48.dp).testTag(CoachLessonTags.CHIP),
        enabled = !writing,
        fontSize = 15.sp,
    ) {
        val content = if (ready) CoachMistakeLesson.parse(lesson!!.content) else null
        if (content != null) actions.onPlayLesson(lesson!!.id, content) else actions.onMistakeLesson()
    }
}

@Composable
private fun MessageView(m: CoachMessageDto, online: Boolean, lesson: (@Composable () -> Unit)? = null, onAdd: (Chunk) -> Unit) {
    if (m.role == "user") return UserBubble(m.content)
    if (m.content_type == "analysis") {
        val a = CoachAnalysisDto.parse(m.content)
        if (a != null) return AnalysisView(a, online, lesson, onAdd)
    }
    Column(Modifier.fillMaxWidth(0.94f).clip(RoundedCornerShape(18.dp, 18.dp, 18.dp, 6.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp, 18.dp, 18.dp, 6.dp)).padding(14.dp)) {
        CoachMarkdown(m.content)
        val tools = CoachAnalysisDto.toolResults(m.tool_results)
        if (tools.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            tools.forEach { ToolChip(it, "coach") }
        }
    }
}

@Composable
private fun UserBubble(text: String) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            text,
            color = Color.White,
            fontSize = 16.sp,
            modifier = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp)).background(Lab.colors.accent).padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

/** Port of ToolResultChips: one chip per tool result (stored JSON, [CoachAnalysisDto.toolResults]). */
@Composable
internal fun CoachToolResults(raw: String?, surface: String = "thread") {
    CoachAnalysisDto.toolResults(raw).forEach { ToolChip(it, surface) }
}

private fun CoachToolResultDto.asCardTool() = dev.jeromeswannack.chineselearning.lab.core.claude.CardTools.Result(tool, success, data, error)

/** One tool result's chip. */
@Composable
private fun ToolChip(r: CoachToolResultDto, surface: String) {
    if (r.tool == "create_flashcards" && r.success) {
        // The cards with their note ids — `notes` (the Coach, reader / exercise chats) or `created` (a card thread):
        // "✓ Added 2 cards to From Claude" + a chip per word → the language explorer (⚡ Study it today there).
        val cards = dev.jeromeswannack.chineselearning.lab.core.claude.CardTools.addedCards(r.data)
        if (cards.isNotEmpty()) {
            val deckName = (r.data?.get("deck_name") as? kotlinx.serialization.json.JsonPrimitive)?.content
            Column(
                Modifier.padding(top = 4.dp).clip(RoundedCornerShape(12.dp)).background(Palette.Good.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 8.dp)
                    .testTag("claude-added-cards"),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("${dev.jeromeswannack.chineselearning.lab.core.claude.CardTools.addedCardsHead(cards.size)}${deckName?.let { " to $it" }.orEmpty()}", fontSize = 13.sp, color = Lab.colors.ink)
                dev.jeromeswannack.chineselearning.lab.ui.claude.AddedCardChips(cards, surface, Palette.Good)
                // "Open card ›" / "Open deck ›" (docs/CHAT.md "Tool lines you can tap").
                dev.jeromeswannack.chineselearning.lab.core.claude.CardTools.resultLink(r.asCardTool())?.let { dev.jeromeswannack.chineselearning.lab.ui.claude.ResultLinkGo(it, Palette.Good) }
            }
            return
        }
    }
    // A mini lesson, ⚡ bumped words, an edited card: the shared line, a link to what it made ("🎓 Mini lesson made: … · Start ›").
    if (r.success && r.tool in setOf("create_custom_lesson", "bump_cards", "edit_current_card")) {
        val line = dev.jeromeswannack.chineselearning.lab.core.claude.CardTools.lines(listOf(r.asCardTool())).firstOrNull() ?: return
        val tone = if (line.kind == "bumped") Color(0xFFB45309) else Palette.Good
        val link = line.link
        if (link != null) {
            dev.jeromeswannack.chineselearning.lab.ui.claude.ResultLinkLine(link, line.text, tone, Modifier.padding(top = 4.dp))
        } else {
            Text(line.text, fontSize = 13.sp, color = tone, modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(10.dp)).background(tone.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 6.dp))
        }
        return
    }
    val text = when {
        r.tool == "create_flashcards" && r.success -> {
            val notes = ((r.data?.get("notes") ?: r.data?.get("created")) as? kotlinx.serialization.json.JsonArray).orEmpty()
            val hanzi = notes.mapNotNull { ((it as? kotlinx.serialization.json.JsonObject)?.get("hanzi") as? kotlinx.serialization.json.JsonPrimitive)?.content }.joinToString("、")
            val deckName = (r.data?.get("deck_name") as? kotlinx.serialization.json.JsonPrimitive)?.content
            "✓ Added ${notes.size} card${if (notes.size == 1) "" else "s"}${deckName?.let { " to $it" }.orEmpty()}${if (hanzi.isNotEmpty()) ": $hanzi" else ""}"
        }
        r.tool == "create_custom_lesson" && r.success -> {
            val title = (r.data?.get("title") as? kotlinx.serialization.json.JsonPrimitive)?.content
            "🎓 Mini lesson created${title?.let { ": $it" }.orEmpty()} — it'll appear in your next study session"
        }
        r.success -> "✓ ${r.tool}"
        else -> "✗ ${r.tool}: ${r.error ?: "failed"}"
    }
    val color = if (r.success) Palette.Good else Palette.Again
    Text(text, fontSize = 13.sp, color = Lab.colors.ink, modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(10.dp)).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 6.dp))
}

@Composable
private fun AnalysisView(a: CoachAnalysisDto, online: Boolean, lesson: (@Composable () -> Unit)?, onAdd: (Chunk) -> Unit) {
    if (a.kind == "explain" && a.breakdown != null) return ExplainResult(a.breakdown, enabled = online, onAdd = onAdd, sentenceCard = false)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (a.kind == "chinese" && a.coach != null) {
            val r = a.coach
            SentenceCard {
                Badge(if (r.isCorrect) "✓ Looks good!" else "Needs a little work", if (r.isCorrect) Palette.Good else Palette.Hard)
                Headline(r.corrected, it)
                if (r.critique.isNotBlank()) CoachMarkdown(r.critique, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp))
                lesson?.invoke()
            }
            Alternatives(r.alternatives)
            a.explanation?.let { Explanation(it) }
        } else if (a.translation != null) {
            val t = a.translation
            SentenceCard {
                Badge("Translation", Palette.Good)
                Headline(t.primary, it)
                t.primary.note?.let { n -> CoachZh(n, fontSize = 13.sp, color = Lab.colors.muted) }
                t.usage_note?.let { n -> CoachMarkdown(n, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp)) }
            }
            Alternatives(t.alternatives)
        }
    }
}

/** Test tag on Explain's "+ Add whole sentence as card" (the chat's Explain sheet; the coach has none). */
const val COACH_ADD_SENTENCE_TAG = "coach-add-sentence"

/**
 * Explain (the web's ExplainResultBlock): the translation — used instead of Google Translate — then
 * the SAME one-word-per-row breakdown as the study card's "What's going on here?" (every row adds
 * that word as a card) and the whole sentence as a card, its fun_facts glossing every word.
 */
@Composable
internal fun ExplainResult(
    b: CoachBreakdownDto,
    enabled: Boolean,
    onAdd: (Chunk) -> Unit,
    offlineNote: String? = null,
    /** "+ Add whole sentence as card" (the chat's Explain sheet); the coach has 🎤 Practise saying it instead. */
    sentenceCard: Boolean = true,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (sentenceCard) Card {
            Badge("🔍 Explained", Palette.Secondary)
            offlineNote?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
            Text(b.hanzi, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            if (b.pinyin.isNotBlank()) Text(b.pinyin, fontSize = 16.sp, color = Lab.colors.accent)
            b.translation?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 17.sp, color = Lab.colors.ink.copy(alpha = 0.85f)) }
        } else SentenceCard { stop ->
            Badge("🔍 Explained", Palette.Secondary)
            offlineNote?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
            CoachZh(b.hanzi, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            if (b.pinyin.isNotBlank()) Text(b.pinyin, fontSize = 16.sp, color = Lab.colors.accent)
            b.translation?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 17.sp, color = Lab.colors.ink.copy(alpha = 0.85f)) }
            PractiseSentenceRow(b.hanzi, stop = stop)
        }
        Card {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Word by word", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                if (enabled) Text("Tap a word to explore it", fontSize = 12.sp, color = Lab.colors.muted)
            }
            SentenceBreakdown(b.asExplanation().copy(translation = null), enabled = enabled, onWord = { w -> onAdd(Chunk(w.hanzi, w.pinyin, w.gloss)) }, sentence = b.hanzi)
            if (sentenceCard) {
                val card = CoachActions.sentenceCard(b.hanzi, b.pinyin, b.translation, b.words.map { CoachBreakdownWord(it.hanzi, it.pinyin, it.gloss) }, b.construction)
                SecondaryPill(
                    "+ Add whole sentence as card",
                    Modifier.fillMaxWidth().padding(top = 6.dp).height(48.dp).testTag(COACH_ADD_SENTENCE_TAG),
                    enabled = enabled && card.english.isNotEmpty(),
                ) { onAdd(Chunk(card.hanzi, card.pinyin, card.english, card.funFacts)) }
            }
        }
    }
}

/** A coach answer's big sentence: its words tappable into the explorer, then ▶ and 🎤 Practise saying it. */
@Composable
private fun Headline(l: CoachLine, stop: PractiseStop) {
    CoachZh(l.hanzi, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
    Text(l.pinyin, fontSize = 16.sp, color = Lab.colors.accent)
    Text(l.english, fontSize = 15.sp, color = Lab.colors.muted)
    PractiseSentenceRow(l.hanzi, stop = stop)
}

/** "Other ways to say it": each one tappable by word, with its own ▶ / 🎤. */
@Composable
private fun Alternatives(alts: List<CoachLine>) {
    if (alts.isEmpty()) return
    SentenceCard { stop ->
        Text("Other ways to say it", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        alts.forEachIndexed { i, alt ->
            Column(Modifier.padding(top = 4.dp)) {
                CoachZh(alt.hanzi, fontSize = 19.sp)
                Text("${alt.pinyin} — ${alt.english}", fontSize = 14.sp, color = Lab.colors.muted)
                alt.note?.let { CoachZh(it, fontSize = 13.sp, color = Lab.colors.muted) }
                PractiseSentenceRow(alt.hanzi, tag = "${CoachPractiseTags.ROOT}-alt-$i", stop = stop)
            }
        }
    }
}

/** A [Card] that stops a take in progress on any tap inside it (the web's "tap the card to stop"). */
@Composable
private fun SentenceCard(content: @Composable ColumnScope.(PractiseStop) -> Unit) {
    val stop = remember { PractiseStop() }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp))
            .practiseTapToStop(stop).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) { content(stop) }
}

/** Legacy conversations still carry the full breakdown. */
@Composable
private fun Explanation(e: CoachExplanationDto) {
    if (e.overview.isNotBlank()) Card { Text("Overview", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink); CoachMarkdown(e.overview) }
    if (e.words.isNotEmpty()) Card {
        Text("Word by word", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        e.words.forEach { w ->
            CoachZh(w.hanzi + (w.role?.let { "  · $it" }.orEmpty()), fontSize = 18.sp)
            Text("${w.pinyin} — ${w.english}", fontSize = 14.sp, color = Lab.colors.muted)
            w.notes?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
        }
    }
    if (e.grammar_points.isNotEmpty()) Card {
        Text("Grammar", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        e.grammar_points.forEach { g ->
            Text(g.pattern, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)
            CoachMarkdown(g.explanation, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp))
            g.example?.let { CoachZh("e.g. $it", fontSize = 13.sp, color = Lab.colors.muted) }
        }
    }
    e.nuance?.let { Card { Text("Nuance & usage", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink); CoachMarkdown(it) } }
    if (e.similar_examples.isNotEmpty()) Card {
        Text("Similar sentences", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        e.similar_examples.forEach { CoachZh(it.hanzi, fontSize = 18.sp); Text("${it.pinyin} — ${it.english}", fontSize = 14.sp, color = Lab.colors.muted) }
    }
}

@Composable
private fun Badge(text: String, color: Color) {
    Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp))
}

@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        content = content,
    )
}

@Composable
private fun ThinkingDots() {
    val t = rememberInfiniteTransition(label = "dots")
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        for (i in 0 until 3) {
            val a by t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(500, delayMillis = i * 150), RepeatMode.Reverse), label = "d$i")
            Box(Modifier.size(8.dp).alpha(a).clip(CircleShape).background(Lab.colors.accent))
        }
    }
}

@Composable
private fun ThinkingBubble(modifier: Modifier = Modifier) {
    AnimatedVisibility(true, modifier = modifier, enter = fadeIn() + slideInVertically { it / 2 }) {
        Row(
            Modifier.clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)).padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ThinkingDots()
            Spacer(Modifier.width(10.dp))
            Text("Thinking…", color = Lab.colors.muted)
        }
    }
}

@Composable
private fun ThinkingCard(text: String, note: String? = null, modifier: Modifier = Modifier) {
    Box(modifier) {
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ThinkingDots()
                Spacer(Modifier.width(12.dp))
                Text(text, color = Lab.colors.muted)
            }
            note?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
        }
    }
}

/** Test tags. */
const val COACH_REPLY_PENDING_TAG = "coach-reply-pending"
const val COACH_REPLY_FAILED_TAG = "coach-reply-failed"
const val COACH_CONV_PENDING_TAG = "coach-conv-pending"
const val COACH_CONV_FAILED_TAG = "coach-conv-failed"
/** The follow-up's Send: the voice-first box's submit (typing in tests, which have no microphone). */
const val COACH_SEND_TAG = dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SUBMIT

