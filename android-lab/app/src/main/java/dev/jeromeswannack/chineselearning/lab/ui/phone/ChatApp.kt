package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.ChatContact
import dev.jeromeswannack.chineselearning.lab.core.phone.ChatMe
import dev.jeromeswannack.chineselearning.lab.core.phone.ChatWorld
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneRail
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneWallet
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/*
 * 微聊 (web apps/ChatApp.tsx) — the chat list, a chat (text, 🎤 voice-to-text, ⊕ panel: 转账 / 红包 /
 * 位置…), sending 转账 with a 转账说明, opening a friend's 红包 (開), 扫一扫 a stall's 收款码 and paying,
 * 发现 → 小程序 that open the other apps. A contact with a persona answers; others don't.
 */

private const val APP = "chat"
private val GREEN = Color(0xFF19A356)
private val WX_BG = Color(0xFFEDEDED)
private val ME_BUBBLE = Color(0xFF95EC69)
private val ME_COLOR = Color(0xFF5C6BC0)

@Composable
private fun world(): ChatWorld = LocalPhone.current.spec.world.chat ?: ChatWorld(ChatMe("我", "me"), emptyList(), emptyList())

private fun contactOf(w: ChatWorld, id: String): ChatContact = w.contacts.firstOrNull { it.id == id } ?: ChatContact(id, id)

