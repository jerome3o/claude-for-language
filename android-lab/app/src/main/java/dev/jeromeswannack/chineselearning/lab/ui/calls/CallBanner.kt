package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.core.calls.CallAlerts
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules

enum class CallBannerVariant { TOP, CARD, INLINE }

private val Incoming = Brush.linearGradient(listOf(Color(0xFF15803D), Color(0xFF0F766E)))
private val Quiet = Brush.linearGradient(listOf(Color(0xFF0F5132), Color(0xFF0F5132)))

/** "📹 王老师 is calling — Join" (web: components/calls/CallBanner.tsx). Stateless, for screenshots. */
@Composable
fun CallBannerView(banner: CallAlerts.Banner, variant: CallBannerVariant, onJoin: () -> Unit, onDismiss: (() -> Unit)?, modifier: Modifier = Modifier) {
    val incoming = banner.kind == CallAlerts.Kind.INCOMING
    val wiggle = rememberInfiniteTransition(label = "wiggle")
    val angle by wiggle.animateFloat(
        0f, 0f,
        infiniteRepeatable(keyframes { durationMillis = 1600; 0f at 0; -12f at 160; 12f at 320; -12f at 480; 12f at 640; -12f at 800; 0f at 960 }, RepeatMode.Restart),
        label = "angle",
    )
    val card = variant == CallBannerVariant.CARD
    Row(
        modifier
            .fillMaxWidth()
            .then(if (variant == CallBannerVariant.TOP) Modifier.widthIn(max = 560.dp).shadow(12.dp, RoundedCornerShape(16.dp)) else Modifier)
            .clip(RoundedCornerShape(if (card) 20.dp else 16.dp))
            .background(if (incoming) Incoming else Quiet)
            .heightIn(min = if (card) 76.dp else 56.dp)
            .padding(start = 14.dp, end = 6.dp, top = if (card) 14.dp else 6.dp, bottom = if (card) 14.dp else 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("📹", fontSize = if (card) 30.sp else 22.sp, modifier = Modifier.rotate(if (incoming) angle else 0f))
        Column(Modifier.weight(1f)) {
            Text(banner.title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = if (card) 19.sp else 16.sp, maxLines = if (card) 2 else 1, overflow = TextOverflow.Ellipsis)
            if (card) Text(if (incoming) "Video lesson — tap Join to go straight in." else "The call is still open.", color = Color.White.copy(alpha = 0.85f), fontSize = 14.sp)
        }
        Text(
            banner.action, color = Color(0xFF166534), fontWeight = FontWeight.Bold, fontSize = 16.sp, textAlign = TextAlign.Center,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color.White).bouncyClickable(onClick = onJoin).heightIn(min = 44.dp).widthIn(min = 76.dp).padding(horizontal = 18.dp, vertical = 11.dp),
        )
        if (onDismiss != null) Text("✕", color = Color.White.copy(alpha = 0.8f), fontSize = 16.sp, textAlign = TextAlign.Center, modifier = Modifier.size(44.dp).bouncyClickable(onClick = onDismiss).padding(top = 11.dp))
    }
}

/** This relationship's live call as a banner (from the app-wide list), or null. */
@Composable
fun relationshipCallBanner(nav: LabNav, relationshipId: String, path: String): CallAlerts.Banner? {
    val alerts = nav.app.callAlerts
    val calls by alerts.live.collectAsStateWithLifecycle()
    val me by alerts.myId.collectAsStateWithLifecycle()
    if (me.isEmpty()) return null
    return CallAlerts.pickCallBanner(calls, me, path, System.currentTimeMillis(), emptySet(), relationshipId)
}

/** The inline banner the student / tutor pages draw from their own state. */
@Composable
fun InlineCallBanner(callId: String, title: String?, incoming: Boolean, onJoin: () -> Unit) {
    CallBannerView(
        CallAlerts.Banner(callId, null, if (incoming) CallAlerts.Kind.INCOMING else CallAlerts.Kind.REJOIN, title ?: "Video call in progress", if (incoming) "Join" else "Rejoin", "/calls/$callId", null),
        CallBannerVariant.INLINE, onJoin = onJoin, onDismiss = null,
    )
}

/** The banner for the live call to announce here — optionally only one relationship's. */
@Composable
fun LiveCallBanner(nav: LabNav, variant: CallBannerVariant, path: String, relationshipId: String? = null, modifier: Modifier = Modifier) {
    val alerts = nav.app.callAlerts
    val calls by alerts.live.collectAsStateWithLifecycle()
    val dismissed by alerts.dismissed.collectAsStateWithLifecycle()
    val me by alerts.myId.collectAsStateWithLifecycle()
    if (me.isEmpty()) return
    val dismissible = variant != CallBannerVariant.INLINE
    val banner = CallAlerts.pickCallBanner(calls, me, path, System.currentTimeMillis(), if (dismissible) dismissed else emptySet(), relationshipId) ?: return
    CallBannerView(
        banner, variant,
        onJoin = { alerts.stopRinging(); nav.app.haptics.tick(); nav.open(banner.url) },
        onDismiss = if (dismissible) ({ alerts.dismiss(banner.callId) }) else null,
        modifier = modifier,
    )
}

/**
 * The bar across the top of every normal screen (web: CallAlerts.tsx) — not on full-screen
 * routes, not on Home or that relationship's page (they show their own banner).
 */
@Composable
fun CallTopBar(nav: LabNav, path: String) {
    if (NavRules.isImmersiveRoute(path) || path == "/") return
    val alerts = nav.app.callAlerts
    val calls by alerts.live.collectAsStateWithLifecycle()
    val dismissed by alerts.dismissed.collectAsStateWithLifecycle()
    val me by alerts.myId.collectAsStateWithLifecycle()
    if (me.isEmpty()) return
    val banner = CallAlerts.pickCallBanner(calls, me, path, System.currentTimeMillis(), dismissed) ?: return
    val rel = banner.relationshipId
    if (rel != null && (path == "/connections/$rel" || path.startsWith("/connections/$rel/"))) return
    Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = 8.dp, vertical = 6.dp), contentAlignment = Alignment.TopCenter) {
        CallBannerView(
            banner, CallBannerVariant.TOP,
            onJoin = { alerts.stopRinging(); nav.app.haptics.tick(); nav.open(banner.url) },
            onDismiss = { alerts.dismiss(banner.callId) },
        )
    }
}
