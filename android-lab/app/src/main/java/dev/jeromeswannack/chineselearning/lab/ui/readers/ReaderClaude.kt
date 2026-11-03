package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.claude.ContextFields
import dev.jeromeswannack.chineselearning.lab.data.readers.WordRecapStore
import dev.jeromeswannack.chineselearning.lab.ui.claude.ContextClaudeSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/*
 * 📖 Ask Claude about this page (the web's 💬 in components/reader/ReaderView.tsx; docs/STUDY_SESSION.md
 * "Graded readers" → "Ask Claude about this page"): the 💬 at the end of the reading view's
 * "GRADED READER" row opens the PAGE's Claude thread ([ContextClaudeSheet]) with the reader context —
 * the page, and the words of this reading's word recap run on that page (tapped / read aloud wrong,
 * core [ClaudeChats.readerPageWords]), so "The words I looked up" knows them.
 */

const val READER_ASK_CLAUDE_TAG = "reader-ask-claude"

/** The 💬 at the end of the "GRADED READER" row (the ▶ story button's twin: a 36dp circle in a 48dp target). */
@Composable
internal fun AskClaudeButton(enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).alpha(if (enabled) 1f else 0.4f).clip(CircleShape).bouncyClickable(enabled, pressedScale = 0.9f, onClick = onClick)
            .semantics { contentDescription = "Ask Claude about this page" }
            .testTag(READER_ASK_CLAUDE_TAG),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(36.dp).clip(CircleShape).background(Violet.copy(alpha = 0.14f)).border(1.dp, Violet.copy(alpha = 0.45f), CircleShape),
            contentAlignment = Alignment.Center,
        ) { Text("💬", fontSize = 16.sp) }
    }
}

/** The page's words of this reading (from the word recap's run), as the reader context carries them. */
private suspend fun pageWords(app: LabApp, readerId: String, index: Int): ClaudeChats.PageWords {
    val run = runCatching { WordRecapStore.run(app.cache, readerId) }.getOrNull()
    val words = run?.words.orEmpty().map { ClaudeChats.RecapWordLike(it.hanzi, it.page, it.pos, it.reasons) }
    return ClaudeChats.readerPageWords(words, index)
}

/** The page's Claude thread in a sheet over the reading view. */
@Composable
internal fun ReaderClaudeSheet(reader: GradedReaderDto, page: ReaderPageDto, index: Int, onDismiss: () -> Unit) {
    val app = LocalContext.current.applicationContext as? LabApp ?: return
    val words by produceState<ClaudeChats.PageWords?>(null, reader.id, index) { value = pageWords(app, reader.id, index) }
    val w = words ?: return
    val context = ClaudeContextDto(
        ClaudeChats.READER,
        reader_id = reader.id,
        page_id = page.id,
        page = index + 1,
        looked_up = w.lookedUp.ifEmpty { null },
        said_wrong = w.saidWrong.ifEmpty { null },
        label = reader.titleChinese,
    )
    fun arr(list: List<String>) = if (list.isEmpty()) JsonNull else JsonArray(list.map { JsonPrimitive(it) })
    ContextClaudeSheet(
        context = context,
        fields = ContextFields(lookedUp = arr(w.lookedUp), saidWrong = arr(w.saidWrong)),
        source = "reader",
        explorerSource = "reader",
        onDismiss = onDismiss,
        onResolved = { resumed -> app.analytics.track("reader.ask_claude", mapOf("from" to "toolbar", "resumed" to resumed, "words" to (w.lookedUp.size + w.saidWrong.size))) },
    )
}
