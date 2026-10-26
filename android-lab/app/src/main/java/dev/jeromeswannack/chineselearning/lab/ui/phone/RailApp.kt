package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneRail
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneWorlds
import dev.jeromeswannack.chineselearning.lab.core.phone.RAIL_ID_TYPES
import dev.jeromeswannack.chineselearning.lab.core.phone.RAIL_PASSENGER_TYPES
import dev.jeromeswannack.chineselearning.lab.core.phone.RailPassenger
import dev.jeromeswannack.chineselearning.lab.core.phone.RailTrain
import dev.jeromeswannack.chineselearning.lab.core.phone.RailWorld
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * 铁路出行 (web apps/RailApp.tsx) — a fictional rail-ticket app with the national rail app's flow:
 * 出发地 / 到达地 / 日期 → 车次列表 → 预订 → (登录 with an SMS 验证码) → 填写订单 (乘车人, 添加乘车人
 * with 证件类型 护照, 选座 A–F) → 提交订单 → 待支付 → 支付 → 订单详情 and, from 订单, 改签 / 退票 with
 * the real fee rules (core PhoneRail).
 */

private const val APP = "rail"
private val ACCENT = Color(0xFF2F7DE1)
private val PRICE = Color(0xFFF26B1D)

data class RailSearch(val from: String, val to: String, val date: String, val highSpeed: Boolean)

@Composable
private fun world(): RailWorld = LocalPhone.current.spec.world.rail!!

private fun search(p: PhoneRuntime): RailSearch {
    val w = p.spec.world.rail!!
    return p.getState(APP, "search", RailSearch(w.defaultFrom ?: "", w.defaultTo ?: "", PhoneDates.addDays(p.spec.today, 1), false))
}

private fun setSearch(p: PhoneRuntime, f: (RailSearch) -> RailSearch) = p.setState(APP, "search", f(search(p)))

private fun loggedIn(p: PhoneRuntime): Boolean =
    !p.spec.world.rail!!.loggedOut || p.events.any { PhoneEngine.type(it) == "login" && PhoneJs.sOrNull(it, "app") == APP }

private fun orderNo(seed: Long, n: Int): String =
    "E" + (100_000_000L + ((Math.abs(seed) * 7 + n * 104_729L) % 899_999_999L)).toString().take(9)

private fun masked(no: String): String = if (no.length >= 4) "${no.take(2)}******${no.takeLast(2)}" else "${no.take(2)}******${no.takeLast(2)}"

@Composable
fun RailApp(screen: PhoneScreen) {
    when (screen.name) {
        "station" -> StationPicker(screen.p("field"))
        "date" -> RailDatePicker()
        "trains" -> TrainList()
        "train" -> TrainDetail(screen.p("no"), screen.p("date"))
        "login" -> RailLogin(screen.params)
        "confirm" -> ConfirmOrder(screen.p("no"), screen.p("date"), screen.p("cls"))
        "passenger_add" -> AddPassenger()
        "pay_order" -> PayOrder(screen.p("id"))
        "order" -> OrderDetail(screen.p("id"))
        "change" -> ChangeTrain(screen.p("id"))
        else -> RailHome()
    }
}

// ── home ──

