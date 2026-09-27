package dev.jeromeswannack.chineselearning.lab.ui.readers

import android.media.AudioAttributes
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaPlayer
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.ByteOrder

private const val WAVE_BUCKETS = 96

/**
 * `computePeaks`: the clip decoded to 16-bit PCM (MediaExtractor + MediaCodec) and reduced to
 * [WAVE_BUCKETS] peak amplitudes, normalised to 0..1. Null when it can't be decoded.
 */
fun computePeaks(file: File): List<Float>? = runCatching {
    val extractor = MediaExtractor()
    extractor.setDataSource(file.absolutePath)
    val track = (0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
    extractor.selectTrack(track)
    val format = extractor.getTrackFormat(track)
    val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
    codec.configure(format, null, null, 0)
    codec.start()
    val samples = ArrayList<Float>(64_000)
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    while (!outputDone) {
        if (!inputDone) {
            val i = codec.dequeueInputBuffer(10_000)
            if (i >= 0) {
                val buf = codec.getInputBuffer(i)!!
                val n = extractor.readSampleData(buf, 0)
                if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                else { codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0); extractor.advance() }
            }
        }
        val o = codec.dequeueOutputBuffer(info, 10_000)
        if (o >= 0) {
            val out = codec.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            // Every 8th sample is plenty for a peak.
            var k = 0
            while (k < out.remaining()) { samples += Math.abs(out.get(k) / 32768f); k += 8 }
            codec.releaseOutputBuffer(o, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
        }
    }
    codec.stop(); codec.release(); extractor.release()
    if (samples.isEmpty()) return null
    val size = Math.max(1, samples.size / WAVE_BUCKETS)
    val peaks = (0 until WAVE_BUCKETS).map { b -> samples.subList(Math.min(samples.size, b * size), Math.min(samples.size, (b + 1) * size)).maxOrNull() ?: 0f }
    val max = Math.max(0.01f, peaks.max())
    peaks.map { it / max }
}.getOrNull()

/**
 * The web's ReaderAudioScrubber, for the in-session reader: the page's narration as a
 * waveform with an anchor. Tap or drag anywhere to place it; play always starts FROM THE
 * ANCHOR (stop, play again = the same stretch); dragging while playing seeks live. ↻
 * regenerates a bad cached clip. Play sits on the right — the thumb side.
 */
@Composable
fun ReaderScrubber(page: ReaderPageDto, env: ReaderEnv) {
    val load = env.pageAudio
    var file by remember(page.id) { mutableStateOf<File?>(null) }
    var status by remember(page.id) { mutableStateOf("loading") }
    var peaks by remember(page.id) { mutableStateOf<List<Float>?>(null) }
    var anchor by remember(page.id) { mutableFloatStateOf(0f) }
    var head by remember(page.id) { mutableFloatStateOf(0f) }
    var playing by remember(page.id) { mutableStateOf(false) }
    var regenerating by remember(page.id) { mutableStateOf(false) }
    val player = remember(page.id) { arrayOfNulls<MediaPlayer>(1) }
    val scope = rememberCoroutineScope()

    fun release() { player[0]?.let { runCatching { it.release() } }; player[0] = null; playing = false }
    fun adopt(f: File?) {
        release()
        file = f
        status = if (f == null) "unavailable" else "ready"
        head = anchor
        if (f != null) scope.launch { peaks = withContext(Dispatchers.Default) { env.peaks(f) } }
    }
    LaunchedEffect(page.id) { adopt(load?.invoke(page, false)) }
    DisposableEffect(page.id) { onDispose { release() } }
    LaunchedEffect(playing) {
        while (playing) {
            player[0]?.let { p -> runCatching { if (p.duration > 0) head = p.currentPosition.toFloat() / p.duration } }
            delay(40)
        }
    }

    fun mp(): MediaPlayer? = player[0] ?: file?.let { f ->
        runCatching {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                setDataSource(f.absolutePath)
                prepare()
                setOnCompletionListener { playing = false; head = anchor }
            }
        }.getOrNull()?.also { player[0] = it }
    }
    fun play() {
        val p = mp() ?: return
        runCatching { p.seekTo((anchor * p.duration).toInt()); p.start(); playing = true; env.onTap() }
    }
    fun stop() {
        runCatching { player[0]?.pause() }
        playing = false
        head = anchor
    }
    fun seek(fraction: Float) {
        anchor = fraction.coerceIn(0f, 1f)
        head = anchor
        val p = player[0]
        if (playing && p != null) runCatching { p.seekTo((anchor * p.duration).toInt()) }
    }

    val ready = status == "ready"
    val barColor = if (peaks != null) Color(0xFF94A3B8) else Lab.colors.cardBorder
    val accent = Lab.colors.accent
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            Modifier.size(44.dp).bouncyClickable(!regenerating) {
                if (!regenerating && load != null) {
                    regenerating = true
                    stop()
                    scope.launch {
                        val f = load(page, true)
                        regenerating = false
                        if (f != null) { anchor = 0f; adopt(f) }
                    }
                }
            }.clip(CircleShape).background(Lab.colors.faint).alpha(if (regenerating) 0.4f else 1f),
            contentAlignment = Alignment.Center,
        ) { Text("↻", fontSize = 20.sp, color = Lab.colors.muted) }
        Box(
            Modifier.weight(1f).height(56.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
                .pointerInput(ready) { if (ready) detectTapGestures { seek(it.x / size.width) } }
                .pointerInput(ready) { if (ready) detectHorizontalDragGestures { change, _ -> seek(change.position.x / size.width) } },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val bars = peaks ?: List(WAVE_BUCKETS) { 0.35f }
                val gap = 1.dp.toPx()
                val w = size.width / bars.size - gap
                for ((i, v) in bars.withIndex()) {
                    val h = Math.max(2f, v * (size.height - 12f))
                    drawRoundRect(barColor, Offset(i * (w + gap), (size.height - h) / 2), Size(w, h), CornerRadius(w / 2))
                }
                if (ready) {
                    drawLine(accent.copy(alpha = 0.6f), Offset(head * size.width, 4f), Offset(head * size.width, size.height - 4f), strokeWidth = 2.dp.toPx())
                    drawCircle(accent, radius = 8.dp.toPx(), center = Offset(anchor * size.width, size.height / 2))
                }
            }
            if (status == "unavailable") Text("audio unavailable offline", fontSize = 12.sp, color = Lab.colors.muted)
        }
        Box(
            Modifier.size(56.dp).bouncyClickable(ready, 0.9f) { if (playing) stop() else play() }.clip(CircleShape)
                .background(if (playing) Lab.colors.accent else Lab.colors.accentSoft).alpha(if (ready) 1f else 0.5f),
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (playing) Icons.Filled.Stop else Icons.AutoMirrored.Filled.VolumeUp, if (playing) "Stop audio" else "Play audio from the selected point", Modifier.size(26.dp), tint = if (playing) Color.White else Lab.colors.accent)
        }
    }
}
