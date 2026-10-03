package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.MINIMAX_VOICES
import dev.jeromeswannack.chineselearning.lab.data.api.SuggestedCard
import dev.jeromeswannack.chineselearning.lab.data.api.VocabularyDefinition
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** What the sheets can do (wired to ChatViewModel in ChatNav). */
class ChatSheetActions(
    val onDismiss: () -> Unit = {},
    val onTool: (id: String, ChatMessageDto) -> Unit = { _, _ -> },
    val onReact: (ChatMessageDto, String) -> Unit = { _, _ -> },
    val onSaveCards: (cards: List<SuggestedCard>, deckId: String?, newDeck: String?) -> Unit = { _, _, _ -> },
    val onTogglePin: (String) -> Unit = {},
    val onHelpMeSayIt: (intended: String, guess: String) -> Unit = { _, _ -> },
    val onToggleOption: (Int) -> Unit = {},
    val onRename: (String) -> Unit = {},
    val onVoice: (String) -> Unit = {},
    val onSpeed: (Double) -> Unit = {},
    val onNewConversation: () -> Unit = {},
    val onOpenRename: () -> Unit = {},
    val onOpenVoice: () -> Unit = {},
    val onAllConversations: () -> Unit = {},
    val onAsk: (ChatMessageDto, String) -> Unit = { _, _ -> },
    val onToggleDiscussCard: (Int) -> Unit = {},
    val onSaveDiscussCards: (ChatMessageDto, deckId: String?, newDeck: String?) -> Unit = { _, _, _ -> },
    val define: suspend (hanzi: String, context: String, refresh: Boolean) -> CardTools.Definition = { _, _, _ -> error("offline") },
    val deckHolding: suspend (String) -> String? = { null },
    // ---- PR 2 ----
    val onEdit: (ChatMessageDto) -> Unit = {},
    val onAskDelete: (ChatMessageDto) -> Unit = {},
    val onDelete: (ChatMessageDto) -> Unit = {},
    val onPin: (ChatMessageDto, Boolean) -> Unit = { _, _ -> },
    val onCamera: () -> Unit = {},
    val onGallery: () -> Unit = {},
    val onSendPhoto: (caption: String) -> Unit = {},
    val onDiscardPhoto: () -> Unit = {},
    val onJump: (String) -> Unit = {},
    val loadLocalImage: suspend (String, Int) -> androidx.compose.ui.graphics.ImageBitmap? = { _, _ -> null },
    // ---- PR 3: learning tools ----
    /** The reader word sheet's actions (▶, More about this word, + Add as card). */
    val wordActions: dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordActions = dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordActions(),
    val onWordAdded: () -> Unit = {},
    val onMakeFlashcards: () -> Unit = {},
    val onPinyinAll: (Boolean) -> Unit = {},
    val onTranslationAll: (Boolean) -> Unit = {},
    val review: ReviewActions = ReviewActions(),
    val onSaveCorrection: (ChatMessageDto, text: String, note: String) -> Unit = { _, _, _ -> },
    val onRemoveCorrection: (ChatMessageDto) -> Unit = {},
    // ---- round 2 (docs/CHAT.md "Round 2") ----
    /** A long-press menu action (MessageMenu ids). */
    val onMenuAction: (id: String, ChatMessageDto) -> Unit = { _, _ -> },
    /** Explain / Save as flashcard: add a word or the sentence as a card (the Coach's AddChunkSheet calls). */
    val cards: dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions = dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions(),
    val onRetryExplain: () -> Unit = {},
    val onCloseExplain: () -> Unit = {},
    val onOpenSearch: () -> Unit = {},
    val onOpenHelp: () -> Unit = {},
)

