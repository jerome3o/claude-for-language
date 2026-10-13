package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.PreparedActivities
import dev.jeromeswannack.chineselearning.lab.core.calls.PreparedActivity
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.teaching.PreparedRow
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/*
 * ⋯ → 🎲 Activities, the tutor's first section: "For Jerome · from last lesson" — the activities
 * prepared for this student from their previous lessons (web: ActivityPickerSheet's
 * `prepared`; docs/VIDEO_CALLS.md "Prepared activities"). Tap starts one like a catalogue
 * activity (`activity_start { activity_id: "prepared:<id>" }`); 👁 shows what's in it.
 */

/** What the picker's prepared section shows (null on the student's side / in a solo call). */
data class PickerPreparedUi(
    val studentName: String?,
    /** Ordered (PreparedActivities.order): ready first, then used. */
    val activities: List<PreparedActivity> = emptyList(),
    val loading: Boolean = false,
    val preparing: Boolean = false,
    val canPrepare: Boolean = true,
    val error: String? = null,
)

data class PickerPreparedActions(
    val start: (PreparedActivity) -> Unit = {},
    val makeMore: () -> Unit = {},
    val previewed: (PreparedActivity) -> Unit = {},
)

@Composable
fun PreparedPickerSection(ui: PickerPreparedUi, actions: PickerPreparedActions) {
    val ready = ui.activities.filter { it.status == "ready" }
    val used = ui.activities.filter { it.status == "used" }
    val from = ready.firstOrNull()?.sourceLabel ?: used.firstOrNull()?.sourceLabel
    var openId by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(18.dp)).background(Lab.colors.accentSoft)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)).padding(10.dp).testTag("picker-prepared"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("⭐", fontSize = 20.sp)
            Column {
                Text(PreparedActivities.sectionTitle(ui.studentName), color = Lab.colors.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text((from?.let { "$it · " } ?: "") + "only you see this list", color = Lab.colors.muted, fontSize = 12.sp)
            }
        }
        if (ui.loading && ui.activities.isEmpty()) Text("Loading…", color = Lab.colors.muted, fontSize = 13.sp)
        if (!ui.loading && ui.activities.isEmpty() && !ui.preparing) {
            Text("Nothing prepared yet — activities written from your last lessons with them (new words, corrections, mix-ups).", color = Lab.colors.muted, fontSize = 13.sp)
        }
        (ready + used.take(4)).forEach { a ->
            PreparedRow(a, open = openId == a.id, onTap = { actions.start(a) }, modifier = Modifier.testTag("pick-${PreparedActivities.activityId(a.id)}")) {
                Box(
                    Modifier.width(48.dp).heightIn(min = 52.dp).bouncyClickable {
                        if (openId != a.id) actions.previewed(a)
                        openId = if (openId == a.id) null else a.id
                    },
                    contentAlignment = Alignment.Center,
                ) { Text(if (openId == a.id) "▴" else "👁", fontSize = 16.sp, color = Lab.colors.muted) }
            }
        }
        if (ui.preparing) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.heightIn(min = 44.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                Text("Preparing from the last lessons… about a minute", color = Lab.colors.muted, fontSize = 13.sp)
            }
        } else {
            SecondaryPill(
                if (ui.activities.isEmpty()) "🎲 Prepare from last lesson" else "↻ Make more",
                Modifier.testTag("picker-make-more"), enabled = ui.canPrepare, onClick = actions.makeMore,
            )
        }
        ui.error?.let { Text(it, color = Color(0xFFB91C1C), fontSize = 13.sp) }
    }
}

/** The picker's prepared section from the call's [ctl] (null until the tutor's call knows its relationship). */
@Composable
fun preparedPickerUi(ctl: dev.jeromeswannack.chineselearning.lab.ui.teaching.PreparedActivitiesController?, studentName: String?): PickerPreparedUi? {
    if (ctl == null) return null
    val state by ctl.resource.state.collectAsStateWithLifecycle()
    val error by ctl.error.collectAsStateWithLifecycle()
    val starting by ctl.starting.collectAsStateWithLifecycle()
    val job = state.data?.job
    return PickerPreparedUi(
        studentName = studentName,
        activities = PreparedActivities.order(state.data?.activities.orEmpty()),
        loading = state.loading,
        preparing = PreparedActivities.jobActive(job),
        canPrepare = state.data?.can_prepare != false && !starting,
        error = error ?: job?.takeIf { it.status == "failed" }?.let { "The last try failed — try again." },
    )
}