@Composable
private fun RailHome() {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val tab = p.getState(APP, "tab", "home")
    val s = search(p)
    val w = world()
    PScreen("rail-home", bg = Color(0xFFF2F5F9)) {
        PColumn {
            when (tab) {
                "home" -> PBody {
                    Box {
                        Column(Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(Color(0xFF3D8BF0), Color(0xFF1F5FB8)))).padding(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 54.dp)) {
                            PText("铁路出行", size = 22.sp, weight = FontWeight.Bold, color = Color.White)
                            PText("安全 · 便捷 · 准点", size = 12.sp, color = Color.White.copy(alpha = 0.85f))
                        }
                    }
                    Column(Modifier.fillMaxWidth().offset(y = (-40).dp).padding(horizontal = 12.dp).shadow(6.dp, RoundedCornerShape(14.dp)).clip(RoundedCornerShape(14.dp)).background(Color.White).padding(start = 14.dp, end = 14.dp, top = 6.dp, bottom = 14.dp)) {
                        Row(Modifier.fillMaxWidth().hairline(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f).heightIn(min = 64.dp).clickable { nav.push("station", "field" to "from") }.padding(vertical = 12.dp).testTag("rail-from")) {
                                PText("出发地", size = 12.sp, color = Color(0xFF999999))
                                PText(s.from.ifEmpty { "请选择" }, size = 22.sp, weight = FontWeight.SemiBold, color = if (s.from.isEmpty()) PC.ph else PC.ink)
                            }
                            Box(Modifier.size(40.dp).clip(CircleShape).background(Color(0xFFF4F8FE)).border(1.dp, Color(0xFFD6E4F7), CircleShape).clickable { setSearch(p) { it.copy(from = it.to, to = it.from) } }, contentAlignment = Alignment.Center) {
                                Text("⇄", color = ACCENT, fontSize = 18.sp)
                            }
                            Column(Modifier.weight(1f).heightIn(min = 64.dp).clickable { nav.push("station", "field" to "to") }.padding(vertical = 12.dp).testTag("rail-to"), horizontalAlignment = Alignment.End) {
                                PText("到达地", size = 12.sp, color = Color(0xFF999999))
                                PText(s.to.ifEmpty { "请选择" }, size = 22.sp, weight = FontWeight.SemiBold, color = if (s.to.isEmpty()) PC.ph else PC.ink)
                            }
                        }
                        Row(Modifier.fillMaxWidth().heightIn(min = 50.dp).hairline().clickable { nav.push("date") }.padding(vertical = 14.dp).testTag("rail-date"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PText(PhoneDates.zhMonthDay(s.date), size = 18.sp, weight = FontWeight.Bold)
                            val rel = PhoneDates.zhRelativeDay(s.date, p.clock.date)
                            PText(if (rel == PhoneDates.zhWeekday(s.date)) PhoneDates.zhWeekday(s.date) else "$rel ${PhoneDates.zhWeekday(s.date)}", size = 15.sp)
                            Spacer(Modifier.weight(1f))
                            Text("›", color = PC.arrow, fontSize = 20.sp)
                        }
                        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                            Row(Modifier.heightIn(min = 30.dp).clickable { setSearch(p) { it.copy(highSpeed = !it.highSpeed) } }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                PCheck(s.highSpeed, ACCENT, 16.dp)
                                PText("只看高铁/动车", size = 13.sp, color = Color(0xFF555555))
                            }
                            Row(Modifier.heightIn(min = 30.dp).clickable { p.toast("学生票需先完成学生资质核验") }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                PCheck(false, ACCENT, 16.dp)
                                PText("学生票", size = 13.sp, color = Color(0xFF555555))
                            }
                        }
                        PBtn("查询车票", Modifier.fillMaxWidth(), accent = ACCENT, tag = "rail-search") {
                            when {
                                s.from.isEmpty() -> p.toast("请选择出发地")
                                s.to.isEmpty() -> p.toast("请选择到达地")
                                s.from == s.to -> p.toast("出发地和到达地不能相同")
                                else -> nav.push("trains")
                            }
                        }
                    }
                    Column(Modifier.offset(y = (-28).dp)) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(14.dp)).background(Color.White).padding(vertical = 8.dp)) {
                            val tiles = listOf("车票" to "🎫", "候补购票" to "⏳", "计次·定期票" to "🗓", "约车" to "🚗", "餐饮·特产" to "🍱", "酒店住宿" to "🏨", "旅游" to "🗺", "会员服务" to "⭐")
                            tiles.chunked(4).forEachIndexed { r, row ->
                                Row(Modifier.fillMaxWidth()) {
                                    row.forEachIndexed { c, (label, icon) ->
                                        Column(Modifier.weight(1f).heightIn(min = 60.dp).clickable { if (r != 0 || c != 0) p.toast(ZH.notOpen) }.padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                            Text(icon, fontSize = 22.sp)
                                            PText(label, size = 12.sp)
                                        }
                                    }
                                }
                            }
                        }
                        Gap(12.dp)
                        Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(10.dp)).background(PC.noteTopBg).padding(10.dp)) {
                            PText("温馨提示 购票、改签和退票需不晚于开车前30分钟办理；铁路客票预售期为15天。", size = 12.sp, color = PC.noteTopInk)
                        }
                    }
                }
                "service" -> PBody {
                    PBar("出行服务")
                    PGroup {
                        for (x in listOf("正晚点", "起售时间", "时刻表", "车站大屏", "检票口查询", "遗失物品查找")) PCell(x, onClick = { p.toast(ZH.notOpen) })
                    }
                }
                "orders" -> RailOrders()
                else -> PBody {
                    Row(Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(Color(0xFF3D8BF0), Color(0xFF1F5FB8)))).padding(horizontal = 18.dp, vertical = 30.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("👤", fontSize = 34.sp)
                        if (loggedIn(p)) Column {
                            PText(p.spec.profile.name, weight = FontWeight.Bold, color = Color.White, size = 16.sp)
                            PText(p.spec.profile.phone.replace(Regex("([0-9]{3})[0-9]{4}([0-9]{4})"), "$1****$2"), color = Color.White, size = 13.sp)
                        } else Box(Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.2f)).clickable { nav.push("login") }.padding(horizontal = 14.dp, vertical = 6.dp), contentAlignment = Alignment.Center) {
                            PText("登录/注册", color = Color.White, size = 15.sp)
                        }
                    }
                    PGroup("常用乘车人") {
                        for (x in PhoneWorlds.railPassengers(w, p.events)) PCell("${x.name}${if (x.self) "（本人）" else ""}", sub = "${x.idType} ${masked(x.idNo)}")
                    }
                    PGroup { for (x in listOf("我的钱包", "温馨服务", "设置")) PCell(x, onClick = { p.toast(ZH.notOpen) }) }
                }
            }
            PTabBar(
                listOf(Triple("home", "首页", "🏠"), Triple("service", "出行服务", "🧭"), Triple("orders", "订单", "📄"), Triple("me", "我的", "👤")),
                tab, ACCENT, "rail",
            ) { p.setState(APP, "tab", it) }
        }
    }
}

// ── station + date pickers ──

@Composable
private fun StationPicker(field: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    var q by remember { mutableStateOf("") }
    fun pick(name: String) {
        setSearch(p) { if (field == "from") it.copy(from = name) else it.copy(to = name) }
        nav.pop()
    }
    PScreen("rail-station-picker") {
        PColumn {
            PBar(if (field == "from") "选择出发地" else "选择到达地", onBack = nav::pop)
            Box(Modifier.background(Color.White).padding(horizontal = 12.dp, vertical = 10.dp)) {
                PSearchBox(q, { q = it }, "搜索城市/车站（支持汉字/拼音/简拼）", tag = "rail-station-search", autoFocus = true, mic = true)
            }
            PBody {
                if (q.isNotBlank()) {
                    val hits = PhoneRail.searchStations(w.stations, q)
                    if (hits.isNotEmpty()) PGroup { for (s in hits) PCell(s.name, sub = "${s.city} · ${s.pinyin.replace(" ", "")}", tag = "rail-station-option", onClick = { pick(s.name) }) }
                    else PEmpty("没有找到相关车站", "🚉")
                } else {
                    PSectionTitle("热门城市")
                    PChips { for (c in w.stations.map { it.city }.distinct()) PChip(c) { pick(c) } }
                    PSectionTitle("全部车站")
                    PGroup { for (s in w.stations) PCell(s.name, sub = s.city, onClick = { pick(s.name) }) }
                }
            }
        }
    }
}

