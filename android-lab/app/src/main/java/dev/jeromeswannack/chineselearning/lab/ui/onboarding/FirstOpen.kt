package dev.jeromeswannack.chineselearning.lab.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.core.TutorHomework
import dev.jeromeswannack.chineselearning.lab.data.api.OnboardingDto
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * Should Home be the invitee's first-open screen (web: useOnboarding)? They came in through
 * a TUTOR's invite and have not reviewed a single card — neither on the server nor on this
 * phone — and haven't tapped "Show the normal home".
 */
fun showFirstOpen(state: OnboardingDto?, dismissed: Boolean, localReviews: Int?): Boolean =
    !dismissed && state != null && state.invited && state.inviter_role == "tutor" && !state.has_reviewed && localReviews == 0

/** "about 8 min" / "under a minute" (web: formatStudyEstimate, 20 s a card). */
fun formatStudyEstimate(cards: Int): String = when {
    cards <= 0 -> ""
    cards * 20 < 60 -> "under a minute"
    else -> "about ${maxOf(1, Math.ceil(cards * 20 / 60.0).toInt())} min"
}

/** "just now" / "5 min ago" / "3 h ago" / "yesterday" / "4 days ago" (web: FirstOpenScreen relativeTime). */
fun onboardingRelativeTime(iso: String?, nowMs: Long = System.currentTimeMillis()): String {
    if (iso.isNullOrEmpty()) return ""
    val normalised = if (iso.contains('T')) iso else iso.replaceFirst(' ', 'T')
    val withZone = if (Regex("Z$|[+-]\\d\\d:\\d\\d$").containsMatchIn(normalised)) normalised else "${normalised}Z"
    val then = runCatching { Instant.parse(withZone).toEpochMilli() }.getOrNull() ?: return ""
    val mins = Math.round((nowMs - then) / 60000.0)
    if (mins < 2) return "just now"
    if (mins < 60) return "$mins min ago"
    val hours = Math.round(mins / 60.0)
    if (hours < 24) return "$hours h ago"
    val days = Math.round(hours / 24.0)
    return if (days == 1L) "yesterday" else "$days days ago"
}

data class FirstOpenUi(
    val state: OnboardingDto,
    val userName: String?,
    /** Cards due now (from the local queue). */
    val totalDue: Int,
    val hasSyncedOnce: Boolean,
    val online: Boolean,
)

class FirstOpenActions(
    val onStart: (deckId: String?) -> Unit = {},
    val onReply: () -> Unit = {},
    val onDismiss: () -> Unit = {},
)

/**
 * The very first home a new student sees, built from what the join flow already knows
 * (inviter, copied decks, welcome note), so it renders before the first sync. Replaced by
 * the normal home after the first review (web: FirstOpenScreen).
 */
