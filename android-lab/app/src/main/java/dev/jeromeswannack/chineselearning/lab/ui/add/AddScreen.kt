package dev.jeromeswannack.chineselearning.lab.ui.add

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.add.AddTab
import dev.jeromeswannack.chineselearning.lab.data.api.ChineseCandidateDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.kit.DictatedAnswer
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabModalSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldActions
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

class AddActions(
    val onMethod: (String) -> Unit = {},
    /** The word box started listening for the 🎤 / 🗣 tap that opened it ([AddUi.listenBox]). */
    val onListened: () -> Unit = {},
    /** 📷: the camera, at once. */
    val onTakePhoto: () -> Unit = {},
    /** 🖼 a photo already on the phone. */
    val onPickPhoto: () -> Unit = {},
    val onFocusLine: (Int) -> Unit = {},
    val onRetryPhoto: () -> Unit = {},
    /** A word (chip, picked span, typed word) → the explorer: text, pinyin, gloss, the line it is in. */
    val onLookUp: (String, String?, String?, String?) -> Unit = { _, _, _, _ -> },
    val onSubmitWord: (DictatedAnswer) -> Unit = {},
    val onTile: (String) -> Unit = {},
    val onResult: (AddResult) -> Unit = {},
    val onSheetText: (String) -> Unit = {},
    val onSheetFormat: (String) -> Unit = {},
    val onSheetLevel: (String) -> Unit = {},
    val onCreate: (DictatedAnswer) -> Unit = {},
    val onCloseSheet: () -> Unit = {},
)

object AddTags {
    const val ROOT = "add-page"
    const val WORD_CARD = "add-word-card"
    fun method(id: String) = "add-method-$id"
    const val GALLERY = "add-photo-gallery"
    const val PHOTO = "add-photo-result"
    const val READING = "add-photo-reading"
    const val LINE = "add-ocr-line"
    const val CHIP = "add-word-chip"
    const val PICK = "add-pick"
    const val CHAR = "add-char"
    const val SPAN_OPEN = "add-span-open"
    const val WORD_BOX = "add-word-box"
    const val CANDIDATE = "add-candidate"
    const val RESULT = "add-result"
    const val RESULT_OPEN = "add-result-open"
    fun tile(kind: String) = "add-tile-$kind"
    const val SHEET = "add-content-sheet"
}

private val METHODS = listOf(
    Triple(AddMethod.PHOTO, "📷", "Take a photo" to "Chinese on a screen, a sign, a page"),
    Triple(AddMethod.TYPE, "✏️", "Type it" to "Hanzi, pinyin, English"),
    Triple(AddMethod.SAY_ZH, "🎤", "Say it" to "In Chinese"),
    Triple(AddMethod.SAY_EN, "🗣", "In English" to "Say the English"),
)

/**
 * The ＋ Add tab (docs/ADD_TAB.md; web pages/AddPage.tsx): ONE title, the "Add a word" card on top
 * (📷 the camera in one tap → the Chinese lines as word chips → the explorer; ✏️ / 🎤 / 🗣), the
 * results of what he asked for ("✓ Making your reader… Open ›"), then a tile per thing Claude makes.
 * [voicePreview] (screenshot tests): the word box / the sheet's box drawn in that state.
 */
@Composable
fun AddScreen(ui: AddUi, actions: AddActions, voicePreview: VoiceDictationUi? = null, sheetInline: Boolean = false) {
    LabScreenFrame {
        Column(Modifier.fillMaxSize().testTag(AddTags.ROOT)) {
            ScreenTitle("Add")
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                WordCard(ui, actions, voicePreview)
                if (ui.results.isNotEmpty()) Results(ui.results, actions)
                Text("Ask for new content", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Lab.colors.ink, modifier = Modifier.padding(top = 8.dp))
                Tiles(actions)
                if (sheetInline) ui.sheet?.let { ContentSheetContent(it, actions, voicePreview, ui.offline) }
            }
        }
    }
    if (!sheetInline) ui.sheet?.let { sheet ->
        LabModalSheet(onDismiss = actions.onCloseSheet) { ContentSheetContent(sheet, actions, voicePreview, ui.offline) }
    }
}