@Composable
private fun RailDatePicker() {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val s = search(p)
    val today = p.clock.date
    val first = PhoneDates.addDays(today, -PhoneDates.weekday(today))
    val days = (0 until 28).map { PhoneDates.addDays(first, it) }
    PScreen("rail-date-picker") {
        PColumn {
            PBar("选择日期", onBack = nav::pop)
            PNote("铁路客票预售期为15天，今天可购买至 ${PhoneDates.zhMonthDay(PhoneDates.addDays(today, 14))} 的车票", top = true)
            Row(Modifier.fillMaxWidth().background(Color.White).hairline().padding(vertical = 6.dp)) {
                for (d in listOf("日", "一", "二", "三", "四", "五", "六")) PText(d, size = 12.sp, color = Color(0xFF999999), align = TextAlign.Center, modifier = Modifier.weight(1f))
            }
            PBody(bg = Color.White) {
                days.chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth()) {
                        for (d in week) {
                            val n = PhoneDates.daysBetween(today, d)
                            val ok = n in 0..14
                            val on = d == s.date
                            Column(
                                Modifier.weight(1f).padding(2.dp).heightIn(min = 52.dp).clip(RoundedCornerShape(8.dp)).background(if (on) ACCENT else Color.Transparent)
                                    .clickable(enabled = ok) { setSearch(p) { it.copy(date = d) }; nav.pop() }.testTag("rail-day-$d"),
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                            ) {
                                val weekend = PhoneDates.weekday(d) % 6 == 0
                                PText(d.substring(8).toInt().toString(), weight = FontWeight.Bold, color = when { on -> Color.White; !ok -> Color(0xFFCCCCCC); weekend -> PRICE; else -> PC.ink })
                                val label = when { n == 0 -> "今天"; n == 1 -> "明天"; n == 2 -> "后天"; ok || n < 0 -> ""; else -> "未开售" }
                                if (label.isNotEmpty()) PText(label, size = 10.sp, color = if (on) Color.White else if (!ok) Color(0xFFCCCCCC) else PC.ink)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── train list + detail ──

@Composable
private fun DayBar(date: String, onShift: (Int) -> Unit, onDate: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().background(ACCENT).padding(start = 6.dp, end = 6.dp, bottom = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        DayChip("‹ 前一天") { onShift(-1) }
        Box(Modifier.heightIn(min = 34.dp).clip(RoundedCornerShape(14.dp)).background(Color.White).then(if (onDate != null) Modifier.clickable(onClick = onDate) else Modifier).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
            PText(PhoneDates.zhDateLabel(date) + if (onDate != null) " ▾" else "", size = 13.sp, color = Color(0xFF1F5FB8), weight = FontWeight.SemiBold)
        }
        DayChip("后一天 ›") { onShift(1) }
    }
}

@Composable
private fun DayChip(label: String, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = 34.dp).clip(RoundedCornerShape(14.dp)).background(Color.White.copy(alpha = 0.16f)).clickable(onClick = onClick).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
        PText(label, size = 13.sp, color = Color.White)
    }
}

@Composable
private fun TrainList() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val s = search(p)
    var sort by remember { mutableStateOf("depart") }
    var available by remember { mutableStateOf(false) }
    val records = p.records
    val list = PhoneRail.searchTrains(w, s.from, s.to, s.date, PhoneRail.TrainFilter(s.highSpeed, available, sort), records)
    fun shift(n: Int) {
        val d = PhoneDates.addDays(s.date, n)
        val k = PhoneDates.daysBetween(p.clock.date, d)
        when {
            k < 0 -> p.toast("不能选择今天之前的日期")
            k >= 15 -> p.toast("该日期车票尚未开售")
            else -> setSearch(p) { it.copy(date = d) }
        }
    }
    PScreen("rail-trains") {
        PColumn {
            PBar("${s.from} ⇀ ${s.to}", onBack = nav::pop, accent = ACCENT)
            DayBar(s.date, ::shift) { nav.push("date") }
            PChipsBar {
                PChip("出发最早", sort == "depart", ACCENT) { sort = "depart" }
                PChip("耗时最短", sort == "duration", ACCENT) { sort = "duration" }
                PChip("价格最低", sort == "price", ACCENT) { sort = "price" }
                PChip("高铁动车", s.highSpeed, ACCENT) { setSearch(p) { it.copy(highSpeed = !it.highSpeed) } }
                PChip("只看有票", available, ACCENT) { available = !available }
            }
            PBody {
                if (list.isEmpty()) PEmpty("当前日期没有符合条件的车次，换个日期或车站试试", "🚄")
                for (t in list) TrainRow(t, records) { nav.push("train", "no" to t.no, "date" to t.date) }
                Gap(10.dp)
            }
        }
    }
}

@Composable
private fun TrainRow(t: RailTrain, records: List<dev.jeromeswannack.chineselearning.lab.core.phone.PhoneRecord>, onClick: () -> Unit) {
    PCard(onClick = onClick, tag = "rail-train-row-${t.no}") {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Column(Modifier.widthIn(min = 76.dp)) {
                PText(t.depart, size = 21.sp, weight = FontWeight.Bold)
                Row(verticalAlignment = Alignment.CenterVertically) { MiniTag("始", Color(0xFFF28C28)); PText(t.from, size = 12.sp, color = Color(0xFF555555)) }
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                PText(PhoneDates.zhDuration(PhoneDates.spanMinutes(t.depart, t.arrive)), size = 11.sp, color = Color(0xFF999999))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f).height(1.dp).background(Color(0xFFCFD8E3)))
                    PText(t.no, size = 13.sp, color = Color(0xFF333333), weight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 4.dp))
                    Box(Modifier.weight(1f).height(1.dp).background(Color(0xFFCFD8E3)))
                }
                PText(PhoneRail.trainKind(t.no), size = 11.sp, color = Color(0xFF999999))
            }
            Column(Modifier.widthIn(min = 76.dp), horizontalAlignment = Alignment.End) {
                Row { PText(t.arrive, size = 21.sp, weight = FontWeight.Bold); if (t.arrive < t.depart) PText("+1", size = 10.sp) }
                Row(verticalAlignment = Alignment.CenterVertically) { MiniTag("终", ACCENT); PText(t.to, size = 12.sp, color = Color(0xFF555555)) }
            }
            Column(Modifier.widthIn(min = 54.dp), horizontalAlignment = Alignment.End) {
                PPrice(t.seats.minOf { it.price }, color = PRICE)
                PText("起", size = 10.sp, color = Color(0xFF999999))
            }
        }
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for (o in t.seats) {
                val left = PhoneRail.seatsLeft(t, o.cls, records)
                PText("${o.cls}:${PhoneRail.seatsLabel(left, o.waitlist)}", size = 12.sp, color = if (left > 0) Color(0xFF333333) else if (o.waitlist) Color(0xFFF28C28) else Color(0xFFBBBBBB))
            }
        }
    }
}

@Composable
private fun MiniTag(text: String, color: Color) {
    Box(Modifier.padding(end = 2.dp).clip(RoundedCornerShape(3.dp)).background(color).padding(horizontal = 2.dp)) { Text(text, fontSize = 10.sp, color = Color.White) }
}

