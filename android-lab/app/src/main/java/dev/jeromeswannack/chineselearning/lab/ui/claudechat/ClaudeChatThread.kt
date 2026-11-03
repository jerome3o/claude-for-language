package dev.jeromeswannack.chineselearning.lab.ui.claudechat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.animation.core.animateFloat
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.CoachAsk
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.core.MessageTools
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.core.SayBetter
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckDto
import dev.jeromeswannack.chineselearning.lab.ui.chat.CoachChip
import dev.jeromeswannack.chineselearning.lab.ui.chat.ExplainContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.ExplainUi
import dev.jeromeswannack.chineselearning.lab.ui.chat.MessageMenuContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.SayBetterAmber
import dev.jeromeswannack.chineselearning.lab.ui.chat.SayBetterContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.SayBetterView
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFooterSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceRow
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChineseWords
import dev.jeromeswannack.chineselearning.lab.ui.chat.ListeningContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.ListeningUi
import dev.jeromeswannack.chineselearning.lab.ui.chat.RevealButton
import dev.jeromeswannack.chineselearning.lab.ui.chat.RevealIn
import dev.jeromeswannack.chineselearning.lab.ui.chat.TranslationLine
import dev.jeromeswannack.chineselearning.lab.ui.chat.chatColors
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.readers.MarkedChars
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudHandle
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudMic
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudPanel
import dev.jeromeswannack.chineselearning.lab.ui.readers.rememberReadAloud
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

/**
 * A Claude chat's message list — context-agnostic (the web's components/claudeChat/ClaudeChatThread.tsx;
 * docs/CHAT.md "Ask Claude chat"): a thread id and plain messages, so the Coach's "💬 Ask Claude" and
 * later Claude chats share it.
 *
 * Signal bubbles (mine right, Claude's left); every Chinese word a chip (the device segmenter) → the
 * language explorer, each tap kept as a word to recap ([ClaudeChatThreadActions.onWord]); under each of
 * Claude's Chinese messages ([CoachAsk.readBackOffered]) ▶ · 拼 · EN · 🎤 Read it back — he reads it
 * aloud, the take is judged with the readers' comparison (core ReadAloud, [rememberReadAloud]) and the
 * message shows marked; words with a real mistake join the recap. 🎧 Listen first hides Claude's
 * Chinese until heard (the chat's listening bubble). English answers are Markdown.
 *
 * Claude threads (ui/claude, docs/CHAT.md "Claude thread view"): a pending reply shows "Thinking…" or
 * what Claude is doing ([ClaudeChatThreadActions.statusLine], e.g. "Looking through your cards…"); a
 * reply being STREAMED shows its text so far with a caret; anything that isn't a plain text message
 * (a Coach check / explain / translate result, a mistake lesson) is drawn by the caller (`special`),
 * tool results under a reply by `after`; my message written offline says "🕓 Will send when you're
 * online" until it is sent, or why it was refused (✕ forgets it).
 *
 * A long press on any finished bubble opens the chat's message menu with the parts that fit (core
 * [AskClaude.menu]: Copy, Translate, Pinyin, Explain, Save as flashcard, Open in Coach, Read aloud) —
 * Explain / Save as flashcard need [ClaudeChatThreadActions.cards]. My own Chinese carries the chat's
 * auto-check when the server ran it (a card question, [ClaudeChatMsg.autoCheck]): the ✎ mark, "How to
 * say it better" first in the menu, and the "Open in Coach" chip.
 */
data class ClaudeChatMsg(
    val id: String,
    val role: String,
    val text: String,
    val answerLang: String? = null,
    val status: String? = null,
    val error: String? = null,
    val translation: String? = null,
    /** 'text' (default) | 'analysis' | 'mistake_lesson' — anything but text goes to the caller's `special`. */
    val contentType: String = "text",
    /** Pending with some text: the reply is being streamed (its text so far). */
    val streaming: Boolean = false,
    /** Mine, written offline: waiting in the outbox. */
    val queued: Boolean = false,
    /** Mine, refused when the outbox sent it ([error] says why). */
    val queueFailed: Boolean = false,
    /** Mine: the chat's "check my Chinese" of it (a card question), once the server ran it. */
    val autoCheck: AutoCheckDto? = null,
) {
    /** My message as a chat message (the auto-check rules and the How-to-say-it-better sheet read it). */
    fun asChat(): ChatMessageDto = ChatMessageDto(id = id, sender_id = if (mine) ME else "claude", content = text, translation = translation, auto_check = autoCheck)

    val mine: Boolean get() = role == "user"
    val isText: Boolean get() = contentType == "text"
}

