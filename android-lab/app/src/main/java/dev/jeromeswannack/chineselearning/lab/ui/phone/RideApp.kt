package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.ui.layout.layout
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneRide
import dev.jeromeswannack.chineselearning.lab.core.phone.RIDE_CAR_TYPES
import dev.jeromeswannack.chineselearning.lab.core.phone.RidePoi
import dev.jeromeswannack.chineselearning.lab.core.phone.RideWorld
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/*
 * 招手打车 (web apps/RideApp.tsx) — a fictional ride-hailing app: 你要去哪儿 → POI search (🎤) →
 * car types with 预估价 and coupons (several at once) → 正在呼叫 → 司机已接单 (车牌 first) → 司机已到达
 * (a driver persona may message: "您在哪个门？") → 行程中 → 支付 → 评价; ☰ → 我的行程 → a past trip's
 * 联系司机 / 物品遗失.
 */

private const val APP = "ride"
private val ACCENT = Color(0xFFF2611C)
private val GREEN = Color(0xFF19A356)

@Composable
private fun world(): RideWorld = LocalPhone.current.spec.world.ride!!

@Composable
fun RideApp(screen: PhoneScreen) {
    when (screen.name) {
        "dest" -> Destination()
        "confirm" -> ConfirmRide(screen.p("poi"))
        "trip" -> Trip(screen.p("id"))
        "chat" -> AppChat(
            personaId = screen.p("persona"), title = screen.p("driver"), subtitle = screen.p("plate"), context = screen.p("context"), accent = ACCENT, avatar = "司",
            onBack = LocalPhone.current.nav(APP)::pop, quick = listOf("我马上到", "我在上车点了", "请稍等一下", "好的，谢谢师傅"),
        )
        "trips" -> Trips()
        "past" -> PastTrip(screen.p("id"))
        else -> RideHome()
    }
}

/** The map: grey streets, a route, the green pin (web FakeMap). */
@Composable
private fun FakeMap(route: Boolean, modifier: Modifier) {
    Box(modifier.background(Color(0xFFE8EEF3))) {
        Canvas(Modifier.fillMaxSize()) {
            val road = 14.dp.toPx()
            for (y in listOf(0.30f, 0.62f)) {
                drawRect(Color(0xFFD9E1E8), Offset(0f, size.height * y - 1), androidx.compose.ui.geometry.Size(size.width, road + 2))
                drawRect(Color.White, Offset(0f, size.height * y), androidx.compose.ui.geometry.Size(size.width, road))
            }
            for (x in listOf(0.28f, 0.70f)) {
                drawRect(Color(0xFFD9E1E8), Offset(size.width * x - 1, 0f), androidx.compose.ui.geometry.Size(road + 2, size.height))
                drawRect(Color.White, Offset(size.width * x, 0f), androidx.compose.ui.geometry.Size(road, size.height))
            }
            if (route) {
                val l = size.width * 0.30f
                val t = size.height * 0.32f
                val r = l + size.width * 0.40f
                val b = t + size.height * 0.31f
                val path = androidx.compose.ui.graphics.Path().apply { moveTo(l, t); lineTo(r - 18.dp.toPx(), t); quadraticTo(r, t, r, t + 18.dp.toPx()); lineTo(r, b) }
                drawPath(path, GREEN, style = Stroke(4.dp.toPx()))
            }
        }
        Text("延安西路", fontSize = 10.sp, color = Color(0xFF8796A5), modifier = Modifier.align(Alignment.TopStart).offsetFraction(0.34f, 0.25f))
        Text("华山路", fontSize = 10.sp, color = Color(0xFF8796A5), modifier = Modifier.align(Alignment.TopStart).offsetFraction(0.06f, 0.57f))
        Text("常德路", fontSize = 10.sp, color = Color(0xFF8796A5), modifier = Modifier.align(Alignment.TopStart).offsetFraction(0.74f, 0.66f))
        Box(Modifier.align(Alignment.TopStart).offsetFraction(0.5f, 0.42f, centerX = true, above = true).size(22.dp).rotate(-45f).clip(RoundedCornerShape(50, 50, 50, 0)).background(GREEN), contentAlignment = Alignment.Center) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(Color.White))
        }
    }
}