@Composable
private fun WordCard(ui: AddUi, actions: AddActions, voicePreview: VoiceDictationUi?) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, shape).padding(14.dp).testTag(AddTags.WORD_CARD),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Add a word", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Lab.colors.ink)
        // 📷 first and widest: the fastest way in.
        MethodButton(METHODS[0], ui.method == AddMethod.PHOTO, Modifier.fillMaxWidth(), big = true) { actions.onTakePhoto() }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (m in METHODS.drop(1)) MethodButton(m, ui.method == m.first, Modifier.weight(1f)) { actions.onMethod(m.first) }
        }
        Text(
            "🖼 Or pick a photo you already took",
            color = Lab.colors.accent, fontSize = 14.sp,
            modifier = Modifier.heightIn(min = 44.dp).bouncyClickable(onClick = actions.onPickPhoto).padding(vertical = 12.dp).testTag(AddTags.GALLERY),
        )
        ui.photo?.takeIf { ui.method == AddMethod.PHOTO }?.let { PhotoResult(it, actions) }
        val method = ui.method
        if (method != null && method != AddMethod.PHOTO) key(ui.boxKey) { WordBox(method, actions, voicePreview, ui.lookupBusy, listenNow = ui.listenBox == ui.boxKey) }
        if (ui.lookupBusy) Muted("Finding the Chinese…")
        ui.lookupError?.let { ErrorText(it) }
        ui.typedLine?.let { line -> WordLine(line, primary = true, onLookUp = { w, p, g -> actions.onLookUp(w, p, g, line) }) }
        ui.candidates?.let { Candidates(it, actions) }
    }
}