@Composable
private fun TrainDetail(no: String, date: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val t = PhoneRail.findTrain(w, no, date) ?: return PEmpty("车次信息不存在")
    var stops by remember { mutableStateOf(false) }
    var waitlist by remember { mutableStateOf(false) }
    val records = p.records
    PScreen("rail-train-detail") {
        PColumn {
            PBar("${t.no} ${PhoneDates.zhDateLabel(t.date)}", onBack = nav::pop, accent = ACCENT)
            Row(Modifier.fillMaxWidth().background(ACCENT).padding(start = 18.dp, end = 18.dp, top = 10.dp, bottom = 20.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column { PText(t.depart, size = 26.sp, weight = FontWeight.Bold, color = Color.White); PText(t.from, size = 13.sp, color = Color.White) }
                Column(Modifier.heightIn(min = 44.dp).clickable { stops = true }, horizontalAlignment = Alignment.CenterHorizontally) {
                    PText(t.no, size = 16.sp, weight = FontWeight.SemiBold, color = Color.White)
                    PText("${PhoneDates.zhDuration(PhoneDates.spanMinutes(t.depart, t.arrive))} · 经停 ›", size = 11.sp, color = Color.White.copy(alpha = 0.85f))
                }
                Column(horizontalAlignment = Alignment.End) { PText(t.arrive, size = 26.sp, weight = FontWeight.Bold, color = Color.White); PText(t.to, size = 13.sp, color = Color.White) }
            }
            PBody {
                PGroup {
                    for (o in t.seats) {
                        val left = PhoneRail.seatsLeft(t, o.cls, records)
                        Row(Modifier.fillMaxWidth().hairline().padding(14.dp).testTag("rail-seat-class-${o.cls}"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(Modifier.weight(1f)) {
                                PText(o.cls, size = 16.sp)
                                PText(if (left > 0) (if (left >= 20) "有票" else "剩${left}张") else if (o.waitlist) "无票，可候补" else "无票", size = 12.sp, color = if (left > 0) PC.green else Color(0xFF999999))
                            }
                            PPrice(o.price, color = PRICE)
                            when {
                                left > 0 -> PBtn("预订", small = true, accent = ACCENT, tag = "rail-book-${o.cls}") {
                                    if (!loggedIn(p)) nav.push("login", "next" to "confirm", "no" to t.no, "date" to t.date, "cls" to o.cls)
                                    else nav.push("confirm", "no" to t.no, "date" to t.date, "cls" to o.cls)
                                }
                                o.waitlist -> PBtn("候补", small = true, kind = BtnKind.LINE, accent = Color(0xFFF28C28)) { waitlist = true }
                                else -> PBtn("预订", small = true, kind = BtnKind.GREY, enabled = false) {}
                            }
                        }
                    }
                }
                PNote("· 票价为成人票价，实际以订单为准\n· 请提前到达车站，凭购票时所使用的有效身份证件原件检票乘车")
            }
        }
        PSheet(stops, { stops = false }, "${t.no} 经停站") {
            val list = t.stops ?: listOf(t.from, t.to)
            list.forEachIndexed { i, st ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(22.dp).clip(CircleShape).background(PC.tagBg), contentAlignment = Alignment.Center) { Text("${i + 1}", fontSize = 12.sp, color = ACCENT) }
                    PText(st, weight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    PText(if (i == 0) "${t.depart} 出发" else if (i == list.size - 1) "${t.arrive} 到达" else "停2分", color = Color(0xFF999999))
                }
            }
        }
        PDialog(waitlist, "候补购票", { waitlist = false }, actions = listOf(DialogAction(ZH.ok, primary = true) { waitlist = false })) {
            PDialogText("当前车次该席别余票不足。候补购票需预付票款，有人退票时系统将自动为您购票，不保证一定成功。本次练习请选择有余票的席别。")
        }
    }
}

// ── login ──

@Composable
private fun RailLogin(params: Map<String, String>) {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    var phone by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var agree by remember { mutableStateOf(false) }
    var wait by remember { mutableIntStateOf(0) }
    val expected = PhoneWorlds.smsCodeFor(p.startedAt)
    LaunchedEffect(wait) {
        if (wait > 0) {
            delay(1000)
            wait--
        }
    }
    PScreen("rail-login", bg = Color.White) {
        PColumn {
            PBar("", onBack = nav::pop)
            PBody(Modifier.padding(horizontal = 10.dp, vertical = 18.dp)) {
                PText("手机号登录", size = 24.sp, weight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
                PText("未注册的手机号验证后将自动注册", size = 13.sp, color = PC.muted, modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 18.dp))
                PField("+86", phone, { phone = it.filter(PhoneJs::isDigit).take(11) }, ZH.phonePlaceholder, numeric = true, tag = "rail-login-phone")
                PField("验证码", code, { code = it.filter(PhoneJs::isDigit).take(6) }, ZH.codePlaceholder, numeric = true, tag = "rail-login-code", right = {
                    Box(Modifier.heightIn(min = 40.dp).clickable(enabled = wait <= 0) {
                        if (!PhoneRail.validPhone(phone)) {
                            p.emit("error", "code" to JsonPrimitive("phone"), "app" to JsonPrimitive(APP))
                            p.toast(ZH.badPhone)
                            return@clickable
                        }
                        wait = 60
                        p.scope.launch {
                            delay(1500)
                            p.sms("10690000", PhoneCopy.smsCode(APP, expected))
                        }
                        p.toast("验证码已发送")
                    }.testTag("rail-login-send"), contentAlignment = Alignment.Center) {
                        PText(if (wait > 0) ZH.smsSent(wait) else ZH.sendSms, size = 14.sp, color = if (wait > 0) Color(0xFF999999) else ACCENT)
                    }
                })
                Row(Modifier.fillMaxWidth().clickable { agree = !agree }.padding(horizontal = 14.dp, vertical = 12.dp).testTag("rail-login-agree"), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    PCheck(agree, ACCENT, 16.dp)
                    PText("我已阅读并同意《用户服务协议》和《隐私政策》", size = 12.sp, color = PC.value)
                }
                PBtn("登录", Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), accent = ACCENT, enabled = phone.length >= 11 && code.length >= 6, tag = "rail-login-submit") {
                    when {
                        !agree -> p.toast("请先阅读并同意用户服务协议和隐私政策")
                        phone != p.spec.profile.phone.replace(" ", "") -> {
                            p.emit("error", "code" to JsonPrimitive("login_phone"), "app" to JsonPrimitive(APP))
                            p.toast("该手机号未绑定账号，请输入您注册时使用的手机号")
                        }
                        code != expected -> {
                            p.emit("error", "code" to JsonPrimitive("sms_code"), "app" to JsonPrimitive(APP))
                            p.toast(ZH.wrongCode)
                        }
                        else -> {
                            p.emit("login", "app" to JsonPrimitive(APP))
                            p.toast("登录成功")
                            nav.pop()
                            val next = params["next"]
                            if (!next.isNullOrEmpty()) nav.push(next, *params.filterKeys { it != "next" }.toList().toTypedArray())
                        }
                    }
                }
            }
        }
    }
}

// ── 填写订单 ──