/** Positions a child at a fraction of the parent (CSS `top: x%; left: y%`). */
private fun Modifier.offsetFraction(x: Float, y: Float, centerX: Boolean = false, above: Boolean = false) = this.layout { m, c ->
    val pl = m.measure(c.copy(minWidth = 0, minHeight = 0))
    val w = if (c.hasBoundedWidth) c.maxWidth else pl.width
    val h = if (c.hasBoundedHeight) c.maxHeight else pl.height
    layout(w, h) {
        pl.place((w * x).toInt() - if (centerX) pl.width / 2 else 0, (h * y).toInt() - if (above) pl.height else 0)
    }
}

private fun activeOrderId(p: PhoneRuntime): String? {
    val list = p.recordsOf("ride_order").filter { r ->
        val st = PhoneJs.s(r.data, "status")
        st !in listOf("paid", "cancelled") || (st == "paid" && r.data["rating"] == null && r.data["rated"] == null)
    }
    return list.lastOrNull()?.id
}

@Composable
private fun RideHome() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    var menu by remember { mutableStateOf(false) }
    val active = activeOrderId(p)
    PScreen("ride-home", bg = Color(0xFFE8EEF3)) {
        FakeMap(false, Modifier.fillMaxSize())
        Row(Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).shadow(4.dp, CircleShape).clip(CircleShape).background(Color.White).clickable { menu = true }.testTag("ride-menu"), contentAlignment = Alignment.Center) { Text("☰", fontSize = 18.sp) }
            Row(Modifier.weight(1f).heightIn(min = 42.dp).shadow(4.dp, RoundedCornerShape(21.dp)).clip(RoundedCornerShape(21.dp)).background(Color.White).horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                listOf("快车", "专车", "出租车", "代驾", "顺风车").forEachIndexed { i, k ->
                    PText(k, color = if (i == 0) Color(0xFF111111) else PC.value, weight = if (i == 0) FontWeight.Bold else null, modifier = Modifier.clickable { if (i > 2) p.toast(ZH.notOpen) })
                }
            }
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(start = 8.dp, end = 8.dp, bottom = 10.dp).shadow(8.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp)).background(Color.White).padding(horizontal = 14.dp, vertical = 12.dp)) {
            if (active != null) {
                Box(Modifier.fillMaxWidth().padding(bottom = 8.dp).heightIn(min = 40.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFFFF4EC)).clickable { nav.push("trip", "id" to active) }.testTag("ride-active"), contentAlignment = Alignment.Center) {
                    PText("您有一个进行中的订单，点击查看 ›", color = ACCENT)
                }
            }
            Row(Modifier.fillMaxWidth().hairline().padding(top = 6.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Dot(GREEN)
                Column {
                    PText(w.start.name, weight = FontWeight.Bold)
                    PText("在这里上车 · ${w.start.address}", size = 12.sp, color = Color(0xFF999999))
                }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp).heightIn(min = 50.dp).clip(RoundedCornerShape(10.dp)).background(PC.bg).clickable { nav.push("dest") }.padding(horizontal = 12.dp).testTag("ride-where"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Dot(ACCENT)
                PText("你要去哪儿", size = 19.sp, weight = FontWeight.SemiBold, color = Color(0xFF999999))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                for ((label, msg) in listOf("🏠 家" to "请先设置家的地址", "💼 公司" to "请先设置公司的地址", "⏱ 预约" to ZH.notOpen, "👤 帮人叫车" to ZH.notOpen)) {
                    Box(Modifier.heightIn(min = 36.dp).clickable { p.toast(msg) }, contentAlignment = Alignment.Center) { PText(label, size = 13.sp, color = Color(0xFF555555)) }
                }
            }
        }
        PSheet(menu, { menu = false }, "我的") {
            PCell("我的行程", icon = "🧾", tag = "ride-trips", onClick = { menu = false; nav.push("trips") })
            PCell("钱包", icon = "💳", onClick = { menu = false; p.openApp("wallet") })
            PCell("优惠券", icon = "🎟", value = "${(w.coupons ?: emptyList()).size}张", onClick = { p.toast("下单时自动使用最优惠的券") })
            PCell("安全中心", icon = "🛡", onClick = { p.toast(ZH.notOpen) })
            PCell("设置", icon = "⚙", onClick = { p.toast(ZH.notOpen) })
        }
    }
}

