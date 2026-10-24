package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.PagerDefaults
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPlayState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipWord
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.core.clips.LearnMoreOffer
import dev.jeromeswannack.chineselearning.lab.data.clips.ClipStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import kotlinx.coroutines.launch

/** The feed's state (stateless screen; ClipsViewModel fills it). */
data class ClipsUi(
    val clips: List<ClipRecord>? = null,
    val prefs: ClipStore.CaptionPrefs = ClipStore.CaptionPrefs(),
    val startId: String? = null,
    val startScene: Int = 0,
    val offline: Boolean = false,
    val sheet: ClipSheetUi? = null,
    val making: Boolean = false,
    val makeBusy: Boolean = false,
    val makeError: String? = null,
    val online: Boolean = true,
    /** The settled page (the music follows its theme). */
    val active: Int = 0,
)

/** The Learn more sheet ("Keep going with <topic>"). */
data class ClipSheetUi(
    val clipId: String,
    val title: String,
    val offers: List<LearnMoreOffer>,
    val busy: String? = null,
    val note: String? = null,
    val error: Boolean = false,
    val link: Pair<String, String>? = null,
    val showWords: Boolean = false,
    val words: List<ClipWordRow> = emptyList(),
)

/** A focus word in the sheet: in a deck (⚡ today) or not (+ Add). */
data class ClipWordRow(val word: ClipWord, val deck: String? = null, val bumped: Boolean = false, val added: Boolean = false)

class ClipsActions(
    val onBack: () -> Unit = {},
    val onActive: (index: Int) -> Unit = {},
    /** The rail's ⌄ / the end card's Next ↓ (analytics `clips.next`). */
    val onNextButton: (clip: ClipRecord, via: String) -> Unit = { _, _ -> },
    val player: (ClipRecord) -> ClipPlayerActions = { ClipPlayerActions() },
    val onCloseSheet: () -> Unit = {},
    val onOffer: (String) -> Unit = {},
    val onOpenLink: (String) -> Unit = {},
    val onBumpWord: (ClipWord) -> Unit = {},
    val onAddWord: (ClipWord) -> Unit = {},
    val onMakeOpen: (Boolean) -> Unit = {},
    val onMake: (topic: String) -> Unit = {},
    val onRetry: (ClipRecord) -> Unit = {},
    val onDelete: (ClipRecord) -> Unit = {},
)

/**
 * 🎬 Clips (web pages/ClipsPage.tsx): a full-screen vertical pager — swipe up for the next clip;
 * only the settled page plays; the next one is prefetched by the ViewModel. [animate] / [clock]
 * false render settled frames (screenshots).
 */
