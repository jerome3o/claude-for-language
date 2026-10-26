package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH

/*
 * Chats with the people inside the simulated apps (web persona.tsx): the transcript lives in the
 * event log (`persona.message`), replies come from POST /api/phone/persona-reply (Claude playing the
 * persona), the actions a reply carries become `persona.action` events the goals check. Offline →
 * the message waits with "对方暂时无法回复（需要联网）" and 重试.
 */

/** One of their bubbles: tap 译 for the English (stored with the message). */
@Composable
fun TheirBubble(line: ChatLine, avatar: String = "人", color: Color = Color(0xFF9AA5B1)) {
    var en by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(34.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
            Text(avatar, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.widthIn(max = 290.dp)) {
            Box(Modifier.clip(RoundedCornerShape(12.dp)).background(Color.White).padding(horizontal = 12.dp, vertical = 9.dp)) {
                PText(line.text, size = 15.sp, lineHeight = 22.sp)
            }
            if (line.english != null) {
                Box(Modifier.heightIn(min = 24.dp).clickable { en = !en }.padding(horizontal = 4.dp, vertical = 2.dp).testTag("persona-translate")) {
                    Text(if (en) line.english else "译", fontSize = 12.sp, color = PC.muted)
                }
            }
        }
    }
}

@Composable
fun MyBubble(text: String, color: Color) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.End) {
        Box(Modifier.widthIn(max = 290.dp).clip(RoundedCornerShape(12.dp)).background(color).padding(horizontal = 12.dp, vertical = 9.dp)) {
            PText(text, size = 15.sp, color = Color.White, lineHeight = 22.sp)
        }
    }
}

/** "对方正在输入…" / the offline line with 重试. */
@Composable
fun PersonaStatus(p: PhoneRuntime, personaId: String?, context: String?) {
    if (personaId == null) return
    if (p.personaPending[personaId] == true) Text("对方正在输入…", fontSize = 12.sp, color = Color(0xFF999999), modifier = Modifier.padding(horizontal = 42.dp, vertical = 6.dp))
    val err = p.personaError[personaId]
    if (err != null) {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFFDECEA)).padding(horizontal = 10.dp, vertical = 8.dp).testTag("persona-error"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PText(if (err == "offline") ZH.needsConnection else "消息发送失败", size = 12.sp, color = Color(0xFFC0392B), modifier = Modifier.weight(1f))
            Box(
                Modifier.heightIn(min = 30.dp).clip(RoundedCornerShape(12.dp)).background(Color.White).border(1.dp, Color(0xFFE3B4AE), RoundedCornerShape(12.dp)).clickable { p.personaRetry(personaId, context) }.padding(horizontal = 10.dp).testTag("persona-retry"),
                contentAlignment = Alignment.Center,
            ) { PText("重试", size = 12.sp) }
        }
    }
}

/** The chat screen of the ride / food / restaurant apps (web `AppChat`). */
@Composable
fun AppChat(
    personaId: String,
    title: String,
    subtitle: String? = null,
    context: String? = null,
    quick: List<String> = emptyList(),
    accent: Color,
    avatar: String = "人",
    onBack: () -> Unit,
    tag: String = "persona-chat",
    tip: String = "为保护隐私，号码已加密，聊天内容仅在订单进行中可见",
) {
    val p = LocalPhone.current
    var draft by remember { mutableStateOf("") }
    val lines = p.personaLines(personaId).filter { !it.system }
    LaunchedEffect(personaId) { p.personaStart(personaId) }
    val list = rememberLazyListState()
    val count = lines.size + (if (p.personaPending[personaId] == true) 1 else 0) + (if (p.personaError[personaId] != null) 1 else 0)
    LaunchedEffect(count) { list.scrollToItem(maxOf(0, count + 1)) }
    fun send(via: String = "typed", text: String = draft) {
        if (text.isBlank()) return
        p.personaSend(personaId, text, via, context)
        draft = ""
    }
    PScreen(tag, bg = Color(0xFFF2F3F5)) {
        PColumn {
            PBar(title, onBack = onBack, subtitle = subtitle)
            LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 10.dp), state = list) {
                item { PText(tip, size = 11.sp, color = Color(0xFFA0A5AD), align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 10.dp)) }
                itemsIndexed(lines) { _, l -> if (l.from == "me") MyBubble(l.text, accent) else TheirBubble(l, avatar, accent) }
                item { PersonaStatus(p, personaId, context) }
            }
            if (quick.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (q in quick) {
                        Box(
                            Modifier.heightIn(min = 30.dp).clip(RoundedCornerShape(14.dp)).background(Color.White).border(1.dp, PC.chipBorder, RoundedCornerShape(14.dp)).clickable { send("quick", q) }.padding(horizontal = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) { PText(q, size = 13.sp) }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().background(Color.White).hairline(PC.line, top = true).padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PhoneMic(tag = "persona-mic") { t -> draft += t }
                Box(Modifier.weight(1f).heightIn(min = 38.dp).clip(RoundedCornerShape(18.dp)).border(1.dp, PC.chipBorder, RoundedCornerShape(18.dp)).padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) {
                    PInput(draft, { draft = it }, "输入消息…", Modifier.fillMaxWidth(), tag = "persona-input", imeAction = ImeAction.Send, onSubmit = { send() })
                }
                Box(
                    Modifier.heightIn(min = 38.dp).clip(RoundedCornerShape(18.dp)).background(if (draft.isNotBlank()) accent else Color(0xFFCCCCCC)).clickable(enabled = draft.isNotBlank()) { send() }.padding(horizontal = 14.dp).testTag("persona-send"),
                    contentAlignment = Alignment.Center,
                ) { PText("发送", size = 14.sp, color = Color.White) }
            }
        }
    }
}
