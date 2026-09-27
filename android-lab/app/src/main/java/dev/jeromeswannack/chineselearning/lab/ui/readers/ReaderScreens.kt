package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.animation.AnimatedContent
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.study.RatingBar
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** A reader in the study session. [key] changes when the same story comes back. */
data class SessionReader(val reader: GradedReaderDto, val previews: List<IntervalPreview>, val key: Int)

/**
 * A graded reader inside the study session (the web's StudyReader): page through, then
 * rate it on the last page with the same FSRS bar as cards.
 */
@Composable
fun StudyReaderView(session: SessionReader, env: ReaderEnv, onRate: (rating: Int, timeSpentMs: Long) -> Unit) {
    val reader = session.reader
    var page by rememberSaveable(session.key) { mutableIntStateOf(0) }
    val started = remember(session.key) { System.currentTimeMillis() }
    var rated by remember(session.key) { mutableStateOf(false) }
    val pages = reader.pages
    val last = page == pages.size - 1
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.fillMaxSize().widthIn(max = 720.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                PageTitle(reader.titleChinese, "${reader.titleEnglish} · Page ${page + 1} of ${pages.size}")
                ReaderProgress((page + 1f) / pages.size)
                PagesContent(reader, page, env, scrubber = true)
                Spacer(Modifier.height(16.dp))
            }
        }
        if (last) {
            Column(Modifier.fillMaxWidth().background(Lab.colors.card).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (pages.size > 1) SecondaryPill("‹ Back") { page--; env.onTap() }
                    Text("How well did you understand this story?", color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                }
                RatingBar(session.previews, enabled = !rated) { r ->
                    if (rated) return@RatingBar
                    rated = true
                    onRate(r, System.currentTimeMillis() - started)
                }
            }
        } else {
            NavFooter(page, pages.size, onPrev = { page--; env.onTap() }, onNext = { page++; env.onTap() }, onFinish = null)
        }
    }
}

@Composable
private fun PagesContent(reader: GradedReaderDto, page: Int, env: ReaderEnv, scrubber: Boolean = false) {
    AnimatedContent(
        page,
        transitionSpec = {
            val dir = if (targetState > initialState) 1 else -1
            (slideInHorizontally(spring(dampingRatio = 0.85f, stiffness = 380f)) { dir * it / 4 } + fadeIn(tween(180))) togetherWith
                (slideOutHorizontally(tween(200)) { -dir * it / 4 } + fadeOut(tween(150)))
        },
        label = "page",
    ) { p -> reader.pages.getOrNull(p)?.let { ReaderPageView(it, env, scrubber) } }
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
                    Box(Modifier.padding(horizontal = 20.dp)) { ReaderProgress((page + 1f) / reader.pages.size) }
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                        Column(Modifier.fillMaxSize().widthIn(max = 720.dp).verticalScroll(rememberScrollState()).padding(20.dp)) {
                            PagesContent(reader, page, env)
                        }
                    }
                    NavFooter(page, reader.pages.size, onPrev = { page--; env.onTap() }, onNext = { page++; env.onTap() }, onFinish = onFinish)
                }
            }
        }
    }
}

@Composable
private fun CenterMessage(text: String, spinner: Boolean) {
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (spinner) CircularProgressIndicator(color = Lab.colors.accent)
        Text(text, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp))
    }
}
