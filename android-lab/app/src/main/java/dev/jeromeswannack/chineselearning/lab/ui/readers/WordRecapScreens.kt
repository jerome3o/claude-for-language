package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.WordRecap
import dev.jeromeswannack.chineselearning.lab.core.WordRecapRun
import dev.jeromeswannack.chineselearning.lab.core.WordRecapWord
import dev.jeromeswannack.chineselearning.lab.data.readers.RecapOffer
import dev.jeromeswannack.chineselearning.lab.data.readers.WordRecapStore
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RetryProgressBar
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * 📝 Word recap (web: components/readerRecap/; docs/STUDY_SESSION.md "Reader word recap"; rules in
 * core WordRecap). The end-of-story offer ([RecapOfferCard], hosted over every screen by
 * [RecapOfferHost]) and the pass ([ReaderRecapScreen]) — `/readers/:id/recap` for a reading,
 * `/coach/chat/:id/recap` for a "💬 Ask Claude" chat (the run's source): a one-off pass over the words
 * tapped / read aloud (back) wrong, in story / chat order — "Not yet" words come back until "Got it"
 * (the retry bar) — then every word with its switch, OFF by default.
 */

object WordRecapTags {
    const val OFFER = "recap-offer"
    const val OFFER_START = "recap-offer-start"
    const val OFFER_DONE = "recap-offer-done"
    const val CARD = "recap-card"
    const val SHOW = "recap-show"
    const val GOT_IT = "recap-got-it"
    const val NOT_YET = "recap-not-yet"
    const val KEEP = "recap-keep"
    const val SUMMARY = "recap-summary"
    const val DONE = "recap-done"
    const val TO_LIST = "recap-to-list"
    const val SOURCE = "recap-source"
}

/** The explorer source of a recap's words. */
private fun explorerSource(source: String) = if (source == WordRecap.SOURCE_CHAT) "claude_chat" else "reader"

/** "Story finished ✓ — 📝 Recap N words · Done": over whatever comes next; never forced. */
@Composable
fun RecapOfferCard(offer: RecapOffer, onStart: () -> Unit, onDone: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().widthIn(max = 520.dp).clip(RoundedCornerShape(22.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(22.dp)).padding(16.dp).testTag(WordRecapTags.OFFER),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Story finished ✓", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            Text("✕", color = Lab.colors.muted, fontSize = 18.sp, modifier = Modifier.size(44.dp).bouncyClickable(onClick = onDone).padding(12.dp))
        }
        if (offer.line.isNotEmpty()) Text(offer.line, color = Lab.colors.muted, fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryPill("Done", Modifier.weight(1f).height(52.dp).testTag(WordRecapTags.OFFER_DONE), onClick = onDone)
            PrimaryPill(WordRecap.promptLabel(offer.words), Modifier.weight(2f).height(52.dp).testTag(WordRecapTags.OFFER_START), onClick = onStart)
        }
    }
}

/** The offer over the whole app (LabShell), sliding up from the bottom. */
@Composable
fun RecapOfferHost(onStart: (RecapOffer) -> Unit, track: (String, Map<String, Any?>) -> Unit, tick: () -> Unit) {
    val offer by WordRecapStore.offer.collectAsState()
    Box(Modifier.fillMaxSize().navigationBarsPadding().padding(12.dp), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            visible = offer != null,
            enter = slideInVertically(spring(dampingRatio = 0.75f, stiffness = 380f)) { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) {
            val o = offer ?: return@AnimatedVisibility
            RecapOfferCard(
                o,
                onStart = {
                    tick()
                    WordRecapStore.offer(null)
                    track("reader.word_recap_start", mapOf("from" to "finish", "words" to o.words))
                    onStart(o)
                },
                onDone = { WordRecapStore.offer(null) },
            )
        }
    }
}

class RecapActions(
    val answer: (key: String, right: Boolean) -> Unit = { _, _ -> },
    val keep: (key: String, on: Boolean) -> Unit = { _, _ -> },
    val restart: () -> Unit = {},
    val done: () -> Unit = {},
    val close: () -> Unit = {},
    val speak: (String) -> Unit = {},
)

/** What the recap screen shows (a stateless screen: screenshots render it as given). */
data class RecapUi(
    val title: String,
    val run: WordRecapRun?,
    /** "from the story “…”" / "from your chat with Claude" (core [WordRecap.sourceLabel]). */
    val sourceLabel: String? = null,
    /** The source while the run is missing (the empty state); a run's own source wins. */
    val source: String = WordRecap.SOURCE_READER,
    /** Recap keys of words already in his decks (their switch is ⚡ Study it today). */
    val owned: Set<String> = emptySet(),
    val online: Boolean = true,
    val doneLine: String? = null,
    /** Screenshots: start revealed / on the list. */
    val revealed: Boolean = false,
    val listing: Boolean = false,
)

