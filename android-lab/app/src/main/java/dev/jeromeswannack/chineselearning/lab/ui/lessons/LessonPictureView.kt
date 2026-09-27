package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.graphics.BitmapFactory
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.LessonImages
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonPicture
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.withContext

/**
 * The picture of a describe_image exercise, or what stands in for it — the web's
 * `DescribeImagePicture`: "Drawing the picture…" (a shimmering 4:3 card the picture then
 * replaces) while it is being generated, the scene text when there is none.
 */
@Composable
fun LessonPictureView(picture: LessonPicture, prompt: String, modifier: Modifier = Modifier) {
    val file = picture.file
    val bitmap by produceState<ImageBitmap?>(null, file) {
        value = file?.let { f -> withContext(Dispatchers.IO) { runCatching { BitmapFactory.decodeFile(f.absolutePath)?.asImageBitmap() }.getOrNull() } }
    }
    val b = bitmap
    if (picture.state == LessonImages.State.Ready && b != null) {
        Image(b, "Scene to describe", modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)), contentScale = ContentScale.FillWidth)
        return
    }
    val text = LessonImages.placeholder(if (picture.state == LessonImages.State.Ready) LessonImages.State.Loading else picture.state)
    if (text.drawing) {
        val shimmer by rememberInfiniteTransition(label = "picture-shimmer").animateFloat(
            0f, 1f, infiniteRepeatable(tween(1_600, easing = LinearEasing), RepeatMode.Restart), label = "shimmer",
        )
        val base = Lab.colors.faint
        val light = Lab.colors.card
        Column(
            modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(18.dp))
                .background(Brush.linearGradient(listOf(base, light, base), start = androidx.compose.ui.geometry.Offset(-600f + 1800f * shimmer, 0f), end = androidx.compose.ui.geometry.Offset(1800f * shimmer, 600f)))
                .semantics { liveRegion = LiveRegionMode.Polite }
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("🎨", fontSize = 36.sp)
            Text(text.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
            text.detail?.let { Text(it, fontSize = 14.sp, color = Lab.colors.muted, textAlign = TextAlign.Center) }
            if (picture.state == LessonImages.State.Slow) Text(prompt, fontSize = 14.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
        }
    } else {
        Text(
            buildString { append(text.title); append(' '); append(prompt) },
            style = MaterialTheme.typography.bodyLarge,
            color = Lab.colors.ink,
            modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).padding(16.dp),
        )
    }
}

/** Collects a picture flow ([ExerciseEnv.picture] or [rememberLessonPicture]). */
@Composable
fun collectPicture(flow: Flow<LessonPicture>, key: Any?): LessonPicture {
    val state by remember(key) { flow }.collectAsState(LessonPicture.Loading)
    return state
}

/**
 * A describe_image picture outside the lesson player (the editor form, the lesson preview,
 * the catalogue trial), straight from the app's [LessonRuntime]. [queue] false only looks the
 * picture up (the form while the tutor types); [debounceMs] waits for typing to settle.
 */
@Composable
fun rememberLessonPicture(key: String?, prompt: String?, queue: Boolean = true, debounceMs: Long = 0): LessonPicture {
    val app = LocalContext.current.applicationContext as? LabApp
    val flow = remember(app, key, prompt, queue) {
        if (app == null) emptyFlow() else kotlinx.coroutines.flow.flow {
            if (debounceMs > 0) delay(debounceMs)
            LessonRuntime.of(app).store.pictures.picture(key, prompt, app.online, queue).collect { emit(it) }
        }
    }
    val state by flow.collectAsState(if (app == null) LessonPicture(LessonImages.State.None) else LessonPicture.Loading)
    return state
}
