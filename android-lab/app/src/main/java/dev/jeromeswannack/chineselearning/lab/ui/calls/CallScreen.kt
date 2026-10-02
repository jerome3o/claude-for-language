package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardOp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChatMessage
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.TileStatus
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTranscript
import dev.jeromeswannack.chineselearning.lab.core.calls.LiveStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.VideoFit
import dev.jeromeswannack.chineselearning.lab.data.calls.AudioRoute
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/**
 * Draws a video (an org.webrtc renderer on the phone; a stand-in in screenshots). `contain` = show
 * the whole frame (letterboxed), else fill the modifier's box; `onFrameSize` reports the frame's
 * real size (rotation applied) whenever it changes. [FittedVideo] decides the fit.
 */
typealias VideoSlot = @Composable (video: VideoHandle, mirror: Boolean, contain: Boolean, overlay: Boolean, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) -> Unit

/** The first layout for screenshots (the live layout is core CallLayout): TEXT = the text board, BOARD = drawing. */
enum class CallPanel { NONE, TEXT, BOARD, CHAT }

/** A permission as the call screen sees it: granted, can be asked, or only fixable in Settings. */
enum class DeviceAccess { GRANTED, ASK, SETTINGS }

/** What the call page knows beyond the live state. */
data class CallScreenInfo(
    val title: String? = null,
    /** The other participant's name (from the call's participants), until they join. */
    val otherName: String? = null,
    val myName: String = "You",
    val relationshipId: String? = null,
    val loading: Boolean = false,
    val notFound: Boolean = false,
    /** The microphone / camera permissions (the pre-join screen explains a missing one and offers Try again / Open settings). */
    val micAccess: DeviceAccess = DeviceAccess.GRANTED,
    val camAccess: DeviceAccess = DeviceAccess.GRANTED,
    val audioRoute: AudioRoute = AudioRoute.SPEAKER,
    val audioRoutes: List<AudioRoute> = listOf(AudioRoute.SPEAKER),
    /** While I share my screen: the other person's drawings are shown over every app. */
    val screenOverlayOn: Boolean = false,
    /** The text board's tab-complete is on for me (Settings live on the board's footer). */
    val boardGlossOn: Boolean = true,
    /** Screenshots only: a tab-complete offer already showing. */
    val boardGlossPreview: GlossSuggestion? = null,
)

data class CallActions(
    val onBack: () -> Unit = {},
    /** Ask again for the missing mic / camera permissions ("Try again"). */
    val onAllowMedia: () -> Unit = {},
    /** The app's page in Settings (a permission Android won't ask for again). */
    val onOpenSettings: () -> Unit = {},
    /** The device picker: front (true) or back camera. */
    val onFrontCamera: (Boolean) -> Unit = {},
    val onJoin: (record: Boolean) -> Unit = {},
    val onToggleMic: () -> Unit = {},
    val onToggleCam: () -> Unit = {},
    val onFlip: () -> Unit = {},
    val onShareScreen: () -> Unit = {},
    val onStopShare: () -> Unit = {},
    val onToggleRecording: () -> Unit = {},
    val onAudioRoute: (AudioRoute) -> Unit = {},
    val onEnd: () -> Unit = {},
    /** Leave: the call goes on for the other person (the "You left" screen offers Rejoin). */
    val onLeave: () -> Unit = {},
    /** Back into the call I left (same call; mic / camera as I left them). */
    val onRejoin: () -> Unit = {},
    val onCommitBoard: (BoardOp) -> Unit = {},
    val onLive: (LiveStroke?) -> Unit = {},
    val onSendChat: (String) -> Boolean = { false },
    /** [compose] = the IME composition's text while [composing] (shown to the other person in my name flag). */
    /** The board's field changed: text, selection (UTF-16), and the IME composition range while one is open. */
    val onTextChanged: (text: String, start: Int, end: Int, composition: androidx.compose.ui.text.TextRange?) -> Unit = { _, _, _, _ -> },
    val onTextSelected: (Int, Int) -> Unit = { _, _ -> },
    val onTextBlurred: () -> Unit = {},
    /** Word-by-word meaning of a selection on the board (online). */
    val explain: (suspend (String) -> String?)? = null,
    /** Tab-complete: pinyin + meaning for Chinese just typed (POST /api/calls/:id/gloss); null = off. */
    val gloss: (suspend (String) -> BoardGloss?)? = null,
    val onBoardGlossOn: (Boolean) -> Unit = {},
    /** Board pages: the strip, following, "Bring <name> here" (CallController's page actions). */
    val pages: BoardPageActions = BoardPageActions(),
    val onAnnotate: (dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke) -> Unit = {},
    val onPing: (Double, Double) -> Unit = { _, _ -> },
    val onClearAnnotations: () -> Unit = {},
    /** "Keep" on the drawing tools: drawings stay until cleared, for both people (`annot_mode`). */
    val onAnnotationsKept: (Boolean) -> Unit = {},
    /** Show / hide the drawings over other apps while sharing (asks for the permission first). */
    val onToggleScreenOverlay: () -> Unit = {},
    val onReview: () -> Unit = {},
    val onAllCalls: () -> Unit = {},
    /** Haptics: a light tick (focus, preset, swipe) / a snap (a floating camera lands in its corner). */
    val onTick: () -> Unit = {},
    val onSnap: () -> Unit = {},
)

private val Dark = Color(0xFF111418)
private val DarkCard = Color(0xFF1E232A)
private val OnDark = Color(0xFFF3F4F6)
private val MutedDark = Color(0xFF9CA3AF)

/** `/calls/:id` — pre-join preview → the call → "Call ended" (web: CallPage). Immersive: no tab bar. */
@Composable
fun CallScreen(
    s: CallState,
    info: CallScreenInfo,
    actions: CallActions,
    video: VideoSlot,
    nowMs: () -> Long = System::currentTimeMillis,
    initialPanel: CallPanel = CallPanel.NONE,
    /** Screenshots: the drawing tools already on over the shared screen. */
    initialAnnotating: Boolean = false,
    /** The call's layout (the ViewModel's, remembered per user); null = a local one from [initialPanel] (screenshots). */
    layout: CallLayoutHolder? = null,
    /** Screenshots: End's confirm already open. */
    initialEndConfirm: Boolean = false,
    /** Screenshots: the long-press "board beside the screen" menu already open for this tile. */
    initialSplitMenu: CallLayout.TileId? = null,
) {
    when {
        info.loading -> Center { Text("Loading the call…", color = OnDark) }
        info.notFound -> Center {
            Text("Call not found.", color = OnDark, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(16.dp))
            SecondaryPill("Back to calls", onClick = actions.onAllCalls)
        }
        s.phase == CallPhase.LEFT -> Left(s, info, actions)
        s.phase == CallPhase.ENDED || s.phase == CallPhase.ERROR -> Ended(s, actions)
        s.phase == CallPhase.PREJOIN || s.phase == CallPhase.JOINING -> PreJoin(s, info, actions, video)
        else -> Live(s, info, actions, video, nowMs, initialPanel, layout, initialAnnotating, initialEndConfirm, initialSplitMenu)
    }
}