@Composable
fun ReaderRecapScreen(ui: RecapUi, actions: RecapActions) {
    val run = ui.run
    Column(Modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding()) {
        var listing by rememberSaveable { mutableStateOf(ui.listing) }
        val progress = run?.let(WordRecap::progress)
        val nextKey = progress?.remaining?.firstOrNull()
        val word = if (run != null && nextKey != null) WordRecap.wordFor(run, nextKey) else null
        val showList = run != null && (listing || progress!!.complete || word == null)
        val source = run?.let(WordRecap::source) ?: ui.source
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("📝 ${ui.title}", fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink, maxLines = 1, modifier = Modifier.weight(1f))
            if (run != null && !showList) {
                Text("Choose words", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    modifier = Modifier.bouncyClickable { listing = true }.padding(horizontal = 10.dp, vertical = 12.dp).testTag(WordRecapTags.TO_LIST))
            }
            Text("✕", fontSize = 20.sp, color = Lab.colors.muted, modifier = Modifier.size(48.dp).bouncyClickable(onClick = actions.close).padding(14.dp))
        }
        if (!ui.sourceLabel.isNullOrEmpty() && run != null && run.words.isNotEmpty()) {
            Text(ui.sourceLabel, color = Lab.colors.muted, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).testTag(WordRecapTags.SOURCE))
        }
        when {
            run == null || run.words.isEmpty() -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Text(WordRecap.emptyLine(source), color = Lab.colors.muted, textAlign = TextAlign.Center)
            }
            showList -> RecapSummary(source, run, ui, actions, complete = progress!!.complete, onBack = if (!progress.complete && word != null) ({ listing = false }) else null)
            else -> {
                RetryProgressBar(WordRecap.bar(run), Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp))
                val attempt = run.events.count { it.item_id == nextKey }
                androidx.compose.runtime.key("$nextKey:$attempt") {
                    RecapCard(source, word!!, owned = nextKey!! in ui.owned, kept = WordRecap.isKept(run, nextKey), startRevealed = ui.revealed, actions = actions, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun MarkedSentence(sentence: String, hanzi: String) {
    val at = sentence.indexOf(hanzi)
    val text = buildAnnotatedString {
        if (at < 0) append(sentence)
        else {
            append(sentence.substring(0, at))
            withStyle(SpanStyle(background = Violet.copy(alpha = 0.18f), color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)) { append(hanzi) }
            append(sentence.substring(at + hanzi.length))
        }
    }
    Text(text, fontSize = 21.sp, lineHeight = 34.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
}

/** The switch: "Add to my long-term review" (a new word) or "⚡ Study it today" (one he has) — OFF by default. */
@Composable
fun RecapKeepSwitch(owned: Boolean, on: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(50)
    val tint = if (owned) Color(0xFFF59E0B) else Palette.Secondary
    val bg by animateColorAsState(if (on) tint.copy(alpha = 0.12f) else Color.Transparent, label = "recap-keep-bg")
    val border by animateColorAsState(if (on) tint else Lab.colors.outline, label = "recap-keep-border")
    Row(
        modifier.heightIn(min = 44.dp).clip(shape).background(bg).border(1.dp, border, shape)
            .toggleable(value = on, role = Role.Switch, onValueChange = onChange)
            .padding(start = 16.dp, end = 6.dp).testTag(WordRecapTags.KEEP),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(WordRecap.keepLabel(owned), style = MaterialTheme.typography.labelLarge, color = if (on) tint else Lab.colors.muted, modifier = Modifier.weight(1f, fill = false))
        Spacer(Modifier.width(8.dp))
        Switch(checked = on, onCheckedChange = null, colors = SwitchDefaults.colors(checkedTrackColor = tint, checkedBorderColor = tint))
    }
}

@Composable
private fun RecapCard(source: String, word: WordRecapWord, owned: Boolean, kept: Boolean, startRevealed: Boolean, actions: RecapActions, modifier: Modifier = Modifier) {
    var revealed by rememberSaveable { mutableStateOf(startRevealed) }
    val key = WordRecap.key(word.hanzi)
    Column(modifier.fillMaxWidth()) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp).testTag(WordRecapTags.CARD),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Spacer(Modifier.height(12.dp))
            if (revealed) ExplorableText(word.hanzi, explorerSource(source), fontSize = 46.sp, fontWeight = FontWeight.SemiBold)
            else Text(word.hanzi, fontSize = 46.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            if (word.sentence.isNotEmpty()) {
                if (revealed) ExplorableText(word.sentence, explorerSource(source), fontSize = 21.sp, lineHeight = 34.sp, textAlign = TextAlign.Center, highlight = word.hanzi)
                else MarkedSentence(word.sentence, word.hanzi)
            }
            AnimatedVisibility(revealed, enter = fadeIn() + slideInVertically { it / 6 }) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(
                            Modifier.size(44.dp).clip(CircleShape).border(1.dp, Lab.colors.cardBorder, CircleShape).bouncyClickable { actions.speak(word.hanzi) },
                            contentAlignment = Alignment.Center,
                        ) { Text("▶", color = Lab.colors.ink) }
                        Text(word.pinyin, fontSize = 20.sp, color = Lab.colors.accent)
                    }
                    Text(word.gloss.ifEmpty { "Tap the word for its meaning" }, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    if (word.page_english.isNotEmpty()) Text("The page: ${word.page_english}", fontSize = 15.sp, color = Lab.colors.muted, textAlign = TextAlign.Center)
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFFF97316).copy(alpha = 0.09f)).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        for (line in WordRecap.whyLines(word, source)) Text(line, fontSize = 14.sp, color = Lab.colors.ink)
                    }
                    RecapKeepSwitch(owned, kept, onChange = { actions.keep(key, it) }, modifier = Modifier.fillMaxWidth())
                }
            }
        }
        Row(Modifier.fillMaxWidth().background(Lab.colors.card).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (revealed) {
                SecondaryPill("Not yet", Modifier.weight(1f).height(54.dp).testTag(WordRecapTags.NOT_YET), danger = true) { actions.answer(key, false) }
                PrimaryPill("Got it", Modifier.weight(1f).height(54.dp).testTag(WordRecapTags.GOT_IT), color = Palette.Good) { actions.answer(key, true) }
            } else {
                PrimaryPill("Show answer", Modifier.weight(1f).height(54.dp).testTag(WordRecapTags.SHOW)) {
                    revealed = true
                    actions.speak(word.hanzi)
                }
            }
        }
    }
}

