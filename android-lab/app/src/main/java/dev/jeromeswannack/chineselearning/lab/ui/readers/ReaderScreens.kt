package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import kotlinx.coroutines.launch
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import dev.jeromeswannack.chineselearning.lab.core.DailyReader
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** A reader in the study session. [key] changes when the same story is presented again. */
data class SessionReader(val reader: GradedReaderDto, val key: Int)

/**
 * "▶ Play whole story" hooks for a page's scrubber ([ReaderScrubber]): play as soon as the
 * clip is ready, and tell the reader when it ended / was stopped / has no audio.
 */
class StoryPlayback(
    val autoPlay: Boolean,
    val onEnded: () -> Unit = {},
    val onStopped: () -> Unit = {},
    /** No clip on the phone ([missing] = true: offline and not downloaded) or it wouldn't play. */
    val onUnavailable: (missing: Boolean) -> Unit = {},
)

/** The story button's test tag. */
const val READER_PLAY_STORY_TAG = "reader-play-story"

/** The Finish button's test tag. */
const val READER_FINISH_TAG = "reader-finish"

/**
 * A graded reader inside the study session (the web's StudyReader): page through, then
 * Finish on the last page — a story is read ONCE and never comes back (core [DailyReader]).
 * Listen-first: "▶ Play whole story" plays every page's narration one after another, turning
 * the pages, at the speed chip's speed; listening to the end counts as finishing
 * ([onFinish]'s `how` = "listened"). Every page's narration is fetched onto the phone when the
 * story opens, so it keeps playing when the train goes offline.
 */
@Composable
fun StudyReaderView(session: SessionReader, env: ReaderEnv, onFinish: (timeSpentMs: Long, how: String) -> Unit) {
    val reader = session.reader
    var page by rememberSaveable(session.key) { mutableIntStateOf(0) }
    val started = remember(session.key) { System.currentTimeMillis() }
    var finished by remember(session.key) { mutableStateOf(false) }
    var storyPlaying by rememberSaveable(session.key) { mutableStateOf(false) }
    var storyNote by remember(session.key) { mutableStateOf<String?>(null) }
    val pages = reader.pages
    val last = page == pages.size - 1
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    var gapJob by remember(session.key) { mutableStateOf<kotlinx.coroutines.Job?>(null) }

    // Listen-first: every page's narration onto the phone in the background.
    LaunchedEffect(session.key) { env.pageAudio?.let { load -> for (p in pages) runCatching { load(p, false) } } }

    fun finish(how: String) {
        if (finished) return
        finished = true
        onFinish(System.currentTimeMillis() - started, how)
    }
    fun stopStory(track: Boolean) {
        gapJob?.cancel()
        gapJob = null
        if (storyPlaying && track) dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("reader.story_stop", mapOf("page" to page + 1, "pages" to pages.size))
        storyPlaying = false
    }
    fun turnTo(i: Int) {
        // A manual turn while the story plays: it carries on from the new page.
        gapJob?.cancel()
        gapJob = null
        page = i
        env.onTap()
    }
    val story = StoryPlayback(
        autoPlay = storyPlaying,
        onEnded = {
            if (storyPlaying) {
                val next = DailyReader.storyNextPage(page, pages.size)
                if (next == null) {
                    storyPlaying = false
                    finish("listened")
                } else {
                    gapJob = scope.launch {
                        kotlinx.coroutines.delay(DailyReader.storyPageGapMs(env.speed))
                        page = next
                    }
                }
            }
        },
        onStopped = { stopStory(track = true) },
        onUnavailable = { missing ->
            if (storyPlaying) {
                stopStory(track = false)
                storyNote = if (missing) "This page's audio isn't on the phone yet — it downloads when you're online."
                else "This page's audio wouldn't play — tap 🔊 to try again."
            }
        },
    )
    Column(Modifier.fillMaxSize()) {
        // The blue progress bar stays pinned under the study top bar; the page scrolls beneath it.
        PinnedReaderProgress((page + 1f) / pages.size, scrolled = scroll.value > 0)
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.fillMaxSize().widthIn(max = 720.dp).testTag(READER_SCROLL_TAG).verticalScroll(scroll).padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                PageTitle(reader.titleChinese, "${reader.titleEnglish} · Page ${page + 1} of ${pages.size}", leading = {
                    StoryButton(
                        playing = storyPlaying,
                        label = when { storyPlaying -> "Stop the story"; page == 0 -> "Play whole story"; else -> "Play the rest" },
                    ) {
                        if (storyPlaying) stopStory(track = true)
                        else {
                            storyNote = null
                            dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("reader.story_play", mapOf("from_page" to page + 1, "pages" to pages.size, "speed" to env.speed, "offline" to false))
                            storyPlaying = true
                            env.onTap()
                        }
                    }
                })
                storyNote?.let { Text(it, fontSize = 12.sp, color = Color(0xFF92400E), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
                PagesContent(reader, page, env, scrubber = true, story = story)
                Spacer(Modifier.height(16.dp))
            }
        }
        if (last) {
            Row(Modifier.fillMaxWidth().background(Lab.colors.card).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (pages.size > 1) SecondaryPill("‹ Back", Modifier.weight(1f).height(54.dp)) { turnTo(page - 1) }
                PrimaryPill("Finish ✓", Modifier.weight(2f).height(54.dp).testTag(READER_FINISH_TAG), enabled = !finished) {
                    stopStory(track = false)
                    finish("finish")
                }
            }
        } else {
            NavFooter(page, pages.size, onPrev = { turnTo(page - 1) }, onNext = { turnTo(page + 1) }, onFinish = null)
        }
    }
}

