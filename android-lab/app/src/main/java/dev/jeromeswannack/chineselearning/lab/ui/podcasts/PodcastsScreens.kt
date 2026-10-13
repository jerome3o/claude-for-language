package dev.jeromeswannack.chineselearning.lab.ui.podcasts

import android.graphics.BitmapFactory
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.podcasts.Podcasts
import dev.jeromeswannack.chineselearning.lab.data.api.FeedEpisodeDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastEpisodeDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastFeedViewDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastTranscriptDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastsHomeDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/*
 * 🎙 Podcasts (docs/PODCASTS.md) — Lab app only for now: the list (My episodes, Subscriptions,
 * add by link, Suggested) and a podcast's feed with a Transcribe button per episode. The player is
 * EpisodeScreen.kt. Stateless screens + actions, so screenshot tests render them.
 */

object PodcastTags {
    const val URL = "podcasts-url"
    const val ADD = "podcasts-add"
    fun suggested(url: String) = "podcasts-suggested-${url.hashCode()}"
    fun transcribe(id: String) = "podcast-transcribe-$id"
    fun episode(id: String) = "podcast-episode-$id"
}

// ---------------------------------------------------------------- shared pieces

/**
 * A podcast's cover: downloaded once into the cache dir and decoded small (covers are often
 * 3000 px squares); a gradient with 🎙 until it is there, offline, or without one. [preview] for screenshots.
 */
@Composable
fun PodcastCover(url: String?, size: Dp, modifier: Modifier = Modifier, preview: ImageBitmap? = null) {
    val context = LocalContext.current
    val app = context.applicationContext as? LabApp
    val loaded by produceState<ImageBitmap?>(null, url, preview) {
        if (preview != null || app == null || url.isNullOrBlank()) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(app.cacheDir, "podcast-covers").apply { mkdirs() }
                val name = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
                val file = File(dir, "$name.img")
                if (!file.exists() || file.length() == 0L) app.repo.api.download(url, file)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.absolutePath, bounds)
                var sample = 1
                while (bounds.outWidth / (sample * 2) >= 240) sample *= 2
                BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            }.getOrNull()
        }
    }
    val bitmap = preview ?: loaded
    Box(
        modifier.size(size).clip(RoundedCornerShape(size / 6)).background(Brush.linearGradient(listOf(Color(0xFF6366F1), Color(0xFFA855F7)))),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) Image(bitmap, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text("🎙", fontSize = (size.value * 0.42f).sp)
    }
}

/** The transcription's state as a small pill (nothing when nobody asked yet). */
@Composable
fun TranscriptPill(t: PodcastTranscriptDto?, modifier: Modifier = Modifier) {
    if (t == null) return
    val (text, color) = when (t.status) {
        "ready" -> "✓ Transcribed" to Palette.Good
        "failed" -> "Couldn't transcribe" to Palette.Again
        "translating" -> (Podcasts.fraction(t.status, t.progress_done, t.progress_total)?.let { "Translating ${(it * 100).toInt()}%" } ?: "Translating…") to Palette.Easy
        else -> Podcasts.statusLine(t.status, t.progress, t.progress_done, t.progress_total, null) to Palette.Easy
    }
    StatusPill(text, color, modifier)
}

private fun meta(vararg parts: String?): String = parts.filterNotNull().filter { it.isNotBlank() }.joinToString(" · ")

// ---------------------------------------------------------------- /podcasts

data class PodcastsHomeUi(
    val home: Loadable<PodcastsHomeDto> = Loadable(loading = true),
    val url: String = "",
    val adding: Boolean = false,
    val addError: String? = null,
    /** Suggested feeds being subscribed to. */
    val busy: Set<String> = emptySet(),
    val online: Boolean = true,
)

class PodcastsHomeActions(
    val onBack: () -> Unit = {},
    val onUrl: (String) -> Unit = {},
    val onAdd: () -> Unit = {},
    val onSubscribe: (String) -> Unit = {},
    val onOpenFeed: (String) -> Unit = {},
    val onOpenEpisode: (String) -> Unit = {},
    val onRetry: () -> Unit = {},
)