@Composable
private fun RecapSummary(source: String, run: WordRecapRun, ui: RecapUi, actions: RecapActions, complete: Boolean, onBack: (() -> Unit)?) {
    val celebrate = remember { complete }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp).testTag(WordRecapTags.SUMMARY),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(if (complete) "Recap done 🎉" else "Choose words to keep", fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Lab.colors.ink)
                val n = run.words.size
                Text("$n ${if (n == 1) "word" else "words"}" + if (complete) " · ${WordRecap.rightFirstTime(run)} right first time" else "", color = Lab.colors.muted)
                Text(WordRecap.keepHint(source), color = Lab.colors.muted, fontSize = 14.sp, textAlign = TextAlign.Center)
                for (w in run.words) {
                    val k = WordRecap.key(w.hanzi)
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ExplorableText(w.hanzi, explorerSource(source), fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                            Column(Modifier.weight(1f)) {
                                Text(w.pinyin, color = Lab.colors.accent, fontSize = 15.sp)
                                if (w.gloss.isNotEmpty()) Text(w.gloss, color = Lab.colors.muted, fontSize = 14.sp, maxLines = 2)
                            }
                            for (r in w.reasons) ReasonTag(r)
                        }
                        RecapKeepSwitch(k in ui.owned, WordRecap.isKept(run, k), onChange = { actions.keep(k, it) }, modifier = Modifier.fillMaxWidth())
                    }
                }
                val keptNew = run.words.count { WordRecap.isKept(run, WordRecap.key(it.hanzi)) && WordRecap.key(it.hanzi) !in ui.owned }
                if (!ui.online && keptNew > 0) Text("The new cards are made when you're back online.", color = Lab.colors.muted, fontSize = 14.sp)
                ui.doneLine?.let { Text(it, color = Palette.Good, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center) }
            }
            Row(Modifier.fillMaxWidth().background(Lab.colors.card).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (onBack != null) SecondaryPill("‹ Back to the cards", Modifier.weight(1f).height(54.dp), onClick = onBack)
                else SecondaryPill("↺ Again", Modifier.weight(1f).height(54.dp), onClick = actions.restart)
                PrimaryPill("Done", Modifier.weight(1f).height(54.dp).testTag(WordRecapTags.DONE), enabled = ui.doneLine == null, onClick = actions.done)
            }
        }
        if (celebrate && complete) ConfettiRain(key = "recap-${run.reader_id}", colors = Palette.Confetti, modifier = Modifier.matchParentSize())
    }
}

@Composable
private fun ReasonTag(reason: String) {
    val (label, color) = if (reason == WordRecap.TAPPED) "tapped" to Violet else "said wrong" to Color(0xFFEA580C)
    Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = color, modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 3.dp))
}