@Composable
private fun ConfirmOrder(no: String, date: String, cls: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val t = PhoneRail.findTrain(w, no, date) ?: return PEmpty("车次信息不存在")
    val passengers = PhoneWorlds.railPassengers(w, p.events)
    val pickedKey = "picked:$no:$date"
    val picked = p.getState(APP, pickedKey, emptyList<String>())
    var letters by remember { mutableStateOf(listOf<String>()) }
    var confirm by remember { mutableStateOf(false) }
    val lastAdded = p.getState<String?>(APP, "lastAdded", null)
    LaunchedEffect(lastAdded) {
        if (lastAdded != null) {
            p.updateState(APP, pickedKey, emptyList<String>()) { if (lastAdded in it) it else it + lastAdded }
            p.setState<String?>(APP, "lastAdded", null)
        }
    }
    val layout = PhoneRail.seatLetters(cls)
    val offer = t.seats.first { it.cls == cls }
    val chosen = passengers.filter { it.id in picked }
    val total = PhoneDates.round2(offer.price * chosen.size)

    fun toggleLetter(row: Int, l: String) {
        val key = "$row$l"
        letters = when {
            key in letters -> letters - key
            letters.size >= maxOf(1, chosen.size) -> {
                p.toast(if (chosen.isNotEmpty()) "最多选择${chosen.size}个座位" else "请先选择乘车人")
                letters
            }
            else -> letters + key
        }
    }

    fun submit() {
        when {
            chosen.isEmpty() -> {
                p.emit("error", "code" to JsonPrimitive("no_passenger"), "app" to JsonPrimitive(APP))
                p.toast("请选择乘车人")
            }
            PhoneRail.seatsLeft(t, cls, p.records) < chosen.size -> p.toast("余票不足，请减少乘车人或选择其他车次")
            PhoneDates.minutesUntil(p.clock.date, p.clock.time, t.date, t.depart) < 30 -> p.toast("距开车时间不足30分钟，请到车站窗口办理")
            else -> confirm = true
        }
    }

    fun place() {
        confirm = false
        val id = p.newId("rail_order", "R")
        val wanted = letters.map { it.substring(1) }.distinct()
        val seats = PhoneRail.assignSeats(t, cls, chosen.size, wanted, id)
        val data = PhoneRail.railOrderData(t, cls, chosen, seats, id, orderNo(p.startedAt, p.recordsOf("rail_order").size + 1), "unpaid")
        p.write("rail_order", id, PhoneJs.merge(data, PhoneRuntime.obj("placed_at" to p.now())))
        p.setState(APP, pickedKey, emptyList<String>())
        letters = emptyList()
        nav.resetTo("pay_order" to mapOf("id" to id))
    }

    PScreen("rail-confirm") {
        PColumn {
            PBar("填写订单", onBack = nav::pop)
            PBody {
                PCard(radius = 12.dp) {
                    TrainOd(t.depart, t.from, t.no, PhoneDates.zhDuration(PhoneDates.spanMinutes(t.depart, t.arrive)), t.arrive, t.to)
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp).hairline(Color(0xFFE5E7EB), top = true).padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        PText("${PhoneDates.zhDateLabel(t.date)} · $cls", size = 13.sp, color = Color(0xFF555555))
                        PPrice(offer.price, color = PRICE)
                    }
                }
                PGroup("乘车人") {
                    for (x in passengers) {
                        val on = x.id in picked
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 52.dp).hairline().clickable { p.setState(APP, pickedKey, if (on) picked - x.id else picked + x.id) }.padding(horizontal = 14.dp, vertical = 12.dp).testTag("rail-passenger-${x.id}"),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            PCheck(on, ACCENT)
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) { PText(x.name, weight = FontWeight.Bold); if (x.self) PTag("本人") }
                                PText("${x.idType} ${masked(x.idNo)} · ${x.type ?: "成人"}票", size = 12.sp, color = Color(0xFF999999))
                            }
                        }
                    }
                    Box(Modifier.fillMaxWidth().heightIn(min = 46.dp).clickable { nav.push("passenger_add") }.testTag("rail-add-passenger"), contentAlignment = Alignment.Center) {
                        PText("＋ 添加乘车人", size = 15.sp, color = ACCENT)
                    }
                }
                if (layout != null) {
                    PGroup("选座服务") {
                        Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 10.dp).testTag("rail-seat-picker")) {
                            PText("已选 ${letters.size}/${chosen.size} · 靠窗 A、F　过道 C、D", size = 13.sp, color = PC.muted)
                            for (row in (if (chosen.size > 1) listOf(1, 2) else listOf(1))) {
                                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                                    Text("窗", fontSize = 10.sp, color = Color(0xFF999999))
                                    for (l in layout.letters) {
                                        val on = "$row$l" in letters
                                        Box(
                                            Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(if (on) ACCENT else Color(0xFFF4F8FE)).border(1.5.dp, if (on) ACCENT else Color(0xFFC9D6E8), RoundedCornerShape(8.dp)).clickable { toggleLetter(row, l) }.testTag("rail-seat-$row$l"),
                                            contentAlignment = Alignment.Center,
                                        ) { Text(l, fontWeight = FontWeight.SemiBold, color = if (on) Color.White else PC.ink) }
                                        if (l == layout.aisleAfter) Text("过道", fontSize = 10.sp, color = Color(0xFFBBBBBB), modifier = Modifier.padding(horizontal = 6.dp))
                                    }
                                    Text("窗", fontSize = 10.sp, color = Color(0xFF999999))
                                }
                            }
                            PText("如剩余席位不足，系统将自动为您分配席位。", size = 12.sp, color = PC.muted)
                        }
                    }
                } else PNote("该席别暂不支持在线选座，系统将自动分配座位。")
                PNote("提交订单表示已阅读并同意《铁路旅客运输规程》及《购票须知》。")
            }
            PFooter {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    PText("订单总价", size = 13.sp, color = PC.value)
                    PPrice(total, big = true, color = PRICE)
                }
                PBtn(ZH.submitOrder, accent = PRICE, tag = "rail-submit") { submit() }
            }
        }
        PDialog(confirm, "请核对以下信息", { confirm = false }, actions = listOf(DialogAction("返回修改") { confirm = false }, DialogAction("确认", primary = true, tag = "rail-confirm-ok") { place() })) {
            PText("${PhoneDates.zhDateLabel(t.date)} ${t.no} ${t.from} ${t.depart} 开 → ${t.to}", lineHeight = 24.sp)
            for (x in chosen) PText("${x.name} · $cls · ${x.type ?: "成人"}票", lineHeight = 24.sp)
        }
    }
}