@Composable
private fun Dot(color: Color) = Box(Modifier.size(9.dp).clip(CircleShape).background(color))

@Composable
private fun Destination() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    var q by remember { mutableStateOf("") }
    val recent = w.pois.filter { it.id in listOf("sh_station", "nanjing_rd", "yuyuan") }
    fun pick(poi: RidePoi) = nav.push("confirm", "poi" to poi.id)
    PScreen("ride-dest") {
        PColumn {
            PBar("", onBack = nav::pop) { PText("上海 ▾", color = Color(0xFF333333)) }
            Column(Modifier.background(Color.White).padding(horizontal = 12.dp, vertical = 10.dp)) {
                Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Dot(GREEN)
                    PText(w.start.name)
                }
                PSearchBox(q, { q = it }, "你要去哪儿", tag = "ride-search", autoFocus = true, mic = true)
            }
            PBody {
                if (q.isNotBlank()) {
                    val hits = PhoneRide.searchPois(w.pois, q)
                    if (hits.isEmpty()) PEmpty("没有找到相关地点，换个关键词试试", "🔍")
                    for (poi in hits) PoiRow(poi, "📍", true) { pick(poi) }
                } else {
                    PSectionTitle("历史记录")
                    for (poi in recent) PoiRow(poi, "🕘", false) { pick(poi) }
                }
            }
        }
    }
}

@Composable
private fun PoiRow(poi: RidePoi, icon: String, full: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).background(Color.White).clickable(onClick = onClick).hairline().padding(horizontal = 14.dp, vertical = 12.dp).testTag(if (full) "ride-poi-${poi.id}" else "ride-recent-${poi.id}"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(icon, fontSize = 16.sp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PText(poi.name, size = 15.sp, weight = FontWeight.Bold)
                if (full) poi.kind?.let { PTag(it) }
            }
            PText(if (full) "${poi.district ?: ""} · ${poi.address}" else poi.address, size = 12.sp, color = Color(0xFF999999), maxLines = 1)
        }
        PText("${PhoneJs.numStr(poi.km)}km", size = 12.sp, color = Color(0xFF999999))
    }
}

@Composable
private fun ColumnScope.RideSheet(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.weight(1f).fillMaxWidth().offset(y = (-12).dp).clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).background(Color.White).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 12.dp), content = content)
}

