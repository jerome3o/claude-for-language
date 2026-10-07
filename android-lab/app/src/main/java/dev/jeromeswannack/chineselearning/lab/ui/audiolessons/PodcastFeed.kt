package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastFeedDto
import dev.jeromeswannack.chineselearning.lab.data.api.deletePodcastFeed
import dev.jeromeswannack.chineselearning.lab.data.api.podcastFeed
import dev.jeromeswannack.chineselearning.lab.data.api.resetPodcastFeed
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Settings → Audio lessons → "Podcast feed" (the web's PodcastFeedSection, docs/AUDIO_LESSONS.md
 * "Podcast feed"): the private RSS link of every ready lesson for a podcast app. Copy link · Open
 * in podcast app (podcast://) · Reset link (the old one stops working at once) · Turn off. The link
 * is the only credential, so it is shown masked and never cached on the phone.
 */
object PodcastFeed {
    private val TOKEN = Regex("/podcast/([A-Za-z0-9_-]{4})[A-Za-z0-9_-]+([A-Za-z0-9_-]{4})/")

    /** Port of maskFeedUrl (PodcastFeedSection.tsx): "…/api/podcast/Ab3d…x9Yz/feed.xml". */
    fun mask(url: String): String = TOKEN.replace(url) { m -> "/podcast/${m.groupValues[1]}…${m.groupValues[2]}/" }

    fun whenLabel(iso: String?): String {
        if (iso.isNullOrBlank()) return ""
        return runCatching {
            DateTimeFormatter.ofPattern("d MMM, HH:mm", Locale.getDefault()).withZone(ZoneId.systemDefault()).format(Instant.parse(iso))
        }.getOrDefault("")
    }

    const val TAG = "podcast-feed"
}

data class PodcastFeedUi(
    val feed: PodcastFeedDto? = null,
    val off: Boolean = false,
    val loading: Boolean = false,
    val busy: Boolean = false,
    val copied: Boolean = false,
    val online: Boolean = true,
    val error: String? = null,
)

class PodcastFeedActions(
    val onCopy: () -> Unit = {},
    val onOpen: () -> Unit = {},
    val onReset: () -> Unit = {},
    val onTurnOff: () -> Unit = {},
    val onTurnOn: () -> Unit = {},
    val onRetry: () -> Unit = {},
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PodcastFeedSection(ui: PodcastFeedUi, actions: PodcastFeedActions, modifier: Modifier = Modifier) {
    var confirmReset by remember { mutableStateOf(false) }
    var confirmOff by remember { mutableStateOf(false) }
    SettingsSection(
        "🎧 Audio lessons · Podcast feed",
        "Listen to your audio lessons in any podcast app — AntennaPod, Pocket Casts, Apple Podcasts. Every lesson that is ready arrives as an episode, with chapters, downloaded for the train. The link is private: anyone who has it can listen to your lessons, so don't share it.",
        modifier.testTag(PodcastFeed.TAG),
    ) {
        val feed = ui.feed
        when {
            feed == null && ui.off -> {
                Text("The podcast feed is off.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                PrimaryPill("Turn it on with a new link", enabled = ui.online && !ui.busy, onClick = actions.onTurnOn)
            }
            feed == null && !ui.online -> Text("Connect to the internet to see your podcast link.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            feed == null && ui.loading -> Text("Loading your link…", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            feed == null -> Unit
            feed.url == null -> {
                Text("This link can't be shown any more. Make a new one (the old one keeps working until you do).", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                PrimaryPill("Make a new link", enabled = ui.online && !ui.busy, onClick = { confirmReset = true })
            }
            else -> {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Lab.colors.background)
                        .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp)
                        .testTag("podcast-feed-url"),
                ) {
                    Text(PodcastFeed.mask(feed.url), fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Lab.colors.ink)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryPill(
                        if (ui.copied) "✓ Copied" else "📋 Copy link",
                        color = if (ui.copied) Palette.Good else Lab.colors.accent,
                        onClick = actions.onCopy,
                    )
                    if (feed.podcast_url != null) SecondaryPill("Open in podcast app", onClick = actions.onOpen)
                }
                Text(
                    if (feed.last_fetched_at != null) "Last checked by a podcast app: ${PodcastFeed.whenLabel(feed.last_fetched_at)}"
                    else "No podcast app has used this link yet. Copy it and choose \"Add podcast by URL\" in AntennaPod or Pocket Casts.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Lab.colors.muted,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill("Reset link", enabled = ui.online && !ui.busy, onClick = { confirmReset = true })
                    SecondaryPill("Turn off", enabled = ui.online && !ui.busy, danger = true, onClick = { confirmOff = true })
                }
            }
        }
        if (ui.error != null) InlineNotice(ui.error, kind = NoticeKind.Error, actionLabel = if (feed == null && !ui.off) "Retry" else null, onAction = actions.onRetry)
    }
    if (confirmReset) {
        ConfirmDialog(
            title = "Make a new podcast link?",
            text = "The old link stops working in every podcast app that uses it — you will need to subscribe again with the new one.",
            confirmLabel = "Reset link",
            danger = true,
            onConfirm = { confirmReset = false; actions.onReset() },
            onDismiss = { confirmReset = false },
        )
    }
    if (confirmOff) {
        ConfirmDialog(
            title = "Turn the podcast feed off?",
            text = "Podcast apps stop getting new lessons and the link stops working.",
            confirmLabel = "Turn off",
            danger = true,
            onConfirm = { confirmOff = false; actions.onTurnOff() },
            onDismiss = { confirmOff = false },
        )
    }
}

/** The section with its state: loads the link when online (made on first use), never caches it. */
@Composable
fun PodcastFeedCard(app: LabApp, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val online by app.online.collectAsStateWithLifecycle()
    var ui by remember { mutableStateOf(PodcastFeedUi()) }
    val scope = rememberCoroutineScope()

    fun load() {
        ui = ui.copy(loading = true, error = null)
        scope.launch {
            ui = try {
                ui.copy(feed = app.repo.api.podcastFeed(), off = false, loading = false)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ui.copy(loading = false, error = e.userMessage())
            }
        }
    }

    fun busy(action: String, block: suspend () -> PodcastFeedUi) {
        ui = ui.copy(busy = true, error = null)
        scope.launch {
            ui = try {
                block().copy(busy = false).also {
                    app.haptics.tick()
                    app.analytics.track("audio_lesson.podcast_feed", mapOf("action" to action))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ui.copy(busy = false, error = e.userMessage())
            }
        }
    }

    LaunchedEffect(online) { if (online && ui.feed == null && !ui.off) load() }

    PodcastFeedSection(
        ui.copy(online = online),
        PodcastFeedActions(
            onCopy = {
                val url = ui.feed?.url ?: return@PodcastFeedActions
                context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Podcast feed", url))
                app.haptics.correct()
                app.analytics.track("audio_lesson.podcast_feed", mapOf("action" to "copy"))
                ui = ui.copy(copied = true)
                scope.launch { delay(2500); ui = ui.copy(copied = false) }
            },
            onOpen = {
                val feed = ui.feed ?: return@PodcastFeedActions
                app.analytics.track("audio_lesson.podcast_feed", mapOf("action" to "open"))
                if (!openInPodcastApp(context, feed)) ui = ui.copy(error = "No podcast app on this phone opens podcast links — copy the link and add it in the app instead.")
            },
            onReset = { busy("reset") { ui.copy(feed = app.repo.api.resetPodcastFeed(), off = false) } },
            onTurnOff = { busy("off") { app.repo.api.deletePodcastFeed(); ui.copy(feed = null, off = true) } },
            onTurnOn = { ui = ui.copy(off = false); load() },
            onRetry = { load() },
        ),
        modifier,
    )
}

/** podcast://… (AntennaPod, Pocket Casts, Podcast Addict); false when nothing on the phone takes it. */
private fun openInPodcastApp(context: Context, feed: PodcastFeedDto): Boolean {
    val uri = feed.podcast_url ?: return false
    return try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}