@Composable
private fun TrainOd(depart: String, from: String, no: String, sub: String, arrive: String, to: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column { PText(depart, size = 22.sp, weight = FontWeight.Bold); PText(from, size = 13.sp) }
        Column(horizontalAlignment = Alignment.CenterHorizontally) { PText(no, weight = FontWeight.SemiBold); PText(sub, size = 11.sp, color = Color(0xFF999999)) }
        Column(horizontalAlignment = Alignment.End) { PText(arrive, size = 22.sp, weight = FontWeight.Bold); PText(to, size = 13.sp) }
    }
}

private val COUNTRIES = listOf("英国", "美国", "加拿大", "澳大利亚", "新西兰", "爱尔兰", "法国", "德国", "意大利", "西班牙", "日本", "韩国", "新加坡")

@Composable
private fun AddPassenger() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    var form by remember { mutableStateOf(RailPassenger(idType = "中国居民身份证", type = "成人")) }
    var sheet by remember { mutableStateOf<String?>(null) }
    val foreign = form.idType == "护照" || form.idType == "外国人永久居留身份证"
    fun save() {
        val draft = form.copy(
            name = if (foreign) PhoneRail.normalizePassportName(form.name) else form.name.trim(),
            idNo = form.idNo.trim().uppercase(),
        )
        val problems = PhoneRail.passengerProblems(draft, PhoneWorlds.railPassengers(w, p.events))
        if (problems.isNotEmpty()) {
            p.emit("error", "code" to JsonPrimitive("passenger_form"), "app" to JsonPrimitive(APP))
            p.toast(problems[0])
            return
        }
        val id = "p_${p.recordsOf("rail_passenger").size + 1}"
        p.write(
            "rail_passenger", id,
            "id_type" to draft.idType, "type" to draft.type, "name" to draft.name, "id_no" to draft.idNo, "country" to draft.country, "phone" to draft.phone?.ifEmpty { null }, "id" to id,
        )
        // The order page underneath ticks the new passenger.
        p.setState<String?>(APP, "lastAdded", id)
        p.toast("添加成功")
        nav.pop()
    }
    PScreen("rail-add-passenger-form") {
        PColumn {
            PBar("添加乘车人", onBack = nav::pop)
            PBody {
                PGroup {
                    PCell("证件类型", value = form.idType, tag = "rail-id-type", onClick = { sheet = "id" })
                    if (foreign) PCell("国家/地区", value = form.country ?: "请选择", valueColor = if (form.country == null) PC.ph else PC.value, tag = "rail-country", onClick = { sheet = "country" })
                    PField("姓名", form.name, { form = form.copy(name = it) }, if (foreign) "与证件上的姓名一致（英文大写）" else "请输入姓名", tag = "rail-pas-name")
                    PField("证件号码", form.idNo, { form = form.copy(idNo = it) }, "请输入证件号码", tag = "rail-pas-no")
                    PCell("旅客类型", value = form.type, onClick = { sheet = "type" })
                    PField("手机号码", form.phone ?: "", { form = form.copy(phone = it.filter(PhoneJs::isDigit).take(11)) }, "选填，用于接收出行通知", numeric = true)
                }
                PNote("请准确填写乘车人信息，乘车时需出示与购票时一致的有效身份证件原件。")
                Box(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) { PBtn(ZH.save, Modifier.fillMaxWidth(), accent = ACCENT, tag = "rail-pas-save") { save() } }
            }
        }
        PSheet(sheet == "id", { sheet = null }, "证件类型") {
            for (x in RAIL_ID_TYPES) PCell(x, value = if (form.idType == x) "✓" else "", arrow = false, tag = "rail-id-type-option-$x", onClick = { form = form.copy(idType = x); sheet = null })
        }
        PSheet(sheet == "country", { sheet = null }, "国家/地区") {
            for (x in COUNTRIES) PCell(x, value = if (form.country == x) "✓" else "", arrow = false, tag = "rail-country-option-$x", onClick = { form = form.copy(country = x); sheet = null })
        }
        PSheet(sheet == "type", { sheet = null }, "旅客类型") {
            for (x in RAIL_PASSENGER_TYPES) PCell(x, arrow = false, onClick = { form = form.copy(type = x); sheet = null })
        }
    }
}

// ── pay, orders, order detail ──

@Composable
private fun PayOrder(id: String) {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val o = p.record("rail_order", id) ?: return PEmpty("订单不存在")
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1000); tick++ } }
    @Suppress("UNUSED_EXPRESSION") tick
    val placed = PhoneJs.n(o, "placed_at").let { if (it.isNaN()) p.now().toDouble() else it }
    val left = maxOf(0L, 30 * 60 - ((p.now() - placed.toLong()) / 1000))
    fun payNow() {
        p.scope.launch {
            val r = p.pay(PayRequest(APP, "${PhoneJs.s(o, "train_no")} ${PhoneJs.s(o, "seat_class")} ${PhoneJs.list(o, "seats").size}张", "铁路出行", PhoneJs.n(o, "total"))) ?: return@launch
            p.write("rail_order", id, "status" to "paid", "pay_method" to r.method, "paid_at" to p.now())
            p.sms(
                "10690000",
                "【铁路出行】订单${PhoneJs.s(o, "order_no")}，${PhoneJs.list(o, "passengers").joinToString("、")}您已购${PhoneDates.zhMonthDay(PhoneJs.s(o, "date"))}${PhoneJs.s(o, "train_no")}次${PhoneJs.list(o, "seats").joinToString("、")}号，${PhoneJs.s(o, "from")}站${PhoneJs.s(o, "depart")}开，${PhoneJs.s(o, "gate").ifEmpty { "检票口请留意车站公告" }}。",
                OpenTarget(APP, "order", mapOf("id" to id)),
            )
            nav.resetTo("order" to mapOf("id" to id, "fresh" to "true"))
        }
    }
    PScreen("rail-pay-order") {
        PColumn {
            PBar("订单待支付", onBack = nav::home)
            PBody {
                Column(Modifier.fillMaxWidth().background(ACCENT).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    PText("席位已锁定", size = 18.sp, weight = FontWeight.Bold, color = Color.White)
                    PText("请在 ${PhoneDates.pad2((left / 60).toInt())}:${PhoneDates.pad2((left % 60).toInt())} 内完成支付，逾期将自动取消订单", size = 13.sp, color = Color.White, modifier = Modifier.testTag("rail-countdown"))
                }
                OrderCard(o)
            }
            PFooter {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    PText("合计", size = 13.sp, color = PC.value)
                    PPrice(PhoneJs.n(o, "total"), big = true, color = PRICE)
                }
                PBtn("取消订单", kind = BtnKind.LINE) {
                    p.write("rail_order", id, "status" to "cancelled")
                    p.toast("订单已取消")
                    nav.home()
                }
                PBtn(ZH.payNow, accent = PRICE, tag = "rail-pay") { payNow() }
            }
        }
    }
}