@Composable
private fun ConfirmRide(poiId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val poi = w.pois.firstOrNull { it.id == poiId } ?: return PEmpty("地点不存在")
    var picked by remember { mutableStateOf(listOf("快车")) }
    val offers = RIDE_CAR_TYPES.mapNotNull { t -> w.cars.firstOrNull { it.type == t } }
    data class Priced(val type: String, val eta: Double, val note: String?, val raw: Double, val coupon: dev.jeromeswannack.chineselearning.lab.core.phone.RideCoupon?, val price: Double)
    val priced = offers.map { c ->
        val raw = PhoneRide.estimatePrice(c, poi.km)
        val coupon = PhoneRide.bestCoupon(w.coupons, c.type, raw)
        Priced(c.type, c.etaMin, c.note, raw, coupon, PhoneRide.priceAfterCoupon(raw, coupon))
    }
    fun call() {
        if (picked.isEmpty()) return p.toast("请至少选择一种车型")
        // The car type whose driver answers first (the shortest pickup time).
        val chosen = priced.filter { it.type in picked }.sortedWith { a, b -> a.eta.compareTo(b.eta) }.first()
        val id = p.newId("ride_order", "D")
        p.write(
            "ride_order", id,
            "order_id" to id, "from" to w.start.name, "to" to poi.name, "to_id" to poi.id, "car_type" to chosen.type, "called" to picked,
            "km" to poi.km, "price" to chosen.price, "coupon" to (chosen.coupon?.amount ?: 0.0), "status" to "calling", "called_at" to p.now(),
        )
        nav.resetTo("trip" to mapOf("id" to id))
    }
    PScreen("ride-confirm") {
        PColumn {
            PBar("", onBack = nav::pop)
            FakeMap(true, Modifier.fillMaxWidth().fillMaxHeight(0.38f))
            RideSheet {
                Column(Modifier.fillMaxWidth().hairline().padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Dot(GREEN); PText(w.start.name, size = 15.sp, weight = FontWeight.SemiBold) }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Dot(ACCENT); PText(poi.name, size = 15.sp, weight = FontWeight.SemiBold) }
                    PText("全程约${PhoneJs.numStr(poi.km)}公里 · 约${PhoneRide.tripMinutes(poi.km)}分钟", color = Color(0xFF999999))
                }
                Column(Modifier.padding(vertical = 8.dp)) {
                    for (c in priced) {
                        val on = c.type in picked
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 60.dp).clip(RoundedCornerShape(10.dp)).background(if (on) Color(0xFFFFF4EC) else Color.Transparent)
                                .clickable { picked = if (on) picked - c.type else picked + c.type }.padding(horizontal = 6.dp, vertical = 10.dp).testTag("ride-car-${c.type}"),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(if (c.type == "专车") "🚘" else if (c.type == "出租车") "🚕" else "🚗", fontSize = 26.sp)
                            Column(Modifier.weight(1f)) {
                                PText(c.type, weight = FontWeight.Bold)
                                PText("${c.note ?: ""} · 约${PhoneJs.numStr(c.eta)}分钟接驾", size = 12.sp, color = Color(0xFF999999))
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                PText("预估", size = 11.sp, color = Color(0xFF999999))
                                PPrice(c.price)
                                if (c.coupon != null) PText("券已抵${PhoneDates.yuan(c.coupon.amount)}元 · 原价${PhoneDates.yuan(c.raw)}", size = 11.sp, color = ACCENT)
                            }
                            PCheck(on, ACCENT)
                        }
                    }
                }
                PBtn(
                    if (picked.size > 1) "同时呼叫${picked.size}种车型" else if (picked.size == 1) "呼叫${picked[0]}" else "请选择车型",
                    Modifier.fillMaxWidth(), accent = ACCENT, tag = "ride-call",
                ) { call() }
            }
        }
    }
}