@Composable
private fun MethodButton(m: Triple<String, String, Pair<String, String>>, on: Boolean, modifier: Modifier, big: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    val box = modifier.heightIn(min = if (big) 64.dp else 84.dp).clip(shape).background(Lab.colors.background)
        .border(if (on || big) 1.5.dp else 1.dp, if (on || big) Lab.colors.accent else Lab.colors.cardBorder, shape)
        .bouncyClickable(onClick = onClick).testTag(AddTags.method(m.first))
    if (big) {
        // 📷: icon beside the words, the whole width.
        Row(box.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(m.second, fontSize = 26.sp)
            Column {
                Text(m.third.first, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink, maxLines = 1)
                Text(m.third.second, fontSize = 13.sp, color = Lab.colors.muted, maxLines = 2)
            }
        }
    } else {
        // ✏️ · 🎤 · 🗣: three small squares.
        Column(box.padding(horizontal = 6.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(m.second, fontSize = 20.sp)
            Text(m.third.first, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = Lab.colors.ink, maxLines = 1)
            Text(m.third.second, fontSize = 11.sp, color = Lab.colors.muted, maxLines = 2, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

// ---------------- the photo ----------------

@Composable
private fun PhotoResult(photo: PhotoUi, actions: AddActions) {
    Column(Modifier.fillMaxWidth().testTag(AddTags.PHOTO), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        photo.image?.let { image ->
            val ratio = (image.width.toFloat() / image.height.coerceAtLeast(1)).coerceIn(0.5f, 2.5f)
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.Black), contentAlignment = Alignment.Center) {
                BoxWithConstraints(Modifier.heightIn(max = 240.dp).aspectRatio(ratio)) {
                    Image(image, "Your photo", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                    val order = lineOrder(photo)
                    photo.lines.forEachIndexed { i, line ->
                        val b = line.box ?: return@forEachIndexed
                        val on = order.firstOrNull() == i
                        Box(
                            Modifier.offset(x = maxWidth * (b[1] / 1000).toFloat(), y = maxHeight * (b[0] / 1000).toFloat())
                                .size(maxWidth * ((b[3] - b[1]) / 1000).toFloat(), maxHeight * ((b[2] - b[0]) / 1000).toFloat())
                                .border(2.dp, if (on) Color(0xFFFFD60A) else Color(0x8CFFD60A), RoundedCornerShape(4.dp))
                                .background(if (on) Color(0x26FFD60A) else Color.Transparent)
                                .bouncyClickable(pressedScale = 1f) { actions.onFocusLine(i) },
                        )
                    }
                }
            }
        }
        when (photo.status) {
            "reading" -> Column(Modifier.fillMaxWidth().testTag(AddTags.READING), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Skeleton(Modifier.fillMaxWidth().height(32.dp))
                Skeleton(Modifier.fillMaxWidth(0.6f).height(22.dp))
                Muted("Reading the Chinese…")
            }
            "offline" -> Muted("Reading this photo needs a connection — it will be read as soon as you're back online.")
            "failed" -> Row(verticalAlignment = Alignment.CenterVertically) {
                ErrorText(photo.error ?: "Couldn't read the photo.")
                Text(" Try again", color = Lab.colors.accent, fontSize = 14.sp, modifier = Modifier.heightIn(min = 44.dp).bouncyClickable(onClick = actions.onRetryPhoto).padding(vertical = 12.dp))
            }
            else -> {
                Muted(AddTab.foundLine(photo.lines.size))
                lineOrder(photo).forEachIndexed { n, i ->
                    val text = photo.lines[i].text
                    key(i, text) { WordLine(text, primary = n == 0, onLookUp = { w, p, g -> actions.onLookUp(w, p, g, text) }) }
                }
            }
        }
    }
}

private fun lineOrder(photo: PhotoUi): List<Int> {
    val order = photo.lines.indices.toMutableList()
    if (photo.focus in 1 until order.size) {
        order.remove(photo.focus)
        order.add(0, photo.focus)
    }
    return order
}

@Composable
private fun Skeleton(modifier: Modifier) = Box(modifier.clip(RoundedCornerShape(8.dp)).background(Lab.colors.cardBorder.copy(alpha = 0.6f)))

// ---------------- word chips ----------------

/** One read / typed line as tappable words (the device segmenter); ✂ Pick: the first and the last character. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WordLine(text: String, primary: Boolean, onLookUp: (String, String?, String?) -> Unit) {
    val words: List<ReaderWordDto> = DeviceWords.of(text) ?: text.codePoints().toArray().map { ReaderWordDto(String(Character.toChars(it))) }
    var picking by remember(text) { mutableStateOf(false) }
    var from by remember(text) { mutableStateOf<Int?>(null) }
    var to by remember(text) { mutableStateOf<Int?>(null) }
    val fontSize = if (primary) 26.sp else 19.sp
    Row(Modifier.fillMaxWidth().padding(top = 4.dp).testTag(AddTags.LINE), verticalAlignment = Alignment.Top) {
        FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (!picking) {
                for (w in words) {
                    if (AddTab.hanCount(w.text) > 0) {
                        Chip(w.text, fontSize, primary, false, AddTags.CHIP) { onLookUp(w.text, w.pinyin.ifEmpty { null }, w.gloss.ifEmpty { null }) }
                    } else Text(w.text, fontSize = fontSize, color = Lab.colors.muted, modifier = Modifier.align(Alignment.CenterVertically))
                }
            } else {
                val chars = text.codePoints().toArray()
                val lo = from?.let { minOf(it, to ?: it) } ?: -1
                val hi = from?.let { maxOf(it, to ?: it) } ?: -1
                chars.forEachIndexed { i, cp ->
                    Chip(String(Character.toChars(cp)), fontSize, primary, i in lo..hi, AddTags.CHAR) {
                        if (from == null || to != null) { from = i; to = null } else to = i
                    }
                }
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            val span = from?.let { AddTab.span(text, it, to ?: it) }.orEmpty()
            if (picking && AddTab.hanCount(span) > 0) {
                Text(
                    "Look up $span ›", color = Lab.colors.onAccent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).background(Lab.colors.accent)
                        .bouncyClickable { onLookUp(span, null, null) }.padding(horizontal = 10.dp, vertical = 12.dp).testTag(AddTags.SPAN_OPEN),
                )
            }
            Text(
                if (picking) "Words" else "✂ Pick", color = Lab.colors.muted, fontSize = 13.sp,
                modifier = Modifier.heightIn(min = 44.dp).bouncyClickable { picking = !picking; from = null; to = null }.padding(horizontal = 8.dp, vertical = 12.dp).testTag(AddTags.PICK),
            )
        }
    }
}

@Composable
private fun Chip(text: String, fontSize: androidx.compose.ui.unit.TextUnit, primary: Boolean, on: Boolean, tag: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier.heightIn(min = 44.dp).widthIn(min = 44.dp).clip(shape)
            .background(if (on) Lab.colors.accent else Lab.colors.background)
            .border(1.dp, if (primary || on) Lab.colors.accent else Lab.colors.cardBorder, shape)
            .bouncyClickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 4.dp).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(text, fontSize = fontSize, color = if (on) Lab.colors.onAccent else Lab.colors.ink) }
}

// ---------------- typed / spoken ----------------

@Composable
private fun WordBox(method: String, actions: AddActions, voicePreview: VoiceDictationUi?, busy: Boolean, listenNow: Boolean) {
    var value by remember { mutableStateOf("") }
    val lang = if (method == AddMethod.SAY_EN) "en" else "zh"
    val placeholder = if (method == AddMethod.SAY_EN) "An English word — \"bank\", \"to queue\"…" else "A word in Chinese, pinyin or English"
    Box(Modifier.fillMaxWidth().padding(top = 4.dp).testTag(AddTags.WORD_BOX)) {
        if (voicePreview != null) {
            VoiceTextFieldContent(ui = voicePreview, value = value, onValueChange = { value = it }, actions = VoiceTextFieldActions(), submitLabel = "Look it up", placeholder = placeholder, lang = lang, compact = true)
        } else {
            val controller = rememberVoiceDictation("add_word", lang, if (method == AddMethod.TYPE) "type" else null)
            val ui by controller.ui.collectAsState()
            val va = rememberVoiceFirstActions(controller, value, onFill = { value = it }) { a -> actions.onSubmitWord(a) }
            // 🎤 / 🗣 straight away ONLY for the tap that opened this box (the button he tapped WAS "say it"). Coming
            // back to the tab with the method still picked shows the idle box: nothing records until he taps 🎤.
            LaunchedEffect(Unit) {
                if (listenNow && method != AddMethod.TYPE) {
                    actions.onListened()
                    va.say()
                }
            }
            VoiceTextFieldContent(ui = ui, value = value, onValueChange = { value = it }, actions = va, submitLabel = "Look it up", placeholder = placeholder, lang = lang, enabled = !busy, compact = true)
        }
    }
}

@Composable
private fun Candidates(words: List<ChineseCandidateDto>, actions: AddActions) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (w in words) {
            val shape = RoundedCornerShape(12.dp)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(shape).background(Lab.colors.background).border(1.dp, Lab.colors.cardBorder, shape)
                    .bouncyClickable { actions.onLookUp(w.hanzi, w.pinyin, w.english, null) }.padding(horizontal = 12.dp, vertical = 8.dp).testTag(AddTags.CANDIDATE),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(w.hanzi, fontSize = 24.sp, color = Lab.colors.ink)
                Column(Modifier.weight(1f)) {
                    Text(w.pinyin, fontSize = 15.sp, color = Lab.colors.ink)
                    Text(w.english + (w.note?.let { " · $it" } ?: ""), fontSize = 13.sp, color = Lab.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Text("›", fontSize = 20.sp, color = Lab.colors.muted)
            }
        }
    }
}

// ---------------- results + tiles ----------------

@Composable
private fun Results(results: List<AddResult>, actions: AddActions) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (r in results) {
            val shape = RoundedCornerShape(12.dp)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(shape).background(Lab.colors.card)
                    .border(1.dp, if (r.status == "failed") dev.jeromeswannack.chineselearning.lab.ui.theme.Palette.Again else Lab.colors.cardBorder, shape)
                    .padding(start = 12.dp).testTag(AddTags.RESULT),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    AddTab.resultLine(r.kind, r.status) + "  " + r.topic, fontSize = 14.sp, color = Lab.colors.ink,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (r.status != "failed") {
                    Text(
                        "Open ›", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                        modifier = Modifier.heightIn(min = 48.dp).bouncyClickable { actions.onResult(r) }.padding(horizontal = 14.dp, vertical = 14.dp).testTag(AddTags.RESULT_OPEN),
                    )
                }
            }
        }
    }
}

@Composable
private fun Tiles(actions: AddActions) {
    val tiles = AddTab.TILES
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        tiles.filter { it.kind != AddTab.ASK }.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (t in row) Tile(t, Modifier.weight(1f), actions)
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        tiles.firstOrNull { it.kind == AddTab.ASK }?.let { Tile(it, Modifier.fillMaxWidth(), actions, min = 60.dp) }
    }
}

@Composable
private fun Tile(t: AddTab.Tile, modifier: Modifier, actions: AddActions, min: Dp = 92.dp) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier.heightIn(min = min).clip(shape).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, shape)
            .bouncyClickable { actions.onTile(t.kind) }.padding(12.dp).testTag(AddTags.tile(t.kind)),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(t.icon, fontSize = 22.sp)
        Text(t.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Lab.colors.ink)
        Text(t.subtitle, fontSize = 12.sp, color = Lab.colors.muted, maxLines = 2)
    }
}

// ---------------- the tile's box ----------------

@Composable
fun ContentSheetContent(sheet: ContentSheetUi, actions: AddActions, voicePreview: VoiceDictationUi?, offline: Boolean) {
    val tile = AddTab.tile(sheet.kind) ?: return
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp).padding(bottom = 16.dp).testTag(AddTags.SHEET), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("${tile.icon} ${tile.title}", fontWeight = FontWeight.SemiBold, fontSize = 19.sp, color = Lab.colors.ink)
        if (sheet.kind == AddTab.AUDIO) Options(AddTab.AUDIO_FORMATS.map { it.format to it.label }, sheet.format, actions.onSheetFormat)
        if (sheet.kind == AddTab.READER) Options(listOf("beginner" to "Beginner", "elementary" to "Elementary", "intermediate" to "Intermediate"), sheet.level, actions.onSheetLevel)
        val lang = AddTab.lang(sheet.kind, sheet.format)
        val placeholder = AddTab.placeholder(sheet.kind, sheet.format)
        val submit = if (sheet.busy) "Starting…" else tile.submitLabel
        val multiline = sheet.kind == AddTab.AUDIO && sheet.format != "dialogue"
        if (voicePreview != null) {
            VoiceTextFieldContent(ui = voicePreview, value = sheet.text, onValueChange = actions.onSheetText, actions = VoiceTextFieldActions(), submitLabel = submit, placeholder = placeholder, lang = lang, multiline = multiline)
        } else key(lang) {
            val controller = rememberVoiceDictation("add_content", lang)
            val ui by controller.ui.collectAsState()
            val va = rememberVoiceFirstActions(controller, sheet.text, onFill = actions.onSheetText) { a -> actions.onCreate(a) }
            VoiceTextFieldContent(ui = ui, value = sheet.text, onValueChange = actions.onSheetText, actions = va, submitLabel = submit, placeholder = placeholder, lang = lang, multiline = multiline, enabled = !sheet.busy)
        }
        if (sheet.busy) Muted(if (sheet.kind == AddTab.DECK) "Claude is writing the cards — this takes a little while…" else "Starting…")
        sheet.error?.let { ErrorText(it) }
        if (offline) Muted("Needs a connection.")
    }
}

@Composable
private fun Options(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((id, label) in options) {
            val on = id == selected
            val shape = RoundedCornerShape(22.dp)
            Box(
                Modifier.heightIn(min = 44.dp).clip(shape).background(if (on) Lab.colors.accent else Lab.colors.background)
                    .border(1.dp, if (on) Lab.colors.accent else Lab.colors.cardBorder, shape).bouncyClickable { onPick(id) }.padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, color = if (on) Lab.colors.onAccent else Lab.colors.ink, fontSize = 14.sp) }
        }
    }
}

@Composable
private fun Muted(text: String) = Text(text, fontSize = 14.sp, color = Lab.colors.muted)

@Composable
private fun ErrorText(text: String) = Text(text, fontSize = 14.sp, color = dev.jeromeswannack.chineselearning.lab.ui.theme.Palette.Again, modifier = Modifier.alpha(0.95f))