@Composable
fun ChatAvatar(name: String, color: String? = null, initial: String? = null, size: Dp = 40.dp, colorValue: Color? = null) {
    Box(Modifier.size(size).clip(RoundedCornerShape(6.dp)).background(colorValue ?: PC.hex(color)), contentAlignment = Alignment.Center) {
        Text(initial ?: name.take(1), color = Color.White, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Avatar(c: ChatContact, size: Dp = 40.dp) = ChatAvatar(c.name, c.color, c.initial, size)

@Composable
fun ChatApp(screen: PhoneScreen) {
    when (screen.name) {
        "chat" -> ChatWindow(screen.p("contact"))
        "transfer" -> MoneyForm(screen.p("contact"), "transfer")
        "red_packet" -> MoneyForm(screen.p("contact"), "red_packet")
        "scan" -> Scan()
        "qr_pay" -> QrPay(screen.p("qr"))
        "qr_contact" -> QrContact(screen.p("qr"))
        "mini" -> MiniPrograms()
        else -> ChatHome()
    }
}

private data class Row(
    val key: String,
    val at: Long,
    val from: String,
    val kind: String,
    val text: String? = null,
    val english: String? = null,
    val amount: Double? = null,
    val app: String? = null,
    val time: String? = null,
    val opened: Boolean? = null,
    val seedIndex: Int? = null,
)

private fun rows(p: PhoneRuntime, w: ChatWorld, contactId: String): List<Row> {
    val c = contactOf(w, contactId)
    val thread = w.threads.firstOrNull { it.contact == contactId }
    val opened = p.recordsOf("red_packet_opened").map { it.id }.toSet()
    val out = (thread?.messages ?: emptyList()).mapIndexed { i, m ->
        Row(
            "seed$i", (i - 1000).toLong(), m.from, m.kind ?: "text", m.text, null, m.amount, m.app, m.time,
            if (m.kind == "red_packet") "$contactId-$i" in opened || m.opened == true else null, i,
        )
    }.toMutableList()
    for (e in p.events) {
        val type = PhoneEngine.type(e)
        if (type == "chat.message" && PhoneJs.sOrNull(e, "contact") == contactId) out.add(Row("e${PhoneEngine.at(e)}${out.size}", PhoneEngine.at(e), "me", "text", PhoneJs.s(e, "text")))
        if (c.persona != null && type == "persona.message" && PhoneJs.sOrNull(e, "persona") == c.persona && (e["system"] as? JsonPrimitive)?.booleanOrNull != true) {
            out.add(Row("p${PhoneEngine.at(e)}${out.size}", PhoneEngine.at(e), if (PhoneJs.sOrNull(e, "from") == "me") "me" else "them", "text", PhoneJs.s(e, "text"), PhoneJs.sOrNull(e, "english")))
        }
    }
    for (r in p.recordsOf("transfer")) {
        if (PhoneJs.sOrNull(r.data, "to_id") == contactId) {
            out.add(Row("t${r.id}", r.at, "me", if (PhoneJs.sOrNull(r.data, "kind") == "red_packet") "red_packet" else "transfer", PhoneJs.sOrNull(r.data, "note") ?: "", amount = PhoneJs.n(r.data, "amount")))
        }
    }
    return out.sortedBy { it.at }
}

@Composable
private fun ChatHome() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val tab = p.getState(APP, "tab", "chats")
    var menu by remember { mutableStateOf(false) }
    val read = p.events.filter { PhoneEngine.type(it) == "chat.read" }.map { PhoneJs.s(it, "contact") }.toSet()
    val unread = w.threads.filter { it.contact !in read }.sumOf { it.unread ?: 0 }
    fun open(contact: String) {
        p.emit("chat.read", mapOf("contact" to contact))
        nav.push("chat", "contact" to contact)
    }
    val threads = w.threads.sortedBy { if (it.pinned) 0 else 1 }
    fun lastText(contact: String): String {
        val m = w.threads.firstOrNull { it.contact == contact }?.messages?.lastOrNull() ?: return ""
        return when (m.kind) {
            "red_packet" -> "[红包] " + (m.text ?: "恭喜发财，大吉大利")
            "transfer" -> "[转账]"
            "mini_program" -> "[小程序] " + (m.text ?: "")
            else -> m.text ?: ""
        }
    }
    @Composable
    fun WxBar(title: String, right: (@Composable () -> Unit)? = null) {
        Row(Modifier.fillMaxWidth().heightIn(min = 46.dp).background(WX_BG).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(80.dp))
            PText(title, size = 17.sp, weight = FontWeight.SemiBold, align = TextAlign.Center, modifier = Modifier.weight(1f))
            Row(Modifier.width(80.dp), horizontalArrangement = Arrangement.End) { right?.invoke() }
        }
    }
    PScreen("chat-home", bg = WX_BG) {
        PColumn {
            when (tab) {
                "chats" -> {
                    WxBar("微聊${if (unread > 0) "($unread)" else ""}") {
                        PBarButton("🔍") { p.toast("搜索：暂未开放") }
                        PBarButton("⊕", tag = "chat-plus") { menu = !menu }
                    }
                    PBody(bg = Color.White) {
                        for (t in threads) {
                            val c = contactOf(w, t.contact)
                            val n = if (t.contact in read) 0 else t.unread ?: 0
                            Row(
                                Modifier.fillMaxWidth().background(if (t.pinned) Color(0xFFF7F7F7) else Color.White).tap { open(t.contact) }.hairline().padding(horizontal = 14.dp, vertical = 11.dp).testTag("chat-row-${t.contact}"),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Box {
                                    Avatar(c, 44.dp)
                                    if (n > 0) Badge(n, Modifier.align(Alignment.TopEnd))
                                }
                                Column(Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        PText(c.name, size = 16.sp, modifier = Modifier.weight(1f), maxLines = 1)
                                        PText(t.messages.lastOrNull()?.time ?: "", size = 11.sp, color = Color(0xFFB2B2B2))
                                    }
                                    PText(lastText(t.contact), size = 13.sp, color = Color(0xFF999999), maxLines = 1)
                                }
                            }
                        }
                    }
                }
                "contacts" -> PBody {
                    WxBar("通讯录")
                    PGroup { for (c in w.contacts) PCell(c.name, arrow = false, iconContent = { Avatar(c, 36.dp) }, tag = "chat-contact-${c.id}", onClick = { open(c.id) }) }
                }
                "discover" -> PBody {
                    WxBar("发现")
                    PGroup { PCell("朋友圈", icon = "🌈", onClick = { p.toast(ZH.notOpen) }) }
                    PGroup {
                        PCell("扫一扫", icon = "⌗", tag = "chat-discover-scan", onClick = { nav.push("scan") })
                        PCell("摇一摇", icon = "〰", onClick = { p.toast(ZH.notOpen) })
                    }
                    PGroup { PCell("小程序", icon = "▦", tag = "chat-mini", onClick = { nav.push("mini") }) }
                }
                else -> PBody {
                    Row(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 20.dp, vertical = 30.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        ChatAvatar(w.me.name, size = 60.dp, colorValue = ME_COLOR)
                        Column {
                            PText(w.me.name, size = 20.sp, weight = FontWeight.Bold)
                            PText("微聊号：${w.me.id}", size = 13.sp, color = PC.muted)
                        }
                    }
                    PGroup { PCell("服务", icon = "💴", onClick = { p.openApp("wallet") }) }
                    PGroup {
                        PCell("收藏", icon = "⭐", onClick = { p.toast(ZH.notOpen) })
                        PCell("设置", icon = "⚙", onClick = { p.toast(ZH.notOpen) })
                    }
                }
            }
            PTabBar(
                listOf(Triple("chats", "微聊", "💬"), Triple("contacts", "通讯录", "👥"), Triple("discover", "发现", "🧭"), Triple("me", "我", "👤")),
                tab, GREEN, "chat", bg = Color(0xFFF7F7F7), badge = { if (it == "chats") unread else 0 },
            ) { p.setState(APP, "tab", it) }
        }
        if (menu && tab == "chats") {
            Box(Modifier.fillMaxSize().tap { menu = false })
            Column(Modifier.align(Alignment.TopEnd).padding(top = 46.dp, end = 8.dp).width(160.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF4C4C4C)).testTag("chat-plus-menu")) {
                for ((label, tag, action) in listOf<Triple<String, String?, () -> Unit>>(
                    Triple("💬 发起群聊", null) { p.toast(ZH.notOpen) },
                    Triple("👤 添加朋友", null) { p.toast(ZH.notOpen) },
                    Triple("⌗ 扫一扫", "chat-scan") { nav.push("scan") },
                    Triple("💴 收付款", null) { p.openApp("wallet") },
                )) {
                    Box(Modifier.fillMaxWidth().heightIn(min = 46.dp).tap { menu = false; action() }.padding(horizontal = 14.dp).then(if (tag != null) Modifier.testTag(tag) else Modifier), contentAlignment = Alignment.CenterStart) {
                        PText(label, color = Color.White, size = 15.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatWindow(contactId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val c = contactOf(w, contactId)
    val rows = rows(p, w, contactId)
    var draft by remember { mutableStateOf("") }
    var panel by remember { mutableStateOf(false) }
    var packet by remember { mutableStateOf<Row?>(null) }
    PhoneBackHandler(panel) { panel = false }
    LaunchedEffect(c.persona) { p.personaStart(c.persona) }
    val list = rememberLazyListState()
    val pending = c.persona != null && p.personaPending[c.persona] == true
    val error = c.persona?.let { p.personaError[it] }
    LaunchedEffect(rows.size, pending, error) { list.scrollToItem(maxOf(0, rows.size + 1)) }
    fun send(via: String = "typed") {
        val t = draft.trim()
        if (t.isEmpty()) return
        draft = ""
        if (c.persona != null) p.personaSend(c.persona, t, via) else p.emit("chat.message", mapOf("contact" to contactId, "text" to t))
    }
    PScreen("chat-window-$contactId", bg = WX_BG) {
        PColumn {
            PBar(c.name, onBack = nav::pop, right = { PBarButton("⋯") { p.toast(ZH.notOpen) } })
            LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 10.dp), state = list) {
                items(rows.size) { i ->
                    val r = rows[i]
                    MessageRow(if (r.time != null && rows.getOrNull(i - 1)?.time == r.time) r.copy(time = null) else r, c, w.me.name, onPacket = { packet = r }, onMini = { p.openApp(it) })
                }
                item { PersonaStatus(p, c.persona, null) }
            }
            Row(Modifier.fillMaxWidth().background(Color(0xFFF7F7F7)).hairline(PC.line, top = true).padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PhoneMic(tag = "chat-mic") { t -> draft += t }
                Box(Modifier.weight(1f).heightIn(min = 40.dp).clip(RoundedCornerShape(6.dp)).background(Color.White).padding(horizontal = 10.dp), contentAlignment = Alignment.CenterStart) {
                    PInput(draft, { draft = it; panel = false }, "", Modifier.fillMaxWidth(), tag = "chat-input", imeAction = ImeAction.Send, onSubmit = { send() })
                }
                if (draft.isNotBlank()) {
                    Box(Modifier.heightIn(min = 38.dp).clip(RoundedCornerShape(6.dp)).background(GREEN).tap { send() }.padding(horizontal = 14.dp).testTag("chat-send"), contentAlignment = Alignment.Center) {
                        PText("发送", color = Color.White, weight = FontWeight.SemiBold)
                    }
                } else {
                    Box(Modifier.size(40.dp).tap { panel = !panel }.testTag("chat-panel-toggle"), contentAlignment = Alignment.Center) { Text("⊕", fontSize = 26.sp, color = Color(0xFF333333)) }
                }
            }
            if (panel) {
                val items = listOf("相册" to "🖼", "拍摄" to "📷", "视频通话" to "📹", "位置" to "📍", "红包" to "🧧", "转账" to "💱", "语音输入" to "🎙", "收藏" to "⭐")
                Column(Modifier.fillMaxWidth().background(Color(0xFFF7F7F7)).padding(vertical = 14.dp).testTag("chat-panel")) {
                    for (row in items.chunked(4)) {
                        Row(Modifier.fillMaxWidth()) {
                            for ((label, icon) in row) {
                                Column(
                                    Modifier.weight(1f).tap {
                                        panel = false
                                        when (label) {
                                            "转账" -> nav.push("transfer", "contact" to contactId)
                                            "红包" -> nav.push("red_packet", "contact" to contactId)
                                            else -> p.toast(ZH.notOpen)
                                        }
                                    }.padding(vertical = 8.dp).testTag("chat-panel-$label"),
                                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Box(Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(Color.White), contentAlignment = Alignment.Center) { Text(icon, fontSize = 26.sp) }
                                    PText(label, size = 12.sp, color = PC.value)
                                }
                            }
                        }
                    }
                }
            }
        }
        packet?.let { RedPacketOpen(c, it) { packet = null } }
    }
}

@Composable
private fun MessageRow(r: Row, c: ChatContact, meName: String, onPacket: () -> Unit, onMini: (String) -> Unit) {
    var en by remember { mutableStateOf(false) }
    val mine = r.from == "me"
    if (r.time != null) PText(r.time, size = 12.sp, color = Color(0xFFB2B2B2), align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
    Row(
        Modifier.fillMaxWidth().padding(vertical = 7.dp).testTag(if (mine) "chat-msg-me" else "chat-msg-them"),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        if (!mine) { Avatar(c, 36.dp); Box(Modifier.width(8.dp)) }
        Box(Modifier.weight(1f, fill = false)) {
            when (r.kind) {
                "transfer" -> MoneyBubble("⇄", "¥${PhoneDates.yuan2(r.amount ?: 0.0)}", r.text?.ifEmpty { null } ?: if (mine) "转账给${c.name}" else "转账给你", "微聊转账", Color(0xFFF79C3C), "chat-transfer-bubble")
                "red_packet" -> Box(Modifier.tap(!mine && r.opened != true, onPacket)) {
                    MoneyBubble("🧧", r.text?.ifEmpty { null } ?: "恭喜发财，大吉大利", if (r.opened == true) "已领取" else null, "微聊红包", if (r.opened == true) Color(0xFFF3C8A0) else Color(0xFFF35543), "chat-red-packet")
                }
                "mini_program" -> Column(
                    Modifier.width(220.dp).clip(RoundedCornerShape(6.dp)).background(Color.White).tap { r.app?.let(onMini) }.padding(10.dp).testTag("chat-mini-card"),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    PText(r.app?.let { PhoneCopy.app(it).name } ?: "小程序", size = 12.sp, color = PC.muted)
                    PText(r.text ?: "", weight = FontWeight.SemiBold)
                    Hr()
                    PText("▦ 小程序", size = 11.sp, color = PC.muted)
                }
                else -> Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(if (mine) ME_BUBBLE else Color.White).padding(horizontal = 11.dp, vertical = 9.dp)) {
                        PText(r.text ?: "", size = 16.sp, lineHeight = 23.sp)
                    }
                    if (!mine && r.english != null) {
                        Box(Modifier.heightIn(min = 24.dp).tap { en = !en }.padding(horizontal = 4.dp, vertical = 2.dp).testTag("persona-translate")) {
                            Text(if (en) r.english else "译", fontSize = 12.sp, color = PC.muted)
                        }
                    }
                }
            }
        }
        if (mine) { Box(Modifier.width(8.dp)); ChatAvatar(meName, size = 36.dp, colorValue = ME_COLOR) }
    }
}

@Composable
private fun MoneyBubble(icon: String, title: String, sub: String?, foot: String, bg: Color, tag: String) {
    Column(Modifier.width(230.dp).clip(RoundedCornerShape(6.dp)).background(bg).testTag(tag)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(icon, fontSize = 26.sp, color = Color.White)
            Column {
                PText(title, color = Color.White, size = 15.sp, weight = FontWeight.SemiBold, maxLines = 1)
                if (sub != null) PText(sub, color = Color.White, size = 12.sp, maxLines = 1)
            }
        }
        PText(foot, size = 11.sp, color = Color.White.copy(alpha = 0.85f), modifier = Modifier.fillMaxWidth().background(Color.White.copy(alpha = 0.15f)).padding(horizontal = 12.dp, vertical = 4.dp))
    }
}

@Composable
private fun BoxScope.RedPacketOpen(contact: ChatContact, row: Row, onClose: () -> Unit) {
    val p = LocalPhone.current
    var opened by remember { mutableStateOf(false) }
    PhoneBackHandler(true, onClose)
    val id = "${contact.id}-${row.seedIndex ?: 0}"
    Box(Modifier.fillMaxSize().background(Color(0x99000000)).tap(onClick = onClose).testTag("red-packet-sheet"), contentAlignment = Alignment.Center) {
        Column(
            Modifier.width(280.dp).heightIn(min = 400.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFE5513F)).tap { }.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Avatar(contact, 44.dp)
            PText("${contact.name}发出的红包", color = Color(0xFFFCE3B4), size = 15.sp)
            PText(row.text?.ifEmpty { null } ?: "恭喜发财，大吉大利", color = Color(0xFFFCE3B4), size = 20.sp, weight = FontWeight.SemiBold, align = TextAlign.Center)
            Box(Modifier.heightIn(min = 30.dp))
            if (opened) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.testTag("red-packet-amount")) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        PText(PhoneDates.yuan2(row.amount ?: 0.0), color = Color(0xFFFCE3B4), size = 40.sp, weight = FontWeight.Bold)
                        PText("元", color = Color(0xFFFCE3B4), size = 14.sp)
                    }
                    PText("已存入零钱，可直接消费", color = Color(0xFFFCE3B4), size = 12.sp)
                }
            } else {
                Box(
                    Modifier.size(90.dp).clip(CircleShape).background(Color(0xFFEBCD9A)).tap {
                        opened = true
                        val amount = row.amount ?: 0.0
                        p.write("red_packet_opened", id, "from_id" to contact.id, "amount" to amount)
                        p.write("payment", p.newId("payment", "P"), "app" to APP, "title" to "${contact.name}的红包", "payee" to contact.name, "amount" to amount, "method" to "balance", "direction" to "in", "status" to "paid")
                    }.testTag("red-packet-open"),
                    contentAlignment = Alignment.Center,
                ) { Text("開", fontSize = 36.sp, color = Color(0xFF333333), fontWeight = FontWeight.Bold) }
            }
        }
    }
}

