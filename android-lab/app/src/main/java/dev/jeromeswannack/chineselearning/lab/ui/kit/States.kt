package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

enum class NoticeKind { Info, Success, Warning, Error, Offline }

/**
 * An inline message in the flow of the screen — never `Toast` / a blocking alert for a
 * failure (the web's `InlineNotice`). Optional action on the right ("Retry", "Open in app").
 */
@Composable
fun InlineNotice(
    text: String,
    modifier: Modifier = Modifier,
    kind: NoticeKind = NoticeKind.Info,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val (icon, tint) = when (kind) {
        NoticeKind.Info -> "ℹ️" to Palette.Easy
        NoticeKind.Success -> "✓" to Palette.Good
        NoticeKind.Warning -> "⚠️" to Palette.Hard
        NoticeKind.Error -> "⚠️" to Palette.Again
        NoticeKind.Offline -> "📴" to Lab.colors.muted
    }
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(tint.copy(alpha = 0.12f)).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(icon, fontSize = 15.sp, color = tint)
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.weight(1f))
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.width(8.dp))
            Text(
                actionLabel,
                color = Lab.colors.accent,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onAction).padding(horizontal = 8.dp, vertical = 10.dp),
            )
        }
    }
}

/** "You're offline — showing what's on this phone." with the time of the cached copy. */
@Composable
fun OfflineNotice(modifier: Modifier = Modifier, updatedAt: Long? = null, nowMs: Long = System.currentTimeMillis()) {
    val age = updatedAt?.let { " (from ${ago(nowMs - it)})" }.orEmpty()
    InlineNotice("You're offline — showing what's on this phone$age.", modifier, NoticeKind.Offline)
}

/** A centred spinner with an optional line under it. Prefer showing cached data over this. */
@Composable
fun LoadingState(modifier: Modifier = Modifier, text: String? = null) {
    Column(modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.5.dp, color = Lab.colors.accent)
        if (text != null) {
            Spacer(Modifier.height(12.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        }
    }
}

/** Nothing here yet: big emoji, a title, one line, an optional next step. */
@Composable
fun EmptyState(
    emoji: String,
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(emoji, fontSize = 44.sp)
        Text(title, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, textAlign = TextAlign.Center)
        if (body != null) Text(body, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(8.dp))
            PrimaryPill(actionLabel, Modifier.height(52.dp), onClick = onAction)
        }
    }
}

/** A failure with nothing cached to show: the reason and Retry. */
@Composable
fun ErrorState(message: String, modifier: Modifier = Modifier, onRetry: (() -> Unit)? = null) {
    EmptyState("😕", "Couldn't load this", modifier, body = message, actionLabel = if (onRetry != null) "Try again" else null, onAction = onRetry)
}

/**
 * Renders a [Loadable] (from CachedResource) the Lab way: cached data at once with a notice
 * above it when the refresh failed or the phone is offline; a spinner only when there is no
 * data yet; [ErrorState] when nothing could be loaded. [isEmpty] decides when [empty] shows.
 */
@Composable
fun <T> LoadableContent(
    state: Loadable<T>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    isEmpty: (T) -> Boolean = { false },
    empty: @Composable () -> Unit = {},
    content: @Composable (T) -> Unit,
) {
    val data = state.data
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            data != null -> {
                if (state.offline) OfflineNotice(updatedAt = state.updatedAt)
                else if (state.error != null) InlineNotice(state.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = onRetry)
                if (isEmpty(data)) empty() else content(data)
            }
            state.loading -> LoadingState()
            state.offline -> EmptyState("📴", "You're offline", body = "This hasn't been downloaded to this phone yet.", actionLabel = "Try again", onAction = onRetry)
            else -> ErrorState(state.error ?: "Something went wrong.", onRetry = onRetry)
        }
    }
}

internal fun ago(ms: Long): String = when {
    ms < 60_000 -> "just now"
    ms < 3_600_000 -> "${ms / 60_000} min ago"
    ms < 86_400_000 -> "${ms / 3_600_000} h ago"
    else -> "${ms / 86_400_000} d ago"
}

/** A tinted status pill (e.g. "due today", "overdue"). */
@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        color = color,
        style = MaterialTheme.typography.labelMedium,
        modifier = modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}