class ClaudeChatThreadActions(
    /** A word tapped (hanzi, pinyin, gloss, sentence, mine): the explorer + the recap. */
    val onWord: (ReaderWordDto, String, Boolean) -> Unit = { _, _, _ -> },
    /** EN: the English of a message (null = couldn't). */
    val translate: suspend (String) -> String? = { null },
    val retry: (String) -> Unit = {},
    /** ▶ a message in Claude's voice (again = stop). */
    val play: (ClaudeChatMsg) -> Unit = {},
    /** 🎧 hidden answers. */
    val listen: (String, Boolean) -> Unit = { _, _ -> },
    val reveal: (String) -> Unit = {},
    val toggleSlow: () -> Unit = {},
    val audioBusy: () -> Boolean = { false },
    /** A Read it back found these words said wrong. */
    val onReadBackWords: (List<CoachAsk.RecapWord>) -> Unit = {},
    /** He starts reading: anything playing stops. */
    val stopAudio: () -> Unit = {},
    /** Analytics `coach.ask_tool`. */
    val track: (String, Boolean) -> Unit = { _, _ -> },
    /** What a pending reply says instead of "Thinking…" (Claude using a tool), null = the usual. */
    val statusLine: (ClaudeChatMsg) -> String? = { null },
    /** ✕ on my message the outbox couldn't send. */
    val onDiscardQueued: (ClaudeChatMsg) -> Unit = {},
    /** Explain / Save as flashcard (the menu) and the How-to-say-it-better sheet's cards; null = left out. */
    val cards: SentenceActions? = null,
    /** "Open in Coach" (the menu, the chip under my checked question: menu | chip | sheet); null = left out. */
    val openCoach: ((ClaudeChatMsg, String) -> Unit)? = null,
    /** How to say it better → "Ask why": a question for the composer. */
    val onAskWhy: (String) -> Unit = {},
    /** Answers in Chinese (the "Ask why" wording). */
    val language: String = AskClaude.ZH,
    val online: Boolean = true,
)

/** "Me" in the auto-check rules (they compare a sender id with the viewer). */
private const val ME = "me"

object ClaudeChatTags {
    const val THREAD = "claude-chat-thread"
    const val MINE = "claude-chat-mine"
    const val REPLY = "claude-chat-reply"
    const val PENDING = "claude-chat-pending"
    const val FAILED = "claude-chat-failed"
    const val RETRY = "claude-chat-retry"
    const val PLAY = "claude-chat-play"
    const val PINYIN = "claude-chat-pinyin"
    const val TRANSLATE = "claude-chat-translate"
    const val READ_BACK = "claude-chat-read-back"
    const val HIDDEN = "claude-chat-listening-bubble"
    const val STREAMING = "claude-chat-streaming"
    const val STATUS_LINE = "claude-chat-status-line"
    const val QUEUED = "claude-chat-queued"
    const val QUEUE_FAILED = "claude-chat-queue-failed"
    const val DISCARD = "claude-chat-queue-discard"
    const val SPECIAL = "claude-chat-special"
    const val MARK = "claude-chat-say-better-mark"
    const val MENU = "claude-chat-menu"
}

