package dev.jeromeswannack.chineselearning.lab.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

@Composable
fun SignInScreen(error: String?, onSignIn: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("学", fontSize = 96.sp, color = Lab.colors.accent, fontWeight = FontWeight.Medium)
        Text("Chinese Learning · Lab", style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink)
        Spacer(Modifier.height(12.dp))
        Text(
            "The experimental native app. Same account, same cards — your reviews sync with the main app.",
            style = MaterialTheme.typography.bodyLarge,
            color = Lab.colors.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 420.dp),
        )
        Spacer(Modifier.height(32.dp))
        PrimaryPill("Sign in with Google", Modifier.fillMaxWidth().widthIn(max = 420.dp).height(58.dp), onClick = onSignIn)
        if (error != null) {
            Spacer(Modifier.height(16.dp))
            Text(error, color = Palette.Again, textAlign = TextAlign.Center)
        }
    }
}
