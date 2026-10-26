package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneWallet
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The one pay sheet every simulated app opens (web PaySheet.tsx, 安付钱包): the amount and payee,
 * 付款方式 (零钱 or a bank card — 零钱 that doesn't cover it is "余额不足"), the six-digit 支付密码
 * on a number pad (5 tries), then 支付成功. A payment is a `payment` record; a wrong password is an
 * `error` event (a slip).
 */
@Composable
fun BoxScope.PaySheet(p: PhoneRuntime) {
    val pending = p.payRequest ?: return
    val req = pending.req
    val wallet = p.spec.wallet
    var step by remember(pending) { mutableStateOf("confirm") }
    var method by remember(pending) { mutableStateOf(PhoneWallet.defaultMethod(wallet, p.events, req.amount)) }
    var digits by remember(pending) { mutableStateOf("") }
    var fails by remember(pending) { mutableIntStateOf(0) }
    var error by remember(pending) { mutableStateOf<String?>(null) }
    var paymentId by remember(pending) { mutableStateOf("") }
    val balances = PhoneWallet.walletBalances(wallet, p.events)
    val enough = PhoneWallet.canPay(wallet, p.events, method, req.amount)
    fun done() = p.finishPay(PayResult(method, paymentId))

    PhoneBackHandler(step != "processing") {
        when (step) {
            "methods" -> step = "confirm"
            "success" -> done()
            else -> p.finishPay(null)
        }
    }

    fun press(key: String) {
        if (step != "password") return
        error = null
        if (key == "del") {
            digits = digits.dropLast(1)
            return
        }
        val next = (digits + key).take(6)
        digits = next
        if (next.length < 6) return
        p.scope.launch {
            delay(120)
            if (next != wallet.payPassword) {
                fails++
                digits = ""
                p.emit("error", "code" to kotlinx.serialization.json.JsonPrimitive("pay_password"), "app" to kotlinx.serialization.json.JsonPrimitive(req.app))
                if (fails >= PhoneWallet.MAX_PASSWORD_TRIES) {
                    p.toast(ZH.locked)
                    p.finishPay(null)
                    return@launch
                }
                error = ZH.wrongPassword(PhoneWallet.MAX_PASSWORD_TRIES - fails)
                return@launch
            }
            step = "processing"
            val id = p.newId("payment", "P")
            paymentId = id
            delay(700)
            p.write("payment", id, "app" to req.app, "title" to req.title, "payee" to req.payee, "amount" to req.amount, "method" to method, "direction" to "out", "status" to "paid")
            step = "success"
        }
    }

    Box(Modifier.matchParentSize().background(Color(0x80000000)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.testTag("pay-sheet"), contentAlignment = Alignment.BottomCenter) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).background(Color.White)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.padding(bottom = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (step != "success" && step != "processing") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clickable { if (step == "methods") step = "confirm" else p.finishPay(null) }.testTag("pay-close"), contentAlignment = Alignment.Center) {
                    Text(if (step == "methods") "‹" else "✕", fontSize = 20.sp, color = PC.ink)
                }
                PText(
                    when (step) { "methods" -> "选择付款方式"; "password" -> ZH.enterPassword; else -> "确认付款" },
                    size = 16.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f), align = androidx.compose.ui.text.style.TextAlign.Center,
                )
                Spacer(Modifier.width(44.dp))
            }
        }
        if (step == "confirm" || step == "password") {
            PText(req.payee, color = PC.value, modifier = Modifier.padding(top = 4.dp))
            Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(vertical = 4.dp).testTag("pay-amount")) {
                Text("¥", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = PC.ink)
                Text(PhoneDates.yuan2(req.amount), fontSize = 36.sp, fontWeight = FontWeight.Bold, color = PC.ink)
            }
            PText(req.title, size = 13.sp, color = Color(0xFF999999))
            Row(
                Modifier.fillMaxWidth().padding(16.dp).hairline(top = true).hairline().clickable(enabled = step == "confirm") { step = "methods" }.padding(vertical = 12.dp).testTag("pay-method"),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                PText(ZH.payMethod, size = 15.sp)
                PText(PhoneWallet.methodLabel(wallet, method) + (if (!enough) " · 余额不足" else "") + " ›", size = 15.sp, color = if (enough) PC.ink else PC.red)
            }
        }
        if (step == "confirm") {
            GreenButton(ZH.payNow, "pay-confirm") {
                if (!enough) {
                    p.toast(ZH.insufficient)
                    step = "methods"
                } else step = "password"
            }
        }
        if (step == "methods") {
            Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                val rows = listOf("balance" to "零钱（剩余¥${PhoneDates.yuan2(balances.balance)}）") + wallet.cards.map { it.id to "${it.bank}${it.kind}（${it.last4}）" }
                for ((id, label) in rows) {
                    val ok = PhoneWallet.canPay(wallet, p.events, id, req.amount)
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp).alpha(if (ok) 1f else 0.45f).clickable(enabled = ok) { method = id; step = "confirm" }.hairline().padding(horizontal = 16.dp, vertical = 14.dp).testTag("pay-method-$id"),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(if (id == "balance") "💰" else "💳", fontSize = 16.sp)
                        Column(Modifier.weight(1f)) {
                            PText(label, size = 15.sp)
                            if (!ok) PText("余额不足", size = 12.sp, color = PC.red)
                        }
                        Text(if (method == id) "✓" else "", fontSize = 15.sp, color = PC.green)
                    }
                }
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { p.toast(ZH.notOpen) }.padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("＋", fontSize = 16.sp)
                    PText("添加银行卡", size = 15.sp)
                }
            }
        }
        if (step == "password") {
            Row(Modifier.padding(top = 18.dp, bottom = 6.dp).testTag("pay-dots")) {
                for (i in 0 until 6) {
                    Box(Modifier.size(44.dp).offset(x = (-i).dp).border(1.dp, Color(0xFFD0D4DA)), contentAlignment = Alignment.Center) {
                        if (i < digits.length) Box(Modifier.size(10.dp).clip(CircleShape).background(PC.dark))
                    }
                }
            }
            val err = error
            if (err != null) PText(err, size = 13.sp, color = PC.red, modifier = Modifier.heightIn(min = 30.dp).padding(6.dp).testTag("pay-error"))
            else Box(Modifier.heightIn(min = 30.dp).clickable { p.toast("请在“安付钱包 → 我的 → 支付设置”中找回") }.padding(6.dp)) { PText(ZH.forgotPassword, size = 13.sp, color = Color(0xFF576B95)) }
            Keypad(listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"), tagPrefix = "key-") { press(it) }
        }
        if (step == "processing") PText("支付中…", size = 16.sp, color = PC.value, modifier = Modifier.padding(vertical = 60.dp))
        if (step == "success") {
            Column(Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 8.dp).testTag("pay-success"), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(PC.green), contentAlignment = Alignment.Center) { Text("✓", color = Color.White, fontSize = 30.sp) }
                Spacer(Modifier.height(10.dp))
                PText(ZH.paySuccess, size = 17.sp)
                Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(vertical = 4.dp)) {
                    Text("¥", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = PC.ink)
                    Text(PhoneDates.yuan2(req.amount), fontSize = 36.sp, fontWeight = FontWeight.Bold, color = PC.ink)
                }
                PText("${req.payee} · ${PhoneCopy.app("wallet").name}", size = 13.sp, color = Color(0xFF999999))
                GreenButton(ZH.done, "pay-done") { done() }
            }
        }
    }
    }
}

@Composable
private fun GreenButton(label: String, tag: String, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 12.dp).heightIn(min = 46.dp).clip(RoundedCornerShape(8.dp)).background(PC.green).clickable(onClick = onClick).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { PText(label, size = 17.sp, weight = FontWeight.SemiBold, color = Color.White) }
}

/** The number pads (支付密码 and the amount pad). */
@Composable
fun Keypad(keys: List<String>, tagPrefix: String, onKey: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().background(Color(0xFFE9EBEE)).padding(top = 1.dp)) {
        keys.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(bottom = 1.dp), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                for (k in row) {
                    if (k.isEmpty()) Box(Modifier.weight(1f).height(52.dp).background(Color(0xFFE9EBEE)))
                    else Box(
                        Modifier.weight(1f).height(52.dp).background(Color.White).clickable { onKey(k) }.testTag(tagPrefix + if (k == ".") "dot" else k),
                        contentAlignment = Alignment.Center,
                    ) { Text(if (k == "del") "⌫" else k, fontSize = 22.sp, color = PC.ink) }
                }
            }
        }
    }
}