@Composable
private fun Center(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Dark).windowInsetsPadding(WindowInsets.safeDrawing).padding(24.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

@Composable
private fun Initials(name: String, size: Dp = 112.dp) {
    val letters = name.trim().split(Regex("\\s+")).mapNotNull { it.firstOrNull()?.toString() }.take(2).joinToString("").uppercase().ifEmpty { "?" }
    Box(Modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFF4F46E5), Color(0xFFDB2777)))), contentAlignment = Alignment.Center) {
        Text(letters, color = Color.White, fontSize = (size.value * 0.36f).sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun RoundButton(label: String, desc: String, off: Boolean = false, active: Boolean = false, danger: Boolean = false, badge: Int = 0, warn: Boolean = false, size: Dp = 52.dp, onClick: () -> Unit) {
    Box {
        Box(
            Modifier.size(size).clip(CircleShape)
                .background(when { danger -> Palette.Again; off -> Color(0xFFF3F4F6); active -> Lab.colors.accent; else -> Color(0x33FFFFFF) })
                .bouncyClickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { Text(label, fontSize = 22.sp, modifier = Modifier.alpha(1f)) }
        if (badge > 0) Box(
            Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-2).dp).size(20.dp).clip(CircleShape).background(Palette.Again),
            contentAlignment = Alignment.Center,
        ) { Text(if (badge > 9) "9+" else "$badge", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
        // Not in the call (blocked / no device): tap to add it.
        if (warn) Box(
            Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-2).dp).size(20.dp).clip(CircleShape).background(Color(0xFFF59E0B)),
            contentAlignment = Alignment.Center,
        ) { Text("!", color = Color(0xFF111827), fontSize = 12.sp, fontWeight = FontWeight.Bold) }
    }
}

/** The mic / camera buttons: a missing device shows off with a "!" and asks for it when tapped. */
@Composable
private fun MicButton(s: CallState, onClick: () -> Unit, size: Dp = 52.dp) =
    RoundButton(if (s.micOn && s.hasMic) "🎙️" else "🔇", if (!s.hasMic) "Turn on the microphone" else if (s.micOn) "Mute" else "Unmute", off = !s.micOn || !s.hasMic, warn = s.mediaReady && !s.hasMic, size = size, onClick = onClick)

@Composable
private fun CamButton(s: CallState, onClick: () -> Unit, size: Dp = 52.dp) =
    RoundButton(if (s.camOn && s.hasCamera) "📷" else "🚫", if (!s.hasCamera) "Turn on the camera" else if (s.camOn) "Camera off" else "Camera on", off = !s.camOn || !s.hasCamera, warn = s.mediaReady && !s.hasCamera && s.camProblem != MediaProblem.NO_DEVICE, size = size, onClick = onClick)

/** What the Join button says, by which devices will go into the call. */
fun joinLabel(s: CallState): String = when {
    s.phase == CallPhase.JOINING -> "Joining…"
    !s.mediaReady -> "Join call"
    s.hasMic && s.hasCamera -> "Join call"
    s.hasMic -> "Join with audio only"
    s.hasCamera -> "Join without microphone"
    else -> "Join without camera & mic"
}

/**
 * Why the mic / camera aren't in the call, and how to fix it: Try again (asks again / reopens the
 * camera), or Open settings when Android won't ask again. Joining never waits for this.
 */
@Composable
private fun DeviceNotice(s: CallState, info: CallScreenInfo, actions: CallActions) {
    if (!s.mediaReady) return
    val lines = buildList {
        if (!s.hasMic) add(
            when (s.micProblem) {
                MediaProblem.BLOCKED -> "🎙️ Microphone blocked" to "They won’t hear you. 学 Lab needs the microphone to send your voice (and to record it for the transcript)."
                else -> "🎙️ The microphone didn’t start" to "They won’t hear you until it does."
            },
        )
        if (!s.hasCamera) add(
            when (s.camProblem) {
                MediaProblem.BLOCKED -> "📷 Camera blocked" to "They won’t see you. You can still join and turn it on later."
                MediaProblem.IN_USE -> "📷 The camera is in use by another app" to "Close the other app (another call, the camera app), then tap Try again."
                MediaProblem.NO_DEVICE -> "📷 No camera found" to "You’ll join with audio only."
                else -> "📷 The camera didn’t start" to "Tap Try again, or join with audio only."
            },
        )
    }
    if (lines.isEmpty()) return
    val blocked = buildList {
        if (!s.hasMic && s.micProblem == MediaProblem.BLOCKED) add(info.micAccess)
        if (!s.hasCamera && s.camProblem == MediaProblem.BLOCKED) add(info.camAccess)
    }
    val settings = blocked.any { it == DeviceAccess.SETTINGS }
    val retry = blocked.any { it == DeviceAccess.ASK } || (!s.hasCamera && (s.camProblem == MediaProblem.IN_USE || s.camProblem == MediaProblem.FAILED)) || (!s.hasMic && s.micProblem == MediaProblem.FAILED)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFF2A2314)).border(1.dp, Color(0x66F59E0B), RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        lines.forEach { (title, body) ->
            Column {
                Text(title, color = OnDark, fontWeight = FontWeight.SemiBold)
                Text(body, color = MutedDark, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (settings) Text(
            "Android won’t ask again: open Settings → Permissions and allow ${listOfNotNull(
                "Microphone".takeIf { !s.hasMic && s.micProblem == MediaProblem.BLOCKED && info.micAccess == DeviceAccess.SETTINGS },
                "Camera".takeIf { !s.hasCamera && s.camProblem == MediaProblem.BLOCKED && info.camAccess == DeviceAccess.SETTINGS },
            ).joinToString(" and ")}. Come back here and it switches on.",
            color = MutedDark, style = MaterialTheme.typography.bodySmall,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (retry) SecondaryPill("Try again", Modifier.height(44.dp), onClick = actions.onAllowMedia)
            if (settings) SecondaryPill("Open settings", Modifier.height(44.dp), onClick = actions.onOpenSettings)
        }
    }
}

/**
 * One video fitted by the shared rule (core VideoFit, parity-tested with shared/calls/videoFit.ts):
 * cropped to fill only when its shape is close to the box's, otherwise shown whole — the renderer
 * is sized to the picture's rectangle, centred on a dark letterbox (a SurfaceView can't be blurred
 * like the web's backdrop). [cover] forces filling (the self-view, already shaped like the camera).
 */
@Composable
fun FittedVideo(
    video: VideoHandle,
    mirror: Boolean,
    screen: Boolean,
    overlay: Boolean,
    slot: VideoSlot,
    modifier: Modifier,
    cover: Boolean = false,
    onFrameSize: ((VideoFit.Size) -> Unit)? = null,
) {
    var frame by remember(video) { mutableStateOf<VideoFit.Size?>(null) }
    var box by remember { mutableStateOf<VideoFit.Size?>(null) }
    val fit = if (cover) VideoFit.Fit.COVER else VideoFit.choose(frame, box, screen)
    val density = LocalDensity.current
    val report: (Int, Int) -> Unit = { w, h ->
        val next = VideoFit.Size(w.toDouble(), h.toDouble())
        if (next != frame) { frame = next; onFrameSize?.invoke(next) }
    }
    Box(
        modifier
            .onSizeChanged { box = VideoFit.Size(it.width.toDouble(), it.height.toDouble()) }
            .background(if (screen || fit == VideoFit.Fit.COVER) Brush.linearGradient(listOf(Color.Black, Color.Black)) else Letterbox),
        contentAlignment = Alignment.Center,
    ) {
        val b = box
        val f = frame
        // ONE call site, so the renderer survives a change of fit / size (a tile moving between stage and corner).
        val contained = fit == VideoFit.Fit.CONTAIN && b != null && f != null
        val m = if (contained) {
            val r = VideoFit.containRect(f, b!!)
            with(density) { Modifier.requiredSize(r.width.toFloat().toDp(), r.height.toFloat().toDp()) }
        } else Modifier.fillMaxSize()
        slot(video, mirror, !contained && fit == VideoFit.Fit.CONTAIN, overlay, report, m)
    }
}

