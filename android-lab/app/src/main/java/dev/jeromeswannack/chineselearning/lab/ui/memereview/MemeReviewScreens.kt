package dev.jeromeswannack.chineselearning.lab.ui.memereview

import android.graphics.BitmapFactory
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssue
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssueSummary
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeItem
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeLessonJob
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeLine
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeReview
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/*
 * 梗 Meme review (PROTOTYPE; web pages/MemeReviewPage.tsx + MemeIssuePage.tsx, docs/MEME_REVIEW.md):
 * the issue list and one monthly issue. Stateless: [MemeListUi] / [MemeIssueUi] in, taps out —
 * MemeReviewNav wires them.
 */

private object MemeColors {
    @Composable fun dark() = Lab.colors.card.luminance() < 0.4f
    @Composable fun ink() = if (dark()) Color(0xFFC4B5FD) else Color(0xFF6D28D9)
    @Composable fun soft() = if (dark()) Color(0xFF2E1F4D) else Color(0xFFEDE9FE)
    @Composable fun line() = if (dark()) Color(0xFF3F2F66) else Color(0xFFE9E3FB)
    @Composable fun pop() = if (dark()) Color(0xFFF9A8D4) else Color(0xFFDB2777)
}

const val MEME_ROW_TAG = "meme-issue-row"
const val MEME_CARD_TAG = "meme-card"
const val MEME_CARD_BODY_TAG = "meme-card-body"
const val MEME_QUIZ_OPTION_TAG = "meme-quiz-option"
const val MEME_LESSON_TAG = "meme-make-lesson"
const val MEME_LINK_TAG = "meme-link"

// ── the list ───────────────────────────────────────────────────────────────

data class MemeListUi(
    val loading: Boolean = true,
    val issues: List<MemeIssueSummary> = emptyList(),
    /** Months with a ready issue on this phone (✓; the only ones that open offline). */
    val onPhone: Set<String> = emptySet(),
    val online: Boolean = true,
    val canGenerate: Boolean = false,
    val currentMonth: String = "",
    val generating: Boolean = false,
    val error: String? = null,
)

data class MemeListActions(
    val onBack: (() -> Unit)? = null,
    val onOpen: (String) -> Unit = {},
    val onGenerate: () -> Unit = {},
)

