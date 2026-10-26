package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson

/**
 * Port of shared/phone/wallet.ts — 安付钱包 and the one pay sheet every app opens: 付款方式
 * (零钱 or a card), the six-digit 支付密码 (5 tries), balances derived from `payment` records,
 * and the messenger's 转账 / 红包 amount rules.
 */
object PhoneWallet {
    const val MAX_PASSWORD_TRIES = 5

    data class Balances(val balance: Double, val cards: Map<String, Double>)

    /** Current balances: 零钱 and each card, after this phone's payments and money received. */
    fun walletBalances(wallet: WalletSpec, events: List<PhoneEvent>): Balances {
        var balance = wallet.balance
        val cards = LinkedHashMap<String, Double>()
        for (c in wallet.cards) cards[c.id] = c.balance
        for (r in PhoneEngine.recordsOf(events, "payment")) {
            val amount = PhoneJs.n(r.data, "amount").let { if (it.isNaN()) 0.0 else it }
            val sign = if (JsJson.str(r.data["direction"]) == "in") 1 else -1
            if (JsJson.str(r.data["status"]) == "refunded" && sign < 0) continue
            val method = r.data["method"]?.let { if (it is kotlinx.serialization.json.JsonNull) null else PhoneJs.jsString(it) } ?: "balance"
            if (method == "balance") balance += sign * amount
            else if (method in cards) cards[method] = cards.getValue(method) + sign * amount
        }
        for (k in cards.keys.toList()) cards[k] = PhoneDates.round2(cards.getValue(k))
        return Balances(PhoneDates.round2(balance), cards)
    }

    /** Wrong passwords in a row since the last success. */
    fun passwordFailures(events: List<PhoneEvent>): Int {
        var n = 0
        for (e in events) {
            if (PhoneEngine.type(e) == "error" && JsJson.str(e["code"]) == "pay_password") n++
            if (PhoneEngine.type(e) == "record" && JsJson.str(e["record"]) == "payment") n = 0
        }
        return n
    }

    fun methodLabel(wallet: WalletSpec, method: String): String {
        if (method == "balance") return "零钱"
        val c = wallet.cards.firstOrNull { it.id == method } ?: return "银行卡"
        return "${c.bank}${c.kind}(${c.last4})"
    }

    fun canPay(wallet: WalletSpec, events: List<PhoneEvent>, method: String, amount: Double): Boolean {
        val b = walletBalances(wallet, events)
        val have = if (method == "balance") b.balance else b.cards[method] ?: 0.0
        return have + 1e-9 >= amount
    }

    /** 零钱 when it covers the amount, else the first card that does. */
    fun defaultMethod(wallet: WalletSpec, events: List<PhoneEvent>, amount: Double): String {
        if (canPay(wallet, events, "balance", amount)) return "balance"
        return wallet.cards.firstOrNull { canPay(wallet, events, it.id, amount) }?.id ?: "balance"
    }

    /** 转账 / 红包 amount rules (kind = transfer | red_packet). */
    fun transferProblem(amount: Double, kind: String): String? {
        if (!amount.isFinite() || amount <= 0) return "请输入金额"
        if (Math.abs(amount * 100 - dev.jeromeswannack.chineselearning.lab.core.Js.round(amount * 100)) > 1e-6) return "金额最多保留两位小数"
        if (kind == "red_packet" && amount > 200) return "单个红包金额不可超过200元"
        if (amount > 50_000) return "超出单笔转账限额"
        return null
    }

    private val AMOUNT = Regex("^[0-9]+(\\.[0-9]{0,2})?$")

    /** What was typed on an amount pad ("18.5" → 18.5, "" → 0). */
    fun parseAmount(text: String): Double {
        val t = JsJson.trim(text)
        if (!AMOUNT.matches(t)) return 0.0
        return PhoneJs.toNumber(t)
    }

    /** The amount pad: append a key ("1", ".", "del") with the real rules. */
    fun amountKey(text: String, key: String): String {
        if (key == "del") return text.dropLast(1)
        if (key == ".") {
            if (text.contains('.')) return text
            return if (text == "") "0." else "$text."
        }
        if (key.length != 1 || !PhoneJs.isDigit(key[0])) return text
        if (text == "0") return key
        val dot = text.indexOf('.')
        if (dot >= 0 && text.length - dot > 2) return text
        if (dot < 0 && text.length >= 6) return text
        return text + key
    }
}