@Composable
private fun Trip(id: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val o = p.record("ride_order", id)
    val status = o?.let { PhoneJs.s(it, "status") }
    val persona = w.arrivalPersona ?: w.driver.persona
    val found = p.hasAction(w.arrivalPersona, "found_passenger")
    var cancel by remember { mutableStateOf(false) }
    var stars by remember { mutableIntStateOf(0) }
    var tags by remember { mutableStateOf(listOf<String>()) }
    val car = w.cars.firstOrNull { it.type == o?.let { PhoneJs.s(it, "car_type") } }
    val eta = car?.etaMin ?: 3.0

    // The trip moves on by itself, like a real one (seconds instead of minutes).
    LaunchedEffect(status, found, id) {
        if (o == null) return@LaunchedEffect
        when {
            status == "calling" -> {
                delay(2500)
                p.write("ride_order", id, "status" to "accepted", "accepted_at" to p.now(), "driver" to w.driver.name, "plate" to w.driver.plate)
                p.notify(APP, "司机已接单", "${w.driver.plate} ${w.driver.car} ${w.driver.name}正在赶来", OpenTarget(APP, "trip", mapOf("id" to id)))
            }
            status == "accepted" -> {
                delay(maxOf(4000L, (eta * 1500).toLong()))
                p.write("ride_order", id, "status" to "arrived", "arrived_at" to p.now())
                p.notify(APP, "司机已到达", "${w.driver.plate} 已到达上车点，请尽快上车", OpenTarget(APP, "trip", mapOf("id" to id)))
                w.arrivalPersona?.let { ap ->
                    p.personaStart(ap)
                    p.persona(ap)?.opening?.let { opening ->
                        p.notify(APP, w.driver.name, opening, OpenTarget(APP, "chat", mapOf("persona" to ap, "driver" to w.driver.name, "plate" to w.driver.plate)))
                    }
                }
            }
            status == "arrived" && (w.arrivalPersona == null || found) -> {
                delay(if (w.arrivalPersona != null) 3500 else 4000)
                p.write("ride_order", id, "status" to "in_trip", "started_at" to p.now())
                p.notify(APP, "行程已开始", "请系好安全带，祝您旅途愉快")
            }
            status == "in_trip" -> {
                delay(6000)
                p.write("ride_order", id, "status" to "finished", "finished_at" to p.now())
                p.notify(APP, "已到达目的地", "本次行程费用${PhoneDates.yuan(PhoneJs.n(o, "price"))}元，请尽快支付", OpenTarget(APP, "trip", mapOf("id" to id)))
            }
        }
    }
    if (o == null) return PEmpty("订单不存在")
    val st = status!!
    val context = "订单：${PhoneJs.s(o, "car_type")}，${PhoneJs.s(o, "from")} → ${PhoneJs.s(o, "to")}；状态：${PhoneRide.rideStatusLine(st, eta)}"
    fun openChat() {
        if (persona != null) nav.push("chat", "persona" to persona, "driver" to w.driver.name, "plate" to w.driver.plate, "context" to context) else p.toast("司机正在开车，请稍后再试")
    }
    fun pay() {
        p.scope.launch {
            val r = p.pay(PayRequest(APP, "${PhoneJs.s(o, "car_type")} ${PhoneJs.s(o, "from")} → ${PhoneJs.s(o, "to")}", "招手打车", PhoneJs.n(o, "price"))) ?: return@launch
            p.write("ride_order", id, "status" to "paid", "pay_method" to r.method)
        }
    }
    val unread = p.personaLines(persona).count { it.from == "them" }
    PScreen("ride-trip-$st") {
        PColumn {
            PBar(if (st == "paid") "行程结束" else "", onBack = nav::home)
            FakeMap(st != "calling", Modifier.fillMaxWidth().fillMaxHeight(0.38f))
            RideSheet {
                PText(PhoneRide.rideStatusLine(st, eta), size = 17.sp, weight = FontWeight.Bold, modifier = Modifier.padding(bottom = 10.dp).testTag("ride-status"))
                if (st == "calling") {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Spinner()
                        PText("已为您呼叫 ${PhoneJs.list(o, "called").ifEmpty { listOf(PhoneJs.s(o, "car_type")) }.joinToString("、")}，预估 ", color = Color(0xFF555555))
                        PPrice(PhoneJs.n(o, "price"))
                    }
                }
                if (st in listOf("accepted", "arrived", "in_trip", "finished")) {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFFF8F9FB)).padding(12.dp).testTag("ride-driver"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        PText(w.driver.plate, size = 24.sp, weight = FontWeight.ExtraBold)
                        PText(w.driver.car, size = 13.sp, color = Color(0xFF555555))
                        PText("${w.driver.name} ★${PhoneJs.numStr(w.driver.rating)} · ${w.driver.trips}单", size = 13.sp, color = Color(0xFF888888))
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            DriverButton("💬 联系司机", "ride-chat", unread) { openChat() }
                            DriverButton("📞 打电话", null, 0) { p.toast("正在通过隐私号码呼叫…对方暂时无法接听") }
                            DriverButton("🛡 安全", null, 0) { p.toast("已开启行程分享") }
                        }
                    }
                }
                if (st == "arrived" && w.arrivalPersona != null && !found) {
                    Box(Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFFFF4EC)).padding(horizontal = 10.dp, vertical = 8.dp)) { PText("司机在找您，请回复司机的消息", size = 13.sp, color = Color(0xFFC2410C)) }
                }
                if (st == "finished") {
                    Column(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) { PText("本次行程 "); PPrice(PhoneJs.n(o, "price"), big = true) }
                        if (PhoneJs.n(o, "coupon") > 0) PText("已使用优惠券抵扣${PhoneDates.yuan(PhoneJs.n(o, "coupon"))}元", size = 12.sp, color = PC.muted)
                        PBtn("去支付", Modifier.fillMaxWidth(), accent = ACCENT, tag = "ride-pay") { pay() }
                    }
                }
                if (st == "paid" && o["rating"] == null) {
                    Column(Modifier.fillMaxWidth().padding(top = 12.dp).testTag("ride-rate"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        PText("匿名评价司机", weight = FontWeight.Bold)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            for (s in 1..5) Box(Modifier.size(44.dp).clickable { stars = s }.testTag("ride-star-$s"), contentAlignment = Alignment.Center) {
                                Text("★", fontSize = 32.sp, color = if (s <= stars) Color(0xFFFF9F1A) else Color(0xFFDDDDDD))
                            }
                        }
                        if (stars > 0) {
                            PText(listOf("", "非常不满意", "不满意", "一般", "满意", "非常满意")[stars], size = 12.sp, color = PC.muted)
                            PChips {
                                for (t in if (stars >= 4) PhoneRide.RATING_TAGS_GOOD else PhoneRide.RATING_TAGS_BAD) PChip(t, t in tags, ACCENT) { tags = if (t in tags) tags - t else tags + t }
                            }
                        }
                        PBtn("提交评价", Modifier.fillMaxWidth(), accent = ACCENT, enabled = stars > 0, tag = "ride-rate-submit") {
                            if (stars == 0) return@PBtn
                            p.write("ride_order", id, "rating" to stars, "tags" to tags, "rated" to true)
                            p.emit("ride.rated", "stars" to JsonPrimitive(stars))
                            p.toast("感谢您的评价")
                        }
                    }
                }
                if (st == "paid" && o["rating"] != null) {
                    Column(Modifier.fillMaxWidth().padding(top = 12.dp).testTag("ride-done"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        PText("行程已完成", weight = FontWeight.Bold)
                        PText("实付 ¥${PhoneDates.yuan(PhoneJs.n(o, "price"))} · 已评价${PhoneJs.s(o, "rating")}星", size = 12.sp, color = PC.muted)
                        PBtn("返回首页", Modifier.fillMaxWidth(), kind = BtnKind.LINE, accent = ACCENT) { nav.home() }
                    }
                }
                if (st in listOf("calling", "accepted", "arrived")) {
                    Box(Modifier.fillMaxWidth().padding(top = 12.dp), contentAlignment = Alignment.Center) {
                        Box(Modifier.heightIn(min = 36.dp).clickable { cancel = true }.testTag("ride-cancel"), contentAlignment = Alignment.Center) { PText("取消订单", size = 13.sp, color = Color(0xFF888888)) }
                    }
                }
            }
        }
        PDialog(cancel, "确定要取消订单吗？", { cancel = false }, actions = listOf(
            DialogAction("再等等") { cancel = false },
            DialogAction("确定取消", primary = true) {
                val acceptedAt = PhoneJs.n(o, "accepted_at").let { if (it.isNaN()) p.now().toDouble() else it }
                val fee = PhoneRide.cancelFee(st, (p.now() - acceptedAt) / 60_000)
                p.write("ride_order", id, "status" to "cancelled", "cancel_fee" to fee)
                cancel = false
                p.toast(if (fee > 0) "订单已取消，需支付取消费${PhoneJs.numStr(fee)}元" else "订单已取消")
                nav.home()
            },
        )) {
            PDialogText(if (st == "calling") "附近司机正在接单，现在取消不收费。" else "司机已经在赶来的路上，取消可能产生取消费。")
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.DriverButton(label: String, tag: String?, badge: Int, onClick: () -> Unit) {
    Box(
        Modifier.weight(1f).heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).background(Color.White).border(1.dp, PC.chipBorder, RoundedCornerShape(20.dp)).clickable(onClick = onClick).then(if (tag != null) Modifier.testTag(tag) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        PText(label, size = 13.sp, maxLines = 1)
        if (badge > 0) Badge(badge, Modifier.align(Alignment.TopEnd))
    }
}

@Composable
private fun Spinner() {
    val t = rememberInfiniteTransition(label = "spin")
    val a by t.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "a")
    Canvas(Modifier.size(18.dp)) {
        drawArc(Color(0xFFFFD7C2), 0f, 360f, false, style = Stroke(3.dp.toPx()))
        drawArc(ACCENT, a, 90f, false, style = Stroke(3.dp.toPx()))
    }
}

