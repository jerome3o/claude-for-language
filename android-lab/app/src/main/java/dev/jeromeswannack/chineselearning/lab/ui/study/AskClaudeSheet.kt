package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.core.MessageTools
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.core.SayBetter
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.api.AskToolResult
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChineseWords
import dev.jeromeswannack.chineselearning.lab.ui.chat.CoachChip
import dev.jeromeswannack.chineselearning.lab.ui.chat.ExplainContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.ExplainUi
import dev.jeromeswannack.chineselearning.lab.ui.chat.MessageMenuContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.SayBetterAmber
import dev.jeromeswannack.chineselearning.lab.ui.chat.SayBetterContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.SayBetterView
import dev.jeromeswannack.chineselearning.lab.ui.chat.TranslationLine
import dev.jeromeswannack.chineselearning.lab.ui.chat.chatColors
import dev.jeromeswannack.chineselearning.lab.ui.explorer.rememberExplorerTap
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFooterSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/** What the Ask Claude sheet calls (the view-model). */
class AskActions(
    val ask: (question: String, withHistory: Boolean, userAnswer: String?) -> Unit = { _, _, _ -> },
    val approve: () -> Unit = {},
    val reject: () -> Unit = {},
    /** The header's 中 / EN ('zh' | 'en'). */
    val setLanguage: (String) -> Unit = {},
    /** Long-press → Translate: the English of the answer / my question ([part]); false = couldn't. */
    val translate: suspend (id: String, part: String) -> Boolean = { _, _ -> false },
    /** Long-press → Read aloud (Claude in the app voice, mine in my voice). */
    val readAloud: (text: String, mine: Boolean) -> Unit = { _, _ -> },
    /** "Open in Coach": the Coach deep link (my Chinese checked, Claude's explained). */
    val openPath: (String) -> Unit = {},
    /** Hanzi already in a deck (quieter chips). */
    val known: suspend () -> Set<String> = { emptySet() },
    /** Analytics `study.ask_claude_tool`. */
    val track: (action: String, mine: Boolean) -> Unit = { _, _ -> },
)

/** Friendly labels for Claude's read-only lookups (`TOOL_LABELS`). */
private val TOOL_LABELS = mapOf(
    "search_cards" to "Searched cards",
    "list_conversations" to "Checked conversations",
    "get_deck_info" to "Looked up deck info",
    "get_note_cards" to "Checked card details",
    "get_note_history" to "Checked review history",
    "get_deck_progress" to "Checked deck progress",
    "get_due_cards" to "Checked due cards",
    "get_overall_stats" to "Checked study stats",
)

/** Test tags. */
object AskTags {
    const val SHEET = "ask-claude-sheet"
    const val MINE = "ask-mine"
    const val REPLY = "ask-claude-reply"
    const val LANG_ZH = "ask-lang-zh"
    const val LANG_EN = "ask-lang-en"
    const val HINT = "ask-hint"
    const val MARK = "ask-say-better-mark"
}

/** One bubble: the answer or my question of one Q&A. */
private data class AskTarget(val entry: AskAnswer, val part: String) {
    val mine get() = part == "question"
    val key get() = "${entry.id}:$part"
    val text get() = if (mine) entry.question else entry.answer
    val words: List<ReaderWordDto>? get() = if (mine) entry.question_words else entry.answer_words
    val translation: String? get() = if (mine) entry.question_translation else entry.answer_translation
    /** An English / older answer: Markdown, Copy only. */
    val markdown get() = !mine && entry.answer_lang != AskClaude.ZH
}

/** My question as a chat message (the auto-check rules and the How-to-say-it-better sheet read it). */
private fun AskAnswer.asMessage() = ChatMessageDto(
    id = id, sender_id = "me", content = question, translation = question_translation, auto_check = question_check,
)

/**
 * Ask Claude about this card (web components/askClaude/AskClaudeSheet.tsx): Claude answers in
 * simple Chinese by default (中文 / EN in the header), every Chinese word is a chip → the language
 * explorer, a long press opens the chat's message menu with the parts that fit (core
 * [AskClaude.menu]: Translate, Pinyin, Explain, Save as flashcard, Open in Coach, Read aloud, Copy),
 * and my own Chinese gets the chat's auto-check (✎, How to say it better, the Open in Coach chip).
 * Claude's changes still wait for Approve / Reject.
 */