private val Letterbox = Brush.radialGradient(listOf(Color(0xFF26303C), Color(0xFF0B0F14)))

// ---------------------------------------------------------------- pre-join

@Composable
private fun PreJoin(s: CallState, info: CallScreenInfo, actions: CallActions, video: VideoSlot) {
    var record by rememberSaveable { mutableStateOf(s.recordSupported) }
    var localFrame by remember { mutableStateOf<VideoFit.Size?>(null) }
    BoxWithConstraints(Modifier.fillMaxSize().background(Dark).windowInsetsPadding(WindowInsets.safeDrawing)) {
        val wide = maxWidth >= 640.dp
        val preview: @Composable (Modifier) -> Unit = { m ->
            Box(m.clip(RoundedCornerShape(24.dp)).background(DarkCard), contentAlignment = Alignment.Center) {
                val local = s.localVideo
                if (local != null && s.hasCamera && s.camOn) FittedVideo(local, s.frontCamera, screen = false, overlay = false, slot = video, modifier = Modifier.fillMaxSize(), onFrameSize = { localFrame = it })
                else Initials(info.myName)
                Row(Modifier.align(Alignment.BottomCenter).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    MicButton(s, actions.onToggleMic)
                    CamButton(s, actions.onToggleCam)
                }
            }
        }
        val body: @Composable (Modifier) -> Unit = { m ->
            Column(m, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(info.title ?: "Lesson with ${info.otherName ?: "your partner"}", color = OnDark, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                s.mediaError?.let { InlineNotice(it, kind = NoticeKind.Warning) }
                DeviceNotice(s, info, actions)
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(DarkCard)
                        .bouncyClickable(enabled = s.recordSupported, pressedScale = 0.99f) { record = !record }
                        .padding(12.dp).alpha(if (s.recordSupported) 1f else 0.5f),
                    verticalAlignment = Alignment.Top,
                ) {
                    Checkbox(record && s.recordSupported, onCheckedChange = { record = it }, enabled = s.recordSupported, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent, uncheckedColor = MutedDark))
                    Column(Modifier.padding(top = 10.dp)) {
                        Text("Record my microphone for the transcript", color = OnDark, fontWeight = FontWeight.SemiBold)
                        Text(
                            if (s.recordSupported) "Chinese + English, transcribed after the call, with lesson notes and flashcards. Both of you see a ● REC badge."
                            else "Recording needs Android 10 or newer on this phone.",
                            color = MutedDark, style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                // Joining never waits for a device: no camera = audio only, no mic = listen & watch.
                PrimaryPill(
                    joinLabel(s),
                    Modifier.fillMaxWidth().height(56.dp),
                    enabled = s.phase != CallPhase.JOINING,
                ) { actions.onJoin(record && s.recordSupported) }
                if (!s.mediaReady && s.mediaError == null) Text("Allow the camera and microphone so they can see and hear you.", color = MutedDark, style = MaterialTheme.typography.bodySmall)
            }
        }
        Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().height(56.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("‹ Back", color = OnDark, fontSize = 17.sp, modifier = Modifier.bouncyClickable(onClick = actions.onBack).padding(8.dp))
                Spacer(Modifier.weight(1f))
                BetaBadge()
            }
            if (wide) Row(Modifier.fillMaxSize().padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                preview(Modifier.weight(1.2f).aspectRatio(localFrame?.let { (it.width / it.height).toFloat().coerceIn(0.5f, 2f) } ?: (4f / 3)))
                body(Modifier.weight(1f))
            } else Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                preview(Modifier.fillMaxWidth().weight(1f))
                body(Modifier.fillMaxWidth().padding(bottom = 16.dp))
            }
        }
    }
}

// ---------------------------------------------------------------- live

/** The layout a screenshot / first open starts from, for the old one-panel API ([CallPanel]). */
fun layoutForPanel(panel: CallPanel, wide: Boolean): CallLayout.Layout {
    val d = CallLayout.DEFAULT_LAYOUT
    return when (panel) {
        CallPanel.NONE -> d
        CallPanel.TEXT -> if (wide) CallLayout.reduce(d, CallLayout.Action.Preset(CallLayout.PresetId.BOARD)) else CallLayout.reduce(d, CallLayout.Action.Focus(CallLayout.TileId.TEXT))
        CallPanel.BOARD -> if (wide) CallLayout.reduce(CallLayout.reduce(d, CallLayout.Action.Preset(CallLayout.PresetId.BOARD)), CallLayout.Action.Swap(CallLayout.TileId.TEXT, CallLayout.TileId.DRAW))
        else CallLayout.reduce(d, CallLayout.Action.Focus(CallLayout.TileId.DRAW))
        CallPanel.CHAT -> if (wide) CallLayout.reduce(d, CallLayout.Action.Split(CallLayout.TileId.CHAT, CallLayout.TileId.REMOTE)) else CallLayout.reduce(d, CallLayout.Action.Focus(CallLayout.TileId.CHAT))
    }
}