/** The amount pad (转账 / 红包 / 付款). */
@Composable
fun AmountPad(value: String, onChange: (String) -> Unit) {
    Box(Modifier.testTag("amount-keypad")) {
        Keypad(listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"), "amount-") { onChange(PhoneWallet.amountKey(value, it)) }
    }
}

@Composable
private fun AmountBox(label: String, amount: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(10.dp)).background(Color.White).padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PText(label, size = 13.sp, color = PC.value)
        Row(Modifier.fillMaxWidth().hairline().padding(vertical = 8.dp).testTag("money-amount"), verticalAlignment = Alignment.Bottom) {
            PText("¥", size = 26.sp, weight = FontWeight.Bold)
            PText(amount.ifEmpty { "0.00" }, size = 38.sp, weight = FontWeight.Bold, color = if (amount.isEmpty()) PC.ph else PC.dark, modifier = Modifier.padding(start = 6.dp))
        }
        content()
    }
}

@Composable
private fun MoneyForm(contactId: String, kind: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val c = contactOf(w, contactId)
    var amount by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var noteOpen by remember { mutableStateOf(false) }
    var noteDraft by remember { mutableStateOf("") }
    val value = PhoneWallet.parseAmount(amount)
    fun go() {
        val problem = PhoneWallet.transferProblem(value, kind)
        if (problem != null) {
            p.emit("error", mapOf("code" to "amount", "app" to APP))
            return p.toast(problem)
        }
        p.scope.launch {
            val r = p.pay(PayRequest(APP, if (kind == "transfer") "转账给${c.name}" else "${c.name}的红包", c.name, value)) ?: return@launch
            val id = p.newId("transfer", "T")
            val text = if (kind == "red_packet") note.ifEmpty { "恭喜发财，大吉大利" } else note
            p.write("transfer", id, "to_id" to contactId, "to" to c.name, "amount" to value, "note" to text, "kind" to kind, "status" to "sent", "payment_id" to r.paymentId)
            if (c.persona != null) p.personaSendEvent(c.persona, "[${if (kind == "transfer") "转账" else "红包"}] ¥${PhoneDates.yuan2(value)}${if (text.isNotEmpty()) " $text" else ""}")
            nav.pop()
        }
    }
    PScreen("chat-$kind-form", bg = WX_BG) {
        PColumn {
            PBar(if (kind == "transfer") "" else "发红包", onBack = nav::pop)
            PBody {
                if (kind == "transfer") {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Avatar(c, 48.dp)
                        PText("转账给 ${c.name}", size = 16.sp, weight = FontWeight.SemiBold)
                    }
                }
                AmountBox(if (kind == "transfer") "转账金额" else "单个金额", amount) {
                    if (kind == "transfer") {
                        Box(Modifier.heightIn(min = 36.dp).tap { noteDraft = note; noteOpen = true }.testTag("transfer-note"), contentAlignment = Alignment.CenterStart) {
                            PText(if (note.isNotEmpty()) "$note　修改" else "添加转账说明", size = 14.sp, color = Color(0xFF576B95))
                        }
                    } else {
                        PInput(note, { note = it.take(25) }, "恭喜发财，大吉大利", Modifier.fillMaxWidth().heightIn(min = 40.dp), tag = "red-packet-wish")
                    }
                }
                PBtn(if (kind == "transfer") "转账" else "塞钱进红包", Modifier.fillMaxWidth().padding(horizontal = 12.dp), accent = GREEN, enabled = value > 0, shape = RoundedCornerShape(8.dp), tag = "money-submit") { go() }
                if (kind == "red_packet") PNote("未领取的红包，将于24小时后发起退款")
            }
            AmountPad(amount) { amount = it }
        }
        PDialog(
            noteOpen, "添加转账说明", onClose = { noteOpen = false },
            actions = listOf(
                DialogAction(ZH.cancel) { noteOpen = false },
                DialogAction(ZH.confirm, primary = true, tag = "transfer-note-ok") { note = noteDraft.trim().take(20); noteOpen = false },
            ),
        ) {
            Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).border(1.dp, PC.chipBorder, RoundedCornerShape(6.dp)).padding(horizontal = 10.dp), contentAlignment = Alignment.CenterStart) {
                PInput(noteDraft, { noteDraft = it }, "最多20个字", Modifier.fillMaxWidth(), tag = "transfer-note-input", autoFocus = true)
            }
        }
    }
}