/** `/meme-review` — the web's MemeReviewPage. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MemeReviewListScreen(ui: MemeListUi, actions: MemeListActions) {
    val current = ui.issues.firstOrNull { it.month == ui.currentMonth }
    val canStart = ui.canGenerate && ui.currentMonth.isNotEmpty() && (current == null || current.status == "failed")
    LabScreen("梗 Meme review", onBack = actions.onBack, subtitle = "prototype") {
        item {
            Text(
                "What the Chinese internet has been saying lately — one issue a month, researched by Claude with real sources: what each 梗 means, where it came from, who says it and whether you should. Links go to the original videos and posts.",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
        }
        if (!ui.online) item { InlineNotice("Offline — issues you’ve opened before still work; links need internet.", kind = NoticeKind.Offline) }
        if (canStart) {
            item {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MemeColors.soft()).padding(16.dp).testTag("meme-generate")) {
                    Text("No issue for ${MemeReview.monthLabel(ui.currentMonth)} yet${if (current?.status == "failed") " (the last try failed)" else ""}. It normally appears on the 1st.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                    Spacer(Modifier.height(10.dp))
                    PrimaryPill(if (ui.generating) "Starting…" else "Generate now (admin)", Modifier.height(48.dp), enabled = !ui.generating && ui.online, onClick = actions.onGenerate)
                    Spacer(Modifier.height(6.dp))
                    Text("About 5–15 minutes and roughly $1–3 (Claude + web searches + pictures).", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    ui.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.Again, modifier = Modifier.padding(top = 6.dp)) }
                }
            }
        }
        when {
            ui.loading && ui.issues.isEmpty() -> item { LoadingState(text = "Loading…") }
            ui.issues.isEmpty() -> item {
                Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("🌀", fontSize = 40.sp)
                    Text("No issues yet — the first one comes out on the 1st of the month.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
                }
            }
            else -> for (issue in ui.issues) item(key = issue.month) { IssueRow(issue, issue.month in ui.onPhone, offline = !ui.online) { actions.onOpen(issue.month) } }
        }
        item {
            Text(
                "A prototype: written by Claude from web search results and checked by code (every link must come from the search), not by an editor. Memes move fast — when something looks off, ask your tutor.",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun IssueRow(issue: MemeIssueSummary, onPhone: Boolean, offline: Boolean, onClick: () -> Unit) {
    val ready = issue.status == "ready"
    Column(
        Modifier.fillMaxWidth().then(if (ready) Modifier.bouncyClickable(onClick = onClick) else Modifier)
            .clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, MemeColors.line(), RoundedCornerShape(18.dp))
            .alpha(if (!ready || (offline && !onPhone)) 0.6f else 1f).testTag(MEME_ROW_TAG).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(MemeReview.monthLabelZh(issue.month), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MemeColors.ink())
            Spacer(Modifier.width(8.dp))
            Text(MemeReview.monthLabel(issue.month), style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted, modifier = Modifier.weight(1f))
            if (onPhone) Text("✓", color = Palette.Good)
        }
        when (issue.status) {
            "ready" -> {
                Text(issue.title.orEmpty(), fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink, modifier = Modifier.padding(top = 4.dp))
                issue.title_en?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (h in issue.preview) Chip(h, MemeColors.soft(), MemeColors.ink())
                    if (issue.item_count > issue.preview.size) Chip("+${issue.item_count - issue.preview.size}")
                }
            }
            "generating" -> Text("🔎 Being researched…", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp))
            else -> Text("This issue didn’t come out.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun Chip(text: String, bg: Color? = null, fg: Color? = null, modifier: Modifier = Modifier) {
    Text(
        text, fontSize = 14.sp, color = fg ?: Lab.colors.ink,
        modifier = modifier.clip(RoundedCornerShape(50)).background(bg ?: Lab.colors.card).border(1.dp, MemeColors.line(), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

// ── one issue ──────────────────────────────────────────────────────────────

sealed interface MemeIssueState {
    data object Loading : MemeIssueState
    data class Ready(val issue: MemeIssue) : MemeIssueState
    data class Generating(val progress: String?) : MemeIssueState
    data class Failed(val message: String) : MemeIssueState
    data object Missing : MemeIssueState
    data object Offline : MemeIssueState
}

data class MemeIssueUi(
    val month: String,
    val state: MemeIssueState = MemeIssueState.Loading,
    /** The expanded meme (one at a time, like the web). */
    val openId: String? = null,
    /** Items whose English is shown. */
    val english: Set<String> = emptySet(),
    val introEnglish: Boolean = false,
    /** What is playing: "intro", "m1:head", "m1:meaning", "m1:ex0". */
    val playing: String? = null,
    /** The quiz: the option picked per question (null = not yet). */
    val picked: List<Int?> = emptyList(),
    /** Item id → the picture's file on the phone. */
    val pictures: Map<String, File> = emptyMap(),
    /** Item id → the deck it is already a card in. */
    val cards: Map<String, String> = emptyMap(),
    val added: Set<String> = emptySet(),
    val bumped: String? = null,
    val lesson: MemeLessonJob? = null,
    val lessonBusy: Boolean = false,
    val lessonError: String? = null,
    /** Admin: "14 model calls · 25 searches · 8 pictures · ≈ $1.92". */
    val stats: String? = null,
    val online: Boolean = true,
)

data class MemeIssueActions(
    val onBack: () -> Unit = {},
    val onToggle: (MemeItem, Int) -> Unit = { _, _ -> },
    val onPlay: (key: String, text: String) -> Unit = { _, _ -> },
    val onToggleEnglish: (String) -> Unit = {},
    val onToggleIntroEnglish: () -> Unit = {},
    /** url, link (media | source), kind (video | post), platform. */
    val onLink: (url: String, link: String, kind: String, platform: String) -> Unit = { _, _, _, _ -> },
    val onRelated: (MemeLine) -> Unit = {},
    val onAdd: (MemeItem) -> Unit = {},
    val onBump: (MemeItem) -> Unit = {},
    val onPick: (question: Int, option: Int) -> Unit = { _, _ -> },
    val onResetQuiz: () -> Unit = {},
    val onMakeLesson: () -> Unit = {},
    val onOpenLesson: (String) -> Unit = {},
)