@Composable
fun ChatSheetHost(ui: ChatUi, actions: ChatSheetActions) {
    when (val s = ui.sheet) {
        null -> {}
        is ChatSheet.Actions -> {
            val m = ui.messages.firstOrNull { it.id == s.message.id } ?: s.message
            LabBottomSheet(onDismiss = actions.onDismiss) {
                MessageMenuContent(
                    m, ui.menu(m), ui.online, ui.recentEmojis, mine = m.sender_id == ui.myId,
                    onReact = { e -> actions.onReact(m, e) },
                    onAction = { id -> actions.onMenuAction(id, m) },
                )
            }
        }
        ChatSheet.Attach -> LabBottomSheet(onDismiss = actions.onDismiss) {
            if (!ui.isAi) {
                NavRow("📷", "Camera", trailing = {}, onClick = actions.onCamera)
                RowDivider()
                NavRow("🖼️", "Photo", desc = "From the gallery", trailing = {}, onClick = actions.onGallery)
                RowDivider()
            }
            val help = ui.online && ui.messages.isNotEmpty() && !ui.generatingOptions
            NavRow(
                "💡", "Help me say it",
                desc = if (!ui.online) "Needs internet" else if (ui.messages.isEmpty()) "After the first message" else "Say what you mean — Claude suggests replies",
                enabled = help, trailing = {}, onClick = actions.onOpenHelp,
            )
            Spacer(Modifier.height(16.dp))
        }
        is ChatSheet.Explain -> ui.explain?.let { e ->
            LabBottomSheet(onDismiss = actions.onCloseExplain) {
                ExplainContent(e, s.saveCard, ui.online, actions.cards, onRetry = actions.onRetryExplain, onClose = actions.onCloseExplain)
            }
        }
        is ChatSheet.Photo -> PhotoSheet(s, ui, actions)
        ChatSheet.Pins -> LabBottomSheet(onDismiss = actions.onDismiss, title = "Pinned messages") {
            val pins = ui.pinned
            if (pins.isEmpty()) Text("Nothing pinned.", color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 20.dp))
            pins.forEachIndexed { i, m ->
                if (i > 0) RowDivider()
                NavRow("📌", m.sender.name ?: "", desc = previewOf(m), trailing = {}, onClick = { actions.onJump(m.id) })
            }
            Spacer(Modifier.height(16.dp))
        }
        is ChatSheet.ConfirmDelete -> dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog(
            "Delete this message?",
            "It's removed for both of you — they'll see \"Message deleted\".",
            confirmLabel = "Delete",
            onConfirm = { actions.onDelete(s.message) },
            onDismiss = actions.onDismiss,
            danger = true,
        )
        ChatSheet.Menu -> LabBottomSheet(onDismiss = actions.onDismiss) {
            NavRow("🔍", "Search", desc = "Find a message in this chat", onClick = actions.onOpenSearch)
            RowDivider()
            // PR 3: make cards from the chat; pinyin / translations for every message.
            NavRow("🃏", "Make flashcards", desc = "Pick messages — Claude suggests cards", enabled = ui.messages.isNotEmpty(), onClick = actions.onMakeFlashcards)
            RowDivider()
            ToggleRow("拼", "Show pinyin for all", ui.aids.pinyinAll) { actions.onPinyinAll(it) }
            RowDivider()
            ToggleRow("EN", "Show translations for all", ui.aids.translationAll) { actions.onTranslationAll(it) }
            RowDivider()
            NavRow("＋", "New conversation", desc = if (!ui.online) "Needs internet" else null, enabled = ui.online, onClick = actions.onNewConversation)
            RowDivider()
            NavRow("✏️", if (ui.conversation?.title.isNullOrBlank()) "Add a title" else "Rename conversation", enabled = ui.online, onClick = actions.onOpenRename)
            if (ui.isAi) { RowDivider(); NavRow("🔊", "Voice settings", onClick = actions.onOpenVoice) }
            RowDivider()
            NavRow("☰", "All conversations", onClick = actions.onAllConversations)
            Spacer(Modifier.height(16.dp))
        }
        is ChatSheet.Translate -> CardSheet("Translation", listOf(s.result.flashcard), ui, actions, s.result.translation)
        is ChatSheet.Check -> LabBottomSheet(onDismiss = actions.onDismiss, title = "Check Result") {
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(s.result.feedback, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                val corrections = s.result.corrections.orEmpty()
                if (corrections.isNotEmpty()) {
                    Text("Suggested Corrections", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    corrections.forEach { CardPreview(it) }
                    DeckPicker(ui, corrections.size, actions) { deck, new -> actions.onSaveCards(corrections, deck, new) }
                }
                ui.modalNotice?.let { InlineNotice(it.text, kind = NoticeKind.Error) }
                SecondaryPill("Close", Modifier.fillMaxWidth(), onClick = actions.onDismiss)
                Spacer(Modifier.height(12.dp))
            }
        }
        ChatSheet.HelpMeSayIt -> HelpMeSayItSheet(actions)
        is ChatSheet.Options -> LabBottomSheet(onDismiss = actions.onDismiss, title = "What could I say?") {
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                s.explanation?.let { MarkdownText(it, Modifier.clip(RoundedCornerShape(12.dp)).background(Lab.colors.accentSoft).padding(12.dp), style = MaterialTheme.typography.bodyMedium) }
                Text("Select the responses you'd like to save as flashcards:", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                s.options.forEachIndexed { i, o -> SelectableCard(o, i in s.selected) { actions.onToggleOption(i) } }
                if (s.selected.isNotEmpty()) DeckPicker(ui, s.selected.size, actions) { deck, new -> actions.onSaveCards(s.options.filterIndexed { i, _ -> i in s.selected }, deck, new) }
                ui.modalNotice?.let { InlineNotice(it.text, kind = NoticeKind.Error) }
                Spacer(Modifier.height(12.dp))
            }
        }
        is ChatSheet.Word -> WordSheet(s.hanzi, s.context, ui, actions)
        ChatSheet.Rename -> RenameSheet(ui, actions)
        ChatSheet.Voice -> VoiceSheet(ui, actions)
        is ChatSheet.Discuss -> DiscussSheet(s.message, ui, actions)
        is ChatSheet.ChatWord -> dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordSheet(
            s.word, s.sentence, known = s.word.text.trim() in ui.known, actions = actions.wordActions,
            onDismiss = actions.onDismiss, onAdded = actions.onWordAdded,
        )
        ChatSheet.Review -> ui.review?.let { r ->
            LabBottomSheet(onDismiss = actions.review.onClose) { ReviewPanel(r, ui.decks, ui.online, actions.review) }
        }
        is ChatSheet.Correct -> LabBottomSheet(onDismiss = actions.onDismiss, title = if (s.message.correction == null) "Correct this" else "Edit correction") {
            CorrectPanel(ui.messages.firstOrNull { it.id == s.message.id } ?: s.message, ui, actions)
        }
    }
}

