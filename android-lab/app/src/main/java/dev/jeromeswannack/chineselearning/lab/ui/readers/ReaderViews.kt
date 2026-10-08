package dev.jeromeswannack.chineselearning.lab.ui.readers

import android.graphics.BitmapFactory
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.FlowRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import dev.jeromeswannack.chineselearning.lab.data.readers.ClipAnalysis
import dev.jeromeswannack.chineselearning.lab.data.readers.decodeClip

/** What a reader page may do outside itself (a fake in screenshots). */
class ReaderEnv(
    /** The page's illustration: cached, downloaded, or generated on demand (null offline / none). */
    val image: suspend (page: ReaderPageDto) -> File? = { null },
    /** An illustration already on the phone (renders on the first frame). */
    val cachedImage: (page: ReaderPageDto) -> File? = { null },
    /** Plays / stops the page narration (cache-first TTS at the reader speed). */
    val togglePlay: (page: ReaderPageDto) -> Unit = {},
    /** The page id whose narration is playing. */
    val playingPage: String? = null,
    val onTap: () -> Unit = {},
    /** The page's word chips (made with Haiku, cached on the page); null = plain text until they arrive. */
    val words: (suspend (page: ReaderPageDto) -> List<ReaderWordDto>?)? = null,
    /** Hanzi already in a deck — their chips are marked subtly. */
    val known: Set<String> = emptySet(),
    /** A tapped word, with the sentence it was read in → the word sheet. */
    val onWord: (word: ReaderWordDto, sentence: String) -> Unit = { _, _ -> },
    /** The page narration as a file (cache-first; `regenerate` replaces a bad clip) — the session's scrubber. */
    val pageAudio: (suspend (page: ReaderPageDto, regenerate: Boolean) -> File?)? = null,
    /** The clip's waveform peaks + phrase blocks (decoded on the phone; cached per clip in the app). */
    val analyze: suspend (page: ReaderPageDto, file: File) -> ClipAnalysis? = { _, f -> withContext(Dispatchers.Default) { decodeClip(f) } },
    /** The speed chip's value (1 / 0.75 / 0.5, core ReaderSpeed): narration and a word's ▶ play at it, pitch kept. */
    val speed: Double = 1.0,
    /** The speed chip was tapped (1× → 0.75× → 0.5× → 1×). */
    val onSpeed: () -> Unit = {},
)

val Violet = Color(0xFF8B5CF6)

/** `DIFFICULTY_COLORS`. */
fun difficultyStyle(level: String): Triple<String, Color, Color> = when (level) {
    "elementary" -> Triple("Elementary", Color(0xFFDBEAFE), Color(0xFF1E40AF))
    "intermediate" -> Triple("Intermediate", Color(0xFFFEF3C7), Color(0xFF92400E))
    "advanced" -> Triple("Advanced", Color(0xFFFCE7F3), Color(0xFF9D174D))
    else -> Triple("Beginner", Color(0xFFDCFCE7), Color(0xFF166534))
}

@Composable
fun DifficultyBadge(level: String) {
    val (label, bg, fg) = difficultyStyle(level)
    Text(label, color = fg, fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.clip(CircleShape).background(bg).padding(horizontal = 10.dp, vertical = 3.dp))
}

private fun decode(file: File): ImageBitmap? = runCatching { BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap() }.getOrNull()

/**
 * One page, listen-first (the web's StudyReaderPage / PageView): the illustration, the
 * Chinese hidden until tapped (tap again to hide), the narration button, pinyin and the
 * translation each behind their own tap. Keyed by page id by the caller so every reveal
 * resets on a page turn.
 */
