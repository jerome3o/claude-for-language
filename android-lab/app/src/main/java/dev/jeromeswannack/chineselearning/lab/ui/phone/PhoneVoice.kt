package dev.jeromeswannack.chineselearning.lab.ui.phone

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationController
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation

/**
 * The 🎤 of a search box / chat input (web ui.tsx `PhoneMic`): dictation into the field in
 * Chinese with the kit's voice engine (`rememberVoiceDictation`, auto-submit), the live words in a
 * "正在听…" card over the phone ([PhoneVoiceOverlay], drawn by the shell).
 */
@Composable
fun PhoneMic(tag: String? = null, label: String = "语音输入", onText: (String) -> Unit) {
    val p = LocalPhone.current
    val context = LocalContext.current
    val d = rememberVoiceDictation("phone", lang = "zh", defaultMode = VoiceDictation.VOICE, autoSubmit = true)
    fun start() {
        d.onSubmit = { a ->
            p.voice = null
            if (a.text.isNotBlank()) onText(a.text.trim())
        }
        p.voice = d
        d.say()
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) start() else p.toast("无法使用麦克风，请检查权限设置")
    }
    Box(
        Modifier.size(36.dp).clickable {
            if (!p.online) return@clickable p.toast("网络不可用，语音输入暂时无法使用")
            val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            if (granted) start() else runCatching { permission.launch(Manifest.permission.RECORD_AUDIO) }.onFailure { p.toast("无法使用麦克风，请检查权限设置") }
        }.then(if (tag != null) Modifier.testTag(tag) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Text("🎤", fontSize = 18.sp) }
}

/** The "正在听…" card over the whole phone while a 🎤 take runs. */
@Composable
fun BoxScope.PhoneVoiceOverlay(p: PhoneRuntime) {
    val d: VoiceDictationController = p.voice ?: return
    val ui by d.ui.collectAsState()
    PhoneBackHandler(true) { d.cancel(); p.voice = null }
    LaunchedEffect(ui.phase) {
        if (ui.phase == "failed") {
            p.toast("没听清，请再说一遍")
            d.cancel()
            p.voice = null
        }
    }
    Box(Modifier.matchParentSize().background(Color(0x59000000)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.testTag("phone-voice"), contentAlignment = Alignment.BottomCenter) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp)).background(Color.White).padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🎤", fontSize = 34.sp, modifier = Modifier.scale(if (ui.phase == "listening") 1.15f else 1f))
        val text = when {
            ui.finalText.isNotEmpty() || ui.partialText.isNotEmpty() -> buildAnnotatedString {
                append(ui.finalText)
                withStyle(SpanStyle(color = Color(0xFF9AA0A8))) { append(ui.partialText) }
            }
            ui.phase == "finishing" -> buildAnnotatedString { append("识别中…") }
            else -> buildAnnotatedString { append(ZH.voiceListening) }
        }
        Text(text, fontSize = 18.sp, color = PC.dark, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).border(1.dp, Color(0xFFDDDDDD), RoundedCornerShape(22.dp)).clickable { d.cancel(); p.voice = null },
                contentAlignment = Alignment.Center,
            ) { Text(ZH.cancel, fontSize = 15.sp, color = PC.ink) }
            val listening = ui.phase == "listening"
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(PC.green).alpha(if (listening) 1f else 0.5f).clickable(enabled = listening) { d.stop() },
                contentAlignment = Alignment.Center,
            ) { Text(ZH.voiceTapToStop, fontSize = 15.sp, color = Color.White) }
        }
    }
    }
}