@Composable
fun AskClaudeSheet(
    view: CardView,
    ask: AskUi,
    language: String,
    userAnswer: String?,
    online: Boolean,
    actions: AskActions,
    sentences: SentenceActions,
    onDismiss: () -> Unit,
) {
    LabBottomSheet(onDismiss = onDismiss) { AskClaudeBody(view, ask, language, userAnswer, online, actions, sentences) }
}

@Composable
fun AskClaudeBody(
    view: CardView,
    ask: AskUi,
    language: String,
    userAnswer: String?,
    online: Boolean,
    actions: AskActions,
    sentences: SentenceActions = SentenceActions(),
) {
    var question by remember { mutableStateOf("") }
    var pinyinOn by remember { mutableStateOf(emptySet<String>()) }
    var translateOn by remember { mutableStateOf(emptySet<String>()) }
    var menuFor by remember { mutableStateOf<AskTarget?>(null) }
    var explain by remember { mutableStateOf<Pair<ExplainUi, Boolean>?>(null) }
    var sayBetterFor by remember { mutableStateOf<String?>(null) }
    var known by remember { mutableStateOf(emptySet<String>()) }
    val scope = rememberCoroutineScope()
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val explore = rememberExplorerTap("ask_claude", view.note.hanzi)
    LaunchedEffect(Unit) { known = runCatching { actions.known() }.getOrDefault(emptySet()) }

    val typed = view.card.cardType != dev.jeromeswannack.chineselearning.lab.core.CardTypes.HANZI_TO_MEANING && !userAnswer.isNullOrEmpty()
    val loadExplain: (String, String, String?, Boolean) -> Unit = { key, text, translation, save ->
        val row = SentenceRow(key = "ask-$key", sentenceId = null, hanzi = text, pinyin = null, translation = translation, audioUrl = null, badge = null)
        explain = ExplainUi(key, text, translation) to save
        scope.launch {
            val r = runCatching { sentences.cachedExplanation(row) ?: sentences.explain(row) }
            val cur = explain?.takeIf { it.first.messageId == key } ?: return@launch
            val e = cur.first
            explain = r.fold(
                { x -> e.copy(loading = false, result = x, translation = e.translation ?: x.translation) },
                { e.copy(loading = false, error = if (online) "Couldn't explain it just now." else "You're offline — explaining needs a connection the first time.") },
            ) to cur.second
        }
    }
    fun openCoach(t: AskTarget, source: String) {
        val req = SayBetter.openInCoachRequest(if (t.mine) "me" else "claude", t.text, null, null, null, null, "me") ?: return
        actions.track(if (source == "menu") "open_coach" else "open_coach_$source", t.mine)
        actions.openPath(dev.jeromeswannack.chineselearning.lab.ui.coach.coachOpenPath(req.text, req.action, null))
    }
    suspend fun toggleTranslate(t: AskTarget) {
        if (t.key in translateOn) { translateOn = translateOn - t.key; return }
        translateOn = translateOn + t.key
        // Couldn't translate: switch it back off so the next tap retries.
        if (!actions.translate(t.entry.id, t.part)) translateOn = translateOn - t.key
    }

    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp).testTag(AskTags.SHEET), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Ask about: ${view.note.hanzi}", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            LanguageToggle(language, actions.setLanguage)
        }

        if (ask.conversation.isEmpty() && !ask.asking) {
            ChipRow {
                for (qa in AskClaude.quickActions(language, typed, !view.note.sentenceClue.isNullOrBlank())) {
                    LabChip(qa.label) { actions.ask(qa.question, false, userAnswer) }
                }
            }
            if (language == AskClaude.ZH) Text(
                "Claude answers in simple Chinese. Tap any word to look it up · hold a message to translate it.",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.testTag(AskTags.HINT),
            )
        }

        ask.conversation.forEachIndexed { i, qa ->
            val latest = i == ask.conversation.lastIndex
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (part in listOf("question", "answer")) {
                    val t = AskTarget(qa, part)
                    if (part == "answer") qa.readOnlyToolCalls?.takeIf { it.isNotEmpty() }?.let { ToolCalls(it.map { c -> c.tool to c.input }) }
                    Bubble(
                        t, showPinyin = t.key in pinyinOn, showTranslation = t.key in translateOn, known = known,
                        onWord = { w, sentence ->
                            ExplorerStack.itemForText(w.text, w.pinyin.ifEmpty { null }, w.gloss.ifEmpty { null }, sentence)?.let { item ->
                                actions.track("word", t.mine)
                                explore?.invoke(item)
                            }
                        },
                        onLongPress = { menuFor = t },
                    ) {
                        if (!t.mine) {
                            val results = qa.toolResults.orEmpty()
                            if (results.isNotEmpty()) {
                                Spacer(Modifier.height(8.dp))
                                if (latest && ask.pending != null) ApprovalBox(results, actions) else results.forEach { AppliedResult(it) }
                            }
                        }
                    }
                    if (t.mine && SayBetter.showCoachChip("me", qa.question, null, null, null, null, qa.question_check?.status, qa.question_check?.text, "me")) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { CoachChip { openCoach(t, "chip") } }
                    }
                }
            }
        }

        if (ask.asking) {
            ask.pendingQuestion?.let { q ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Text(q, color = Color.White, fontSize = 17.sp, modifier = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(18.dp)).background(chatColors().mine.copy(alpha = 0.7f)).padding(horizontal = 14.dp, vertical = 9.dp))
                }
            }
            Thinking(language)
        }
        ask.error?.takeIf { !ask.asking }?.let { InlineNotice(it, kind = NoticeKind.Error) }

        if (!ask.cardDeleted) {
            Row(verticalAlignment = Alignment.Bottom) {
                OutlinedTextField(
                    value = question,
                    onValueChange = { question = it },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                    placeholder = { Text(if (ask.pending != null) "Approve or reject changes first…" else if (language == AskClaude.ZH) "用中文问吧… (or English)" else "Ask a question…") },
                    enabled = !ask.asking && ask.pending == null,
                    maxLines = 5,
                    shape = RoundedCornerShape(18.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
                )
                Spacer(Modifier.width(8.dp))
                PrimaryPill("Ask", Modifier.height(52.dp), enabled = question.isNotBlank() && !ask.asking && ask.pending == null) {
                    actions.ask(question, true, userAnswer)
                    question = ""
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }

    // ---- The chat's sheets, over this one ----
    menuFor?.let { t ->
        val menu = AskClaude.menu(
            AskClaude.MenuMessage(t.mine, t.text, t.translation, t.entry.question_check?.status.takeIf { t.mine }, t.entry.question_check?.text.takeIf { t.mine }, t.markdown),
            pinyinOn = t.key in pinyinOn, translateOn = t.key in translateOn,
        )
        LabBottomSheet(onDismiss = { menuFor = null }) {
            MessageMenuContent(
                ChatMessageDto(id = t.key, sender_id = if (t.mine) "me" else "claude", content = t.text), menu, online, recent = emptyList(), mine = t.mine,
                onReact = {},
                onAction = { id ->
                    menuFor = null
                    if (id != MessageMenu.OPEN_COACH) actions.track(id, t.mine)
                    when (id) {
                        MessageMenu.SAY_BETTER -> sayBetterFor = t.entry.id
                        MessageMenu.OPEN_COACH -> openCoach(t, "menu")
                        MessageMenu.COPY -> clipboard.setText(androidx.compose.ui.text.AnnotatedString(t.text))
                        MessageMenu.TRANSLATE -> scope.launch { toggleTranslate(t) }
                        MessageMenu.PINYIN -> pinyinOn = if (t.key in pinyinOn) pinyinOn - t.key else pinyinOn + t.key
                        MessageMenu.EXPLAIN -> loadExplain(t.key, jsTrim(t.text), t.translation, false)
                        MessageMenu.SAVE_CARD -> loadExplain(t.key, jsTrim(t.text), t.translation, true)
                        MessageMenu.PLAY -> actions.readAloud(t.text, t.mine)
                    }
                },
            )
        }
    }
    explain?.let { (e, save) ->
        LabFooterSheet(onDismiss = { explain = null }) {
            ExplainContent(e, save, online, sentences, onRetry = { loadExplain(e.messageId, e.text, e.translation, save) }, onClose = { explain = null })
        }
    }
    sayBetterFor?.let { id ->
        val qa = ask.conversation.firstOrNull { it.id == id }
        val v = qa?.let { SayBetterView.of(it.asMessage(), "me", "Claude") }
        if (v != null) LabBottomSheet(onDismiss = { sayBetterFor = null }) {
            SayBetterContent(
                v, online, playing = false, cards = sentences,
                onPlay = { actions.readAloud(v.corrected, true) },
                onAsk = {
                    sayBetterFor = null
                    question = if (language == AskClaude.ZH) "为什么「${v.corrected}」更好？" else "Why is \"${v.corrected}\" better?"
                },
                onClose = { sayBetterFor = null },
                onOpenCoach = { sayBetterFor = null; openCoach(AskTarget(qa, "question"), "sheet") },
            )
        }
    }
}

private fun jsTrim(s: String) = dev.jeromeswannack.chineselearning.lab.core.NoteSearch.jsTrim(s)

/** 中文 | EN — what Claude answers in (Settings has the same switch). */
@Composable
private fun LanguageToggle(language: String, onChange: (String) -> Unit) {
    val haptics = LocalHapticFeedback.current
    Row(Modifier.clip(RoundedCornerShape(50)).background(Lab.colors.ink.copy(alpha = 0.06f)).padding(2.dp)) {
        for ((value, label, tag) in listOf(Triple(AskClaude.ZH, "中文", AskTags.LANG_ZH), Triple(AskClaude.EN, "EN", AskTags.LANG_EN))) {
            val on = language == value
            Box(
                Modifier.heightIn(min = 40.dp).widthIn(min = 48.dp).clip(RoundedCornerShape(50))
                    .background(if (on) Lab.colors.card else Color.Transparent)
                    .clickable(enabled = !on) { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); onChange(value) }
                    .semantics { contentDescription = if (value == AskClaude.ZH) "Claude answers in Chinese${if (on) ", selected" else ""}" else "Claude answers in English${if (on) ", selected" else ""}" }
                    .testTag(tag)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (on) Lab.colors.accent else Lab.colors.muted) }
        }
    }
}