@Composable
fun ClaudeChatThread(
    messages: List<ClaudeChatMsg>,
    listening: Boolean,
    listen: ListeningUi,
    listenNotice: Pair<String, String>?,
    playingText: String?,
    thinking: String,
    known: Set<String>,
    actions: ClaudeChatThreadActions,
    /** Screenshots: a Read it back state drawn as given, by message id. */
    readBackPreview: Map<String, ReadAloudHandle> = emptyMap(),
    /** Screenshots: messages shown with pinyin / their translation. */
    pinyinPreview: Set<String> = emptySet(),
    translatePreview: Set<String> = emptySet(),
    /** A non-text message (Coach result card, mistake lesson): the caller draws it. */
    special: (@Composable (ClaudeChatMsg) -> Unit)? = null,
    /** Under one of Claude's finished text replies (tool results). */
    after: (@Composable (ClaudeChatMsg) -> Unit)? = null,
) {
    var pinyinOn by remember { mutableStateOf(pinyinPreview) }
    var translateOn by remember { mutableStateOf(translatePreview) }
    var translations by remember { mutableStateOf(emptyMap<String, String?>()) }
    var menuFor by remember { mutableStateOf<ClaudeChatMsg?>(null) }
    var explain by remember { mutableStateOf<Pair<ExplainUi, Boolean>?>(null) }
    var sayBetterFor by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    fun toggleTranslate(m: ClaudeChatMsg) {
        if (m.id in translateOn) { translateOn = translateOn - m.id; return }
        actions.track("translate", m.mine)
        translateOn = translateOn + m.id
        if (m.translation == null && translations[m.id] == null) scope.launch {
            val t = actions.translate(m.id)
            if (t == null) translateOn = translateOn - m.id else translations = translations + (m.id to t)
        }
    }
    fun loadExplain(m: ClaudeChatMsg, save: Boolean) {
        val cards = actions.cards ?: return
        val text = NoteSearch.jsTrim(m.text)
        val translation = m.translation ?: translations[m.id]
        val row = SentenceRow(key = "claude-${m.id}", sentenceId = null, hanzi = text, pinyin = null, translation = translation, audioUrl = null, badge = null)
        explain = ExplainUi(m.id, text, translation) to save
        scope.launch {
            val r = runCatching { cards.cachedExplanation(row) ?: cards.explain(row) }
            val cur = explain?.takeIf { it.first.messageId == m.id } ?: return@launch
            val e = cur.first
            explain = r.fold(
                { x -> e.copy(loading = false, result = x, translation = e.translation ?: x.translation) },
                { e.copy(loading = false, error = if (actions.online) "Couldn't explain it just now." else "You're offline — explaining needs a connection the first time.") },
            ) to cur.second
        }
    }
    val openMenu: (ClaudeChatMsg) -> Unit = { m -> if (!m.queued && !m.queueFailed) menuFor = m }
    // 🎧 a new answer that arrives hidden plays once by itself (Ask Claude's rule).
    val seen = remember { messages.mapTo(HashSet()) { it.id } }
    val entries = messages.filter { !it.mine && it.status == null && it.isText }.map { AskClaude.ListeningEntry(it.id, it.text, it.answerLang) }
    LaunchedEffect(entries.size) {
        val id = AskClaude.autoPlayId(listening, entries, seen, listen.revealed, actions.audioBusy())
        entries.lastOrNull()?.let { seen += it.id }
        if (id != null) actions.listen(id, true)
    }
    Column(Modifier.fillMaxWidth().testTag(ClaudeChatTags.THREAD), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (m in messages) key(m.id) {
            when {
                m.mine -> Mine(m, known, m.id in pinyinOn, m.id in translateOn, m.translation ?: translations[m.id], actions, onLongPress = { openMenu(m) })
                !m.isText && special != null -> Box(Modifier.fillMaxWidth().testTag(ClaudeChatTags.SPECIAL)) { special(m) }
                m.status == "pending" && m.text.isNotEmpty() -> Streaming(m, actions.statusLine(m))
                m.status == "pending" -> Thinking(actions.statusLine(m) ?: thinking)
                m.status == "failed" -> Column(Modifier.testTag(ClaudeChatTags.FAILED), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    InlineNotice(m.error ?: "Claude couldn’t answer — try again.", kind = NoticeKind.Error)
                    SecondaryPill("Retry", Modifier.testTag(ClaudeChatTags.RETRY)) { actions.retry(m.id) }
                }
                AskClaude.answerHidden(AskClaude.ListeningEntry(m.id, m.text, m.answerLang), listening, listen.revealed) ->
                    Hidden(m, listen, listenNotice?.takeIf { it.first == m.id }?.second, actions)
                else -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    RevealIn(m.id, animate = m.id in listen.justRevealed) {
                        Claude(
                            m, known,
                            pinyin = m.id in pinyinOn,
                            translateOn = m.id in translateOn,
                            translation = m.translation ?: translations[m.id],
                            playing = playingText != null && playingText == m.text,
                            actions = actions,
                            preview = readBackPreview[m.id],
                            onLongPress = { openMenu(m) },
                            onPinyin = { actions.track("pinyin", false); pinyinOn = if (m.id in pinyinOn) pinyinOn - m.id else pinyinOn + m.id },
                            onTranslate = { toggleTranslate(m) },
                        )
                    }
                    after?.invoke(m)
                }
            }
        }
    }

    // ---- The chat's sheets, over this one ----
    menuFor?.let { m ->
        val menu = AskClaude.menu(
            AskClaude.MenuMessage(m.mine, m.text, m.translation ?: translations[m.id], m.autoCheck?.status.takeIf { m.mine }, m.autoCheck?.text.takeIf { m.mine }, markdown = !m.mine && m.answerLang != AskClaude.ZH && !MessageTools.looksLikeChinese(m.text)),
            pinyinOn = m.id in pinyinOn, translateOn = m.id in translateOn,
        ).let { menu ->
            menu.copy(items = menu.items.filter {
                (it.id != MessageMenu.OPEN_COACH || actions.openCoach != null) && ((it.id != MessageMenu.EXPLAIN && it.id != MessageMenu.SAVE_CARD) || actions.cards != null)
            })
        }
        LabBottomSheet(onDismiss = { menuFor = null }) {
            Box(Modifier.testTag(ClaudeChatTags.MENU)) {
                MessageMenuContent(
                    m.asChat(), menu, actions.online, recent = emptyList(), mine = m.mine,
                    onReact = {},
                    onAction = { id ->
                        menuFor = null
                        if (id != MessageMenu.OPEN_COACH) actions.track(id, m.mine)
                        when (id) {
                            MessageMenu.SAY_BETTER -> sayBetterFor = m.id
                            MessageMenu.OPEN_COACH -> actions.openCoach?.invoke(m, "menu")
                            MessageMenu.COPY -> clipboard.setText(androidx.compose.ui.text.AnnotatedString(m.text))
                            MessageMenu.TRANSLATE -> toggleTranslate(m)
                            MessageMenu.PINYIN -> pinyinOn = if (m.id in pinyinOn) pinyinOn - m.id else pinyinOn + m.id
                            MessageMenu.EXPLAIN -> loadExplain(m, false)
                            MessageMenu.SAVE_CARD -> loadExplain(m, true)
                            MessageMenu.PLAY -> actions.play(m)
                        }
                    },
                )
            }
        }
    }
    explain?.let { (e, save) ->
        val cards = actions.cards
        if (cards != null) LabFooterSheet(onDismiss = { explain = null }) {
            ExplainContent(e, save, actions.online, cards, onRetry = { messages.firstOrNull { it.id == e.messageId }?.let { loadExplain(it, save) } }, onClose = { explain = null })
        }
    }
    sayBetterFor?.let { id ->
        val m = messages.firstOrNull { it.id == id }
        val v = m?.let { SayBetterView.of(it.asChat(), ME, "Claude") }
        if (m != null && v != null) LabBottomSheet(onDismiss = { sayBetterFor = null }) {
            SayBetterContent(
                v, actions.online, playing = false, cards = actions.cards ?: SentenceActions(),
                onPlay = { actions.play(m.copy(id = "better:${m.id}", text = v.corrected)) },
                onAsk = {
                    sayBetterFor = null
                    actions.onAskWhy(if (actions.language == AskClaude.ZH) "为什么「${v.corrected}」更好？" else "Why is \"${v.corrected}\" better?")
                },
                onClose = { sayBetterFor = null },
                onOpenCoach = actions.openCoach?.let { open -> { sayBetterFor = null; open(m, "sheet") } },
            )
        }
    }
}