@Composable
fun CardPreview(c: SuggestedCard) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.background).padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(c.hanzi, fontSize = 30.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Text(c.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
        Text(c.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, textAlign = TextAlign.Center)
        c.fun_facts?.takeIf { it.isNotBlank() }?.let { Spacer(Modifier.height(6.dp)); Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
        c.context?.takeIf { it.isNotBlank() }?.let { Text("Context: $it", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted) }
    }
}

@Composable
private fun SelectableCard(c: SuggestedCard, selected: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.background)
            .border(2.dp, if (selected) Lab.colors.accent else Color.Transparent, RoundedCornerShape(14.dp))
            .bouncyClickable(onClick = onToggle).padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(24.dp).clip(CircleShape).background(if (selected) Lab.colors.accent else Lab.colors.faint), contentAlignment = Alignment.Center) {
            if (selected) Text("✓", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column {
            Text(c.hanzi, fontSize = 22.sp, color = Lab.colors.ink)
            Text(c.pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent)
            Text(c.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            c.fun_facts?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
            c.context?.takeIf { it.isNotBlank() }?.let { Text("Context: $it", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted) }
        }
    }
}

/** "Save N cards to:" — pinned decks first (📌), then + Create new deck (web: DeckSelectorWithCreate). */
@Composable
fun DeckPicker(ui: ChatUi, count: Int, actions: ChatSheetActions, onPick: (deckId: String?, newDeck: String?) -> Unit) {
    var creating by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.testTag("deck-picker")) {
        Text("Save $count card${if (count != 1) "s" else ""} to:", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        if (ui.decks.isEmpty() && !creating) Text("No decks yet — create one below.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        ui.decks.forEach { d ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    (if (d.pinned) "📌 " else "") + d.name,
                    style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.background)
                        .bouncyClickable(enabled = !ui.saving) { onPick(d.id, null) }.padding(horizontal = 14.dp, vertical = 13.dp),
                )
                Box(Modifier.size(44.dp).clip(CircleShape).clickable { actions.onTogglePin(d.id) }.alpha(if (d.pinned) 1f else 0.35f), contentAlignment = Alignment.Center) { Text("📌") }
            }
        }
        if (creating) {
            OutlinedTextField(name, { name = it }, placeholder = { Text("Deck name...") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryPill("Cancel", Modifier.weight(1f)) { creating = false }
                PrimaryPill("Create & Save", Modifier.weight(1f).height(48.dp), enabled = name.isNotBlank() && !ui.saving) { onPick(null, name) }
            }
        } else {
            Text("+ Create new deck", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.heightIn(min = 44.dp).bouncyClickable { creating = true }.padding(vertical = 12.dp))
        }
        if (ui.saving) Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Lab.colors.accent); Text("  Saving…", color = Lab.colors.muted) }
    }
}