@Composable
private fun Trips() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val mine = p.recordsOf("ride_order").reversed()
    PScreen("ride-trips-list") {
        PColumn {
            PBar("我的行程", onBack = nav::pop)
            PBody {
                for (r in mine) {
                    TripRow("今天 · ${PhoneJs.s(r.data, "car_type")}", PhoneJs.s(r.data, "from"), PhoneJs.s(r.data, "to"), when (PhoneJs.s(r.data, "status")) { "paid" -> "已完成"; "cancelled" -> "已取消"; else -> "进行中" }, null) { nav.push("trip", "id" to r.id) }
                }
                for (t in w.trips ?: emptyList()) {
                    TripRow("${PhoneDates.zhMonthDay(t.date)} ${t.time} · ${t.carType}", t.from, t.to, "已完成 ›", "ride-past-trip-${t.id}") { nav.push("past", "id" to t.id) }
                }
                if (mine.isEmpty() && w.trips.isNullOrEmpty()) PEmpty("暂无行程", "🚗")
            }
        }
    }
}

@Composable
private fun TripRow(meta: String, from: String, to: String, status: String, tag: String?, onClick: () -> Unit) {
    PCard(onClick = onClick, tag = tag) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                PText(meta, size = 12.sp, color = Color(0xFF999999))
                PText(from, weight = FontWeight.Bold)
                PText("→ $to", weight = FontWeight.Bold)
            }
            PText(status, size = 13.sp, color = Color(0xFF888888))
        }
    }
}

