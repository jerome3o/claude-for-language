package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.StudyDayClock
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import java.time.ZoneId
import kotlin.test.assertEquals

/** Settings → Study → "New day starts at" (DayRolloverSettings.kt) + the clock every "today" reads. */
class DayRolloverScreenshots : LabScreenshotTest() {
    @Test fun setting() = shoot("day-rollover-01-setting") {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DayRolloverSettingsView(hour = 4) {}
            DayRolloverSettingsView(hour = 0) {}
        }
    }

    @Test fun clockFollowsTheHour() {
        val london = ZoneId.of("Europe/London")
        val at0130 = java.time.Instant.parse("2026-11-11T01:30:00Z").toEpochMilli()
        val before = StudyDayClock.hour.value
        try {
            StudyDayClock.hour.value = 4
            assertEquals("2026-11-10", StudyDayClock.todayKey(at0130, london))
            assertEquals(java.time.Instant.parse("2026-11-10T04:00:00Z").toEpochMilli(), StudyDayClock.dayStart(at0130, london))
            assertEquals(java.time.Instant.parse("2026-11-11T03:59:59.999Z").toEpochMilli(), StudyDayClock.cutoff(at0130, london).ts)
            StudyDayClock.hour.value = 0
            assertEquals("2026-11-11", StudyDayClock.todayKey(at0130, london))
        } finally {
            StudyDayClock.hour.value = before
        }
    }
}