@Composable
fun ReaderPageView(page: ReaderPageDto, env: ReaderEnv, scrubber: Boolean = false, story: StoryPlayback? = null) {
    var showChinese by rememberSaveable(page.id) { mutableStateOf(false) }
    var showPinyin by rememberSaveable(page.id) { mutableStateOf(false) }
    var showTranslation by rememberSaveable(page.id) { mutableStateOf(false) }
    val first = remember(page.id, page.imageUrl) { env.cachedImage(page)?.let(::decode) }
    val image by produceState(first to (first == null && !page.imagePrompt.isNullOrBlank()), page.id, page.imageUrl) {
        if (value.first == null) {
            val bmp = env.image(page)?.let { withContext(Dispatchers.IO) { decode(it) } }
            value = bmp to false
        }
    }
    // Unfolded (≥ 640dp): picture beside the text, like the web's desktop grid.
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val wide = maxWidth >= 640.dp
        val (bmp, generating) = image
        val picture: @Composable (Modifier) -> Unit = { m ->
            when {
                bmp != null -> Image(bmp, "Story illustration", m.clip(RoundedCornerShape(18.dp)), contentScale = ContentScale.FillWidth)
                generating -> Box(m.aspectRatio(4f / 3f).clip(RoundedCornerShape(18.dp)).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(Modifier.size(28.dp), color = Lab.colors.muted, strokeWidth = 3.dp)
                        Text("Generating illustration…", fontSize = 12.sp, color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
        }
        val text: @Composable (Modifier) -> Unit = { m ->
            Column(m, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.weight(1f)) {
                        AnimatedContent(showChinese, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) }, label = "chinese") { shown ->
                            if (shown) {
                                RevealedChinese(page, env) { showChinese = false; env.onTap() }
                            } else {
                                RevealBox("Tap to reveal Chinese", big = true) { showChinese = true; env.onTap() }
                            }
                        }
                    }
                    if (!scrubber) {
                        // ▶ with the speed chip under it (the web's .reader-audio-controls)
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            PlayButton(env.playingPage == page.id) { env.togglePlay(page) }
                            ReaderSpeedChip(env.speed, env.onSpeed, minWidth = 56.dp)
                        }
                    }
                }
                // In the session (StudyReader): the scrubbable waveform under the Chinese.
                if (scrubber) ReaderScrubber(page, env, story = story)
                ToggleBox(showPinyin, page.contentPinyin, "Tap to reveal pinyin", Lab.colors.accent) { showPinyin = !showPinyin; env.onTap() }
                ToggleBox(showTranslation, page.contentEnglish, "Tap to reveal translation", Lab.colors.ink) { showTranslation = !showTranslation; env.onTap() }
            }
        }
        if (wide) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Box(Modifier.weight(1f)) { picture(Modifier.fillMaxWidth()) }
                text(Modifier.weight(1f))
            }
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                picture(Modifier.fillMaxWidth())
                text(Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * The revealed Chinese as word chips (`ReaderWordsText`): each word is tappable (→ the word
 * sheet), punctuation stays plain, a line break starts a new row, a word already in a deck is
 * marked with a quieter chip and a green underline. Plain text until the words are there;
 * tapping anywhere that isn't a word hides the Chinese again.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RevealedChinese(page: ReaderPageDto, env: ReaderEnv, onHide: () -> Unit) {
    val load = env.words
    val words by produceState(page.currentWords(), page.id, page.contentChinese, load) {
        if (value == null) value = load?.invoke(page)?.takeIf { w -> ReaderWords.matches(w.map { it.text }, page.contentChinese) }
    }
    val box = Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.99f, onClick = onHide)
        .clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(16.dp)
    val w = words
    if (w == null) {
        Text(page.contentChinese, fontSize = 26.sp, lineHeight = 38.sp, color = Lab.colors.ink, modifier = box)
        return
    }
    val offsets = remember(w) { ReaderWords.offsets(w.map { it.text }) }
    FlowRow(box.testTag("reader-words"), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for ((i, word) in w.withIndex()) {
            when {
                word.text.contains('\n') -> Spacer(Modifier.fillMaxWidth())
                !ReaderWords.isTappable(word.text) -> Text(word.text, fontSize = 26.sp, color = Lab.colors.ink)
                else -> WordChip(word, known = word.text in env.known) {
                    env.onWord(word, ReaderWords.sentenceAround(page.contentChinese, offsets[i], offsets[i] + word.text.length))
                }
            }
        }
    }
}