@Composable
private fun Scan() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    var scanning by remember { mutableStateOf<String?>(null) }
    val codes = w.qrCodes ?: emptyList()
    LaunchedEffect(scanning) {
        val s = scanning ?: return@LaunchedEffect
        delay(900)
        val q = codes.firstOrNull { it.id == s }
        scanning = null
        if (q == null) return@LaunchedEffect
        p.emit("qr.scan", mapOf("qr" to q.id))
        nav.pop()
        nav.push(if (q.kind == "pay") "qr_pay" else "qr_contact", "qr" to q.id)
    }
    PScreen("chat-scan-view", bg = Color(0xFF111111)) {
        PColumn {
            PBar("扫一扫", onBack = nav::pop, accent = Color(0xFF111111))
            Column(Modifier.weight(1f).fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                PText("将二维码放入框内，即可自动扫描", color = Color(0xFFCCCCCC), size = 13.sp)
                if (codes.isEmpty()) PText("附近没有可扫描的二维码", color = Color(0xFF999999))
                for (row in codes.chunked(2)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        for (q in row) {
                            Column(
                                Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(Color.White).border(3.dp, if (scanning == q.id) GREEN else Color.Transparent, RoundedCornerShape(10.dp))
                                    .tap { scanning = q.id }.padding(10.dp).testTag("qr-code-${q.id}"),
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                PText(q.label, size = 12.sp, weight = FontWeight.SemiBold, align = TextAlign.Center)
                                Column(Modifier.fillMaxWidth(0.8f).aspectRatio(1f)) {
                                    for (y in 0 until 7) Row(Modifier.weight(1f)) {
                                        for (x in 0 until 7) Box(Modifier.weight(1f).fillMaxSize().background(if (qrCell(q.id, y * 7 + x)) Color(0xFF111111) else Color.White))
                                    }
                                }
                                PText(if (q.kind == "pay") q.payee else "${q.payee} · 微聊", size = 11.sp, color = PC.muted, align = TextAlign.Center)
                            }
                        }
                        if (row.size == 1) Box(Modifier.weight(1f))
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.SpaceAround) {
                PText("🔦 轻触照亮", color = Color(0xFFCCCCCC))
                PText("🖼 相册", color = Color(0xFFCCCCCC), modifier = Modifier.tap { p.toast(ZH.notOpen) })
            }
        }
    }
}