/** One message in the chat's look: mine blue on the right, Claude's grey on the left. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Bubble(
    t: AskTarget,
    showPinyin: Boolean,
    showTranslation: Boolean,
    known: Set<String>,
    onWord: (ReaderWordDto, String) -> Unit,
    onLongPress: () -> Unit,
    extra: @Composable () -> Unit,
) {
    val c = chatColors()
    val haptics = LocalHapticFeedback.current
    val long = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); onLongPress() }
    val zh = MessageTools.looksLikeChinese(t.text)
    // Word chips made on the phone at once (data/text/DeviceWords: the deterministic segmenter).
    val words = if (!zh || t.markdown) null else DeviceWords.of(t.text)
    val better = t.mine && SayBetter.state("me", t.entry.question, null, null, false, null, t.entry.question_check?.status, t.entry.question_check?.text, "me") != null
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (t.mine) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier.widthIn(max = if (t.mine) 320.dp else 360.dp).clip(RoundedCornerShape(18.dp))
                .background(if (t.mine) c.mine else c.theirs)
                .combinedClickable(onClick = {}, onLongClick = long)
                .testTag(if (t.mine) AskTags.MINE else AskTags.REPLY)
                .padding(horizontal = 14.dp, vertical = 9.dp),
        ) {
            if (t.markdown) {
                MarkdownText(t.text, style = MaterialTheme.typography.bodyMedium.copy(color = if (t.mine) c.onMine else c.onTheirs))
            } else {
                ChineseWords(
                    text = t.text, words = words, isMe = t.mine, color = if (t.mine) c.onMine else c.onTheirs, showPinyin = showPinyin, known = known,
                    onChip = { i ->
                        val ws = words ?: return@ChineseWords
                        val offsets = ReaderWords.offsets(ws.map { it.text })
                        onWord(ws[i], ReaderWords.sentenceAround(t.text, offsets[i], offsets[i] + ws[i].text.length))
                    },
                    fontSize = 18.sp,
                    onLongPress = long,
                )
            }
            if (showTranslation) TranslationLine(t.translation ?: "Translating…", t.mine)
            if (better) Text(
                "✎", color = SayBetterAmber, fontWeight = FontWeight.Bold, fontSize = 13.sp,
                modifier = Modifier.align(Alignment.End).semantics { contentDescription = SayBetter.label(SayBetter.IMPROVABLE, null) }.testTag(AskTags.MARK),
            )
            extra()
        }
    }
}

@Composable
private fun ToolCalls(calls: List<Pair<String, JsonObject?>>) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.clip(RoundedCornerShape(10.dp)).clickable { expanded = !expanded }.padding(vertical = 4.dp)) {
        Text("${if (expanded) "▾" else "▸"} Used ${calls.size} tool${if (calls.size != 1) "s" else ""}", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        if (expanded) for ((tool, inputObj) in calls) {
            val input = inputObj?.entries?.joinToString(", ") { (k, v) -> "$k: ${(v as? JsonPrimitive)?.contentOrNull ?: v}" }
            Text("${TOOL_LABELS[tool] ?: tool}${if (!input.isNullOrEmpty()) " ($input)" else ""}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}

private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.int(key: String) = (this[key] as? JsonPrimitive)?.intOrNull

/** "Claude wants to make changes:" with Approve / Reject (the changes are already made server-side). */
@Composable
private fun ApprovalBox(results: List<AskToolResult>, actions: AskActions) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Claude wants to make changes:", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        for (tr in results) {
            when {
                !tr.success -> Text("Action failed: ${tr.error ?: "Unknown error"}", color = Palette.Again)
                tr.tool == "edit_current_card" -> Column {
                    Text("✎ Edit card", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    (tr.data?.get("changes") as? JsonObject)?.forEach { (field, value) ->
                        Text("$field: ${(value as? JsonPrimitive)?.contentOrNull ?: value}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    }
                }
                tr.tool == "create_flashcards" -> Column {
                    val n = tr.data?.int("count") ?: 0
                    Text("+ Create $n new card${if (n != 1) "s" else ""}", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    (tr.data?.get("created") as? JsonArray)?.forEach { el ->
                        val o = el as? JsonObject ?: return@forEach
                        Text("${o.str("hanzi")}  ${o.str("pinyin")} — ${o.str("english")}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    }
                }
                tr.tool == "delete_current_card" -> Text("🗑 Delete this card", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                tr.tool == "create_custom_lesson" -> Column {
                    Text("🎓 Mini lesson created: ${tr.data?.str("title").orEmpty()}", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    Text("It will appear in your next study session.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryPill("Approve", Modifier.weight(1f).height(46.dp), color = Palette.Good, onClick = actions.approve)
            SecondaryPill("Reject", Modifier.weight(1f).height(46.dp), onClick = actions.reject)
        }
    }
}

@Composable
private fun AppliedResult(tr: AskToolResult) {
    val text = when {
        !tr.success -> "Action failed: ${tr.error ?: "Unknown error"}"
        tr.tool == "edit_current_card" -> "Card updated" + ((tr.data?.get("changes") as? JsonObject)?.keys?.takeIf { it.isNotEmpty() }?.let { ": ${it.joinToString(", ")} changed" } ?: "")
        tr.tool == "create_flashcards" -> (tr.data?.int("count") ?: 0).let { n -> "$n new card${if (n != 1) "s" else ""} created" }
        tr.tool == "delete_current_card" -> "Card deleted — advancing to next card..."
        tr.tool == "create_custom_lesson" -> "Mini lesson created: ${tr.data?.str("title").orEmpty()} — it'll appear in your next study session"
        else -> return
    }
    Text(text, style = MaterialTheme.typography.labelMedium, color = if (tr.success) Palette.Good else Palette.Again)
}

@Composable
private fun Thinking(language: String) {
    val t = rememberInfiniteTransition(label = "thinking")
    val a by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "a")
    Text(if (language == AskClaude.ZH) "想一想… Thinking…" else "Thinking…", color = Lab.colors.muted, fontSize = 15.sp, modifier = Modifier.alpha(a))
}
