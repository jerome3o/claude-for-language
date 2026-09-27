package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.FontWeight
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * A calendar for a 'YYYY-MM-DD' day (the web's `<input type="date" min={today}>`). The
 * Material picker works in UTC midnights, so no local-zone maths leaks into the date.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DatePickerSheet(initial: String, minDate: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val min = minDate?.let { LocalDate.parse(it) }
    val start = runCatching { LocalDate.parse(initial) }.getOrDefault(LocalDate.now())
    val state = rememberDatePickerState(
        initialSelectedDateMillis = start.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli(),
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                if (min == null) return true
                return !Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate().isBefore(min)
            }
        },
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) } ?: onDismiss()
            }) { Text("OK", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = Lab.colors.muted) } },
        colors = DatePickerDefaults.colors(containerColor = Lab.colors.card),
    ) {
        DatePicker(state = state, showModeToggle = false)
    }
}