@Composable
fun PodcastsScreen(ui: PodcastsHomeUi, actions: PodcastsHomeActions) {
    LabScreen("Podcasts", onBack = actions.onBack, subtitle = "Real Chinese podcasts, a sentence at a time") {
        item {
            LoadableContent(ui.home, onRetry = actions.onRetry) { home ->
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!home.transcription_available) {
                        InlineNotice("Transcribing episodes isn't set up on the server yet — you can subscribe and browse.", kind = NoticeKind.Warning)
                    }
                    if (home.episodes.isNotEmpty()) {
                        SectionHeader("My episodes")
                        LabCard {
                            home.episodes.forEachIndexed { i, e ->
                                MyEpisodeRow(e) { actions.onOpenEpisode(e.id) }
                                if (i < home.episodes.lastIndex) RowDivider()
                            }
                        }
                    }
                    SectionHeader("Subscriptions")
                    if (home.subscriptions.isEmpty()) {
                        Text(
                            "Subscribe to a podcast to see its episodes here — paste its link below, or pick one of the suggestions.",
                            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 4.dp),
                        )
                    } else {
                        LabCard {
                            home.subscriptions.forEachIndexed { i, s ->
                                FeedRow(s.image_url, s.title, s.author, onClick = { actions.onOpenFeed(s.feed_url) })
                                if (i < home.subscriptions.lastIndex) RowDivider()
                            }
                        }
                    }
                    AddByLink(ui, actions)
                    SectionHeader("Suggested")
                    LabCard {
                        home.suggested.forEachIndexed { i, s ->
                            Row(
                                Modifier.fillMaxWidth().clickable { actions.onOpenFeed(s.feed_url) }.padding(horizontal = 16.dp, vertical = 12.dp)
                                    .testTag(PodcastTags.suggested(s.feed_url)),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(s.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(meta(s.level.replaceFirstChar { it.uppercase() }, s.blurb), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2)
                                }
                                Spacer(Modifier.width(8.dp))
                                if (s.subscribed) Text("✓", color = Palette.Good, fontSize = 20.sp, modifier = Modifier.padding(horizontal = 12.dp))
                                else SecondaryPill(if (s.feed_url in ui.busy) "…" else "+ Subscribe", Modifier.height(44.dp), enabled = ui.online && s.feed_url !in ui.busy, horizontalPadding = 12.dp, fontSize = 14.sp) {
                                    actions.onSubscribe(s.feed_url)
                                }
                            }
                            if (i < home.suggested.lastIndex) RowDivider()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MyEpisodeRow(e: PodcastEpisodeDto, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp).testTag(PodcastTags.episode(e.id)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PodcastCover(e.image_url, 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(e.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(meta(e.podcast_title, e.duration_ms?.let { Podcasts.minutes(it / 1000) }), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            TranscriptPill(PodcastTranscriptDto(e.status, e.progress, e.progress_done, e.progress_total, e.error))
        }
    }
}

@Composable
private fun FeedRow(image: String?, title: String, author: String?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        PodcastCover(image, 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (!author.isNullOrBlank()) Text(author, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1)
        }
        Text("›", color = Lab.colors.muted, fontSize = 22.sp)
    }
}

@Composable
private fun AddByLink(ui: PodcastsHomeUi, actions: PodcastsHomeActions) {
    LabCard(Modifier.padding(top = 4.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Add a podcast", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
            Text("Paste its RSS feed, its Apple Podcasts link, or the show's website.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            OutlinedTextField(
                value = ui.url,
                onValueChange = actions.onUrl,
                placeholder = { Text("https://…") },
                singleLine = true,
                enabled = !ui.adding,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { actions.onAdd() }),
                modifier = Modifier.fillMaxWidth().testTag(PodcastTags.URL),
            )
            ui.addError?.let { InlineNotice(it, kind = NoticeKind.Error) }
            PrimaryPill(
                if (ui.adding) "Reading the feed…" else "Subscribe",
                Modifier.fillMaxWidth().height(52.dp).testTag(PodcastTags.ADD),
                enabled = ui.online && !ui.adding && ui.url.isNotBlank(),
                onClick = actions.onAdd,
            )
            if (!ui.online) Text("Adding a podcast needs a connection.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}

// ---------------------------------------------------------------- /podcasts/feed?url=

data class PodcastFeedUi(
    val url: String,
    val feed: Loadable<PodcastFeedViewDto> = Loadable(loading = true),
    /** Episodes whose Transcribe was just tapped. */
    val starting: Set<String> = emptySet(),
    val subscribing: Boolean = false,
    val expanded: String? = null,
    val error: String? = null,
    val online: Boolean = true,
)

class PodcastFeedActions(
    val onBack: () -> Unit = {},
    val onSubscribe: () -> Unit = {},
    val onUnsubscribe: () -> Unit = {},
    val onTranscribe: (FeedEpisodeDto) -> Unit = {},
    val onOpen: (FeedEpisodeDto) -> Unit = {},
    val onExpand: (String) -> Unit = {},
    val onRetry: () -> Unit = {},
)

@Composable
fun PodcastFeedScreen(ui: PodcastFeedUi, actions: PodcastFeedActions, cover: ImageBitmap? = null) {
    val feed = ui.feed.data
    LabScreen(feed?.podcast?.title ?: "Podcast", onBack = actions.onBack, subtitle = feed?.podcast?.author) {
        item {
            LoadableContent(ui.feed, onRetry = actions.onRetry) { f ->
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        PodcastCover(f.podcast.image_url, 96.dp, preview = cover)
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("${f.episodes.size} episodes", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                            if (f.subscription_id != null) {
                                SecondaryPill("✓ Subscribed", Modifier.height(44.dp), enabled = ui.online && !ui.subscribing, horizontalPadding = 14.dp, fontSize = 14.sp, onClick = actions.onUnsubscribe)
                            } else {
                                PrimaryPill(if (ui.subscribing) "…" else "+ Subscribe", Modifier.height(44.dp), enabled = ui.online && !ui.subscribing, onClick = actions.onSubscribe)
                            }
                        }
                    }
                    if (f.podcast.description.isNotBlank()) {
                        Text(f.podcast.description, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    }
                    if (f.stale) InlineNotice("Couldn't refresh the feed — showing the copy from ${Podcasts.date(f.fetched_at) ?: "earlier"}.", kind = NoticeKind.Warning)
                    if (!f.transcription_available) InlineNotice("Transcribing episodes isn't set up on the server yet.", kind = NoticeKind.Warning)
                    ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                }
            }
        }
        val f = feed ?: return@LabScreen
        items(f.episodes, key = { it.id }) { e -> FeedEpisodeCard(e, f, ui, actions) }
    }
}

@Composable
private fun FeedEpisodeCard(e: FeedEpisodeDto, f: PodcastFeedViewDto, ui: PodcastFeedUi, actions: PodcastFeedActions) {
    val t = e.transcript
    val listenable = Podcasts.isListenable(t?.status)
    val tooLong = (e.duration_s ?: 0) > f.max_minutes * 60L
    LabCard(Modifier.testTag(PodcastTags.episode(e.id))) {
        Column(
            Modifier.fillMaxWidth().clickable { if (t != null) actions.onOpen(e) else actions.onExpand(e.id) }.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(e.title, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, maxLines = 3, overflow = TextOverflow.Ellipsis)
            Text(
                meta(Podcasts.date(e.published_at), Podcasts.minutes(e.duration_s), Podcasts.size(e.enclosure_bytes)),
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            )
            AnimatedVisibility(ui.expanded == e.id && e.description.isNotBlank(), enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Text(e.description, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink)
            }
            if (t != null && Podcasts.isWorking(t.status)) {
                Text(Podcasts.statusLine(t.status, t.progress, t.progress_done, t.progress_total, t.error), style = MaterialTheme.typography.bodySmall, color = Palette.Easy)
                val frac = Podcasts.fraction(t.status, t.progress_done, t.progress_total)
                if (frac != null) LinearProgressIndicator(progress = { frac }, Modifier.fillMaxWidth()) else LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            if (t?.status == "failed") Text(Podcasts.statusLine(t.status, null, null, null, t.error), style = MaterialTheme.typography.bodySmall, color = Palette.Again)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TranscriptPill(t)
                Spacer(Modifier.weight(1f))
                when {
                    listenable -> PrimaryPill("🎧 Listen", Modifier.height(44.dp), onClick = { actions.onOpen(e) })
                    t != null && t.status != "failed" -> SecondaryPill("Open", Modifier.height(44.dp), horizontalPadding = 16.dp, onClick = { actions.onOpen(e) })
                    tooLong -> Text("Too long to transcribe (over ${f.max_minutes} min)", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    else -> PrimaryPill(
                        when {
                            e.id in ui.starting -> "Starting…"
                            t?.status == "failed" -> "↻ Try again"
                            else -> "✨ Transcribe"
                        },
                        Modifier.height(44.dp).testTag(PodcastTags.transcribe(e.id)),
                        enabled = ui.online && f.transcription_available && e.id !in ui.starting,
                        onClick = { actions.onTranscribe(e) },
                    )
                }
            }
        }
    }
}

@Composable
internal fun PodcastsEmpty(onBack: () -> Unit) {
    EmptyState("🎙", "Nothing here", body = "This episode isn't on the phone and can't be fetched now.", actionLabel = "Back", onAction = onBack)
}