@Composable
private fun CardSheet(title: String, cards: List<SuggestedCard>, ui: ChatUi, actions: ChatSheetActions, translation: String?) {
    LabBottomSheet(onDismiss = actions.onDismiss, title = title) {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            translation?.let {
                Text(it, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
                Text("Flashcard", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
            }
            cards.forEach { CardPreview(it) }
            DeckPicker(ui, cards.size, actions) { deck, new -> actions.onSaveCards(cards, deck, new) }
            ui.modalNotice?.let { InlineNotice(it.text, kind = NoticeKind.Error) }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun HelpMeSayItSheet(actions: ChatSheetActions) {
    var intended by rememberSaveable { mutableStateOf("") }
    var guess by rememberSaveable { mutableStateOf("") }
    LabBottomSheet(onDismiss = actions.onDismiss, title = "Help me say it") {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Tell me what you mean and I'll suggest ways to say it in Chinese.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            OutlinedTextField(intended, { intended = it }, label = { Text("What are you trying to say?") }, placeholder = { Text("e.g. \"I want to ask about their weekend plans\"") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(guess, { guess = it }, label = { Text("Your guess (optional)") }, placeholder = { Text("e.g. 你周末想...") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            PrimaryPill("Suggest replies", Modifier.fillMaxWidth().height(52.dp), enabled = intended.isNotBlank()) { actions.onHelpMeSayIt(intended, guess) }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun RenameSheet(ui: ChatUi, actions: ChatSheetActions) {
    var title by rememberSaveable { mutableStateOf(ui.conversation?.title.orEmpty()) }
    LabBottomSheet(onDismiss = actions.onDismiss, title = if (ui.conversation?.title.isNullOrBlank()) "Add a title" else "Rename conversation") {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(title, { if (it.length <= 120) title = it }, label = { Text("Title (optional)") }, placeholder = { Text("e.g. This week's homework") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            ui.modalNotice?.let { InlineNotice(it.text, kind = NoticeKind.Error) }
            PrimaryPill(if (ui.saving) "Saving…" else "Save", Modifier.fillMaxWidth().height(52.dp), enabled = !ui.saving) { actions.onRename(title) }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VoiceSheet(ui: ChatUi, actions: ChatSheetActions) {
    val current = ui.conversation?.voice_id ?: "Chinese (Mandarin)_Gentleman"
    var speed by remember { mutableStateOf((ui.conversation?.voice_speed ?: 0.8).toFloat()) }
    LabBottomSheet(onDismiss = actions.onDismiss, title = "Voice Settings") {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Voice", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
            ChipRow { MINIMAX_VOICES.forEach { (id, name) -> LabChip(name, selected = id == current) { actions.onVoice(id) } } }
            Text("Speed: ${"%.1f".format(speed)}x", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
            Slider(speed, { speed = (Math.round(it * 10) / 10f) }, valueRange = 0.3f..1.0f, steps = 6, onValueChangeFinished = { actions.onSpeed(speed.toDouble()) })
            ui.modalNotice?.let { InlineNotice(it.text, kind = NoticeKind.Error) }
            PrimaryPill("Done", Modifier.fillMaxWidth().height(52.dp), onClick = actions.onDismiss)
            Spacer(Modifier.height(12.dp))
        }
    }
}

/** Discuss a message with Claude (web: MessageDiscussionModal) — persisted, with quick actions and card suggestions. */
@Composable
private fun DiscussSheet(m: ChatMessageDto, ui: ChatUi, actions: ChatSheetActions) {
    val d = ui.discuss
    var input by rememberSaveable { mutableStateOf("") }
    LabBottomSheet(onDismiss = actions.onDismiss, title = "Discuss Message") {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(m.content, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.accentSoft).padding(12.dp))
            if (d.loading) Text("Loading discussion...", color = Lab.colors.muted)
            if (!d.loading && d.turns.isEmpty() && !d.thinking) {
                ChipRow {
                    DISCUSS_QUICK.forEach { (label, q) -> LabChip(label) { actions.onAsk(m, q) } }
                }
            }
            d.turns.forEach { t ->
                if (t.role == "user") {
                    Text(t.content, style = MaterialTheme.typography.bodyMedium, color = Color.White, modifier = Modifier.align(Alignment.End).clip(RoundedCornerShape(14.dp)).background(Lab.colors.accent).padding(10.dp))
                } else {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.background).padding(12.dp)) { MarkdownText(t.content) }
                }
            }
            if (d.thinking) Text("Thinking...", color = Lab.colors.muted)
            d.cards?.let { cards ->
                Text("Select flashcards to save:", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
                cards.forEachIndexed { i, c -> SelectableCard(c, i in d.selected) { actions.onToggleDiscussCard(i) } }
                if (d.selected.isNotEmpty()) DeckPicker(ui, d.selected.size, actions) { deck, new -> actions.onSaveDiscussCards(m, deck, new) }
            }
            d.saved?.let { InlineNotice(it, kind = NoticeKind.Success) }
            Row(verticalAlignment = Alignment.Bottom) {
                OutlinedTextField(input, { input = it }, placeholder = { Text("Ask about this message...") }, maxLines = 4, enabled = !d.thinking, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                PrimaryPill("Ask", Modifier.height(52.dp), enabled = input.isNotBlank() && !d.thinking && ui.online) { actions.onAsk(m, input); input = "" }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

private val DISCUSS_QUICK = listOf(
    "Explain this" to "Please explain what this message means, including the vocabulary and grammar used.",
    "Break down vocab" to "Please break down each word/phrase in this message with pinyin and English translations.",
    "Make flashcards" to "Please create flashcards for the key vocabulary and phrases in this message.",
)

/** A word tapped in the word-by-word view: its definition (device cache first), then save it to a deck. */
@Composable
private fun WordSheet(hanzi: String, context: String, ui: ChatUi, actions: ChatSheetActions) {
    var def by remember(hanzi) { mutableStateOf<VocabularyDefinition?>(null) }
    var error by remember(hanzi) { mutableStateOf<String?>(null) }
    var existing by remember(hanzi) { mutableStateOf<String?>(null) }
    androidx.compose.runtime.LaunchedEffect(hanzi) {
        runCatching { actions.define(hanzi, context, false).value }.onSuccess { def = it }.onFailure { error = "Failed to load definition. Please try again." }
        existing = runCatching { actions.deckHolding(hanzi) }.getOrNull()
    }
    LabBottomSheet(onDismiss = actions.onDismiss, title = "Save Word to Flashcards") {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val d = def
            when {
                error != null -> InlineNotice(error!!, kind = NoticeKind.Error)
                d == null -> CircularProgressIndicator(color = Lab.colors.accent)
                else -> {
                    val card = SuggestedCard(d.hanzi, d.pinyin, d.english, d.fun_facts)
                    CardPreview(card)
                    existing?.let { InlineNotice("Already in \"$it\"", kind = NoticeKind.Warning) }
                    DeckPicker(ui, 1, actions) { deck, new -> actions.onSaveCards(listOf(card), deck, new) }
                }
            }
            ui.modalNotice?.let { InlineNotice(it.text, kind = NoticeKind.Error) }
            Spacer(Modifier.height(12.dp))
        }
    }
}

/** The photo about to go: preview at its aspect ratio, an optional caption, Send. */
@Composable
private fun PhotoSheet(s: ChatSheet.Photo, ui: ChatUi, actions: ChatSheetActions) {
    var caption by rememberSaveable { mutableStateOf("") }
    val bitmap by androidx.compose.runtime.produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, s.path) { value = runCatching { actions.loadLocalImage(s.path, 1080) }.getOrNull() }
    LabBottomSheet(onDismiss = actions.onDiscardPhoto, title = "Send a photo") {
        Column(Modifier.padding(horizontal = 20.dp).testTag("chat-photo-sheet"), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val (w, h) = dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaSizing.bubbleSize(s.width, s.height, maxW = 320f, maxH = 380f)
            Box(Modifier.size(w.dp, h.dp).clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
                bitmap?.let { androidx.compose.foundation.Image(it, "Photo", contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.matchParentSize()) }
                    ?: Text("📷", fontSize = 32.sp)
            }
            OutlinedTextField(caption, { caption = it }, placeholder = { Text("Add a caption (optional)") }, maxLines = 3, modifier = Modifier.fillMaxWidth().testTag("chat-photo-caption"))
            if (!ui.online) Text("You're offline — it sends when you're back online.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryPill("Cancel", Modifier.weight(1f), onClick = actions.onDiscardPhoto)
                PrimaryPill("Send", Modifier.weight(1f).height(52.dp).testTag("chat-photo-send")) { actions.onSendPhoto(caption) }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
