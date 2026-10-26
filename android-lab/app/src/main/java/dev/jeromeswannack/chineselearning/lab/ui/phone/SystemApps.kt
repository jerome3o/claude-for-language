package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneWallet

/*
 * The phone's own apps (web apps/SystemApps.tsx): 信息 (SMS — 验证码 and order texts the other apps
 * send, with the "复制验证码" chip phones offer) and 安付钱包 (零钱, cards, 账单, 付款码).
 */

private val CODE = Regex("验证码为?([0-9]{4,6})")

private data class Sms(val from: String, val text: String, val at: Long)

@Composable
fun SmsApp(screen: PhoneScreen) {
    val p = LocalPhone.current
    val nav = p.nav("sms")
    val msgs = p.events.filter { PhoneEngine.type(it) == "sms" }.map { Sms(PhoneJs.s(it, "from"), PhoneJs.s(it, "text"), PhoneEngine.at(it)) }
    val clipboard = LocalClipboardManager.current
    if (screen.name == "thread") {
        val from = screen.p("from")
        PScreen("sms-thread", bg = Color.White) {
            PColumn {
                PBar(from, onBack = nav::pop)
                PBody(bg = Color(0xFFF6F7F9), modifier = Modifier.padding(10.dp)) {
                    for (m in msgs.filter { it.from == from }) {
                        Column(Modifier.padding(vertical = 10.dp)) {
                            Box(Modifier.fillMaxWidth(0.85f).clip(RoundedCornerShape(14.dp)).background(Color.White).padding(horizontal = 12.dp, vertical = 10.dp).testTag("sms-text")) {
                                PText(m.text, size = 15.sp, lineHeight = 23.sp)
                            }
                            CODE.find(m.text)?.groupValues?.get(1)?.let { code ->
                                Box(
                                    Modifier.padding(top = 6.dp).heightIn(min = 32.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFE3F6E5))
                                        .clickable { runCatching { clipboard.setText(AnnotatedString(code)) }; p.toast("已复制验证码") }.padding(horizontal = 12.dp).testTag("sms-copy-code"),
                                    contentAlignment = Alignment.Center,
                                ) { PText("复制验证码 $code", size = 13.sp, color = Color(0xFF237A2E)) }
                            }
                        }
                    }
                }
            }
        }
        return
    }
    val senders = msgs.map { it.from }.distinct().reversed()
    PScreen("sms-home", bg = Color.White) {
        PColumn {
            PBar("信息")
            PBody {
                if (senders.isEmpty()) PEmpty("暂无信息", "✉️")
                for (from in senders) {
                    val last = msgs.last { it.from == from }
                    Row(Modifier.fillMaxWidth().clickable { nav.push("thread", "from" to from) }.hairline().padding(horizontal = 14.dp, vertical = 12.dp).testTag("sms-row"), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(42.dp).clip(CircleShape).background(Color(0xFFE3F6E5)), contentAlignment = Alignment.Center) { Text("✉", color = Color(0xFF3CAE47), fontSize = 18.sp) }
                        Column(Modifier.weight(1f)) {
                            PText(from, weight = FontWeight.Bold)
                            PText(last.text, color = Color(0xFF888888), maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun WalletApp() {
    val p = LocalPhone.current
    var code by remember { mutableStateOf(false) }
    val b = PhoneWallet.walletBalances(p.spec.wallet, p.events)
    val bills = p.recordsOf("payment").reversed()
    PScreen("wallet-home") {
        PColumn {
            PBar("安付钱包")
            PBody {
                Column(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(16.dp)).background(Brush.linearGradient(listOf(Color(0xFF3A8EF6), Color(0xFF2463D8)))).padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    PText("零钱（元）", color = Color.White, size = 13.sp)
                    PText(PhoneDates.yuan2(b.balance), color = Color.White, size = 32.sp, weight = FontWeight.Bold, modifier = Modifier.testTag("wallet-balance"))
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for ((label, tag) in listOf("充值" to null, "提现" to null, "付款码" to "wallet-paycode")) {
                            Box(
                                Modifier.weight(1f).heightIn(min = 36.dp).clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.2f))
                                    .clickable { if (tag == null) p.toast(ZH.notOpen) else code = !code }.then(if (tag != null) Modifier.testTag(tag) else Modifier),
                                contentAlignment = Alignment.Center,
                            ) { PText(label, color = Color.White) }
                        }
                    }
                }
                if (code) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(12.dp)).background(Color.White).padding(14.dp).testTag("wallet-code"), horizontalAlignment = Alignment.CenterHorizontally) {
                        Row(Modifier.height(60.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            for (i in 0 until 48) Box(Modifier.width((1 + (i * 7) % 3).dp).fillMaxHeight().background(Color(0xFF111111)))
                        }
                        PText("向商家出示付款码 · 每分钟自动更新", size = 12.sp, color = PC.muted)
                    }
                }
                PGroup("银行卡") { for (c in p.spec.wallet.cards) PCell("${c.bank} ${c.kind}", sub = "尾号 ${c.last4}", icon = "💳") }
                PGroup("账单") {
                    if (bills.isEmpty()) PEmpty("本月暂无交易", "🧾")
                    for (r in bills) {
                        val incoming = PhoneJs.sOrNull(r.data, "direction") == "in"
                        PCell(
                            PhoneJs.s(r.data, "title"),
                            sub = PhoneJs.sOrNull(r.data, "payee") ?: "",
                            valueContent = { PText((if (incoming) "+" else "-") + PhoneDates.yuan2(PhoneJs.n(r.data, "amount")), color = if (incoming) PC.green else PC.value, modifier = Modifier.widthIn(min = 40.dp)) },
                        )
                    }
                }
            }
        }
    }
}
