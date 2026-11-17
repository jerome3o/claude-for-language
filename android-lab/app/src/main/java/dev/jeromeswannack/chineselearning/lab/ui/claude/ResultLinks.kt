package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.claude.CardTools
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LocalLabNav

/*
 * A line under a Claude reply is a link to what it made (web components/claude/ResultLink.tsx;
 * docs/CHAT.md "Tool lines you can tap"; the target per line is core [CardTools.resultLink]):
 * 🎓 a mini lesson → the player, ✓ cards → the card / the deck, ⚡ → the card / Up next, ✓ edited →
 * the card. The whole line is one tap target (≥ 48dp) ending in "Start ›" / "Open card ›"; a line
 * with Undo or word chips on it gets a "›" pill instead. Offline and not on this phone: the line
 * says so and does nothing. Back: the nav back stack returns to the thread; the study card's sheet
 * remembers itself first ([LocalResultOpen]) so it is open again on the same card.
 */

/** Test tags of the lines' links. */
object ResultLinkTags {
    fun line(kind: String) = "claude-result-line-$kind"
    fun go(kind: String) = "claude-result-go-$kind"
}

/** A host's own "open" (the study card's sheet remembers itself, then opens the path). Null = the plain nav. */
val LocalResultOpen = staticCompositionLocalOf<((CardTools.Link) -> Unit)?> { null }

/** The thread's context kind, for `claude.tool_result_open` (the Coach's page has none: "coach"). */
val LocalResultContext = staticCompositionLocalOf { "coach" }

private const val OFFLINE_NOTE = "Not on this phone yet — needs a connection"

@Composable
private fun labApp(): LabApp? = LocalLabNav.current?.app ?: (LocalContext.current.applicationContext as? LabApp)

/** How a line opens its link here: the host's ([LocalResultOpen]) or the app's nav. */
@Composable
fun rememberResultOpener(): (CardTools.Link) -> Unit {
    val host = LocalResultOpen.current
    val nav = LocalLabNav.current
    val context = LocalResultContext.current
    val app = labApp()
    return { link ->
        app?.analytics?.track("claude.tool_result_open", mapOf("kind" to link.kind, "context" to context))
        if (host != null) host(link) else nav?.open(link.path)
    }
}

/** False = offline and the target isn't on this phone (the lesson / card / deck). */
@Composable
fun rememberResultAvailable(link: CardTools.Link): Boolean {
    val app = labApp() ?: return true
    val online by app.online.collectAsState()
    val here by produceState(initialValue = true, link.target, link.id, online) {
        val id = link.id
        value = online || id == null || runCatching {
            when (link.target) {
                "lesson" -> LessonRuntime.of(app).store.entry(id) != null
                "card" -> app.repo.db.dao().note(id) != null
                "deck" -> app.repo.db.dao().decks().any { it.id == id }
                else -> true
            }
        }.getOrDefault(true)
    }
    return here
}

/**
 * A whole line as one tap target: [text], then "Start ›". Offline and not on this phone: the text
 * and "Not on this phone yet — needs a connection", not tappable.
 */
@Composable
fun ResultLinkLine(link: CardTools.Link, text: String, color: Color, modifier: Modifier = Modifier) {
    val open = rememberResultOpener()
    val available = rememberResultAvailable(link)
    val shape = RoundedCornerShape(12.dp)
    if (!available) {
        Column(
            modifier.widthIn(max = 360.dp).clip(shape).background(color.copy(alpha = 0.12f)).padding(horizontal = 12.dp, vertical = 8.dp).testTag(ResultLinkTags.line(link.kind)),
        ) {
            Text(text, color = color, fontSize = 13.sp)
            Text(OFFLINE_NOTE, color = color.copy(alpha = 0.8f), fontSize = 12.sp)
        }
        return
    }
    Row(
        modifier.widthIn(max = 360.dp).heightIn(min = 48.dp).clip(shape).background(color.copy(alpha = 0.12f))
            .bouncyClickable(pressedScale = 0.97f) { open(link) }
            .semantics(mergeDescendants = true) { contentDescription = link.aria }
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .testTag(ResultLinkTags.line(link.kind)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(text, color = color, fontSize = 13.sp, modifier = Modifier.weight(1f, fill = false))
        Text("${link.label} ›", color = color, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** "Open card ›" — the link on a line that has other controls on it (Undo, word chips). */
@Composable
fun ResultLinkGo(link: CardTools.Link, color: Color, modifier: Modifier = Modifier) {
    val open = rememberResultOpener()
    val available = rememberResultAvailable(link)
    Box(
        modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(50)).border(1.dp, color, RoundedCornerShape(50))
            .bouncyClickable(enabled = available, pressedScale = 0.94f) { open(link) }
            .semantics { contentDescription = if (available) link.aria else "${link.aria} — ${OFFLINE_NOTE.lowercase()}" }
            .padding(horizontal = 14.dp).testTag(ResultLinkTags.go(link.kind)),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (available) "${link.label} ›" else "Needs a connection", color = color, fontWeight = if (available) FontWeight.Bold else FontWeight.Normal, fontSize = 13.sp, maxLines = 1)
    }
}
