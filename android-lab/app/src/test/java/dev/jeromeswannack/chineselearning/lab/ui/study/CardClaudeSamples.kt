package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckDto
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckMistakeDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadActions
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadScreen
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi

/** Ask Claude on a card as the sheet draws it (the card's Claude thread; CardClaudeSheet.kt). */
object CardClaudeSamples {
    fun context(hanzi: String = "银行", deck: String = "HSK 2") = ClaudeContextDto(ClaudeChats.CARD, note_id = "n1", card_type = "hanzi_to_meaning", label = hanzi, sublabel = deck)

    fun mine(id: String, text: String, check: AutoCheckDto? = null, queued: Boolean = false) =
        ClaudeMessageDto(id, "t1", id, "user", "text", text, intent = "ask", created_at = "2026-11-03T10:00:0${id.last()}.000Z", queued = queued, auto_check = check)

    fun claude(id: String, text: String, lang: String = "zh", tools: String? = null, status: String? = null) =
        ClaudeMessageDto(id, "t1", null, "assistant", "text", text, status = status, streaming = status == "pending" && text.isNotEmpty(), answer_lang = lang, tool_results = tools, created_at = "2026-11-03T10:00:0${id.last()}.000Z")

    /** The check of "银行是什么意？": improvable (→ 银行是什么意思？). */
    val check = AutoCheckDto(
        text = "银行是什么意？", status = "improvable", corrected = "银行是什么意思？", corrected_pinyin = "yínháng shì shénme yìsi",
        corrected_english = "What does 银行 mean?", mistakes = listOf(AutoCheckMistakeDto(quote = "什么意", fix = "什么意思", why = "The word is 意思.")), severity = "moderate",
    )

    const val EDIT = """[{"tool":"edit_current_card","success":true,"data":{"note":{"id":"n1","hanzi":"银行","fun_facts":"银 silver + 行 business: where money does business."},"changes":{"fun_facts":"银 silver + 行 business: where money does business."}}}]"""

    fun ui(messages: List<ClaudeMessageDto>, hanzi: String = "银行", language: String = "zh", listening: Boolean = false, online: Boolean = true) = ClaudeThreadUi(
        threadId = if (messages.isEmpty()) null else "t1",
        isNew = messages.isEmpty(),
        title = messages.firstOrNull { it.role == "user" }?.content.orEmpty(),
        context = context(hanzi),
        hasThread = messages.isNotEmpty(),
        hasSentence = true,
        messages = messages,
        language = language,
        listening = listening,
        online = online,
    )

    /** An empty card thread (the card's chips, Ask only). */
    val empty = ui(emptyList())

    /** My checked question, Claude's answer, then the fun fact Claude added to the card. */
    val conversation = ui(
        listOf(
            mine("u1", "银行是什么意？", check),
            claude("a2", "「银行」就是放钱的地方。\n「行」在这里读 háng，意思是做生意的地方。\n比如：我去银行取钱。"),
            mine("u3", "请给这张卡片加一个有意思的小知识。"),
            claude("a4", "好的！我给这张卡片加了一个小知识：「银」是银子，「行」是做生意的地方。", tools = EDIT),
        ),
    )

    /** A short thread: my checked question, then Claude added a fun fact to the card ("✓ Claude edited this card · Undo"). */
    val edited = ui(
        listOf(
            mine("u1", "银行是什么意？", check),
            claude("a2", "「银行」就是放钱的地方。我给这张卡片加了一个小知识：「银」是银子，「行」是做生意的地方。", tools = EDIT),
        ),
    )

    val earlier = listOf(
        ClaudeThreadDto("e1", title = "行怎么读？", context_kind = ClaudeChats.CARD, context = context(), preview = "这里读 háng，银行的行。", last_message_at = "2026-11-01T09:12:00.000Z", created_at = "2026-11-01T09:10:00.000Z"),
        ClaudeThreadDto("e2", title = "Use in sentence", context_kind = ClaudeChats.CARD, context = context(), preview = "我去银行取钱。", last_message_at = "2026-10-28T18:40:00.000Z", created_at = "2026-10-28T18:38:00.000Z"),
    )
}

/** The card's sheet, stateless: the thread screen + "Earlier about 银行" + the card tools' lines. */
@Composable
fun CardThreadPreview(
    ui: ClaudeThreadUi,
    height: Dp = 760.dp,
    earlier: List<ClaudeThreadDto> = emptyList(),
    actions: ClaudeThreadActions = ClaudeThreadActions(),
    claude: CardClaudeActions = CardClaudeActions(canUndo = { true }),
    voicePreview: VoiceDictationUi? = VoiceDictationUi(),
    closedNote: String? = null,
) {
    Box(Modifier.fillMaxWidth().height(height)) {
        ClaudeThreadScreen(
            ui, actions, sheet = true, voicePreview = voicePreview,
            headerExtra = { EarlierRow("银行", earlier, canStartNew = ui.threadId != null, onPick = {}, onNew = {}) },
            toolResults = { reply -> CardToolLines(reply, claude, ui.online) },
            closedNote = closedNote,
        )
    }
}

/** A sheet drawn over the dimmed study card (its answer side), the way the ModalBottomSheet shows it. */
@Composable
fun OverStudyCard(view: CardView, sheet: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Box(Modifier.fillMaxSize()) {
        StudyScreen(
            StudyUi(StudyPhase.Showing(view), dev.jeromeswannack.chineselearning.lab.testing.Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = true),
            playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = true), autoplay = false, pendingReviews = 0,
        )
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.32f)))
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(Lab.colors.card)
                .padding(top = 12.dp),
        ) {
            Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.muted.copy(alpha = 0.4f)))
            Spacer(Modifier.height(8.dp))
            sheet()
        }
    }
}