@Composable
private fun OrderCard(o: JsonObject) {
    PCard(tag = "rail-order-card") {
        TrainOd(PhoneJs.s(o, "depart"), PhoneJs.s(o, "from"), PhoneJs.s(o, "train_no"), PhoneDates.zhDateLabel(PhoneJs.s(o, "date")), PhoneJs.s(o, "arrive"), PhoneJs.s(o, "to"))
        val seats = PhoneJs.list(o, "seats")
        PhoneJs.list(o, "passengers").forEachIndexed { i, name ->
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                PText(name, weight = FontWeight.Bold)
                Row(Modifier.weight(1f)) {
                    PText("${PhoneJs.s(o, "seat_class")} · ")
                    PText("${seats.getOrElse(i) { "" }}号", weight = FontWeight.Bold, modifier = Modifier.testTag("rail-seat"))
                }
                PPrice(PhoneJs.n(o, "price_each"))
            }
        }
    }
}

private val STATUS_ZH = mapOf("unpaid" to "待支付", "paid" to "已支付", "refunded" to "已退票", "changed" to "已改签", "cancelled" to "已取消")

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.RailOrders() {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    var tab by remember { mutableStateOf("go") }
    val orders = p.recordsOf("rail_order").reversed()
    val list = orders.filter { val st = PhoneJs.s(it.data, "status"); if (tab == "go") st == "paid" else if (tab == "unpaid") st == "unpaid" else true }
    PBody(tag = "rail-orders") {
        PBar("订单")
        PTabs(listOf("go" to "未出行", "unpaid" to "待支付", "all" to "全部订单"), tab, ACCENT) { tab = it }
        if (list.isEmpty()) PEmpty("暂无订单", "🎫")
        for (r in list) {
            val st = PhoneJs.s(r.data, "status")
            PCard(onClick = { nav.push(if (st == "unpaid") "pay_order" else "order", "id" to r.id) }, tag = "rail-order-row") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        PText("${PhoneJs.s(r.data, "from")} → ${PhoneJs.s(r.data, "to")}", weight = FontWeight.Bold)
                        PText("${PhoneDates.zhDateLabel(PhoneJs.s(r.data, "date"))} ${PhoneJs.s(r.data, "depart")} 开 · ${PhoneJs.s(r.data, "train_no")}", size = 12.sp, color = Color(0xFF888888))
                    }
                    PText(STATUS_ZH[st] ?: "", size = 13.sp, color = when (st) { "unpaid" -> PRICE; "paid" -> ACCENT; else -> Color(0xFF999999) })
                }
            }
        }
    }
}

