package dev.jeromeswannack.chineselearning.lab.ui.clips

import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPlayState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.data.clips.ClipStore
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.study.devicePinyinLine
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import kotlin.coroutines.resume

/** What the player calls back (the feed's ViewModel answers). */
class ClipPlayerActions(
    val onLike: (via: String) -> Unit = {},
    val onSave: () -> Unit = {},
    val onLearnMore: (via: String) -> Unit = {},
    val onComplete: (durationMs: Long) -> Unit = {},
    val onQuiz: (right: Boolean, timedOut: Boolean) -> Unit = { _, _ -> },
    val onExplore: (layout: String) -> Unit = {},
    val onPrefs: (ClipStore.CaptionPrefs, toggled: String) -> Unit = { _, _ -> },
    val onNext: (() -> Unit)? = null,
    val onPlaying: (Boolean) -> Unit = {},
    /** A line's audio file (null = skip it): ClipStore.lineAudio in the app, nothing in previews. */
    val lineAudio: suspend (text: String, voiceId: String?) -> File? = { _, _ -> null },
    val picture: suspend (key: String) -> File? = { null },
)

/**
 * 🎬 One full-screen clip (web components/clips/ClipPlayer.tsx): the clip clock (core Clips.tick:
 * scenes hold for their audio, a quiz waits), each scene's voice lines in turn, progress segments,
 * the right rail, and the gestures — tap = pause / play, double tap = ❤️ burst + like + Learn more,
 * long press = Learn more. Only the [active] clip plays; an open explorer pauses it.
 * [animate] false = no motion and no clock (screenshots, reduced motion keeps the clock).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ClipPlayer(
    clip: ClipRecord,
    active: Boolean,
    prefs: ClipStore.CaptionPrefs,
    actions: ClipPlayerActions,
    held: Boolean = false,
    startScene: Int = 0,
    animate: Boolean = true,
    clock: Boolean = true,
    /** Previews: show this play state (a quiz answered…) instead of starting at [startScene]. */
    previewState: ClipPlayState? = null,
) {
    val spec = clip.spec ?: return
    val look = remember(spec.style) { ClipLooks.of(spec.style.theme, spec.style.accent) }
    var play by remember(clip.id) { mutableStateOf(previewState ?: Clips.start(spec, startScene)) }
    var paused by remember(clip.id) { mutableStateOf(false) }
    var replay by remember(clip.id) { mutableIntStateOf(0) }
    var spokenLine by remember(clip.id) { mutableIntStateOf(-1) }
    val speaking = remember(clip.id) { booleanArrayOf(false) }
    val explorer = LocalExplorer.current
    val exploring = explorer?.isOpen == true
    val running = active && clock && !paused && !held && !exploring && !play.done
    val currentActions by rememberUpdatedState(actions)
    val wasActive = remember(clip.id) { booleanArrayOf(false) }
    val startedAt = remember(clip.id) { longArrayOf(0) }
    val completed = remember(clip.id) { booleanArrayOf(false) }
    val reportedQuiz = remember(clip.id) { intArrayOf(-1) }

    // A clip starts from the top each time it comes on screen (a /clips/:id?scene= link: there, once).
    LaunchedEffect(active, replay) {
        if (!active || previewState != null) return@LaunchedEffect
        play = Clips.start(spec, if (wasActive[0] || replay > 0) 0 else startScene)
        wasActive[0] = true
        paused = false
        completed[0] = false
        reportedQuiz[0] = -1
        startedAt[0] = System.currentTimeMillis()
    }
    LaunchedEffect(running) { currentActions.onPlaying(running) }

    // The clock.
    LaunchedEffect(running) {
        if (!running) return@LaunchedEffect
        var last = withFrameMillis { it }
        var acc = 0L
        while (true) {
            val now = withFrameMillis { it }
            acc += now - last
            last = now
            if (acc >= 80) {
                val dt = acc.coerceAtMost(250)
                acc = 0
                play = Clips.tick(spec, play, dt.toDouble(), speaking[0])
            }
        }
    }

    LaunchedEffect(play.done, active) {
        if (active && play.done && !completed[0] && previewState == null) {
            completed[0] = true
            currentActions.onComplete(System.currentTimeMillis() - startedAt[0])
        }
    }
    LaunchedEffect(play.quiz?.timedOut, play.scene) {
        if (play.quiz?.timedOut == true && reportedQuiz[0] != play.scene) {
            reportedQuiz[0] = play.scene
            currentActions.onQuiz(false, true)
        }
    }

    // The voice: the scene's lines in turn, the clock holding until they're done.
    val player = remember(clip.id) { arrayOfNulls<MediaPlayer>(1) }
    LaunchedEffect(active, play.scene, play.done, prefs.muted, replay) {
        spokenLine = -1
        val scene = spec.scenes.getOrNull(play.scene)
        if (!active || scene == null || play.done || prefs.muted || !clock) { speaking[0] = false; return@LaunchedEffect }
        val lines = Clips.sceneUtterances(scene, play.scene)
        if (lines.isEmpty()) { speaking[0] = false; return@LaunchedEffect }
        speaking[0] = true
        try {
            for (line in lines) {
                val file = withTimeoutOrNull(6_000) { currentActions.lineAudio(line.text, line.voiceId) } ?: continue
                spokenLine = line.line
                playFile(file, player)
                delay(Clips.LINE_GAP_MS)
            }
        } finally {
            speaking[0] = false
            spokenLine = -1
            player[0]?.let { runCatching { it.stop() }; it.release() }
            player[0] = null
        }
    }
    LaunchedEffect(running) {
        val p = player[0] ?: return@LaunchedEffect
        runCatching { if (running) p.start() else if (p.isPlaying) p.pause() }
    }
    DisposableEffect(clip.id) { onDispose { player[0]?.let { runCatching { it.release() } }; player[0] = null } }

    // The scene's picture.
    val scene = spec.scenes.getOrNull(play.scene)
    val imageKey = scene?.image_prompt?.trim()?.let { clip.images[it] }
    var picture by remember(clip.id) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(imageKey) {
        picture = null
        val key = imageKey ?: return@LaunchedEffect
        val file = runCatching { currentActions.picture(key) }.getOrNull() ?: return@LaunchedEffect
        picture = runCatching { BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap() }.getOrNull()
    }

    val hearts = remember(clip.id) { mutableStateListOf<Pair<Long, Offset>>() }
    val scope = rememberCoroutineScope()
    val ctx = SceneCtx(look, prefs.pinyin, prefs.english, animate) { currentActions.onExplore(scene?.layout ?: "end") }
    val onPicture = picture != null
    val fg = if (onPicture) Color.White else look.fg

    Box(
        Modifier.fillMaxSize().background(look.bg)
            .testTag("clip-player")
            .semantics { contentDescription = "Clip: ${spec.title}" }
            .pointerInput(clip.id) {
                detectTapGestures(
                    onTap = { if (!play.done) paused = !paused },
                    onDoubleTap = { at ->
                        val id = System.nanoTime()
                        hearts += id to at
                        currentActions.onLike("double_tap")
                        scope.launch {
                            delay(550)
                            currentActions.onLearnMore("double_tap")
                            delay(400)
                            hearts.removeAll { it.first == id }
                        }
                    },
                    onLongPress = { currentActions.onLearnMore("long_press") },
                )
            },
    ) {
        Canvas(Modifier.fillMaxSize()) { look.texture(this) }
        if (look.name == "ink") Text("印", color = Color(0xFFB91C1C), fontSize = 24.sp, fontWeight = FontWeight.Black, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 64.dp, end = 20.dp).graphicsLayer { rotationZ = 6f }.background(Color.Transparent).padding(4.dp))
        if (look.name == "retro") Text("▶ PLAYER 1", color = look.accent2, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, modifier = Modifier.align(Alignment.BottomStart).navigationBarsPadding().padding(start = 18.dp, bottom = 190.dp))
        picture?.let { bmp ->
            val zoom = remember(bmp) { Animatable(1.02f) }
            LaunchedEffect(bmp) { if (animate) zoom.animateTo(1.14f, tween(14_000, easing = LinearEasing)) }
            Image(bmp, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom.value; scaleY = zoom.value })
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x73000000), Color(0x26000000), Color(0x8C000000), Color(0xCC000000)))))
        }

        // Progress segments.
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 10.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val fills = Clips.progressSegments(spec, play.scene, play.elapsedMs).mapIndexed { i, f -> if (i == play.scene) Clips.sceneFill(spec, play) else f }
            fills.forEach { f ->
                Box(Modifier.weight(1f).height(4.dp).clip(RoundedCornerShape(2.dp)).background(fg.copy(alpha = 0.25f))) {
                    Box(Modifier.fillMaxWidth(f.toFloat()).height(4.dp).background(if (look.light && !onPicture) look.fg else Color.White))
                }
            }
        }

        // The stage.
        Box(
            Modifier.fillMaxSize().statusBarsPadding().padding(top = 64.dp, bottom = 168.dp, start = 16.dp, end = 76.dp).verticalScroll(rememberScrollState()),
            contentAlignment = Alignment.Center,
        ) {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                if (play.done) key("end-$replay") { EndCard(clip, ctx, onLearnMore = { currentActions.onLearnMore("end_card") }, onReplay = { replay++ }, onNext = currentActions.onNext) }
                else if (scene != null) key("${play.scene}-$replay") {
                    SceneView(spec, scene, play.scene, play, ctx, spokenLine) { option ->
                        val next = Clips.answerQuiz(play, option)
                        if (next !== play && reportedQuiz[0] != play.scene) {
                            reportedQuiz[0] = play.scene
                            currentActions.onQuiz(Clips.quizRight(spec, next) == true, false)
                        }
                        play = next
                    }
                }
            }
        }

        // Caption + meta.
        Column(Modifier.align(Alignment.BottomStart).navigationBarsPadding().padding(start = 12.dp, end = 76.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val voice = scene?.voice
            if (!play.done && voice != null && voice.text.isNotBlank()) {
                Column(Modifier.background(Color(0x9E000000), RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) {
                    if (voice.lang == "zh") Zh(voice.text, ctx, TextStyle(color = Color.White, fontSize = 16.sp)) else Text(voice.text, color = Color.White, fontSize = 16.sp)
                    if (voice.lang == "zh" && prefs.pinyin) Text(devicePinyinLine(voice.text), color = Color.White.copy(alpha = 0.82f), fontSize = 13.sp)
                }
            }
            Text("🎬 ${spec.title}", color = if (look.light && !onPicture) look.fg else Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(
                spec.words.joinToString(" · ") { it.hanzi } + if (spec.tags.isNotEmpty()) " · #" + spec.tags.take(3).joinToString(" #") else "",
                color = (if (look.light && !onPicture) look.fg else Color.White).copy(alpha = 0.85f), fontSize = 13.sp,
            )
        }

        // The rail.
        Column(Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 8.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            RailButton(if (clip.state.liked) "❤️" else "🤍", if (clip.state.liked) "Liked" else "Like", clip.state.liked, "clip-like") { currentActions.onLike("button") }
            RailButton("🔖", if (clip.state.saved) "Saved" else "Save", clip.state.saved, "clip-save") { currentActions.onSave() }
            RailButton("✨", "More", false, "clip-learn-more") { currentActions.onLearnMore("button") }
            RailButton("拼", "Pinyin ${if (prefs.pinyin) "on" else "off"}", prefs.pinyin, "clip-toggle-pinyin") { currentActions.onPrefs(prefs.copy(pinyin = !prefs.pinyin), "pinyin") }
            RailButton("EN", "English ${if (prefs.english) "on" else "off"}", prefs.english, "clip-toggle-english") { currentActions.onPrefs(prefs.copy(english = !prefs.english), "english") }
            RailButton(if (prefs.muted) "🔇" else "🔊", if (prefs.muted) "Muted" else "Sound", prefs.muted, "clip-toggle-mute") { currentActions.onPrefs(prefs.copy(muted = !prefs.muted), "mute") }
        }

        if (active && paused && !play.done) {
            Box(Modifier.align(Alignment.Center).size(84.dp).background(Color(0x80000000), CircleShape).semantics { contentDescription = "Paused" }, contentAlignment = Alignment.Center) {
                Text("▶", color = Color.White, fontSize = 36.sp)
            }
        }
        val density = LocalDensity.current
        hearts.forEach { (id, at) -> key(id) { HeartBurst(at, animate, density) } }
    }
}

@Composable
private fun HeartBurst(at: Offset, animate: Boolean, density: androidx.compose.ui.unit.Density) {
    val a = remember { Animatable(if (animate) 0f else 0.4f) }
    LaunchedEffect(Unit) { if (animate) a.animateTo(1f, tween(900)) }
    val t = a.value
    val scale = when { t < 0.25f -> 0.2f + t / 0.25f * 1.05f; t < 0.45f -> 1.25f - (t - 0.25f) / 0.2f * 0.25f; else -> 1f + (t - 0.45f) * 0.55f }
    val alpha = if (t < 0.45f) (t / 0.25f).coerceAtMost(1f) else 1f - (t - 0.45f) / 0.55f
    val half = with(density) { 44.dp.toPx() }
    Text(
        "❤️", fontSize = 88.sp,
        modifier = Modifier.offset { androidx.compose.ui.unit.IntOffset((at.x - half).toInt(), (at.y - half - t.coerceAtLeast(0.45f).minus(0.45f) * 2 * half).toInt()) }
            .graphicsLayer { scaleX = scale; scaleY = scale; this.alpha = alpha.coerceIn(0f, 1f); rotationZ = -8f }
            .testTag("clip-heart"),
    )
}

@Composable
private fun RailButton(icon: String, label: String, pressed: Boolean, tag: String, onClick: () -> Unit) {
    val bg = if (pressed) Color.White.copy(alpha = 0.92f) else Color.Black.copy(alpha = 0.42f)
    val fg = if (pressed) Color(0xFF111111) else Color.White
    Column(
        Modifier.width(56.dp).clip(RoundedCornerShape(16.dp)).background(bg)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { selected = pressed; contentDescription = label }
            .testTag(tag)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(icon, fontSize = 22.sp, color = fg, fontWeight = FontWeight.Black)
        Text(label, fontSize = 10.sp, color = fg, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, lineHeight = 12.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EndCard(clip: ClipRecord, ctx: SceneCtx, onLearnMore: () -> Unit, onReplay: () -> Unit, onNext: (() -> Unit)?) {
    val spec = clip.spec ?: return
    val look = ctx.look
    Column(Modifier.fillMaxWidth().testTag("clip-end"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        val p = entrance(ctx)
        Text("🎬", fontSize = 52.sp, modifier = Modifier.enter(p, Entrance.POP))
        spec.ending?.question_en?.let { Mixed(it, ctx, TextStyle(color = look.fg, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, fontFamily = look.enFont, textAlign = TextAlign.Center, lineHeight = 31.sp), Modifier.enter(p, Entrance.POP)) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            spec.words.forEach { w ->
                Row(Modifier.clipCard(look).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Zh(w.hanzi, ctx, TextStyle(fontFamily = look.zhFont, fontSize = 19.sp, color = look.cardFg))
                    if (ctx.pinyin) Text(" ${w.pinyin}", color = look.cardFg.copy(alpha = 0.75f), fontSize = 13.sp)
                }
            }
        }
        Text(spec.ending?.cta?.takeIf { it.isNotBlank() } ?: "Double-tap to learn more", color = look.muted, fontSize = 15.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            EndButton("✨ Learn more", look, primary = true, onLearnMore)
            EndButton("↻ Watch again", look, primary = false, onReplay)
            if (onNext != null) EndButton("Next ↓", look, primary = false, onNext)
        }
    }
}

@Composable
private fun EndButton(label: String, look: ClipLook, primary: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (primary) Color.White else look.cardFg,
        fontWeight = FontWeight.ExtraBold, fontSize = 16.sp,
        modifier = Modifier.clip(RoundedCornerShape(24.dp))
            .background(if (primary) look.accent else look.cardBg)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 13.dp),
    )
}

/** Play one file to its end (or until cancelled). */
private suspend fun playFile(file: File, holder: Array<MediaPlayer?>) = suspendCancellableCoroutine<Unit> { cont ->
    val mp = MediaPlayer()
    holder[0] = mp
    val done = { if (cont.isActive) cont.resume(Unit) }
    runCatching {
        mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        mp.setDataSource(file.absolutePath)
        mp.setOnPreparedListener { it.start() }
        mp.setOnCompletionListener { done() }
        mp.setOnErrorListener { _, _, _ -> done(); true }
        mp.prepareAsync()
    }.onFailure { done() }
    cont.invokeOnCancellation { runCatching { mp.stop() } }
}