private val QR_FINDERS = setOf(0, 1, 7, 8, 5, 6, 12, 13, 35, 36, 42, 43)

/** A QR-looking 7×7 pattern: three corner finders + cells from a hash of the id (web qrCell). */
fun qrCell(id: String, i: Int): Boolean = i in QR_FINDERS || PhoneRail.hash("$id:$i") % 5 < 2

@Composable
private fun QrPay(qrId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val q = (w.qrCodes ?: emptyList()).firstOrNull { it.id == qrId } ?: return
    var amount by remember { mutableStateOf(q.amount?.let { PhoneJs.numStr(it) } ?: "") }
    var note by remember { mutableStateOf("") }
    var done by remember { mutableStateOf<Double?>(null) }
    val value = PhoneWallet.parseAmount(amount)
    fun go() {
        val problem = PhoneWallet.transferProblem(value, "transfer")
        if (problem != null) return p.toast(problem)
        p.scope.launch {
            val r = p.pay(PayRequest(APP, "付款给${q.payee}", q.payee, value)) ?: return@launch
            p.write("qr_payment", p.newId("qr_payment", "Q"), "qr_id" to q.id, "payee" to q.payee, "amount" to value, "note" to note, "status" to "paid", "payment_id" to r.paymentId)
            done = value
        }
    }
    val paid = done
    if (paid != null) {
        PScreen("qr-pay-done", bg = Color.White) {
            PColumn {
                PBar("", onBack = nav::pop)
                Column(Modifier.weight(1f).fillMaxWidth().padding(top = 60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(64.dp).clip(CircleShape).background(GREEN), contentAlignment = Alignment.Center) { Text("✓", color = Color.White, fontSize = 34.sp) }
                    PText("支付成功", size = 18.sp, weight = FontWeight.Bold)
                    PText("¥${PhoneDates.yuan2(paid)}", size = 34.sp, weight = FontWeight.Bold)
                    PText("收款方：${q.payee}", color = PC.muted)
                    PBtn("完成", kind = BtnKind.LINE, accent = GREEN, tag = "qr-pay-finish") { nav.pop() }
                }
            }
        }
        return
    }
    PScreen("qr-pay", bg = WX_BG) {
        PColumn {
            PBar("", onBack = nav::pop)
            PBody {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ChatAvatar(q.payee, "#ff9800", "张", 48.dp)
                    PText("付款给个人 ${q.payee}", size = 16.sp, weight = FontWeight.SemiBold)
                }
                AmountBox("付款金额", amount) {
                    PInput(note, { note = it.take(20) }, "添加备注（选填）", Modifier.fillMaxWidth().heightIn(min = 40.dp), tag = "qr-pay-note")
                }
                PBtn("付款", Modifier.fillMaxWidth().padding(horizontal = 12.dp), accent = GREEN, enabled = value > 0, shape = RoundedCornerShape(8.dp), tag = "qr-pay-submit") { go() }
            }
            if (q.amount == null || q.amount == 0.0) AmountPad(amount) { amount = it }
        }
    }
}