private fun wordsOf(text: String): List<ReaderWordDto>? = if (MessageTools.looksLikeChinese(text)) DeviceWords.of(text) else null

private fun onChipOf(text: String, words: List<ReaderWordDto>?, mine: Boolean, actions: ClaudeChatThreadActions): (Int) -> Unit = { i ->
    if (words != null) {
        val offsets = ReaderWords.offsets(words.map { it.text })
        actions.track("word", mine)
        actions.onWord(words[i], ReaderWords.sentenceAround(text, offsets[i], offsets[i] + words[i].text.length), mine)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Mine(m: ClaudeChatMsg, known: Set<String>, pinyin: Boolean, translateOn: Boolean, translation: String?, actions: ClaudeChatThreadActions, onLongPress: () -> Unit) {
    val c = chatColors()
    val haptics = LocalHapticFeedback.current
    val long = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); onLongPress() }
    val words = wordsOf(m.text)
    val sent = !m.queued && !m.queueFailed
    val check = m.autoCheck
    val better = sent && SayBetter.state(ME, m.text, null, null, false, null, check?.status, check?.text, ME) != null
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Column(
            Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(18.dp)).background(if (m.queued || m.queueFailed) c.mine.copy(alpha = 0.6f) else c.mine)
                .then(if (sent) Modifier.combinedClickable(onClick = {}, onLongClick = long) else Modifier)
                .testTag(ClaudeChatTags.MINE).padding(horizontal = 14.dp, vertical = 9.dp),
        ) {
            ChineseWords(text = m.text, words = words, isMe = true, color = c.onMine, showPinyin = pinyin, known = known, onChip = onChipOf(m.text, words, true, actions), fontSize = 17.sp, onLongPress = if (sent) long else null)
            if (translateOn) TranslationLine(translation ?: "Translating…", true)
            if (better) Text(
                "✎", color = SayBetterAmber, fontWeight = FontWeight.Bold, fontSize = 13.sp,
                modifier = Modifier.align(Alignment.End).semantics { contentDescription = SayBetter.label(SayBetter.IMPROVABLE, null) }.testTag(ClaudeChatTags.MARK),
            )
        }
        val open = actions.openCoach
        if (sent && open != null && SayBetter.showCoachChip(ME, m.text, null, null, null, null, check?.status, check?.text, ME)) {
            CoachChip { actions.track("open_coach_chip", true); open(m, "chip") }
        }
        if (m.queueFailed) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag(ClaudeChatTags.QUEUE_FAILED)) {
                Text("Couldn’t send: ${m.error?.takeIf { it.isNotBlank() } ?: "refused"}", color = Palette.Again, fontSize = 13.sp, modifier = Modifier.widthIn(max = 280.dp))
                Box(
                    Modifier.size(40.dp).clip(CircleShape).bouncyClickable(pressedScale = 0.9f, role = Role.Button) { actions.onDiscardQueued(m) }
                        .semantics { contentDescription = "Remove this message" }.testTag(ClaudeChatTags.DISCARD),
                    contentAlignment = Alignment.Center,
                ) { Text("✕", color = Palette.Again, fontSize = 15.sp) }
            }
        } else if (m.queued) {
            Text("🕓 Will send when you’re online", color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.testTag(ClaudeChatTags.QUEUED))
        }
    }
}

