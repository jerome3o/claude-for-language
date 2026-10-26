package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson

/**
 * Port of shared/phone/copy.ts: the simulated apps' names, icons and colours — all FICTIONAL —
 * and the shared Chinese UI strings several apps use (no English inside the simulated UI).
 */
object PhoneCopy {
    data class AppMeta(val id: String, val name: String, val kindEn: String, val glyph: String, val colors: Pair<Long, Long>, val accent: Long)

    val APPS: Map<String, AppMeta> = linkedMapOf(
        "rail" to AppMeta("rail", "铁路出行", "Train tickets", "铁", 0xFF2F7DE1 to 0xFF1F5FB8, 0xFF2F7DE1),
        "ride" to AppMeta("ride", "招手打车", "Ride hailing", "招", 0xFFFF8A3D to 0xFFF2611C, 0xFFF2611C),
        "food" to AppMeta("food", "饭点外卖", "Food delivery", "饭", 0xFFFFD23F to 0xFFF5B400, 0xFFF5B400),
        "movie" to AppMeta("movie", "爆米花电影", "Cinema tickets", "影", 0xFFFF5A5F to 0xFFD93848, 0xFFE23D4B),
        "dine" to AppMeta("dine", "吃喝玩乐", "Restaurants & reviews", "吃", 0xFFFF7A45 to 0xFFE8542A, 0xFFEE5A2C),
        "chat" to AppMeta("chat", "微聊", "Messenger", "聊", 0xFF2FC26B to 0xFF19A356, 0xFF19A356),
        "wallet" to AppMeta("wallet", "安付钱包", "Wallet", "付", 0xFF3A8EF6 to 0xFF2463D8, 0xFF2463D8),
        "sms" to AppMeta("sms", "信息", "Messages", "信", 0xFF5FD068 to 0xFF3CAE47, 0xFF3CAE47),
    )

    fun app(id: String): AppMeta = APPS.getValue(id)

    /** Apps on the home screen in this order (dock last). */
    val HOME_SCREEN_ORDER = listOf("rail", "ride", "food", "movie", "dine", "wallet")
    val DOCK_ORDER = listOf("chat", "sms")

    /** Port of `ZH`: one place, so the apps phrase the same thing the same way. */
    object ZH {
        const val back = "返回"
        const val cancel = "取消"
        const val confirm = "确定"
        const val ok = "我知道了"
        const val done = "完成"
        const val save = "保存"
        const val search = "搜索"
        const val submitOrder = "提交订单"
        const val payNow = "立即支付"
        const val paySuccess = "支付成功"
        const val payFailed = "支付失败"
        fun wrongPassword(left: Int) = "支付密码错误，你还可以输入${left}次"
        const val locked = "支付密码错误次数过多，请稍后再试"
        const val insufficient = "余额不足，请选择其他付款方式"
        const val enterPassword = "请输入支付密码"
        const val forgotPassword = "忘记密码？"
        const val payMethod = "付款方式"
        const val balance = "零钱"
        const val notOpen = "该功能暂未开放"
        const val loading = "加载中…"
        const val noNetwork = "网络连接失败，请检查网络设置"
        const val needsConnection = "对方暂时无法回复（需要联网）"
        const val orderPaid = "已支付"
        const val orderUnpaid = "待支付"
        const val orderCancelled = "已取消"
        const val orderDone = "已完成"
        const val orderRefunded = "已退票"
        const val sendSms = "获取验证码"
        fun smsSent(s: Int) = "${s}秒后重新获取"
        const val wrongCode = "验证码错误，请重新输入"
        const val phonePlaceholder = "请输入手机号"
        const val codePlaceholder = "请输入验证码"
        const val badPhone = "请输入正确的手机号码"
        const val inputPlaceholder = "请输入"
        const val voiceListening = "正在听…"
        const val voiceTapToStop = "说完了点击结束"
    }

    /** SMS copy (【app】 prefix like real Chinese SMS). */
    fun smsCode(app: String, code: String): String =
        "【${app(app).name}】您的验证码为${code}，5分钟内有效。请勿泄露给他人，如非本人操作请忽略本短信。"
}

/** Port of the request side of shared/phone/persona.ts (the prompt itself is built by the worker). */
object PhonePersonas {
    const val MESSAGES = 24
    const val MESSAGE_CHARS = 300
    const val CONTEXT_CHARS = 600

    /** `trimPersonaMessages`: me / them only, non-empty, the newest 24, each ≤ 300 characters. */
    fun trim(messages: List<PersonaMessage>): List<PersonaMessage> =
        messages.filter { (it.from == "me" || it.from == "them") && JsJson.trim(it.text).isNotEmpty() }
            .takeLast(MESSAGES)
            .map { PersonaMessage(it.from, JsJson.trim(it.text).let { t -> if (t.length > MESSAGE_CHARS) t.substring(0, MESSAGE_CHARS) else t }) }

    /** `fakePersonaReply`: the deterministic stand-in (the worker's E2E answer, used by tests). */
    fun fakeReply(persona: PhonePersona, messages: List<PersonaMessage>): PersonaReply {
        val last = messages.lastOrNull { it.from == "me" }
        if (last == null || !PhoneJs.hasHan(last.text)) {
            return PersonaReply("不好意思，我没看懂，你能用中文再说一下吗？", "Sorry, I didn't understand — could you say it again in Chinese?", emptyList())
        }
        val action = persona.fakeAction
        return PersonaReply(persona.fakeReply ?: "好的，没问题！", "OK, no problem!", if (action != null) listOf(PersonaAction(action.name, action.params ?: emptyMap())) else emptyList())
    }
}