@Composable
private fun QrContact(qrId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val q = (w.qrCodes ?: emptyList()).firstOrNull { it.id == qrId } ?: return
    PScreen("qr-contact") {
        PColumn {
            PBar("", onBack = nav::pop)
            PBody {
                Row(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 20.dp, vertical = 30.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    ChatAvatar(q.payee, "#ff9800", "张", 60.dp)
                    Column {
                        PText(q.payee, size = 20.sp, weight = FontWeight.Bold)
                        PText("地区：上海 静安", size = 13.sp, color = PC.muted)
                    }
                }
                PBtn("添加到通讯录", Modifier.fillMaxWidth().padding(14.dp), accent = GREEN) { p.toast("已发送添加朋友申请") }
                PNote("这是添加好友的二维码，不能用来付款。")
            }
        }
    }
}

@Composable
private fun MiniPrograms() {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    PScreen("chat-mini-list") {
        PColumn {
            PBar("小程序", onBack = nav::pop)
            PBody {
                PSectionTitle("最近使用")
                Row(Modifier.fillMaxWidth().background(Color.White).padding(vertical = 12.dp)) {
                    for (a in listOf("rail", "ride", "food", "movie", "dine")) {
                        Column(Modifier.weight(1f).tap { p.openApp(a) }.padding(4.dp).testTag("mini-$a"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            AppIcon(a, size = 44.dp)
                            PText(PhoneCopy.app(a).name, size = 11.sp, color = PC.value, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