@Composable
private fun Live(s: CallState, info: CallScreenInfo, actions: CallActions, video: VideoSlot, nowMs: () -> Long, initialPanel: CallPanel, holder: CallLayoutHolder?, initialAnnotating: Boolean = false, initialEndConfirm: Boolean = false, initialSplitMenu: CallLayout.TileId? = null) {
    var seenChat by rememberSaveable { mutableIntStateOf(0) }
    var more by remember { mutableStateOf(false) }
    var layoutSheet by remember { mutableStateOf(false) }
    var confirmEnd by remember { mutableStateOf(initialEndConfirm) }
    // Round 4: the long-press menu on the shared screen / the board ("Show the board beside the screen" …).
    var splitMenu by remember { mutableStateOf(initialSplitMenu) }
    // The tiles box (dp), for the menu's wording (beside / below) and the chip's default.
    var tilesW by remember { mutableStateOf(0.0) }
    var tilesH by remember { mutableStateOf(0.0) }
    var now by remember { mutableLongStateOf(nowMs()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(1_000); now = nowMs() } }
    val remote = s.remote
    val rs = remote?.peer?.state
    val otherName = remote?.peer?.name?.takeIf { it.isNotBlank() } ?: info.otherName ?: "your partner"
    val first = otherName.substringBefore(' ')
    val someoneRecording = s.recording || rs?.recording == true
    val unread = maxOf(0, s.chat.size - seenChat)
    var selfFrame by remember { mutableStateOf<VideoFit.Size?>(null) }
    var remoteCamFrame by remember { mutableStateOf<VideoFit.Size?>(null) }
    var remoteScreenFrame by remember { mutableStateOf<VideoFit.Size?>(null) }
    var myScreenFrame by remember { mutableStateOf<VideoFit.Size?>(null) }
    var annotating by rememberSaveable(initialAnnotating) { mutableStateOf(initialAnnotating) }
    // null = my role's default pen (blue while I share, red on their screen) until I pick one.
    var annotColor by rememberSaveable { mutableStateOf<String?>(null) }
    val remoteSharing = rs?.screen == true
    val sharing = remoteSharing || s.sharingScreen
    val pen = annotPen(annotColor, s)
    val available = CallLayout.Availability(screen = sharing)

    BoxWithConstraints(Modifier.fillMaxSize().background(Dark).windowInsetsPadding(WindowInsets.safeDrawing).imePadding()) {
        val wide = maxWidth >= 640.dp
        // The layout: the ViewModel's (remembered per user) or, in screenshots, a local one.
        val h = holder ?: remember { CallLayoutHolder(initial = layoutForPanel(initialPanel, wide)) }
        val layout by h.layout.collectAsState()
        LaunchedEffect(remoteSharing) { h.setRemoteSharing(remoteSharing) }
        LaunchedEffect(sharing) { if (!sharing) annotating = false }
        val arrangement = CallLayout.arrangeTiles(layout, available, maxWidth.value.toDouble())
        val chatVisible = CallLayout.TileId.CHAT in arrangement.stage || (CallLayout.TileId.CHAT in layout.open && layout.mode == CallLayout.Mode.GRID)
        LaunchedEffect(chatVisible, s.chat.size) { if (chatVisible) seenChat = s.chat.size }
        val boardOnStage = CallLayout.boardOnStage(layout)
        val dispatch: (CallLayout.Action) -> Unit = { h.dispatch(it) }
        val applySplit: (ScreenBoardSplit.Choice, CallLayout.TileId) -> Unit = { choice, board ->
            splitMenu = null
            if (h.applySplit(choice, board)) actions.onTick()
        }

        val boardSwitch: @Composable (CallLayout.TileId) -> Unit = { current ->
            Row(Modifier.padding(start = 8.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Tab("Board", current == CallLayout.TileId.TEXT) { dispatch(CallLayout.Action.Swap(CallLayout.TileId.DRAW, CallLayout.TileId.TEXT)); actions.onTick() }
                Tab("Draw", current == CallLayout.TileId.DRAW) { dispatch(CallLayout.Action.Swap(CallLayout.TileId.TEXT, CallLayout.TileId.DRAW)); actions.onTick() }
                // Round 4: something is shared — the board with the screen (the same menu as a long-press).
                if (available.screen) Tab(if (ScreenBoardSplit.isSplit(layout)) "🖥️ ⋯" else "+ 🖥️", false) { splitMenu = current }
            }
        }
        val tiles = buildMap<CallLayout.TileId, TileSpec> {
            put(CallLayout.TileId.REMOTE, TileSpec(otherName) { role ->
                val floating = role == CallLayout.Role.FLOATING || role == CallLayout.Role.PAIR
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (remote != null) {
                        // Their picture stays up through a dropout (the renderer keeps the last frame): never cleared on
                        // disconnected / failed / away — the badge says what is going on.
                        val cam = remote.video
                        if (cam != null && remote.cameraOn) FittedVideo(cam, false, screen = false, overlay = floating, slot = video, modifier = Modifier.fillMaxSize(), cover = floating, onFrameSize = { remoteCamFrame = it })
                        else Initials(otherName, if (role == CallLayout.Role.PAIR) 30.dp else if (floating) 48.dp else 112.dp)
                        if (remote.tile != TileStatus.LIVE) TileBadge(
                            if (remote.tile == TileStatus.RECONNECTING) "Reconnecting…" else "Connecting…",
                            Modifier.align(Alignment.TopStart).padding(if (floating) 6.dp else 12.dp),
                            compact = floating,
                        )
                        Text(
                            (if (rs != null && !rs.mic) "🔇 " else "") + if (floating) first else otherName,
                            color = Color.White, fontSize = if (floating) 11.sp else 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.align(Alignment.BottomStart).padding(if (floating) 6.dp else 12.dp).clip(RoundedCornerShape(8.dp)).background(Color(0x99000000)).padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    } else if (floating) {
                        Text("…", color = OnDark)
                    } else {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                            WaitingDots()
                            Spacer(Modifier.height(12.dp))
                            Text("Waiting for $otherName to join…", color = OnDark, textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium)
                            Text(if (info.relationshipId != null) "They got a Join link in your chat." else "A test call — try the whiteboard and the chat.", color = MutedDark, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            })
            put(CallLayout.TileId.SELF, TileSpec("You") { role ->
                Box(Modifier.fillMaxSize().background(Color(0xFF2B313A)), contentAlignment = Alignment.Center) {
                    val local = s.localVideo
                    if (local != null && s.hasCamera && s.camOn) FittedVideo(local, s.frontCamera, screen = false, overlay = true, slot = video, modifier = Modifier.fillMaxSize(), cover = role == CallLayout.Role.FLOATING || role == CallLayout.Role.PAIR, onFrameSize = { selfFrame = it })
                    else Text(if (s.micOn && s.hasMic) "You" else "🔇 You", color = OnDark, fontSize = 13.sp)
                }
            })
            if (available.screen) put(CallLayout.TileId.SCREEN, TileSpec(if (remoteSharing) "$first’s screen" else "Your screen", onLongPress = { splitMenu = CallLayout.TileId.SCREEN }) { _ ->
                Box(Modifier.fillMaxSize().background(Color.Black)) {
                    // Their shared screen — or MY own, as big as any tile: either person can draw on it
                    // (circle a character); a tap is a "look here" ping. Strokes show on both sides.
                    if (remoteSharing) remote?.screenVideo?.let { FittedVideo(it, false, screen = true, overlay = false, slot = video, modifier = Modifier.fillMaxSize(), onFrameSize = { f -> remoteScreenFrame = f }) }
                    else s.screenVideo?.let { mine -> FittedVideo(mine, false, screen = true, overlay = false, slot = video, modifier = Modifier.fillMaxSize(), onFrameSize = { f -> myScreenFrame = f }) }
                    AnnotationCanvas(
                        s.annotations, if (remoteSharing) remoteScreenFrame else myScreenFrame, Modifier.fillMaxSize(), interactive = annotating, color = pen,
                        onStroke = actions.onAnnotate, onPing = actions.onPing, nowMs = nowMs,
                    )
                    AnnotateTools(
                        Modifier.align(Alignment.BottomStart).padding(10.dp),
                        if (remoteSharing) "✏️ Draw on $first’s screen" else "✏️ Draw on your screen",
                        annotating, pen, s.annotations.persist,
                        onToggle = { annotating = !annotating; actions.onTick() }, onColor = { annotColor = it; actions.onTick() },
                        onClear = actions.onClearAnnotations, onKeep = actions.onAnnotationsKept,
                    )
                    // Round 4: the board is open → one tap puts it beside / below the screen (and back).
                    val split = ScreenBoardSplit.isSplit(layout)
                    if (split || CallLayout.TileId.TEXT in layout.open || CallLayout.TileId.DRAW in layout.open) SplitChip(
                        split, Modifier.align(Alignment.TopStart).padding(8.dp),
                        onClick = { applySplit(ScreenBoardSplit.toggle(layout, tilesW, tilesH), ScreenBoardSplit.boardOf(layout)) },
                        onLongClick = { splitMenu = CallLayout.TileId.SCREEN },
                    )
                }
            })
            put(CallLayout.TileId.TEXT, TileSpec("Board", closable = true, onLongPress = if (available.screen) ({ splitMenu = CallLayout.TileId.TEXT }) else null) { _ ->
                Column(Modifier.fillMaxSize().background(Lab.colors.background)) {
                    boardSwitch(CallLayout.TileId.TEXT)
                    TextBoardPanel(
                        s.textBoard, actions.onTextChanged, actions.onTextSelected, actions.onTextBlurred, Modifier.fillMaxWidth().weight(1f),
                        explain = actions.explain, gloss = actions.gloss, glossOn = info.boardGlossOn, onGlossOn = actions.onBoardGlossOn,
                        previewSuggestion = info.boardGlossPreview,
                        topInset = LocalTextInsetTop.current,
                    )
                    // Board pages (an older room has none): the strip, where they are, following.
                    if (s.pages.current != null) BoardPagesStrip(
                        s.pages,
                        otherName = remote?.let { first },
                        otherColor = remote?.peer?.userId?.let { presenceColorOf(it) },
                        actions = actions.pages,
                        onTick = actions.onTick,
                    )
                }
            })
            put(CallLayout.TileId.DRAW, TileSpec("Draw", closable = true, onLongPress = if (available.screen) ({ splitMenu = CallLayout.TileId.DRAW }) else null) { _ ->
                Column(Modifier.fillMaxSize().background(Lab.colors.background)) {
                    boardSwitch(CallLayout.TileId.DRAW)
                    Whiteboard(s.board, s.liveStrokes.values.toList(), s.myUserId, actions.onCommitBoard, actions.onLive, Modifier.fillMaxWidth().weight(1f))
                }
            })
            put(CallLayout.TileId.CHAT, TileSpec("Chat", closable = true) { _ ->
                Column(Modifier.fillMaxSize().background(Lab.colors.background)) {
                    Spacer(Modifier.height(8.dp))
                    ChatPanel(s.chat, s.myUserId, actions.onSendChat, Modifier.fillMaxWidth().weight(1f))
                }
            })
        }
        val aspects = buildMap {
            remoteCamFrame?.takeIf { it.height > 0 }?.let { put(CallLayout.TileId.REMOTE, it.width / it.height) }
            selfFrame?.takeIf { it.height > 0 }?.let { put(CallLayout.TileId.SELF, it.width / it.height) }
        }

        Column(Modifier.fillMaxSize()) {
            // top bar
            Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(otherName, color = OnDark, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text(s.startedAt?.let { CallTranscript.formatOffset(now - it) } ?: "0:00", color = MutedDark, fontSize = 14.sp)
                if (someoneRecording) RecBadge()
                if (s.roomStatus == RoomStatus.RECONNECTING) Chip("Reconnecting…", Palette.Hard)
            }
            Box(Modifier.fillMaxWidth().weight(1f)) {
                val density = LocalDensity.current
                CallTiles(
                    layout, dispatch, h::replace, available, tiles, aspects,
                    Modifier.fillMaxSize().padding(horizontal = 8.dp).onSizeChanged {
                        tilesW = kotlin.math.floor(it.width / density.density.toDouble())
                        tilesH = kotlin.math.floor(it.height / density.density.toDouble())
                    },
                    onTick = actions.onTick, onSnap = actions.onSnap,
                )
                // "Minghui brought you to page 3" / "… deleted page 2".
                BoardNoticePill(s.boardNotice, actions.pages.onDismissNotice, Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
            }
            if (s.sharingScreen) ShareBar(s.annotations, otherName, info.screenOverlayOn, now, actions.onToggleScreenOverlay, onDraw = {
                // "Draw on it": my screen on the stage, drawing on.
                dispatch(CallLayout.Action.Preset(CallLayout.PresetId.SCREEN))
                annotating = true
                actions.onTick()
            })
            // controls
            val btn = if (wide) 52.dp else 48.dp
            Row(
                Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(if (wide) 10.dp else 7.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
            ) {
                MicButton(s, actions.onToggleMic, btn)
                CamButton(s, actions.onToggleCam, btn)
                RoundButton("📝", "Board", active = boardOnStage, size = btn) {
                    dispatch(CallLayout.boardButton(layout, narrow = !wide))
                    actions.onTick()
                }
                RoundButton("💬", "Chat", active = chatVisible, badge = if (!chatVisible) unread else 0, size = btn) {
                    dispatch(CallLayout.Action.Focus(if (chatVisible) CallLayout.TileId.REMOTE else CallLayout.TileId.CHAT))
                    actions.onTick()
                }
                if (s.screenShareSupported) RoundButton("🖥️", if (s.sharingScreen) "Stop sharing" else "Share screen", active = s.sharingScreen, size = btn) {
                    if (s.sharingScreen) actions.onStopShare() else actions.onShareScreen()
                }
                // Phones are focus-only (a swipe moves between tiles): the layout menu is for the unfolded screen, like the web.
                if (wide) RoundButton("▦", "Layout", active = layoutSheet, size = btn) { layoutSheet = true }
                RoundButton("⋯", "More", size = btn) { more = true }
                // Leave (the call goes on) next to End (for everyone) when there is room; on a phone it is in ⋯ and in End's confirm.
                if (wide) LeavePill(btn) { actions.onTick(); actions.onLeave() }
                RoundButton("📞", "End the call for everyone", danger = true, size = btn) { confirmEnd = true; actions.onTick() }
            }
        }
        // End asks first, and offers "Just leave" (web: the end-confirm popover above the controls).
        androidx.compose.animation.AnimatedVisibility(
            confirmEnd,
            enter = androidx.compose.animation.fadeIn(),
            exit = androidx.compose.animation.fadeOut(),
        ) {
            Box(
                Modifier.fillMaxSize().background(Color(0x99000000))
                    .clickable(interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, indication = null) { confirmEnd = false },
            )
        }
        androidx.compose.animation.AnimatedVisibility(
            confirmEnd,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = (if (wide) 52.dp else 48.dp) + 36.dp, start = 16.dp, end = 16.dp),
            enter = androidx.compose.animation.slideInVertically(androidx.compose.animation.core.spring(dampingRatio = 0.75f, stiffness = 500f)) { it / 3 } + androidx.compose.animation.fadeIn(),
            exit = androidx.compose.animation.fadeOut(),
        ) {
            EndConfirm(
                onLeave = { confirmEnd = false; actions.onLeave() },
                onEnd = { confirmEnd = false; actions.onEnd() },
                onCancel = { confirmEnd = false },
            )
        }
        // Round 4: the long-press menu — a scrim and a card above the controls (in the tree, like End's confirm).
        val menuFor = splitMenu?.takeIf { available.screen }
        androidx.compose.animation.AnimatedVisibility(menuFor != null, enter = androidx.compose.animation.fadeIn(), exit = androidx.compose.animation.fadeOut()) {
            Box(
                Modifier.fillMaxSize().background(Color(0x99000000))
                    .clickable(interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, indication = null) { splitMenu = null },
            )
        }
        androidx.compose.animation.AnimatedVisibility(
            menuFor != null,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = (if (wide) 52.dp else 48.dp) + 36.dp, start = 16.dp, end = 16.dp),
            enter = androidx.compose.animation.slideInVertically(androidx.compose.animation.core.spring(dampingRatio = 0.75f, stiffness = 500f)) { it / 3 } + androidx.compose.animation.fadeIn(),
            exit = androidx.compose.animation.fadeOut(),
        ) {
            val pressed = menuFor ?: CallLayout.TileId.SCREEN
            ScreenBoardMenu(
                ScreenBoardSplit.menu(layout, available, tilesW, tilesH, pressed),
                onPick = { applySplit(it, ScreenBoardSplit.boardOf(layout, pressed)) },
                onCancel = { splitMenu = null },
            )
        }
        if (layoutSheet) LabBottomSheet(onDismiss = { layoutSheet = false }, title = "Layout") {
            CallLayoutMenu(layout, available, first, onAction = { dispatch(it); actions.onTick() }, close = { layoutSheet = false })
        }
    }
    if (more) LabBottomSheet(onDismiss = { more = false }, title = "Call") {
        CallMoreMenu(s, info, actions, close = { more = false })
    }
    androidx.activity.compose.BackHandler(enabled = confirmEnd) { confirmEnd = false }
    androidx.activity.compose.BackHandler(enabled = splitMenu != null) { splitMenu = null }
}

/** Round 4: the shared screen's "📝 + 🖥️" chip — the board beside / below the screen, or (split) the screen alone. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun SplitChip(split: Boolean, modifier: Modifier, onClick: () -> Unit, onLongClick: () -> Unit) {
    Row(
        modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xD1111827))
            .border(1.dp, Color(0x47FFFFFF), RoundedCornerShape(12.dp))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick, role = androidx.compose.ui.semantics.Role.Button)
            .semantics { contentDescription = if (split) "Show the screen only" else "Show the board with the screen" }
            .testTag("split-chip")
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(if (split) "🖥️ only" else "📝 + 🖥️", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Round 4: the long-press menu (web: the drop zones / "Move to …"), as a card. */
@Composable
fun ScreenBoardMenu(items: List<ScreenBoardSplit.Item>, onPick: (ScreenBoardSplit.Choice) -> Unit, onCancel: () -> Unit) {
    Column(
        Modifier.widthIn(max = 420.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).padding(vertical = 10.dp).testTag("split-menu"),
    ) {
        Text(
            "Screen and board", color = Color(0xFF6B7280), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp),
        )
        items.forEach { item ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp)
                    .bouncyClickable(pressedScale = 0.98f, role = androidx.compose.ui.semantics.Role.Button) { onPick(item.choice) }
                    .padding(horizontal = 18.dp, vertical = 8.dp)
                    .testTag("split-menu-${item.choice.name.lowercase()}"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                SplitIcon(item.choice, if (item.current) Lab.colors.accent else Color(0xFF6B7280))
                Text(item.label, color = Color(0xFF111827), fontSize = 16.sp, modifier = Modifier.weight(1f))
                if (item.current) Text("✓", color = Lab.colors.accent, fontWeight = FontWeight.Bold)
            }
        }
        Box(
            Modifier.fillMaxWidth().height(44.dp).bouncyClickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onCancel),
            contentAlignment = Alignment.Center,
        ) { Text("Cancel", color = Color(0xFF4B5563), fontSize = 15.sp) }
    }
}

/** A small diagram of the choice: the screen (filled) and the board (outlined). */
@Composable
private fun SplitIcon(choice: ScreenBoardSplit.Choice, color: Color) {
    Box(
        Modifier.size(30.dp, 22.dp).border(2.dp, color, RoundedCornerShape(3.dp)).drawBehind {
            val w = size.width
            val h = size.height
            when (choice) {
                ScreenBoardSplit.Choice.BESIDE -> drawRect(color, size = androidx.compose.ui.geometry.Size(w / 2, h))
                ScreenBoardSplit.Choice.BELOW -> drawRect(color, size = androidx.compose.ui.geometry.Size(w, h / 2))
                ScreenBoardSplit.Choice.ABOVE -> drawRect(color, topLeft = androidx.compose.ui.geometry.Offset(0f, h / 2), size = androidx.compose.ui.geometry.Size(w, h / 2))
                ScreenBoardSplit.Choice.SCREEN_ONLY -> drawRect(color, size = androidx.compose.ui.geometry.Size(w, h))
                ScreenBoardSplit.Choice.BOARD_ONLY -> {
                    val s = 2.dp.toPx()
                    for (i in 1..3) drawRect(color, topLeft = androidx.compose.ui.geometry.Offset(w * 0.2f, h * i / 4.5f), size = androidx.compose.ui.geometry.Size(w * 0.6f, s))
                }
            }
        },
    )
}

/**
 * The ▦ sheet (web: the layout menu): the presets with a little diagram, open the Board / Draw /
 * Chat, float their camera over the board / screen, stack split panes.
 */
@Composable
fun CallLayoutMenu(layout: CallLayout.Layout, available: CallLayout.Availability, first: String, onAction: (CallLayout.Action) -> Unit, close: () -> Unit) {
    val current = currentPreset(layout)
    CallLayout.PRESETS.filter { it.id != CallLayout.PresetId.SCREEN || available.screen }.forEachIndexed { i, p ->
        if (i > 0) RowDivider()
        Row(
            Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.98f) { onAction(CallLayout.Action.Preset(p.id)); close() }
                .heightIn(min = 56.dp).padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            PresetIcon(p.id, color = if (p.id == current) Lab.colors.accent else Lab.colors.muted)
            Text(p.label, color = Lab.colors.ink, fontSize = 17.sp, modifier = Modifier.weight(1f))
            if (p.id == current) Text("✓", color = Lab.colors.accent, fontWeight = FontWeight.Bold)
        }
    }
    DeviceHeader("Open")
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(CallLayout.TileId.TEXT to "📝 Board", CallLayout.TileId.DRAW to "✏️ Draw", CallLayout.TileId.CHAT to "💬 Chat").forEach { (t, label) ->
            SecondaryPill(label, Modifier.weight(1f).height(48.dp)) { onAction(CallLayout.Action.Focus(t)); close() }
        }
    }
    Spacer(Modifier.height(8.dp))
    CamerasRow(layout.pip) { onAction(CallLayout.Action.SetPip(it)) }
    RowDivider()
    ToggleRow("Float $first’s camera over the board / screen", layout.remoteFloat) { onAction(CallLayout.Action.RemoteFloat(it)) }
    RowDivider()
    ToggleRow("Stack split panes", layout.dir == CallLayout.Dir.COLUMN) { onAction(CallLayout.Action.SetDir(if (it) CallLayout.Dir.COLUMN else CallLayout.Dir.ROW)) }
    Spacer(Modifier.height(16.dp))
}