@Composable
private fun WordChip(word: ReaderWordDto, known: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Text(
        word.text,
        fontSize = 26.sp,
        color = Lab.colors.ink,
        modifier = Modifier.clip(shape).bouncyClickable(pressedScale = 0.9f, onClick = onClick)
            .background(if (known) Lab.colors.faint else Lab.colors.accentSoft.copy(alpha = 0.55f))
            .then(if (known) Modifier.drawBehind {
                val h = 2.dp.toPx()
                drawRect(Palette.Good.copy(alpha = 0.7f), topLeft = androidx.compose.ui.geometry.Offset(3.dp.toPx(), size.height - h - 1.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width - 6.dp.toPx(), h))
            } else Modifier)
            .semantics { contentDescription = if (known) "${word.text}, in your decks" else word.text }
            .testTag("word-chip")
            .padding(horizontal = 3.dp),
    )
}

@Composable
private fun RevealBox(label: String, big: Boolean = false, onClick: () -> Unit) {
    Text(
        label,
        color = Lab.colors.muted,
        textAlign = TextAlign.Center,
        fontSize = if (big) 16.sp else 15.sp,
        modifier = Modifier.fillMaxWidth().heightIn(min = if (big) 72.dp else 52.dp).bouncyClickable(onClick = onClick)
            .clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).border(1.5.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = if (big) 24.dp else 14.dp),
    )
}

@Composable
private fun ToggleBox(shown: Boolean, text: String, label: String, color: Color, onClick: () -> Unit) {
    if (!shown) return RevealBox(label, onClick = onClick)
    Text(
        text,
        color = color,
        fontSize = 17.sp,
        lineHeight = 25.sp,
        modifier = Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.99f, onClick = onClick).clip(RoundedCornerShape(16.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp, vertical = 14.dp),
    )
}

@Composable
private fun PlayButton(playing: Boolean, onClick: () -> Unit) {
    val pulse by animateFloatAsState(if (playing) 1.08f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow), label = "pulse")
    val bg by animateColorAsState(if (playing) Lab.colors.accent else Lab.colors.accentSoft, label = "playBg")
    Box(Modifier.size(64.dp).scale(pulse).bouncyClickable(pressedScale = 0.9f, onClick = onClick).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Icon(if (playing) Icons.Filled.Stop else Icons.AutoMirrored.Filled.VolumeUp, if (playing) "Stop audio" else "Play audio", Modifier.size(30.dp), tint = if (playing) Color.White else Lab.colors.accent)
    }
}

/** The thin progress bar under a reader's title. */
@Composable
fun ReaderProgress(fraction: Float) {
    val p by animateFloatAsState(fraction.coerceIn(0f, 1f), spring(dampingRatio = 0.9f, stiffness = 120f), label = "readerProgress")
    Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(Lab.colors.faint)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(p).clip(CircleShape).background(Brush.horizontalGradient(listOf(Violet, Palette.Easy))))
    }
}

/**
 * The reader's title block: "📖 GRADED READER", the Chinese title, then [sub]. [leading] (the
 * session's ▶ Play whole story) sits at the START of the label row, the label staying centred.
 */
@Composable
fun PageTitle(titleChinese: String, sub: String, leading: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        val label = @Composable { Text("📖  GRADED READER", color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, letterSpacing = 1.sp) }
        if (leading == null) label()
        else Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(Modifier.align(Alignment.CenterStart)) { leading() }
            Box(Modifier.padding(horizontal = 52.dp)) { label() }
        }
        Text(titleChinese, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Text(sub, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
    }
}