/** A reply being written: its text so far (plain Chinese, or Markdown), a blinking caret, what Claude is doing. */
@Composable
private fun Streaming(m: ClaudeChatMsg, statusLine: String?) {
    val c = chatColors()
    val blink = androidx.compose.animation.core.rememberInfiniteTransition(label = "caret")
    val caret by blink.animateFloat(
        initialValue = 0.6f, targetValue = 0f,
        animationSpec = androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(500, easing = androidx.compose.animation.core.LinearEasing), androidx.compose.animation.core.RepeatMode.Reverse),
        label = "caret-alpha",
    )
    Column(verticalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.testTag(ClaudeChatTags.STREAMING)) {
        Row(
            Modifier.widthIn(max = 360.dp).clip(RoundedCornerShape(18.dp)).background(c.theirs).padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Box(Modifier.weight(1f, fill = false)) {
                if (m.answerLang == "zh") Text(m.text, color = c.onTheirs, fontSize = 18.sp, lineHeight = 28.sp)
                else MarkdownText(m.text, style = MaterialTheme.typography.bodyMedium.copy(color = c.onTheirs))
            }
            Box(Modifier.padding(start = 3.dp, bottom = 4.dp).size(width = 8.dp, height = 16.dp).alpha(caret).background(c.onTheirs))
        }
        statusLine?.let { Text(it, color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.padding(start = 4.dp).testTag(ClaudeChatTags.STATUS_LINE)) }
    }
}

