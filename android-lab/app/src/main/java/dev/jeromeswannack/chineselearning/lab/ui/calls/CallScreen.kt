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
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.TileStatus
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTranscript
import dev.jeromeswannack.chineselearning.lab.core.calls.LiveStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.VideoFit
import dev.jeromeswannack.chineselearning.lab.data.calls.AudioRoute
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
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

/** TEXT = the shared text board (the main board), BOARD = drawing. */
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
    val onLeave: () -> Unit = {},
    val onCommitBoard: (BoardOp) -> Unit = {},
    val onLive: (LiveStroke?) -> Unit = {},
    val onSendChat: (String) -> Boolean = { false },
    /** [compose] = the IME composition's text while [composing] (shown to the other person in my name flag). */
    val onTextChanged: (text: String, start: Int, end: Int, composing: Boolean, compose: String?) -> Unit = { _, _, _, _, _ -> },
    val onTextSelected: (Int, Int) -> Unit = { _, _ -> },
    val onTextBlurred: () -> Unit = {},
    /** Word-by-word meaning of a selection on the board (online). */
    val explain: (suspend (String) -> String?)? = null,
    /** Tab-complete: pinyin + meaning for Chinese just typed (POST /api/calls/:id/gloss); null = off. */
    val gloss: (suspend (String) -> BoardGloss?)? = null,
    val onBoardGlossOn: (Boolean) -> Unit = {},
    val onAnnotate: (dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke) -> Unit = {},
    val onPing: (Double, Double) -> Unit = { _, _ -> },
    val onClearAnnotations: () -> Unit = {},
    /** Show / hide the drawings over other apps while sharing (asks for the permission first). */
    val onToggleScreenOverlay: () -> Unit = {},
    val onReview: () -> Unit = {},
    val onAllCalls: () -> Unit = {},
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
) {
    when {
        info.loading -> Center { Text("Loading the call…", color = OnDark) }
        info.notFound -> Center {
            Text("Call not found.", color = OnDark, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(16.dp))
            SecondaryPill("Back to calls", onClick = actions.onAllCalls)
        }
        s.phase == CallPhase.ENDED || s.phase == CallPhase.ERROR -> Ended(s, actions)
        s.phase == CallPhase.PREJOIN || s.phase == CallPhase.JOINING -> PreJoin(s, info, actions, video)
        else -> Live(s, info, actions, video, nowMs, initialPanel)
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
private fun MicButton(s: CallState, onClick: () -> Unit) =
    RoundButton(if (s.micOn && s.hasMic) "🎙️" else "🔇", if (!s.hasMic) "Turn on the microphone" else if (s.micOn) "Mute" else "Unmute", off = !s.micOn || !s.hasMic, warn = s.mediaReady && !s.hasMic, onClick = onClick)

@Composable
private fun CamButton(s: CallState, onClick: () -> Unit) =
    RoundButton(if (s.camOn && s.hasCamera) "📷" else "🚫", if (!s.hasCamera) "Turn on the camera" else if (s.camOn) "Camera off" else "Camera on", off = !s.camOn || !s.hasCamera, warn = s.mediaReady && !s.hasCamera && s.camProblem != MediaProblem.NO_DEVICE, onClick = onClick)

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
        if (fit == VideoFit.Fit.CONTAIN && b != null && f != null) {
            val r = VideoFit.containRect(f, b)
            val size = with(density) { Modifier.requiredSize(r.width.toFloat().toDp(), r.height.toFloat().toDp()) }
            slot(video, mirror, false, overlay, report, size)
        } else {
            slot(video, mirror, fit == VideoFit.Fit.CONTAIN, overlay, report, Modifier.fillMaxSize())
        }
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

@Composable
private fun Live(s: CallState, info: CallScreenInfo, actions: CallActions, video: VideoSlot, nowMs: () -> Long, initialPanel: CallPanel) {
    var panel by rememberSaveable { mutableStateOf(initialPanel) }
    var seenChat by rememberSaveable { mutableIntStateOf(0) }
    var more by remember { mutableStateOf(false) }
    var confirmEnd by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(nowMs()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(1_000); now = nowMs() } }
    LaunchedEffect(panel, s.chat.size) { if (panel == CallPanel.CHAT) seenChat = s.chat.size }
    val remote = s.remote
    val rs = remote?.peer?.state
    val otherName = remote?.peer?.name?.takeIf { it.isNotBlank() } ?: info.otherName ?: "your partner"
    val someoneRecording = s.recording || rs?.recording == true
    val remoteVideoOn = remote?.video != null && (rs?.cam == true || rs?.screen == true)
    val unread = maxOf(0, s.chat.size - seenChat)
    val density = LocalDensity.current
    var stageDp by remember { mutableStateOf<VideoFit.Size?>(null) }
    var selfFrame by remember { mutableStateOf<VideoFit.Size?>(null) }
    var remoteFrame by remember { mutableStateOf<VideoFit.Size?>(null) }
    var annotating by rememberSaveable { mutableStateOf(false) }
    var annotColor by rememberSaveable { mutableStateOf(dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.ANNOT_COLORS[0]) }
    val remoteSharing = rs?.screen == true && remoteVideoOn
    LaunchedEffect(remoteSharing) { if (!remoteSharing) annotating = false }

    BoxWithConstraints(Modifier.fillMaxSize().background(Dark).windowInsetsPadding(WindowInsets.safeDrawing).imePadding()) {
        val wide = maxWidth >= 640.dp
        Column(Modifier.fillMaxSize()) {
            // top bar
            Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(otherName, color = OnDark, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text(s.startedAt?.let { CallTranscript.formatOffset(now - it) } ?: "0:00", color = MutedDark, fontSize = 14.sp)
                if (someoneRecording) RecBadge()
                if (s.roomStatus == RoomStatus.RECONNECTING) Chip("Reconnecting…", Palette.Hard)
            }
            val stage: @Composable (Modifier) -> Unit = { m ->
                Box(
                    m.clip(RoundedCornerShape(20.dp)).background(DarkCard)
                        .onSizeChanged { stageDp = with(density) { VideoFit.Size(it.width.toDp().value.toDouble(), it.height.toDp().value.toDouble()) } },
                    contentAlignment = Alignment.Center,
                ) {
                    if (remote != null) {
                        // Their picture stays up through a dropout (the renderer keeps the last frame): never cleared on
                        // disconnected / failed / away — the badge says what is going on.
                        if (remoteVideoOn) FittedVideo(remote.video!!, false, screen = rs?.screen == true, overlay = false, slot = video, modifier = Modifier.fillMaxSize(), onFrameSize = { remoteFrame = it })
                        else Initials(otherName)
                        if (remote.tile != TileStatus.LIVE) TileBadge(
                            if (remote.tile == TileStatus.RECONNECTING) "Reconnecting…" else "Connecting…",
                            Modifier.align(Alignment.TopStart).padding(12.dp).padding(top = if (remoteSharing) 52.dp else 0.dp),
                        )
                        Text(
                            (if (rs != null && !rs.mic) "🔇 " else "") + otherName,
                            color = Color.White, fontSize = 13.sp,
                            modifier = Modifier.align(Alignment.BottomStart).padding(12.dp).clip(RoundedCornerShape(8.dp)).background(Color(0x99000000)).padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    } else {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                            WaitingDots()
                            Spacer(Modifier.height(12.dp))
                            Text("Waiting for $otherName to join…", color = OnDark, textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium)
                            Text(if (info.relationshipId != null) "They got a Join link in your chat." else "A test call — try the whiteboard and the chat.", color = MutedDark, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    // Their shared screen: draw on it (circle a character), a tap is a "look here" ping.
                    if (remoteSharing) {
                        AnnotationCanvas(
                            s.annotations, remoteFrame, Modifier.fillMaxSize(), interactive = annotating, color = annotColor,
                            onStroke = actions.onAnnotate, onPing = actions.onPing, nowMs = nowMs,
                        )
                        AnnotateTools(Modifier.align(Alignment.TopStart).padding(10.dp).padding(end = if (wide) 0.dp else 110.dp), otherName, annotating, annotColor,
                            onToggle = { annotating = !annotating }, onColor = { annotColor = it }, onClear = actions.onClearAnnotations)
                    }
                    // self view: shaped like my camera, sized from the stage (VideoFit.pipSize, like the web)
                    val pip = stageDp?.let { VideoFit.pipSize(selfFrame, it) }
                    Box(
                        Modifier.align(if (wide) Alignment.BottomEnd else Alignment.TopEnd).padding(10.dp)
                            .then(if (pip != null) Modifier.size(pip.width.dp, pip.height.dp) else Modifier.width(if (wide) 160.dp else 96.dp).aspectRatio(3f / 4))
                            .clip(RoundedCornerShape(14.dp)).background(Color(0xFF2B313A)).border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(14.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        val screen = s.screenVideo
                        val local = s.localVideo
                        when {
                            screen != null -> Box(Modifier.fillMaxSize()) {
                                FittedVideo(screen, false, screen = true, overlay = true, slot = video, modifier = Modifier.fillMaxSize(), onFrameSize = { selfFrame = it })
                                AnnotationCanvas(s.annotations, selfFrame, Modifier.fillMaxSize(), nowMs = nowMs)
                            }
                            local != null && s.hasCamera && s.camOn -> FittedVideo(local, s.frontCamera, screen = false, overlay = true, slot = video, modifier = Modifier.fillMaxSize(), cover = true, onFrameSize = { selfFrame = it })
                            else -> Text(if (s.micOn) "You" else "🔇 You", color = OnDark, fontSize = 13.sp)
                        }
                    }
                }
            }
            val panelView: @Composable (Modifier) -> Unit = { m ->
                Column(m.clip(RoundedCornerShape(20.dp)).background(Lab.colors.background)) {
                    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Tab("Board", panel == CallPanel.TEXT) { panel = CallPanel.TEXT }
                        Tab("Draw", panel == CallPanel.BOARD) { panel = CallPanel.BOARD }
                        Tab(if (unread > 0 && panel != CallPanel.CHAT) "Chat ($unread)" else "Chat", panel == CallPanel.CHAT) { panel = CallPanel.CHAT }
                        Spacer(Modifier.weight(1f))
                        Text("✕", color = Lab.colors.muted, fontSize = 18.sp, modifier = Modifier.size(44.dp).bouncyClickable { panel = CallPanel.NONE }.padding(top = 10.dp), textAlign = TextAlign.Center)
                    }
                    if (panel == CallPanel.TEXT) TextBoardPanel(
                        s.textBoard, actions.onTextChanged, actions.onTextSelected, actions.onTextBlurred, Modifier.fillMaxWidth().weight(1f),
                        explain = actions.explain, gloss = actions.gloss, glossOn = info.boardGlossOn, onGlossOn = actions.onBoardGlossOn,
                        previewSuggestion = info.boardGlossPreview,
                    )
                    else if (panel == CallPanel.BOARD) Whiteboard(s.board, s.liveStrokes.values.toList(), s.myUserId, actions.onCommitBoard, actions.onLive, Modifier.fillMaxWidth().weight(1f))
                    else ChatPanel(s.chat, s.myUserId, actions.onSendChat, Modifier.fillMaxWidth().weight(1f))
                }
            }
            Box(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 8.dp)) {
                if (wide) Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    stage(Modifier.weight(1f).fillMaxHeight())
                    if (panel != CallPanel.NONE) panelView(Modifier.width(maxOf(360.dp, this@BoxWithConstraints.maxWidth * 0.42f)).fillMaxHeight())
                } else Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    stage(Modifier.fillMaxWidth().weight(if (panel == CallPanel.NONE) 1f else 0.42f))
                    AnimatedVisibility(panel != CallPanel.NONE, enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut(), modifier = Modifier.weight(0.58f, fill = panel != CallPanel.NONE)) {
                        panelView(Modifier.fillMaxSize())
                    }
                }
            }
            if (s.sharingScreen) ShareBar(s.annotations, otherName, info.screenOverlayOn, now, actions.onToggleScreenOverlay)
            // controls
            Row(
                Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
            ) {
                MicButton(s, actions.onToggleMic)
                CamButton(s, actions.onToggleCam)
                RoundButton("📝", "Board", active = panel == CallPanel.TEXT || panel == CallPanel.BOARD) { panel = if (panel == CallPanel.TEXT || panel == CallPanel.BOARD) CallPanel.NONE else CallPanel.TEXT }
                RoundButton("💬", "Chat", active = panel == CallPanel.CHAT, badge = if (panel != CallPanel.CHAT) unread else 0) { panel = if (panel == CallPanel.CHAT) CallPanel.NONE else CallPanel.CHAT }
                RoundButton("⋯", "More") { more = true }
                RoundButton("📞", "End call", danger = true) { confirmEnd = true }
            }
        }
    }
    if (more) LabBottomSheet(onDismiss = { more = false }, title = "Call") {
        CallMoreMenu(s, info, actions, close = { more = false })
    }
    if (confirmEnd) ConfirmDialog("End the call for everyone?", "The recording is uploaded and the transcript and lesson notes follow.", "End call", onConfirm = { confirmEnd = false; actions.onEnd() }, onDismiss = { confirmEnd = false }, danger = true)
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
    NavRow("🚪", "Leave (the call goes on)", desc = "Rejoin from the calls page", onClick = { close(); actions.onLeave() })
    if (!s.turn) Text("No TURN relay configured — calls on strict networks may not connect.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(16.dp))
    Spacer(Modifier.height(16.dp))
}

@Composable
private fun DeviceHeader(label: String) {
    Text(label.uppercase(), color = Lab.colors.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp))
}

/** "Reconnecting…" / "Connecting…" in the corner of their tile, over the frozen last frame. */
@Composable
private fun TileBadge(text: String, modifier: Modifier) {
    Row(
        modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xCC111827)).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        androidx.compose.material3.CircularProgressIndicator(Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp)
        Text(text, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun AnnotateTools(modifier: Modifier, otherName: String, on: Boolean, color: String, onToggle: () -> Unit, onColor: (String) -> Unit, onClear: () -> Unit) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            if (on) "✓ Done" else "✏️ Draw on ${otherName.substringBefore(' ')}’s screen", color = Color.White, fontSize = 14.sp,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) Color(0xFFF43F5E) else Color(0xD9111827)).bouncyClickable(onClick = onToggle).heightIn(min = 40.dp).padding(horizontal = 14.dp, vertical = 10.dp),
        )
        if (on) {
            dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.ANNOT_COLORS.forEach { c ->
                Box(
                    Modifier.size(30.dp).clip(CircleShape).background(Color(0xFF000000 or c.removePrefix("#").toLong(16)))
                        .border(if (c == color) 3.dp else 2.dp, if (c == color) Color.White else Color(0x99FFFFFF), CircleShape).bouncyClickable { onColor(c) },
                )
            }
            Text("Clear", color = Color.White, fontSize = 14.sp, modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xD9111827)).bouncyClickable(onClick = onClear).heightIn(min = 40.dp).padding(horizontal = 14.dp, vertical = 10.dp))
        }
    }
}

/** While I share: "… is drawing on your screen" and the switch for drawings over other apps. */
@Composable
private fun ShareBar(a: Annotations, otherName: String, overlayOn: Boolean, now: Long, onToggleOverlay: () -> Unit) {
    val drawing = now - a.lastRemoteAt < 6_000
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp).padding(top = 8.dp).clip(RoundedCornerShape(14.dp)).background(if (drawing) Color(0xFF7F1D1D) else DarkCard).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            if (drawing) "✏️ ${a.lastRemoteName.ifBlank { otherName }} is drawing on your screen" else "🖥️ You’re sharing your screen",
            color = OnDark, fontSize = 14.sp, modifier = Modifier.weight(1f),
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