/**
 * "▶ Play whole story": a small violet round button at the start of the "GRADED READER" row
 * (a 36dp circle in a 48dp touch target), filled with ■ while the story plays. [label] is its
 * content description ("Play whole story" / "Play the rest" / "Stop the story").
 */
@Composable
internal fun StoryButton(playing: Boolean, label: String, onClick: () -> Unit) {
    val bg by animateColorAsState(if (playing) Color(0xFF6D28D9) else Violet.copy(alpha = 0.14f), label = "storyBg")
    val fg = if (playing) Color.White else Violet
    Box(
        Modifier.size(48.dp).clip(CircleShape).bouncyClickable(pressedScale = 0.9f, onClick = onClick)
            .semantics { contentDescription = label; selected = playing }
            .testTag(READER_PLAY_STORY_TAG),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(36.dp).clip(CircleShape).background(bg)
                .border(1.dp, if (playing) Color(0xFF6D28D9) else Violet.copy(alpha = 0.45f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (playing) Icons.Filled.Stop else Icons.Filled.PlayArrow, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun PagesContent(reader: GradedReaderDto, page: Int, env: ReaderEnv, scrubber: Boolean = false, story: StoryPlayback? = null) {
    AnimatedContent(
        page,
        transitionSpec = {
            val dir = if (targetState > initialState) 1 else -1
            (slideInHorizontally(spring(dampingRatio = 0.85f, stiffness = 380f)) { dir * it / 4 } + fadeIn(tween(180))) togetherWith
                (slideOutHorizontally(tween(200)) { -dir * it / 4 } + fadeOut(tween(150)))
        },
        label = "page",
    ) { p -> reader.pages.getOrNull(p)?.let { ReaderPageView(it, env, scrubber, story?.takeIf { p == page }) } }
}

@Composable
private fun NavFooter(page: Int, count: Int, onPrev: () -> Unit, onNext: () -> Unit, onFinish: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().background(Lab.colors.card).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SecondaryPill("Previous", Modifier.weight(1f).height(54.dp), enabled = page > 0, onClick = onPrev)
        if (page >= count - 1 && onFinish != null) PrimaryPill("Finish", Modifier.weight(1f).height(54.dp), onClick = onFinish)
        else PrimaryPill("Next", Modifier.weight(1f).height(54.dp), enabled = page < count - 1, onClick = onNext)
    }
}

/**
 * `/readers/:id` — the standalone reading view (the web's ReaderPage): page through with
 * Previous / Next, Finish marks the day's reader activity. A reader still being generated
 * shows a waiting state (the screen polls).
 */
@Composable
fun ReaderScreen(reader: GradedReaderDto?, error: String?, env: ReaderEnv, onBack: () -> Unit, onEdit: () -> Unit, onFinish: () -> Unit, onAnki: (() -> Unit)? = null) {
    var page by rememberSaveable(reader?.id) { mutableIntStateOf(0) }
    Box(Modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Lab.colors.ink) }
                Column(Modifier.weight(1f)) {
                    Text(reader?.titleChinese ?: "Reader", fontWeight = FontWeight.SemiBold, fontSize = 19.sp, color = Lab.colors.ink, maxLines = 1)
                    if (reader != null && reader.pages.isNotEmpty()) Text("Page ${page + 1} of ${reader.pages.size}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
                if (reader != null) {
                    Text("Edit", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.bouncyClickable(onClick = onEdit).padding(horizontal = 10.dp, vertical = 12.dp))
                    if (onAnki != null) Text("⬇ Anki", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.bouncyClickable(onClick = onAnki).padding(horizontal = 8.dp, vertical = 12.dp))
                    DifficultyBadge(reader.difficulty)
                    Spacer(Modifier.padding(end = 12.dp))
                }
            }
            when {
                reader == null -> CenterMessage(error ?: "Loading…", spinner = error == null)
                reader.status == "generating" || reader.pages.isEmpty() -> CenterMessage("Generating your reader…\n${reader.titleEnglish}", spinner = reader.status == "generating")
                else -> {
                    val scroll = rememberScrollState()
                    PinnedReaderProgress((page + 1f) / reader.pages.size, scrolled = scroll.value > 0)
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                        Column(Modifier.fillMaxSize().widthIn(max = 720.dp).testTag(READER_SCROLL_TAG).verticalScroll(scroll).padding(horizontal = 20.dp, vertical = 12.dp)) {
                            PagesContent(reader, page, env)
                        }
                    }
                    NavFooter(page, reader.pages.size, onPrev = { page--; env.onTap() }, onNext = { page++; env.onTap() }, onFinish = onFinish)
                }
            }
        }
    }
}

/** The reading area's scrolling column (screenshot tests scroll it). */
const val READER_SCROLL_TAG = "reader-scroll"

/**
 * The page-progress bar held at the top of a reader, above its scrolling page: the page
 * (illustration, Chinese, pinyin, translation, audio) scrolls beneath it, never under it.
 * Once the page has scrolled, a hairline separates the bar from the text passing below.
 */
@Composable
private fun PinnedReaderProgress(fraction: Float, scrolled: Boolean) {
    val line by animateFloatAsState(if (scrolled) 1f else 0f, tween(160), label = "pinnedLine")
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Box(Modifier.fillMaxWidth().widthIn(max = 720.dp).padding(horizontal = 20.dp, vertical = 8.dp)) { ReaderProgress(fraction) }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).alpha(line).background(Lab.colors.cardBorder))
    }
}

@Composable
private fun CenterMessage(text: String, spinner: Boolean) {
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (spinner) CircularProgressIndicator(color = Lab.colors.accent)
        Text(text, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp))
    }
}
