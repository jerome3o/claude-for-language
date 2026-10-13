package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * A request to bring one section of the student page into view (web `#homework`,
 * hooks/useScrollToHash.ts). A class, not a data class: asking for the same section twice is
 * two requests, so "All homework ↓" scrolls again after the tutor scrolled away.
 */
class SectionFocus(val section: String)

/**
 * Scrolls a LazyColumn until the item with [key] is on screen, then puts it at the top. The
 * list only knows the keys it has laid out, so it walks forward a screen at a time from the top.
 */
suspend fun LazyListState.scrollToKey(key: Any): Boolean {
    scrollToItem(0)
    repeat(60) {
        withFrameNanos { }
        val hit = layoutInfo.visibleItemsInfo.firstOrNull { it.key == key }
        if (hit != null) {
            animateScrollToItem(hit.index)
            return true
        }
        if (!canScrollForward) return false
        scrollBy(layoutInfo.viewportSize.height * 0.9f)
    }
    return false
}

/** The landing highlight: a blue ring + wash that fades out (web .section-flash). */
@Composable
fun FlashSection(trigger: SectionFocus?, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(trigger) {
        if (trigger == null) return@LaunchedEffect
        alpha.snapTo(1f)
        delay(800)
        alpha.animateTo(0f, tween(1600))
    }
    val a = alpha.value
    val shape = RoundedCornerShape(12.dp)
    // The caller's modifier (and test tag) on the outer box; the flash and its tag on an inner
    // one — two test tags on one node would hide the second.
    Box(modifier) {
        Box(
            Modifier
                .then(if (a > 0f) Modifier.testTag("section-flash") else Modifier)
                .background(FLASH_WASH.copy(alpha = FLASH_WASH.alpha * a), shape)
                .border(3.dp, FLASH_RING.copy(alpha = a), shape)
                .padding(if (trigger != null) 6.dp else 0.dp),
        ) { content() }
    }
}

// The homework blue (web td-pill-homework / .section-flash), readable on both themes.
private val FLASH_RING = Color(0xFF93C5FD)
private val FLASH_WASH = Color(0x333B82F6)