@Composable
fun ClipsScreen(
    ui: ClipsUi,
    actions: ClipsActions,
    animate: Boolean = true,
    clock: Boolean = true,
    previewState: ClipPlayState? = null,
    previewSpeech: SpeechClock? = null,
    speakPreview: dev.jeromeswannack.chineselearning.lab.ui.coach.PractiseUi? = null,
) {
    val clips = ui.clips
    Box(Modifier.fillMaxSize().background(Color.Black).testTag("clips-page")) {
        when {
            clips == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Color.White) }
            clips.isEmpty() -> EmptyClips(ui, actions)
            else -> {
                val start = remember(clips.size > 0) { clips.indexOfFirst { it.id == ui.startId }.coerceAtLeast(0) }
                val pager = rememberPagerState(initialPage = start) { clips.size }
                val scope = rememberCoroutineScope()
                LaunchedEffect(pager) { snapshotFlow { pager.settledPage }.collect { actions.onActive(it) } }
                // A quarter of the page (or a flick) is enough to go on: a slow swipe should page too.
                val fling = PagerDefaults.flingBehavior(pager, snapPositionalThreshold = 0.25f)
                VerticalPager(pager, Modifier.fillMaxSize().testTag("clips-feed"), beyondViewportPageCount = 1, flingBehavior = fling, key = { clips[it].id }) { page ->
                    val clip = clips[page]
                    if (clip.status == "ready" && clip.spec != null) {
                        val base = actions.player(clip)
                        val next = if (page < clips.size - 1) ({ via: String -> actions.onNextButton(clip, via); scope.launch { pager.animateScrollToPage(page + 1) }; Unit }) else null
                        ClipPlayer(
                            clip,
                            active = pager.settledPage == page,
                            prefs = ui.prefs,
                            actions = ClipPlayerActions(
                                onLike = base.onLike, onSave = base.onSave, onLearnMore = base.onLearnMore, onComplete = base.onComplete,
                                onInteract = base.onInteract, onExplore = base.onExplore, onPrefs = base.onPrefs, onNext = next, onPlaying = base.onPlaying, onSpeaking = base.onSpeaking,
                                lineAudio = base.lineAudio, picture = base.picture,
                            ),
                            held = ui.sheet != null || ui.making,
                            startScene = if (clip.id == ui.startId) ui.startScene else 0,
                            animate = animate,
                            clock = clock,
                            previewState = previewState,
                            previewSpeech = previewSpeech,
                            speakPreview = speakPreview,
                        )
                    } else ClipPlaceholder(clip, actions)
                }
            }
        }
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 8.dp, end = 8.dp, top = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TopButton("←", "Back", actions.onBack)
            Text("🎬 Clips · beta", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.4f)).padding(horizontal = 10.dp, vertical = 4.dp))
            Spacer(Modifier.weight(1f))
            if (ui.offline) Text("Offline", color = Color.White, fontSize = 12.sp, modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.4f)).padding(horizontal = 10.dp, vertical = 4.dp))
            TopButton("＋", "Make new clips") { actions.onMakeOpen(true) }
        }
        ui.sheet?.let { LearnMoreSheet(it, ui.online, actions) }
        if (ui.making) LabBottomSheet(onDismiss = { actions.onMakeOpen(false) }, title = "Make new clips") {
            Text("Claude writes them around what you’re studying. About a minute.", color = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.muted, modifier = Modifier.padding(horizontal = 24.dp))
            MakeClips(ui, actions, dark = false)
        }
    }
}

@Composable
private fun TopButton(label: String, description: String, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(RoundedCornerShape(22.dp)).background(Color.Black.copy(alpha = 0.35f)).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Color.White, fontSize = 20.sp) }
}

private val STATE_BG = Brush.radialGradient(listOf(Color(0xFF2B1450), Color(0xFF0B0B12)), radius = 1400f)