/** Which preset the layout is (for the ✓), if any. */
fun currentPreset(l: CallLayout.Layout): CallLayout.PresetId? = when {
    l.mode == CallLayout.Mode.GRID -> CallLayout.PresetId.GRID
    l.mode == CallLayout.Mode.FOCUS && l.main == CallLayout.TileId.REMOTE -> CallLayout.PresetId.SPEAKER
    l.mode == CallLayout.Mode.FOCUS && l.main == CallLayout.TileId.SCREEN -> CallLayout.PresetId.SCREEN
    l.mode == CallLayout.Mode.SPLIT && l.main == CallLayout.TileId.TEXT && l.second == CallLayout.TileId.REMOTE -> CallLayout.PresetId.BOARD
    l.mode == CallLayout.Mode.SPLIT && l.main == CallLayout.TileId.REMOTE && l.second == CallLayout.TileId.SELF -> CallLayout.PresetId.SIDE
    else -> null
}

/** "Cameras: Together / Separate" — both faces in one box over the board / screen, or two floating cameras. */
@Composable
private fun CamerasRow(pip: CallLayout.Pip, onChange: (CallLayout.Pip) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Cameras", color = Lab.colors.ink, fontSize = 16.sp, modifier = Modifier.weight(1f))
        listOf(CallLayout.Pip.PAIR to "Together", CallLayout.Pip.SEPARATE to "Separate").forEach { (p, label) ->
            val on = p == pip
            Box(
                Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp))
                    .background(if (on) Lab.colors.accent else Color.Transparent)
                    .border(1.dp, if (on) Lab.colors.accent else Lab.colors.muted.copy(alpha = 0.5f), RoundedCornerShape(10.dp))
                    .bouncyClickable(role = androidx.compose.ui.semantics.Role.RadioButton) { onChange(p) }
                    .padding(horizontal = 14.dp, vertical = 10.dp)
                    .testTag("pip-${p.wire}"),
                contentAlignment = Alignment.Center,
            ) { Text(label, color = if (on) Color.White else Lab.colors.ink, fontSize = 15.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal) }
        }
    }
}