@Composable
private fun Thinking(label: String) {
    val c = chatColors()
    Row(
        Modifier.clip(RoundedCornerShape(18.dp)).background(c.theirs).padding(horizontal = 14.dp, vertical = 10.dp).testTag(ClaudeChatTags.PENDING),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Lab.colors.muted)
        Text(label, color = c.onTheirs.copy(alpha = 0.7f), fontSize = 15.sp)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Hidden(m: ClaudeChatMsg, listen: ListeningUi, notice: String?, actions: ClaudeChatThreadActions) {
    val c = chatColors()
    val haptics = LocalHapticFeedback.current
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.clip(RoundedCornerShape(18.dp)).background(c.theirs)
                    .combinedClickable(
                        onClickLabel = "Listen",
                        onLongClickLabel = "Reveal",
                        onClick = { actions.listen(m.id, false) },
                        onLongClick = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); actions.reveal(m.id) },
                    )
                    .testTag(ClaudeChatTags.HIDDEN),
            ) {
                ListeningContent(ChatMessageDto(id = m.id, sender_id = "claude", content = m.text), null, listen, actions.toggleSlow)
            }
            RevealButton { actions.reveal(m.id) }
        }
        notice?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.widthIn(max = 300.dp)) }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Claude(
    m: ClaudeChatMsg,
    known: Set<String>,
    pinyin: Boolean,
    translateOn: Boolean,
    translation: String?,
    playing: Boolean,
    actions: ClaudeChatThreadActions,
    preview: ReadAloudHandle?,
    onPinyin: () -> Unit,
    onTranslate: () -> Unit,
    onLongPress: () -> Unit = {},
) {
    val c = chatColors()
    val haptics = LocalHapticFeedback.current
    val long = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); onLongPress() }
    val offered = CoachAsk.readBackOffered(m.role, m.text, m.answerLang, m.status)
    val markdown = m.answerLang != "zh"
    val words = if (markdown) null else wordsOf(m.text)
    val live = if (preview == null && offered) rememberReadAloud(
        m.text,
        onStart = actions.stopAudio,
        onResult = {},
        surface = "claude_chat_read_back",
        event = "coach.ask_read_back",
        props = { r -> mapOf("wrong_words" to (r?.let { CoachAsk.readBackMistakeWords(m.text, words?.map { w -> w.text }.orEmpty(), it).size } ?: 0)) },
        onJudged = { r, _ -> actions.onReadBackWords(CoachAsk.readBackMistakeWords(m.text, words?.map { it.text }.orEmpty(), r)) },
    ) else null
    val readBack = preview ?: live
    val result = readBack?.ui?.result?.takeIf { readBack.ui.phase != "listening" }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Column(
            Modifier.widthIn(max = 360.dp).clip(RoundedCornerShape(18.dp)).background(c.theirs).combinedClickable(onClick = {}, onLongClick = long)
                .testTag(ClaudeChatTags.REPLY).padding(horizontal = 14.dp, vertical = 9.dp),
        ) {
            when {
                markdown -> MarkdownText(m.text, style = MaterialTheme.typography.bodyMedium.copy(color = c.onTheirs))
                result != null -> MarkedChars(result.chars, result.extraAtEnd, fontSize = 18.sp, lineHeight = 30.sp)
                else -> ChineseWords(text = m.text, words = words, isMe = false, color = c.onTheirs, showPinyin = pinyin, known = known, onChip = onChipOf(m.text, words, false, actions), fontSize = 18.sp, onLongPress = long)
            }
            if (translateOn) TranslationLine(translation ?: "Translating…", false)
        }
        if (offered && readBack != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ToolPill(if (playing) "■" else "▶", playing, if (playing) "Stop" else "Listen", ClaudeChatTags.PLAY) { actions.play(m) }
                ToolPill("拼", pinyin, "Pinyin", ClaudeChatTags.PINYIN, onPinyin)
                ToolPill("EN", translateOn, "English", ClaudeChatTags.TRANSLATE, onTranslate)
                ReadAloudMic(readBack.ui, readBack.actions.onMic, idleLabel = CoachAsk.READ_BACK_LABEL, tag = ClaudeChatTags.READ_BACK)
                if (readBack.ui.result == null && readBack.ui.phase == "idle") Text(CoachAsk.READ_BACK_LABEL, color = Lab.colors.muted, fontSize = 13.sp)
            }
            Box(Modifier.widthIn(max = 360.dp)) { ReadAloudPanel(readBack.ui, readBack.actions, listeningText = CoachAsk.READ_BACK_LISTENING) }
        }
    }
}

@Composable
private fun ToolPill(label: String, on: Boolean, description: String, tag: String, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 44.dp).widthIn(min = 44.dp).clip(CircleShape)
            .background(if (on) Lab.colors.accent.copy(alpha = 0.12f) else Lab.colors.faint)
            .border(1.dp, if (on) Lab.colors.accent else Lab.colors.cardBorder, CircleShape)
            .bouncyClickable(pressedScale = 0.92f, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description }
            .testTag(tag)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (on) Lab.colors.accent else Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
}