@Composable
private fun PastTrip(id: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val t = (w.trips ?: emptyList()).firstOrNull { it.id == id } ?: return PEmpty("行程不存在")
    fun contact() {
        val persona = t.driver.persona ?: return p.toast("行程已结束超过24小时，无法联系司机，如有问题请联系客服")
        nav.push("chat", "persona" to persona, "driver" to t.driver.name, "plate" to t.driver.plate, "context" to "已完成的行程：${PhoneDates.zhMonthDay(t.date)} ${t.time}，${t.from} → ${t.to}，${t.carType}，${PhoneDates.yuan(t.price)}元")
    }
    PScreen("ride-past") {
        PColumn {
            PBar("行程详情", onBack = nav::pop)
            PBody {
                PGroup {
                    PCell("时间", value = "${PhoneDates.zhMonthDay(t.date)} ${t.time}")
                    PCell("起点", value = t.from)
                    PCell("终点", value = t.to)
                    PCell("车型", value = t.carType)
                    PCell("实付", value = "¥${PhoneDates.yuan(PhoneDates.round2(t.price))}")
                }
                PGroup("司机") { PCell("${t.driver.name} ★${PhoneJs.numStr(t.driver.rating)}", sub = "${t.driver.plate} · ${t.driver.car}") }
                PGroup("行程问题") {
                    PCell("物品遗失", sub = "联系司机找回遗落在车上的物品", icon = "🎒", tag = "ride-lost", onClick = { contact() })
                    PCell("联系司机", icon = "💬", onClick = { contact() })
                    PCell("费用疑问 / 投诉", icon = "⚠️", onClick = { p.toast(ZH.notOpen) })
                    PCell("开发票", icon = "🧾", onClick = { p.toast(ZH.notOpen) })
                }
            }
        }
    }
}