@Composable
private fun ToggleRow(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.99f) { onChange(!on) }.heightIn(min = 56.dp).padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Lab.colors.ink, fontSize = 16.sp, modifier = Modifier.weight(1f))
        androidx.compose.material3.Switch(on, onCheckedChange = onChange, colors = androidx.compose.material3.SwitchDefaults.colors(checkedTrackColor = Lab.colors.accent))
    }
}

/** The ⋯ sheet: screen share, recording, the device picker (camera front / back, where the sound goes), leave. */
@Composable
fun CallMoreMenu(s: CallState, info: CallScreenInfo, actions: CallActions, close: () -> Unit) {
    val check: @Composable (Boolean) -> Unit = { on -> if (on) Text("✓", color = Lab.colors.accent, fontWeight = FontWeight.Bold) }
    if (s.screenShareSupported) NavRow("🖥️", if (s.sharingScreen) "Stop sharing your screen" else "Share your screen", onClick = { close(); if (s.sharingScreen) actions.onStopShare() else actions.onShareScreen() })
    if (s.recordSupported && s.hasMic) { RowDivider(); NavRow(if (s.recording) "⏹" else "⏺", if (s.recording) "Stop recording my mic" else "Record my mic", onClick = { close(); actions.onToggleRecording() }) }
    DeviceHeader("Camera")
    if (s.hasCamera) {
        NavRow("🤳", "Front camera", trailing = { check(s.frontCamera) }, onClick = { close(); actions.onFrontCamera(true) })
        RowDivider()
        NavRow("📷", "Back camera", trailing = { check(!s.frontCamera) }, onClick = { close(); actions.onFrontCamera(false) })
    } else NavRow("📷", "Turn on the camera", desc = if (s.camProblem == MediaProblem.IN_USE) "Another app is using it" else "Allow it for 学 Lab", onClick = { close(); actions.onToggleCam() })
    if (!s.hasMic) { RowDivider(); NavRow("🎙️", "Turn on the microphone", desc = "Allow it for 学 Lab", onClick = { close(); actions.onToggleMic() }) }
    DeviceHeader("Sound")
    info.audioRoutes.forEachIndexed { i, r ->
        if (i > 0) RowDivider()
        NavRow(r.icon, r.label, trailing = { check(r == info.audioRoute) }, onClick = { close(); actions.onAudioRoute(r) })
    }
    Spacer(Modifier.height(8.dp))
    RowDivider()
    NavRow("🚪", "Leave — the call goes on", desc = "Rejoin any time, from here or another device", onClick = { close(); actions.onLeave() })
    if (!s.turn) Text("No TURN relay configured — calls on strict networks may not connect.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(16.dp))
    Spacer(Modifier.height(16.dp))
}

@Composable
private fun DeviceHeader(label: String) {
    Text(label.uppercase(), color = Lab.colors.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp))
}