/** `/meme-review/:month` — the web's MemeIssuePage. */
@Composable
fun MemeIssueScreen(ui: MemeIssueUi, actions: MemeIssueActions, list: LazyListState = rememberLazyListState()) {
    LabScreenFrame { Column(Modifier.fillMaxSize()) {
        ScreenTitle("梗 Meme review", subtitle = "prototype", onBack = actions.onBack)
        val state = ui.state
        if (state !is MemeIssueState.Ready) {
            Column(Modifier.fillMaxWidth().padding(24.dp).testTag("meme-state"), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(MemeReview.monthLabelZh(ui.month).ifEmpty { ui.month }, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MemeColors.ink())
                Spacer(Modifier.height(16.dp))
                val body = MaterialTheme.typography.bodyLarge
                when (state) {
                    MemeIssueState.Loading -> LoadingState(text = "Loading…")
                    is MemeIssueState.Generating -> {
                        Text("🔎", fontSize = 36.sp)
                        Text("Claude is researching this month’s memes…", style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
                        state.progress?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
                        Text("Usually 5–15 minutes, once — then it’s here for everyone, offline too.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
                    }
                    is MemeIssueState.Failed -> Text(state.message, style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    MemeIssueState.Missing -> Text("No issue for this month yet — it comes out on the 1st.", style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    MemeIssueState.Offline -> Text("You’re offline and this issue isn’t on the phone yet. Open it once online and it stays here.", style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    is MemeIssueState.Ready -> Unit
                }
            }
            return@Column
        }
        val issue = state.issue
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Head(issue, ui, actions) }
            itemsIndexed(issue.items, key = { _, it -> it.id }) { i, item -> MemeCard(item, i, ui, actions) }
            if (issue.quiz.isNotEmpty()) item { Quiz(issue, ui, actions) }
            item { LessonCard(ui, actions) }
            item {
                Text("Researched and written by Claude from web search results; every link was in the search results. Videos and posts open on their own sites.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
        }
    } }
}

@Composable
private fun PlayDot(active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).bouncyClickable(pressedScale = 0.9f, onClick = onClick).clip(CircleShape)
            .background(if (active) MemeColors.ink() else Lab.colors.card).border(1.dp, MemeColors.line(), CircleShape),
        contentAlignment = Alignment.Center,
    ) { Text(if (active) "■" else "🔊", color = if (active) Color.White else MemeColors.ink(), fontSize = 15.sp) }
}

@Composable
private fun Toggle(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label, color = if (on) Color.White else Lab.colors.muted, fontSize = 13.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.heightIn(min = 36.dp).bouncyClickable(pressedScale = 0.94f, onClick = onClick).clip(RoundedCornerShape(50))
            .background(if (on) MemeColors.ink() else Lab.colors.card).border(1.dp, if (on) MemeColors.ink() else MemeColors.line(), RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 9.dp),
    )
}

@Composable
private fun H3(text: String) = Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Lab.colors.muted, modifier = Modifier.padding(top = 14.dp, bottom = 4.dp))

@Composable
private fun Head(issue: MemeIssue, ui: MemeIssueUi, actions: MemeIssueActions) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MemeColors.soft()).border(1.dp, MemeColors.line(), RoundedCornerShape(20.dp)).padding(16.dp)) {
        Text("${MemeReview.monthLabelZh(issue.month)} · ${MemeReview.monthLabel(issue.month)}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MemeColors.ink())
        Text(issue.title, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink, modifier = Modifier.testTag("meme-issue-title"))
        if (issue.title_en.isNotBlank()) Text(issue.title_en, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        MemeReview.coversLabel(issue.covers).takeIf { it.isNotEmpty() }?.let { Text("Covers $it", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 2.dp)) }
        Spacer(Modifier.height(10.dp))
        Row {
            Column(Modifier.weight(1f)) {
                ExplorableText(issue.intro.hanzi, source = "meme_review", fontSize = 18.sp, lineHeight = 28.sp)
                if (issue.intro.pinyin.isNotBlank()) Text(issue.intro.pinyin, style = MaterialTheme.typography.bodySmall, color = MemeColors.ink())
                if (ui.introEnglish) Text(issue.intro.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                PlayDot(ui.playing == "intro") { actions.onPlay("intro", issue.intro.hanzi) }
                Toggle("EN", ui.introEnglish, actions.onToggleIntroEnglish)
            }
        }
        ui.stats?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp).testTag("meme-stats")) }
    }
}