@Composable
private fun EmptyClips(ui: ClipsUi, actions: ClipsActions) {
    Column(Modifier.fillMaxSize().background(STATE_BG).padding(24.dp).testTag("clips-empty"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
        Text("🎬", fontSize = 48.sp)
        Text("No clips yet", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text("Short vertical clips about the words you’re learning — swipe, double-tap anything to dig deeper.", color = Color.White.copy(alpha = 0.78f), textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 340.dp))
        MakeClips(ui, actions, dark = true)
    }
}

@Composable
private fun MakeClips(ui: ClipsUi, actions: ClipsActions, dark: Boolean) {
    var topic by remember { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().padding(horizontal = if (dark) 0.dp else 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            topic, { topic = it.take(120) },
            modifier = Modifier.fillMaxWidth().testTag("clips-topic"),
            placeholder = { Text("Topic (optional) — e.g. 刚 vs 刚才") },
            singleLine = true,
            keyboardOptions = KeyboardOptions.Default,
            textStyle = androidx.compose.ui.text.TextStyle(color = if (dark) Color.White else dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.ink, fontSize = 16.sp),
        )
        Text(
            when { ui.makeBusy -> "Starting…"; !ui.online -> "Needs a connection"; else -> "✨ Make 2 clips" },
            color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(Color(0xFFFF3B6B))
                .clickable(enabled = ui.online && !ui.makeBusy, role = Role.Button) { actions.onMake(topic) }
                .padding(vertical = 14.dp).testTag("clips-make"),
        )
        ui.makeError?.let { InlineNotice(it, kind = NoticeKind.Error) }
    }
}

@Composable
private fun ClipPlaceholder(clip: ClipRecord, actions: ClipsActions) {
    Column(Modifier.fillMaxSize().background(STATE_BG).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
        if (clip.status == "generating") {
            CircularProgressIndicator(color = Color.White)
            Text(clip.topic?.let { "A clip about $it" } ?: "A new clip", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text("${clip.progress ?: "Being written…"} It appears here by itself.", color = Color.White.copy(alpha = 0.78f), textAlign = TextAlign.Center)
        } else {
            Text("⚠️", fontSize = 40.sp)
            Text("Couldn’t make this clip", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(clip.error ?: "Something went wrong.", color = Color.White.copy(alpha = 0.78f), textAlign = TextAlign.Center)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton("↻ Try again", primary = true) { actions.onRetry(clip) }
                PillButton("Delete", primary = false) { actions.onDelete(clip) }
            }
        }
    }
}

@Composable
private fun PillButton(label: String, primary: Boolean, onClick: () -> Unit) {
    Text(
        label, color = Color.White, fontWeight = FontWeight.ExtraBold,
        modifier = Modifier.clip(RoundedCornerShape(24.dp)).background(if (primary) Color(0xFFFF3B6B) else Color.White.copy(alpha = 0.12f))
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 18.dp, vertical = 13.dp),
    )
}

@Composable
private fun LearnMoreSheet(sheet: ClipSheetUi, online: Boolean, actions: ClipsActions) {
    val c = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors
    LabBottomSheet(onDismiss = actions.onCloseSheet, title = sheet.title) {
        Column(Modifier.padding(horizontal = 16.dp).testTag("clip-learn-more-sheet"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Made for you, in your account — nothing is sent to anyone.", color = c.muted, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 8.dp))
            sheet.note?.let { note ->
                InlineNotice(note, kind = if (sheet.error) NoticeKind.Error else NoticeKind.Info, actionLabel = sheet.link?.second, onAction = sheet.link?.let { l -> { actions.onOpenLink(l.first) } })
            }
            sheet.offers.forEach { o ->
                val disabled = sheet.busy != null || (o.online && !online)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 60.dp).clip(RoundedCornerShape(14.dp)).border(1.dp, c.outline, RoundedCornerShape(14.dp))
                        .clickable(enabled = !disabled, role = Role.Button) { actions.onOffer(o.action) }
                        .padding(horizontal = 12.dp, vertical = 10.dp).testTag("clip-offer-${o.action}"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(o.icon, fontSize = 24.sp, modifier = Modifier.width(36.dp), textAlign = TextAlign.Center)
                    Column(Modifier.weight(1f)) {
                        Text(if (sheet.busy == o.action) "Starting…" else o.label, color = c.ink.copy(alpha = if (disabled) 0.55f else 1f), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(if (o.online && !online) "Needs a connection" else o.detail, color = c.muted, fontSize = 13.sp)
                    }
                    Text("›", color = c.muted, fontSize = 20.sp)
                }
            }
            if (sheet.showWords) sheet.words.forEach { row ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(row.word.hanzi, color = c.ink, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text("${row.word.pinyin} · ${row.word.english}", color = c.muted, fontSize = 13.sp)
                        row.deck?.let { Text("📚 In $it", color = c.muted, fontSize = 12.sp) }
                    }
                    when {
                        row.deck != null -> SheetChip(if (row.bumped) "⚡ Today ✓" else "⚡ Today") { actions.onBumpWord(row.word) }
                        row.added -> Text("✓ Added", color = c.muted, fontSize = 13.sp)
                        else -> SheetChip("+ Add") { actions.onAddWord(row.word) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SheetChip(label: String, onClick: () -> Unit) {
    val c = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors
    Text(
        label, color = c.ink, fontWeight = FontWeight.Bold, fontSize = 14.sp,
        modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).border(1.dp, c.outline, RoundedCornerShape(22.dp))
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
    )
}

/** Sheet offers for a clip (core Clips.learnMoreOffers + the title). */
fun clipSheet(clip: ClipRecord): ClipSheetUi? {
    val spec = clip.spec ?: return null
    return ClipSheetUi(clip.id, Clips.learnMoreTitle(Clips.topic(spec)), Clips.learnMoreOffers(spec, clip.lesson), words = spec.words.map { ClipWordRow(it) })
}