/** "Reconnecting…" / "Connecting…" in the corner of their tile, over the frozen last frame. */
@Composable
private fun TileBadge(text: String, modifier: Modifier, compact: Boolean = false) {
    Row(
        modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xCC111827)).padding(horizontal = if (compact) 6.dp else 10.dp, vertical = if (compact) 4.dp else 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 8.dp),
    ) {
        androidx.compose.material3.CircularProgressIndicator(Modifier.size(if (compact) 10.dp else 14.dp), color = Color.White, strokeWidth = 2.dp)
        Text(text, color = Color.White, fontSize = if (compact) 10.sp else 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Draw toggle, pens, Clear (both sides) and Keep (both people) — web CallPage's `.annot-tools`. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun AnnotateTools(
    modifier: Modifier, label: String, on: Boolean, color: String, keep: Boolean,
    onToggle: () -> Unit, onColor: (String) -> Unit, onClear: () -> Unit, onKeep: (Boolean) -> Unit,
) {
    androidx.compose.foundation.layout.FlowRow(
        modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            if (on) "✓ Done" else label, color = Color.White, fontSize = 14.sp,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) Color(0xFFF43F5E) else Color(0xD9111827)).bouncyClickable(onClick = onToggle).heightIn(min = 40.dp).padding(horizontal = 14.dp, vertical = 10.dp),
        )
        if (on) {
            dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.ANNOT_COLORS.forEach { c ->
                Box(
                    Modifier.align(Alignment.CenterVertically).size(32.dp).clip(CircleShape).background(Color(0xFF000000 or c.removePrefix("#").toLong(16)))
                        .border(if (c == color) 3.dp else 2.dp, if (c == color) Color.White else Color(0x99FFFFFF), CircleShape).bouncyClickable { onColor(c) },
                )
            }
            Text("Clear", color = Color.White, fontSize = 14.sp, modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xD9111827)).bouncyClickable(onClick = onClear).heightIn(min = 40.dp).padding(horizontal = 14.dp, vertical = 10.dp))
            // Keep drawings until cleared (for both of you).
            Row(
                Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xD9111827)).bouncyClickable { onKeep(!keep) }.heightIn(min = 40.dp).padding(start = 4.dp, end = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                androidx.compose.material3.Checkbox(
                    checked = keep, onCheckedChange = onKeep, modifier = Modifier.size(36.dp),
                    colors = androidx.compose.material3.CheckboxDefaults.colors(checkedColor = Color(0xFF38BDF8), uncheckedColor = Color.White, checkmarkColor = Color(0xFF111827)),
                )
                Text("Keep", color = Color.White, fontSize = 14.sp)
            }
            Text("Drag to circle · tap to point", color = Color(0xFFE5E7EB), fontSize = 12.sp, modifier = Modifier.align(Alignment.CenterVertically).clip(RoundedCornerShape(999.dp)).background(Color(0xB3111827)).padding(horizontal = 8.dp, vertical = 3.dp))
        }
    }
}