@Composable
fun FirstOpenScreen(ui: FirstOpenUi, actions: FirstOpenActions) {
    val s = ui.state
    val tutor = s.inviter?.name?.takeIf { it.isNotBlank() } ?: "Your tutor"
    val decks = s.decks
    val words = decks.sumOf { it.note_count }
    val name = ui.userName?.trim().orEmpty()
    val ready = ui.totalDue > 0
    val subtitle = when {
        ready -> formatStudyEstimate(ui.totalDue).replaceFirstChar { it.uppercase() } + " · works offline once it starts"
        decks.isNotEmpty() && !ui.hasSyncedOnce -> if (ui.online) "Getting your words…" else "Connect to the internet once to download your words."
        decks.isNotEmpty() -> "Your cards are ready — tap to begin."
        else -> "Nothing to study yet."
    }
    LabScreen("") {
        item {
            LabCard(Modifier.testTag("first-open")) {
                Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("👋", fontSize = 48.sp)
                    Text("你好" + (if (name.isNotEmpty()) ", $name" else "") + "!", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(tutor) }
                            append(" is your tutor. ")
                            when {
                                decks.size == 1 -> {
                                    append("Your first homework is ready: ")
                                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(TutorHomework.stripFromTutorSuffix(decks[0].name)) }
                                    append(" — ${decks[0].note_count} ${if (decks[0].note_count == 1) "word" else "words"}.")
                                }
                                decks.size > 1 -> append("Your first homework is ready: ${decks.size} decks — $words words.")
                                else -> append("They haven't sent a deck yet — it will show up here as soon as they do.")
                            }
                        },
                        style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, textAlign = TextAlign.Center,
                    )
                    PrimaryPill(
                        "Start your first session",
                        Modifier.fillMaxWidth().height(56.dp),
                        enabled = ready || decks.isEmpty() || ui.hasSyncedOnce,
                    ) { actions.onStart(decks.singleOrNull()?.id) }
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
                }
            }
        }
        item {
            LabCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Two things before the train", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    CheckRow("✅", "Installed as an app", "It opens like an app and works offline.")
                    CheckRow("🔊", "Audio for your words", if (ui.hasSyncedOnce) "downloads automatically after every sync" else if (ui.online) "downloads automatically" else "downloads when you are online")
                }
            }
        }
        s.welcome_message?.takeIf { it.isNotBlank() }?.let { msg ->
            item {
                LabCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.Top) {
                            Box(Modifier.size(40.dp).clip(CircleShape).background(Lab.colors.accentSoft), contentAlignment = Alignment.Center) {
                                Text(tutor.first().uppercase(), color = Lab.colors.accent, fontWeight = FontWeight.Bold)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    buildAnnotatedString {
                                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(tutor) }
                                        onboardingRelativeTime(s.redeemed_at).takeIf { it.isNotEmpty() }?.let { append(" · $it") }
                                    },
                                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                                )
                                Text(msg, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                            }
                        }
                        SecondaryPill("Reply", Modifier.fillMaxWidth()) { actions.onReply() }
                    }
                }
            }
        }
        item {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(
                    "Show the normal home",
                    color = Lab.colors.accent,
                    modifier = Modifier.clip(CircleShape).bouncyClickable(onClick = actions.onDismiss).padding(12.dp).testTag("first-open-dismiss"),
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun CheckRow(icon: String, label: String, sub: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(icon, fontSize = 20.sp)
        Spacer(Modifier.width(12.dp))
        Column {
            Text(label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
            Text(sub, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}

/**
 * The Home gate (HomeNav): the first-open screen while [showFirstOpen] holds, else [home].
 * The server answer is cached by HomeworkSync, so this renders offline and before a sync.
 */
@Composable
fun OnboardingGate(nav: LabNav, totalDue: Int, home: @Composable () -> Unit) {
    val app = nav.app
    val flow = androidx.compose.runtime.remember(app) {
        combine(
            app.cache.observe<OnboardingDto>(HomeworkKeys.ONBOARDING),
            app.cache.observe<Boolean>(HomeworkKeys.ONBOARDING_DISMISSED),
            app.repo.dataVersion,
        ) { s, d, _ -> Triple(s, d == true, withContext(Dispatchers.IO) { app.repo.dao.reviewsSince("") }) }
    }
    val data by flow.collectAsStateWithLifecycle(null)
    val sync by app.repo.status.collectAsStateWithLifecycle()
    val online by app.online.collectAsStateWithLifecycle()
    val d = data
    if (d == null || !showFirstOpen(d.first, d.second, d.third)) {
        home()
        return
    }
    val state = d.first!!
    FirstOpenScreen(
        FirstOpenUi(state, app.prefs.userName, totalDue, hasSyncedOnce = sync.lastSyncAt > 0, online = online),
        FirstOpenActions(
            onStart = { deckId -> nav.open(Routes.study(deckId)) },
            onReply = {
                val rel = state.relationship_id
                nav.open(
                    when {
                        state.welcome_conversation_id != null && rel != null -> Routes.chat(rel, state.welcome_conversation_id)
                        rel != null -> Routes.connection(rel)
                        else -> Routes.CONNECTIONS
                    },
                )
            },
            onDismiss = { app.scope.launch { app.cache.put(HomeworkKeys.ONBOARDING_DISMISSED, HomeworkKeys.ONBOARDING_KIND, true) } },
        ),
    )
}
