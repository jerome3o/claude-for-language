package dev.jeromeswannack.chineselearning.lab.ui.readers

import android.graphics.BitmapFactory
import androidx.compose.animation.AnimatedContent
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import dev.jeromeswannack.chineselearning.lab.core.ReadAloud
import androidx.compose.foundation.combinedClickable
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
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords

/** What a reader page may do outside itself (a fake in screenshots). */
class ReaderEnv(
    /** The page's illustration: cached, downloaded, or generated on demand (null offline / none). */
    val image: suspend (page: ReaderPageDto) -> File? = { null },
    /** An illustration already on the phone (renders on the first frame). */
    val cachedImage: (page: ReaderPageDto) -> File? = { null },
    val onTap: () -> Unit = {},
    /** The page's word chips (made with Haiku, cached on the page); null = plain text until they arrive. */
    val words: (suspend (page: ReaderPageDto) -> List<ReaderWordDto>?)? = null,
    /** Hanzi already in a deck — their chips are marked subtly. */
    val known: Set<String> = emptySet(),
    /** A tapped word, with the sentence it was read in → the word sheet. */
    val onWord: (word: ReaderWordDto, sentence: String) -> Unit = { _, _ -> },
    /** The page narration as a file (cache-first; `regenerate` replaces a bad clip) — the page's scrubber. */
    val pageAudio: (suspend (page: ReaderPageDto, regenerate: Boolean) -> File?)? = null,
    /** The clip's waveform peaks + phrase blocks (decoded on the phone; cached per clip in the app). */
    val analyze: suspend (page: ReaderPageDto, file: File) -> ClipAnalysis? = { _, f -> withContext(Dispatchers.Default) { decodeClip(f) } },
    /** The speed chip's value (1 / 0.75 / 0.5, core ReaderSpeed): narration and a word's ▶ play at it, pitch kept. */
    val speed: Double = 1.0,
    /** The speed chip was tapped (1× → 0.75× → 0.5× → 1×). */
    val onSpeed: () -> Unit = {},
    /** 🎤 Read it aloud on the page (the app's reading views; off in fakes without a microphone). */
    val readAloud: Boolean = false,
    /** Say a word (a long press on a word marked by a read-aloud take). */
    val speak: (text: String) -> Unit = {},
    /** 📝 Reader word recap: what this reading collects (taps, read-aloud mistakes), offered after the finish. */
    val recap: dev.jeromeswannack.chineselearning.lab.data.readers.WordRecapStore.Collector? = null,
    /** 📖 Ask Claude about this page: the 💬 in the reading view opens the page's Claude thread (the app's reading views). */
    val askClaude: Boolean = false,
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
 * One page, listen-first (the web's ReaderView page body): the illustration, the Chinese
 * hidden until tapped (tap again to hide), the phrase-block scrubber with the speed chip,
 * pinyin and the translation each behind their own tap. Keyed by page id by the caller so
 * every reveal resets on a page turn. The same page wherever a story is read.
 */
@Composable
fun ReaderPageView(
    page: ReaderPageDto,
    env: ReaderEnv,
    story: StoryPlayback? = null,
    readAloudPreview: ReadAloudHandle? = null,
    /** The reading view's lock: this page reports its 🎤 take there (only the page on screen gets one). */
    takeLock: ReaderTakeLock? = null,
    /** 0-based: the reader word recap keeps its words in story order. */
    pageIndex: Int = 0,
    /** The Chinese starts shown (screenshots / tests of a marked page); the app always starts hidden. */
    initialShowChinese: Boolean = false,
) {
    var showChinese by rememberSaveable(page.id) { mutableStateOf(initialShowChinese) }
    var showPinyin by rememberSaveable(page.id) { mutableStateOf(false) }
    var showTranslation by rememberSaveable(page.id) { mutableStateOf(false) }
    // 🎤 Read it aloud ([readAloudPreview]: a state drawn as given — screenshots, tests).
    val readAloud: ReadAloudHandle? = when {
        readAloudPreview != null -> readAloudPreview
        env.readAloud -> rememberReadAloud(page.contentChinese, onStart = { if (story?.autoPlay == true) story.onStopped() }, onResult = {})
        else -> null
    }
    // Tell the reading view while a take is under way (it swaps the footer for ■ Stop recording).
    if (takeLock != null && readAloud != null) {
        val stop by rememberUpdatedState(readAloud.actions.onStop)
        val phase = readAloud.ui.phase
        val perfect = readAloud.perfectTakes
        SideEffect {
            takeLock.phase = phase
            takeLock.perfectTakes = perfect
            takeLock.stopTake = { stop() }
        }
        DisposableEffect(takeLock) { onDispose { takeLock.phase = "idle"; takeLock.perfectTakes = 0; takeLock.stopTake = {} } }
    }
    val locked = readAloud != null && ReadAloud.locksPage(readAloud.ui.phase)
    // What it heard vs the page: the differences group by the page's words (a tap on a word still opens the explorer).
    var pageWords by remember(page.id) { mutableStateOf<List<String>?>(null) }
    var pageWordList by remember(page.id) { mutableStateOf<List<ReaderWordDto>?>(null) }
    val resultNow = readAloud?.ui?.result
    // 📝 Reader word recap: the words a take read wrong join the run (glosses from the chips).
    LaunchedEffect(resultNow) {
        val r = resultNow ?: return@LaunchedEffect
        if (readAloudPreview != null) return@LaunchedEffect
        env.recap?.take(
            dev.jeromeswannack.chineselearning.lab.core.WordRecap.Page(pageIndex, page.contentChinese, page.contentEnglish, pageWordList?.map { dev.jeromeswannack.chineselearning.lab.core.WordRecap.Word(it.text, it.pinyin, it.gloss) }),
            r,
        )
    }
    // A take never touches the reveal (Jerome listens, hides the Chinese and says it back from memory):
    // the result marks the Chinese in place whenever it is shown — at once, or when he reveals it later.
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
                AnimatedContent(showChinese, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) }, label = "chinese") { shown ->
                    if (shown) {
                        RevealedChinese(page, env, readAloud?.ui?.result, onWords = { pageWords = it }, onWordList = { pageWordList = it }, pageIndex = pageIndex) { showChinese = false; env.onTap() }
                    } else {
                        RevealBox("Tap to reveal Chinese", big = true) { showChinese = true; env.onTap() }
                    }
                }
                // The scrubbable waveform (phrase blocks, speed chip) under the Chinese.
                ReaderScrubber(page, env, story = story, extra = readAloud?.let { ra -> { ReadAloudMic(ra.ui, ra.actions.onMic) } }, locked = locked)
                readAloud?.let { ReadAloudPanel(it.ui, it.actions, ReadAloudDiffEnv(pageWords, env.speak, page.contentChinese, pageHidden = !showChinese)) }
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
 * marked with a quieter chip and a green underline (not while 🎤 Read it aloud marks are shown:
 * the chips step back and [MarkedChars] draws the marks). Plain text until the words are there;
 * tapping anywhere that isn't a word hides the Chinese again.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RevealedChinese(
    page: ReaderPageDto,
    env: ReaderEnv,
    marks: ReadAloud.Result?,
    onWords: (List<String>?) -> Unit = {},
    onWordList: (List<ReaderWordDto>?) -> Unit = {},
    pageIndex: Int = 0,
    onHide: () -> Unit,
) {
    val load = env.words
    val words by produceState(page.currentWords(), page.id, page.contentChinese, load) {
        if (value == null) value = load?.invoke(page)?.takeIf { w -> ReaderWords.matches(w.map { it.text }, page.contentChinese) }
    }
    val box = Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.99f, onClick = onHide)
        .clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(16.dp)
    // 🎤 Read it aloud: the page's own characters marked in place (one mark per code point).
    val marked = marks?.chars?.takeIf { it.size == page.contentChinese.codePointCount(0, page.contentChinese.length) }
    val extraAtEnd = if (marked != null) marks.extraAtEnd else ""
    // Without Claude's words (yet, or they failed): the words made on the phone.
    val w = words ?: DeviceWords.of(page.contentChinese)
    val report by androidx.compose.runtime.rememberUpdatedState(onWords)
    val reportList by androidx.compose.runtime.rememberUpdatedState(onWordList)
    LaunchedEffect(w) { report(w?.map { it.text }); reportList(w) }
    if (w == null) {
        if (marked != null) MarkedChars(marked, extraAtEnd, lineHeight = 38.sp, modifier = box.testTag("reader-read-aloud-marked"))
        else Text(page.contentChinese, fontSize = 26.sp, lineHeight = 38.sp, color = Lab.colors.ink, modifier = box)
        return
    }
    val offsets = remember(w) { ReaderWords.offsets(w.map { it.text }) }
    FlowRow(box.testTag("reader-words"), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        // The words concatenate to the page's text: a running code-point count lines each up with its marks.
        var cp = 0
        for ((i, word) in w.withIndex()) {
            val len = word.text.codePointCount(0, word.text.length)
            val wordMarks = marked?.subList(cp, minOf(marked.size, cp + len))
            val start = cp
            cp += len
            when {
                word.text.contains('\n') -> Spacer(Modifier.fillMaxWidth())
                !ReaderWords.isTappable(word.text) ->
                    if (wordMarks != null) MarkedChars(wordMarks) else Text(word.text, fontSize = 26.sp, color = Lab.colors.ink)
                else -> WordChip(
                    word,
                    known = word.text in env.known,
                    marks = wordMarks,
                    onLongPress = if (wordMarks != null && ReadAloud.needsLook(wordMarks)) ({ env.speak(word.text) }) else null,
                ) {
                    // Marked or not, a tap opens the word in the language explorer.
                    val sentence = ReaderWords.sentenceAround(page.contentChinese, offsets[i], offsets[i] + word.text.length)
                    env.onWord(word, sentence)
                    env.recap?.tap(dev.jeromeswannack.chineselearning.lab.core.WordRecap.Tap(word.text, word.pinyin, word.gloss, sentence, pageIndex, start, page.contentEnglish))
                }
            }
        }
        if (extraAtEnd.isNotEmpty()) MarkedChars(emptyList(), extraAtEnd, modifier = Modifier.semantics { contentDescription = "You also said $extraAtEnd" })
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun WordChip(word: ReaderWordDto, known: Boolean, marks: List<ReadAloud.Char>? = null, onLongPress: (() -> Unit)? = null, onClick: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    val tap = if (onLongPress != null) Modifier.combinedClickable(onClick = onClick, onLongClick = onLongPress)
    else Modifier.bouncyClickable(pressedScale = 0.9f, onClick = onClick)
    val marked = marks != null && marks.any { (it.mark != ReadAloud.Mark.OK && it.mark != ReadAloud.Mark.UNREAD) || it.extraBefore.isNotEmpty() }
    val label = when {
        marked -> markedLabel(marks!!)
        known -> "${word.text}, in your decks"
        else -> word.text
    }
    // While a read-aloud result is shown the chip steps back (no fill, no clip, no known-word
    // underline) so the marks sit cleanly on the page; a tap still opens the word.
    val chip = Modifier.then(if (marks == null) Modifier.clip(shape) else Modifier).then(tap)
        .then(if (marks == null) Modifier.background(if (known) Lab.colors.faint else Lab.colors.accentSoft.copy(alpha = 0.55f)) else Modifier)
        .then(if (known && marks == null) Modifier.drawBehind {
            val h = 2.dp.toPx()
            drawRect(Palette.Good.copy(alpha = 0.7f), topLeft = androidx.compose.ui.geometry.Offset(3.dp.toPx(), size.height - h - 1.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width - 6.dp.toPx(), h))
        } else Modifier)
        .semantics { contentDescription = label }
        .testTag("word-chip")
        .padding(horizontal = 3.dp)
    if (marks != null) MarkedChars(marks, modifier = chip) else Text(word.text, fontSize = 26.sp, color = Lab.colors.ink, modifier = chip)
}

@Composable
private fun RevealBox(label: String, big: Boolean = false, onClick: () -> Unit) {
    Text(
        label,
        color = Lab.colors.muted,
        textAlign = TextAlign.Center,
        fontSize = if (big) 16.sp else 15.sp,
        modifier = Modifier.fillMaxWidth().heightIn(min = if (big) 72.dp else 52.dp).bouncyClickable(onClick = onClick)
            .clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).border(1.5.dp, Lab.colors.outline, RoundedCornerShape(16.dp))
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
fun PageTitle(titleChinese: String, sub: String, leading: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        val label = @Composable { Text("📖  GRADED READER", color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, letterSpacing = 1.sp) }
        if (leading == null && trailing == null) label()
        else Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            leading?.let { Box(Modifier.align(Alignment.CenterStart)) { it() } }
            Box(Modifier.padding(horizontal = 52.dp)) { label() }
            trailing?.let { Box(Modifier.align(Alignment.CenterEnd)) { it() } }
        }
        Text(titleChinese, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Text(sub, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
    }
}
