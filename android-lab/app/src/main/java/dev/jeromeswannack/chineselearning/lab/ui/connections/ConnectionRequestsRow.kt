package dev.jeromeswannack.chineselearning.lab.ui.connections

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.core.ChatPersonLinks
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** The requests waiting on me (requester ≠ me, never the Claude partner), for [ChatPersonLinks.requestsLine]. */
fun incomingRequests(rel: MyRelationshipsDto?, myId: String?): List<ChatPersonLinks.Request> =
    rel?.pending_incoming.orEmpty()
        .filter { r -> (myId == null || r.requester_id != myId) && r.requester_id != CLAUDE_USER_ID }
        .map { r -> ChatPersonLinks.Request(r.requester.displayName(""), r.requester_role) }

/**
 * Home's "🤝 明慧 wants to be your tutor ›" while a connection request waits on me (web
 * components/home/ConnectionRequestsBanner.tsx). Requests used to show on the Tutor tab, gone in
 * Nov 2026; a tap opens More → Tutors & connections. Reads the shell's cached relationships.
 */
@Composable
fun ConnectionRequestsHomeRow(nav: LabNav) {
    val rel by nav.app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collectAsStateWithLifecycle(null)
    val myId by produceState<String?>(null) { value = Connections.myId(nav.app.cache) }
    val requests = incomingRequests(rel, myId)
    val line = ChatPersonLinks.requestsLine(requests) ?: return
    ConnectionRequestsRow(line) {
        nav.app.analytics.track("chat.connection_requests_open", mapOf("count" to requests.size))
        nav.open(Routes.CONNECTIONS)
    }
}

/** The row itself (stateless, for screenshots): the line, a chevron, a green edge. */
@Composable
fun ConnectionRequestsRow(line: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(16.dp)).background(Lab.colors.card)
            .bouncyClickable(onClick = onClick).testTag("home-connection-requests"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(REQUEST_GREEN))
        Row(Modifier.weight(1f).heightIn(min = 48.dp).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(line, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            Text("›", fontSize = 22.sp, color = Lab.colors.muted)
        }
    }
}

private val REQUEST_GREEN = Color(0xFF16A34A)