@Composable
private fun Picture(file: File?, modifier: Modifier, big: Boolean) {
    val bitmap by produceState<ImageBitmap?>(null, file) {
        value = file?.let { f -> withContext(Dispatchers.IO) { runCatching { BitmapFactory.decodeFile(f.absolutePath)?.asImageBitmap() }.getOrNull() } }
    }
    val b = bitmap
    if (b != null) {
        Image(b, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier.clip(RoundedCornerShape(if (big) 16.dp else 12.dp)))
    } else if (!big) {
        Box(modifier.clip(RoundedCornerShape(12.dp)).background(MemeColors.soft()), contentAlignment = Alignment.Center) {
            Text("梗", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = MemeColors.ink())
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MemeCard(item: MemeItem, index: Int, ui: MemeIssueUi, actions: MemeIssueActions) {
    val open = ui.openId == item.id
    val english = item.id in ui.english
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card)
            .border(1.dp, if (open) MemeColors.ink() else MemeColors.line(), RoundedCornerShape(18.dp)).animateContentSize().testTag(MEME_CARD_TAG),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 10.dp)) {
            Row(
                Modifier.weight(1f).heightIn(min = 72.dp).bouncyClickable(pressedScale = 0.98f) { actions.onToggle(item, index) }.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Picture(ui.pictures[item.id], Modifier.size(60.dp), big = false)
                Spacer(Modifier.width(12.dp))
                Text("${index + 1}", color = MemeColors.pop(), fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, modifier = Modifier.align(Alignment.Top).padding(top = 4.dp))
                Spacer(Modifier.width(6.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.hanzi, fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                    Text(item.pinyin, style = MaterialTheme.typography.bodyMedium, color = MemeColors.ink())
                    Text(item.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Text(if (open) "▴" else "▾", color = Lab.colors.muted)
            }
            PlayDot(ui.playing == "${item.id}:head") { actions.onPlay("${item.id}:head", item.hanzi) }
        }
        if (!open) return@Column
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp).testTag(MEME_CARD_BODY_TAG)) {
            ui.pictures[item.id]?.let { Picture(it, Modifier.fillMaxWidth().height(200.dp), big = true) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { H3("什么意思 · What it means") }
                Toggle("EN", english) { actions.onToggleEnglish(item.id) }
            }
            LineRow(item.meaning, english, ui.playing == "${item.id}:meaning") { actions.onPlay("${item.id}:meaning", item.meaning.hanzi) }

            H3("出处 · Where it came from")
            Text(item.origin.text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            Text(
                item.origin.`when` + if (item.origin.confidence == "medium") " · ⓘ not fully certain" else "",
                style = MaterialTheme.typography.bodySmall, color = if (item.origin.confidence == "medium") Color(0xFFB45309) else Lab.colors.muted,
            )

            H3("怎么用 · How people use it")
            item.examples.forEachIndexed { i, ex -> LineRow(ex, english, ui.playing == "${item.id}:ex$i") { actions.onPlay("${item.id}:ex$i", ex.hanzi) } }

            H3("谁在说 · Who says it")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (c in MemeReview.registerChips(item.register)) {
                    if (c.startsWith("⚠")) Chip(c, Color(0xFFFFF7ED), Color(0xFFC2410C)) else Chip(c, MemeColors.soft(), MemeColors.ink())
                }
            }
            if (item.register.note.isNotBlank()) Text(item.register.note, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.padding(top = 6.dp))
            val verdictBg = when (item.say_it.verdict) {
                "cute" -> if (MemeColors.dark()) Color(0xFF3B1F33) else Color(0xFFFDF2F8)
                "cringe" -> if (MemeColors.dark()) Color(0xFF3A2E12) else Color(0xFFFFFBEB)
                "avoid" -> if (MemeColors.dark()) Color(0xFF3A1A1A) else Color(0xFFFEF2F2)
                else -> if (MemeColors.dark()) Color(0xFF16301F) else Color(0xFFF0FDF4)
            }
            Column(Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(12.dp)).background(verdictBg).padding(12.dp).testTag("meme-verdict")) {
                Text("Would you say it? ${MemeReview.verdictLabel(item.say_it.verdict)}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                if (item.say_it.note.isNotBlank()) Text(item.say_it.note, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.padding(top = 2.dp))
            }

            if (item.related.isNotEmpty()) {
                H3("相关 · It riffs on")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (r in item.related) {
                        Row(
                            Modifier.heightIn(min = 44.dp).bouncyClickable { actions.onRelated(r) }.clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
                                .border(1.dp, MemeColors.line(), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(r.hanzi, fontSize = 17.sp, color = Lab.colors.ink)
                            Spacer(Modifier.width(6.dp))
                            Text(r.english, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                        }
                    }
                }
            }

            if (item.media.isNotEmpty() || item.sources.isNotEmpty()) {
                H3("原视频 · Watch / read")
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (m in item.media) LinkRow(MemeReview.linkLabel(m.kind, m.platform), m.title, media = true, enabled = ui.online) { actions.onLink(m.url, "media", m.kind, m.platform) }
                    for (s in item.sources) LinkRow("↗ ${MemeReview.platformName(s.platform)}", s.title, media = false, enabled = ui.online) { actions.onLink(s.url, "source", "post", s.platform) }
                }
                if (!ui.online) Text("Links need a connection.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp))
            }

            Spacer(Modifier.height(12.dp))
            val deck = ui.cards[item.id]
            when {
                deck != null -> {
                    Text("📚 In $deck", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    ui.bumped?.let { InlineNotice(it, kind = NoticeKind.Success, modifier = Modifier.padding(vertical = 6.dp)) }
                    PrimaryPill("⚡ Study it today", Modifier.fillMaxWidth().height(48.dp)) { actions.onBump(item) }
                }
                item.id in ui.added -> Text("✓ Added — it’s in your deck.", style = MaterialTheme.typography.bodyMedium, color = Palette.Good)
                else -> SecondaryPill("+ Add as card", Modifier.fillMaxWidth().height(48.dp).testTag("meme-add-card")) { actions.onAdd(item) }
            }
        }
    }
}

@Composable
private fun LineRow(line: MemeLine, english: Boolean, playing: Boolean, onPlay: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
            ExplorableText(line.hanzi, source = "meme_review", fontSize = 18.sp, lineHeight = 28.sp)
            if (line.pinyin.isNotBlank()) Text(line.pinyin, style = MaterialTheme.typography.bodySmall, color = MemeColors.ink())
            if (english && line.english.isNotBlank()) Text(line.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 2.dp))
        }
        Spacer(Modifier.width(8.dp))
        PlayDot(playing, onPlay)
    }
}