/** While I share: "… is drawing on your screen", "✏️ Draw on it" and the switch for drawings over other apps. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ShareBar(a: Annotations, otherName: String, overlayOn: Boolean, now: Long, onToggleOverlay: () -> Unit, onDraw: () -> Unit) {
    val drawing = now - a.lastRemoteAt < 6_000
    androidx.compose.foundation.layout.FlowRow(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp).padding(top = 8.dp).clip(RoundedCornerShape(14.dp)).background(if (drawing) Color(0xFF7F1D1D) else DarkCard).padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            if (drawing) "✏️ ${a.lastRemoteName.ifBlank { otherName }} is drawing on your screen" else "🖥️ You’re sharing your screen",
            color = OnDark, fontSize = 14.sp, modifier = Modifier.weight(1f).widthIn(min = 150.dp).align(Alignment.CenterVertically),
        )
        Text(
            "✏️ Draw on it", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xFF0284C7)).bouncyClickable(onClick = onDraw).heightIn(min = 40.dp).padding(horizontal = 12.dp, vertical = 10.dp),
        )
        Text(
            if (overlayOn) "Drawings over apps: on" else "Show drawings over apps", color = Color(0xFF111827), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xFFF9FAFB)).bouncyClickable(onClick = onToggleOverlay).heightIn(min = 40.dp).padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun Tab(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label, fontWeight = FontWeight.SemiBold, color = if (selected) Lab.colors.accent else Lab.colors.muted,
        modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(if (selected) Lab.colors.accent.copy(alpha = 0.12f) else Color.Transparent)
            .bouncyClickable(onClick = onClick).heightIn(min = 40.dp).padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

@Composable
private fun RecBadge() {
    val t = rememberInfiniteTransition(label = "rec")
    val a by t.animateFloat(1f, 0.35f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "rec-a")
    Text("● REC", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Palette.Again.copy(alpha = 0.3f + 0.6f * a)).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable
private fun Chip(text: String, color: Color) {
    Text(text, color = Color.White, fontSize = 12.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(color).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable
private fun WaitingDots() {
    val t = rememberInfiniteTransition(label = "wait")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(3) { i ->
            val a by t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(600, delayMillis = i * 200), RepeatMode.Reverse), label = "d$i")
            Box(Modifier.size(12.dp).clip(CircleShape).background(Lab.colors.accent.copy(alpha = a)))
        }
    }
}

@Composable
private fun ChatPanel(messages: List<CallChatMessage>, myUserId: String, onSend: (String) -> Boolean, modifier: Modifier) {
    var text by rememberSaveable { mutableStateOf("") }
    val list = rememberLazyListState()
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) list.animateScrollToItem(messages.size - 1) }
    Column(modifier) {
        LazyColumn(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 12.dp), state = list, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (messages.isEmpty()) item {
                Text("Type a word or sentence here — it’s saved with the call and goes into the lesson notes.", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 12.dp))
            }
            items(messages, key = { it.id }) { m ->
                val mine = m.userId == myUserId
                Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                    if (!mine) Text(m.name, color = Lab.colors.muted, fontSize = 12.sp)
                    Text(
                        m.text, color = if (mine) Color.White else Lab.colors.ink, fontSize = 17.sp,
                        modifier = Modifier.widthIn(max = 280.dp).clip(RoundedCornerShape(16.dp)).background(if (mine) Lab.colors.accent else Lab.colors.card).padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val send = { if (onSend(text)) text = "" }
            OutlinedTextField(
                text, { text = it.take(1000) }, Modifier.weight(1f), placeholder = { Text("Message…") }, singleLine = true, shape = RoundedCornerShape(16.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }),
                colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.card, unfocusedContainerColor = Lab.colors.card),
            )
            PrimaryPill("Send", Modifier.height(52.dp), enabled = text.isNotBlank()) { send() }
        }
    }
}

// ---------------------------------------------------------------- leave / end

/** 🚪 Leave — next to End on a wide screen (web: .call-btn.leave). */
@Composable
private fun LeavePill(height: Dp, onClick: () -> Unit) {
    Row(
        Modifier.height(height).clip(RoundedCornerShape(999.dp)).background(Color(0x33FFFFFF))
            .bouncyClickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
            .semantics { contentDescription = "Leave — the call continues" }
            .padding(horizontal = 16.dp).testTag("leave-call"),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("🚪", fontSize = 20.sp)
        Text("Leave", color = OnDark, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** "End the call for everyone?" with Just leave / End for everyone / Cancel (web: .call-end-confirm). */
@Composable
fun EndConfirm(onLeave: () -> Unit, onEnd: () -> Unit, onCancel: () -> Unit) {
    Column(
        Modifier.widthIn(max = 380.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).padding(18.dp).testTag("end-confirm"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("End the call for everyone?", color = Color(0xFF111827), fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                append("To switch device or step away, ")
                pushStyle(androidx.compose.ui.text.SpanStyle(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic, fontWeight = FontWeight.SemiBold))
                append("Leave")
                pop()
                append(" instead — the call goes on.")
            },
            color = Color(0xFF374151), fontSize = 15.sp, lineHeight = 21.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.weight(1f).height(48.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFF3F4F6))
                    .bouncyClickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onLeave).testTag("end-confirm-leave"),
                contentAlignment = Alignment.Center,
            ) { Text("🚪 Just leave", color = Color(0xFF111827), fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
            Box(
                Modifier.weight(1f).height(48.dp).clip(RoundedCornerShape(12.dp)).background(Palette.Again)
                    .bouncyClickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onEnd).testTag("end-confirm-end"),
                contentAlignment = Alignment.Center,
            ) { Text("End for everyone", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
        }
        Box(
            Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(12.dp)).bouncyClickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onCancel),
            contentAlignment = Alignment.Center,
        ) { Text("Cancel", color = Color(0xFF4B5563), fontSize = 15.sp) }
    }
}

/** "You left the call" — it goes on for them; Rejoin (same call, devices as I left them) or All calls (web: phase 'left'). */
@Composable
private fun Left(s: CallState, info: CallScreenInfo, actions: CallActions) {
    val first = info.otherName?.trim()?.takeIf { it.isNotEmpty() }?.substringBefore(' ') ?: "the other person"
    Center {
        Column(
            Modifier.widthIn(max = 420.dp).clip(RoundedCornerShape(24.dp)).background(DarkCard).padding(24.dp).testTag("call-left"),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("🚪", fontSize = 48.sp)
            Text("You left the call", color = OnDark, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "It goes on for $first — rejoin from here or from another device. A call nobody is in ends by itself after 10 minutes.",
                color = MutedDark, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium,
            )
            if (s.pendingUploads > 0) Text(
                "Uploading your recording… ${CallsFormat.plural(s.pendingUploads, "part")} left.",
                color = MutedDark, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall,
            )
            PrimaryPill("Rejoin", Modifier.fillMaxWidth().height(52.dp).testTag("rejoin-call"), onClick = actions.onRejoin)
            SecondaryPill("All calls", Modifier.fillMaxWidth().height(48.dp), onClick = actions.onAllCalls)
        }
    }
}

// ---------------------------------------------------------------- ended

@Composable
private fun Ended(s: CallState, actions: CallActions) {
    Center {
        Column(
            Modifier.widthIn(max = 420.dp).clip(RoundedCornerShape(24.dp)).background(DarkCard).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(if (s.phase == CallPhase.ENDED) "👋" else "⚠️", fontSize = 48.sp)
            Text(if (s.phase == CallPhase.ENDED) "Call ended" else "Left the call", color = OnDark, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            s.error?.let { Text(it, color = MutedDark, textAlign = TextAlign.Center) }
            Text(
                if (s.pendingUploads > 0) "Uploading your recording… ${CallsFormat.plural(s.pendingUploads, "part")} left. You can leave this screen — it finishes on the next sync."
                else "The transcript and lesson notes appear on the call page in a few minutes.",
                color = MutedDark, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium,
            )
            PrimaryPill("Transcript & notes", Modifier.fillMaxWidth().height(52.dp), onClick = actions.onReview)
            SecondaryPill("All calls", Modifier.fillMaxWidth().height(48.dp), onClick = actions.onAllCalls)
        }
    }
}