@Composable
private fun OrderDetail(id: String) {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val o = p.record("rail_order", id) ?: return PEmpty("订单不存在")
    var refund by remember { mutableStateOf(false) }
    val status = PhoneJs.s(o, "status")
    val total = PhoneJs.n(o, "total")
    val fee = PhoneRail.refundFee(total, p.clock.date, p.clock.time, PhoneJs.s(o, "date"), PhoneJs.s(o, "depart"))
    fun doRefund() {
        refund = false
        if (fee == null) return p.toast("已过开车时间，无法办理退票")
        val back = PhoneDates.round2(total - fee)
        p.write("rail_order", id, "status" to "refunded", "refund_fee" to fee, "refunded_at" to p.now())
        p.write("payment", p.newId("payment", "P"), "app" to APP, "title" to "${PhoneJs.s(o, "train_no")} 退票退款", "payee" to "铁路出行", "amount" to back, "method" to (PhoneJs.sOrNull(o, "pay_method") ?: "balance"), "direction" to "in", "status" to "paid")
        p.sms("10690000", "【铁路出行】您好，${PhoneJs.list(o, "passengers").joinToString("、")}已办理${PhoneDates.zhMonthDay(PhoneJs.s(o, "date"))}${PhoneJs.s(o, "train_no")}次退票，应退票款${PhoneDates.yuan(back)}元，退票费${PhoneDates.yuan(fee)}元，将在1-7个工作日退回原支付账户。")
        p.toast("退票成功")
    }
    PScreen("rail-order-detail") {
        PColumn {
            PBar("订单详情", onBack = nav::home)
            PBody {
                Column(Modifier.fillMaxWidth().background(if (status == "paid") ACCENT else Color(0xFF9AA5B1)).padding(horizontal = 16.dp, vertical = 18.dp).testTag("rail-order-status")) {
                    PText(if (status == "paid") "支付成功" else STATUS_ZH[status] ?: "", size = 20.sp, weight = FontWeight.Bold, color = Color.White)
                    PText("订单号 ${PhoneJs.s(o, "order_no")}", size = 12.sp, color = Color.White.copy(alpha = 0.85f))
                }
                OrderCard(o)
                if (status == "paid") {
                    Column(Modifier.fillMaxWidth().padding(10.dp).clip(RoundedCornerShape(12.dp)).background(Color.White).padding(14.dp).testTag("rail-gate"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        PText(PhoneJs.s(o, "gate").ifEmpty { "检票口以车站公告为准" }, size = 18.sp, color = Color(0xFF1F5FB8), weight = FontWeight.Bold)
                        PText("电子客票，凭购票时所使用的有效身份证件原件检票乘车", size = 12.sp, color = Color(0xFF888888))
                    }
                }
                if (status == "refunded") PNote("已退票：退票费 ¥${PhoneDates.yuan(PhoneJs.n(o, "refund_fee").let { if (it.isNaN()) 0.0 else it })}，票款将退回原支付账户。")
                if (status == "changed") PNote("该车票已改签，请在订单列表中查看新车票。")
            }
            if (status == "paid") {
                PFooter {
                    Spacer(Modifier.weight(1f))
                    PBtn("退票", kind = BtnKind.LINE, tag = "rail-refund") { refund = true }
                    PBtn("变更到站", kind = BtnKind.LINE) { p.toast(ZH.notOpen) }
                    PBtn("改签", kind = BtnKind.LINE, accent = ACCENT, tag = "rail-change") {
                        if (o["changed_from"] != null) p.toast("该车票已改签过一次，不能再次改签") else nav.push("change", "id" to id)
                    }
                }
            }
        }
        PDialog(refund, "退票确认", { refund = false }, tag = "rail-refund-dialog", actions = listOf(DialogAction("再想想") { refund = false }, DialogAction("确认退票", primary = true, tag = "rail-refund-ok") { doRefund() })) {
            PText("${PhoneJs.s(o, "train_no")} ${PhoneDates.zhDateLabel(PhoneJs.s(o, "date"))} ${PhoneJs.s(o, "depart")} 开", lineHeight = 25.sp)
            PText("票价：¥${PhoneDates.yuan(total)}　退票费：¥${PhoneDates.yuan(fee ?: 0.0)}", lineHeight = 25.sp)
            PText("应退金额：¥${PhoneDates.yuan(PhoneDates.round2(total - (fee ?: 0.0)))}", weight = FontWeight.Bold, lineHeight = 25.sp)
            PText(PhoneRail.refundRateLabel(p.clock.date, p.clock.time, PhoneJs.s(o, "date"), PhoneJs.s(o, "depart")), size = 12.sp, color = Color(0xFF999999))
        }
    }
}

@Composable
private fun ChangeTrain(id: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val o = p.record("rail_order", id) ?: return PEmpty("订单不存在")
    var date by remember { mutableStateOf(PhoneJs.sOrNull(o, "date") ?: p.clock.date) }
    var pick by remember { mutableStateOf<Pair<RailTrain, String>?>(null) }
    val records = p.records
    val options = PhoneRail.changeOptions(w, PhoneJs.s(o, "train_no"), PhoneJs.s(o, "date"), PhoneJs.s(o, "from"), PhoneJs.s(o, "to"), p.clock.date, p.clock.time).filter { it.date == date }
    val count = PhoneJs.list(o, "passengers").size
    val oldTotal = PhoneJs.n(o, "total")
    fun confirm() {
        val (t, cls) = pick ?: return
        pick = null
        val offer = t.seats.first { it.cls == cls }
        val diff = PhoneRail.changeDifference(oldTotal, PhoneDates.round2(offer.price * count))
        p.scope.launch {
            var method = PhoneJs.sOrNull(o, "pay_method") ?: "balance"
            if (diff > 0) {
                val r = p.pay(PayRequest(APP, "改签补差价 ${t.no} $cls", "铁路出行", diff)) ?: return@launch
                method = r.method
            }
            val newId = p.newId("rail_order", "R")
            val pas = PhoneJs.list(o, "passenger_ids").mapNotNull { pid -> PhoneWorlds.railPassengers(w, p.events).firstOrNull { it.id == pid } }
            val seats = PhoneRail.assignSeats(t, cls, count, emptyList(), newId)
            p.write("rail_order", id, "status" to "changed", "changed_to" to newId)
            val data = PhoneRail.railOrderData(t, cls, pas, seats, newId, PhoneJs.s(o, "order_no"), "paid", PhoneJs.sOrNull(o, "order_id") ?: id)
            p.write("rail_order", newId, PhoneJs.merge(data, PhoneRuntime.obj("pay_method" to method)))
            if (diff < 0) p.write("payment", p.newId("payment", "P"), "app" to APP, "title" to "${t.no} 改签退还差额", "payee" to "铁路出行", "amount" to -diff, "method" to method, "direction" to "in", "status" to "paid")
            p.sms("10690000", "【铁路出行】订单${PhoneJs.s(o, "order_no")}，您已改签${PhoneDates.zhMonthDay(t.date)}${t.no}次${seats.joinToString("、")}号，${t.from}站${t.depart}开，${t.gate ?: ""}。原车票已失效。")
            p.toast("改签成功")
            nav.resetTo("order" to mapOf("id" to newId))
        }
    }
    PScreen("rail-change-list") {
        PColumn {
            PBar("改签", onBack = nav::pop)
            PNote("原车次 ${PhoneJs.s(o, "train_no")} ${PhoneDates.zhDateLabel(PhoneJs.s(o, "date"))} ${PhoneJs.s(o, "depart")} 开 · ${PhoneJs.s(o, "seat_class")} ¥${PhoneDates.yuan(oldTotal)}。改签后原车票失效；每张车票只能改签一次。", top = true)
            DayBar(date, { n ->
                val d = PhoneDates.addDays(date, n)
                val k = PhoneDates.daysBetween(p.clock.date, d)
                if (k in 0..14) date = d
            }, null)
            PBody {
                if (options.isEmpty()) PEmpty("当日没有可改签的车次", "🚄")
                for (t in options) {
                    PCard(tag = "rail-change-row-${t.no}") {
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            PText(t.depart, size = 18.sp, weight = FontWeight.Bold)
                            PText("→")
                            PText(t.arrive, size = 18.sp, weight = FontWeight.Bold)
                            PText(t.no, weight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp))
                            Spacer(Modifier.weight(1f))
                            PText(PhoneDates.zhDuration(PhoneDates.spanMinutes(t.depart, t.arrive)), color = Color(0xFF999999))
                        }
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (s in t.seats) {
                                val left = PhoneRail.seatsLeft(t, s.cls, records)
                                val ok = left >= count
                                Column(
                                    Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFF4F8FE)).border(1.dp, Color(0xFFD6E4F7), RoundedCornerShape(8.dp))
                                        .then(if (ok) Modifier.clickable { pick = t to s.cls } else Modifier).padding(4.dp).testTag("rail-change-seat-${t.no}-${s.cls}"),
                                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                                ) {
                                    PText(s.cls, color = if (ok) PC.ink else Color(0xFFBBBBBB))
                                    PText(if (ok) "¥${PhoneDates.yuan(s.price)} ${PhoneRail.seatsLabel(left)}" else "无票", size = 11.sp, color = Color(0xFF888888))
                                }
                            }
                        }
                    }
                }
            }
        }
        PDialog(pick != null, "确认改签", { pick = null }, actions = listOf(DialogAction(ZH.cancel) { pick = null }, DialogAction("确认改签", primary = true, tag = "rail-change-ok") { confirm() })) {
            pick?.let { (t, cls) ->
                PText("新车次：${t.no} ${PhoneDates.zhDateLabel(t.date)} ${t.depart} 开 · $cls", lineHeight = 25.sp)
                val diff = PhoneRail.changeDifference(oldTotal, PhoneDates.round2((t.seats.firstOrNull { it.cls == cls }?.price ?: 0.0) * count))
                PText(if (diff > 0) "需补差价：¥${PhoneDates.yuan(diff)}" else if (diff < 0) "退还差额：¥${PhoneDates.yuan(-diff)}" else "票价相同，无需补差价", weight = FontWeight.Bold, lineHeight = 25.sp)
            }
        }
    }
}