@Composable
private fun LinkRow(label: String, title: String, media: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(enabled = enabled, pressedScale = 0.98f, onClick = onClick).clip(RoundedCornerShape(12.dp))
            .background(if (media) MemeColors.soft() else Lab.colors.card).border(1.dp, if (media) Color.Transparent else MemeColors.line(), RoundedCornerShape(12.dp))
            .alpha(if (enabled) 1f else 0.5f).padding(horizontal = 12.dp, vertical = 10.dp).testTag(MEME_LINK_TAG),
    ) {
        Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MemeColors.ink())
        if (title.isNotBlank()) Text(title, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Quiz(issue: MemeIssue, ui: MemeIssueUi, actions: MemeIssueActions) {
    val picked = if (ui.picked.size == issue.quiz.size) ui.picked else issue.quiz.map { null }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, MemeColors.line(), RoundedCornerShape(18.dp)).padding(16.dp).animateContentSize()) {
        Text("🎯 你懂梗吗？ Quick quiz", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
        issue.quiz.forEachIndexed { qi, q ->
            Spacer(Modifier.height(12.dp))
            Text(q.prompt, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            Spacer(Modifier.height(6.dp))
            val chosen = picked[qi]
            q.options.forEachIndexed { oi, opt ->
                val (bg, border) = when {
                    chosen == null -> Lab.colors.card to MemeColors.line()
                    oi == q.answer -> Palette.Good.copy(alpha = 0.16f) to Palette.Good
                    oi == chosen -> Palette.Again.copy(alpha = 0.14f) to Palette.Again
                    else -> Lab.colors.card to MemeColors.line()
                }
                Text(
                    opt, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp).heightIn(min = 44.dp)
                        .bouncyClickable(enabled = chosen == null, pressedScale = 0.98f) { actions.onPick(qi, oi) }
                        .clip(RoundedCornerShape(12.dp)).background(bg).border(1.dp, border, RoundedCornerShape(12.dp))
                        .alpha(if (chosen != null && oi != q.answer && oi != chosen) 0.55f else 1f)
                        .padding(horizontal = 12.dp, vertical = 11.dp).testTag(MEME_QUIZ_OPTION_TAG),
                )
            }
            if (chosen != null) {
                val right = chosen == q.answer
                Text((if (right) "✓ Right. " else "✗ Not quite. ") + q.explanation, style = MaterialTheme.typography.bodyMedium, color = if (right) Palette.Good else Palette.Again, modifier = Modifier.padding(top = 4.dp))
            }
        }
        if (picked.isNotEmpty() && picked.all { it != null }) {
            val correct = picked.withIndex().count { (i, p) -> p == issue.quiz[i].answer }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth().testTag("meme-quiz-score"), verticalAlignment = Alignment.CenterVertically) {
                Text(MemeReview.quizScoreLine(correct, issue.quiz.size), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                SecondaryPill("Try again", Modifier.height(44.dp), onClick = actions.onResetQuiz)
            }
        }
    }
}

@Composable
private fun LessonCard(ui: MemeIssueUi, actions: MemeIssueActions) {
    val job = ui.lesson
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, MemeColors.line(), RoundedCornerShape(18.dp)).padding(16.dp)) {
        Text("🎓 Practise them", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
        Spacer(Modifier.height(6.dp))
        when {
            job?.status == "ready" && job.lesson_id != null -> {
                Text("Your mini lesson on this issue is in your Mini Lessons.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                Spacer(Modifier.height(10.dp))
                PrimaryPill("▶ Open the lesson", Modifier.fillMaxWidth().height(48.dp)) { actions.onOpenLesson(job.lesson_id!!) }
            }
            job?.status == "generating" -> Text("✍️ Claude is writing your mini lesson… (about a minute — you can leave this screen)", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            else -> {
                Text("A short mini lesson on these memes — meanings, matching, using them in a chat — saved in your own Mini Lessons. Nothing is sent to anyone.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                if (job?.status == "failed") Text(job.error ?: "The last try failed.", style = MaterialTheme.typography.bodySmall, color = Palette.Again, modifier = Modifier.padding(top = 4.dp))
                Spacer(Modifier.height(10.dp))
                PrimaryPill(if (ui.lessonBusy) "Starting…" else "Make a mini lesson from this issue", Modifier.fillMaxWidth().height(48.dp).testTag(MEME_LESSON_TAG), enabled = !ui.lessonBusy && ui.online, onClick = actions.onMakeLesson)
                if (!ui.online) Text("Needs a connection.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp))
            }
        }
        ui.lessonError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.Again, modifier = Modifier.padding(top = 6.dp)) }
    }
}
