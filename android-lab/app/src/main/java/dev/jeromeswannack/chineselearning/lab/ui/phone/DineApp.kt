package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.DineRestaurant
import dev.jeromeswannack.chineselearning.lab.core.phone.DineWorld
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDine.BookingDraft
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import kotlinx.coroutines.delay

/*
 * 吃喝玩乐 (web apps/DineApp.tsx) — search / 附近热门 (★ 评分, 人均, 区域), a restaurant (口味 / 环境 /
 * 服务, 推荐菜, 评价), 排队取号 (the table type follows the party size; "前方还有8桌"), 订座 (date, 人数,
 * times with 已满, 大厅 / 包间 with a 最低消费, 联系人 先生 / 女士, 手机号 → 商家确认中 → 已确认), and
 * 💬 咨询 the restaurant (a persona).
 */

private const val APP = "dine"
private val ACCENT = Color(0xFFEE5A2C)

@Composable
private fun world(): DineWorld = LocalPhone.current.spec.world.dine!!

@Composable
fun DineApp(screen: PhoneScreen) {
    when (screen.name) {
        "search" -> Search()
        "restaurant" -> Restaurant(screen.p("id"))
        "queue" -> Queue(screen.p("id"))
        "ticket" -> QueueTicketPage(screen.p("id"))
        "book" -> Book(screen.p("id"))
        "booking" -> BookingDone(screen.p("id"))
        "chat" -> HostChat(screen.p("id"))
        "mine" -> Mine()
        else -> DineHome()
    }
}

@Composable
private fun DineTags(tags: List<String>?) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) { for (t in tags ?: emptyList()) PLineTag(t, color = ACCENT, border = Color(0xFFF8C4B1)) }
}

@Composable
private fun RestaurantRow(r: DineRestaurant, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(Color.White).tap(onClick = onClick).hairline().padding(12.dp).testTag("dine-restaurant-${r.id}"), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(72.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFFFEFE8)), contentAlignment = Alignment.Center) { Text(r.emoji ?: "🍽", fontSize = 34.sp) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            PText(r.name, size = 16.sp, weight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                PStars(r.rating, 12.sp)
                PText(PhoneJs.numStr(r.rating), size = 12.sp, color = ACCENT, weight = FontWeight.Bold)
                PText("人均¥${PhoneJs.numStr(r.avgPrice)}", size = 12.sp, color = PC.value)
            }
            PText("${r.cuisine} · ${r.district}", size = 12.sp, color = PC.muted)
            DineTags(r.tags)
        }
    }
}

@Composable
private fun DineHome() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    PScreen("dine-home") {
        PColumn {
            Row(Modifier.fillMaxWidth().background(ACCENT).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PText("上海 ▾", color = Color.White, weight = FontWeight.Bold)
                Box(Modifier.weight(1f).heightIn(min = 36.dp).clip(RoundedCornerShape(18.dp)).background(Color.White).tap { nav.push("search") }.padding(horizontal = 12.dp).testTag("dine-search-open"), contentAlignment = Alignment.CenterStart) {
                    PText("🔍 搜索商户、地点、菜名", color = PC.ph, size = 13.sp, maxLines = 1)
                }
                Box(Modifier.heightIn(min = 40.dp).tap { nav.push("mine") }.padding(horizontal = 4.dp).testTag("dine-mine"), contentAlignment = Alignment.Center) { PText("我的", color = Color.White) }
            }
            PBody {
                val cats = listOf("美食" to "🍲", "火锅" to "🫕", "本帮菜" to "🥢", "小吃快餐" to "🥟", "休闲娱乐" to "🎤", "酒店" to "🏨", "丽人" to "💅", "亲子" to "🧸")
                Column(Modifier.fillMaxWidth().background(Color.White).padding(vertical = 8.dp)) {
                    for (row in cats.chunked(4)) Row(Modifier.fillMaxWidth()) {
                        for ((name, icon) in row) Column(Modifier.weight(1f).heightIn(min = 64.dp).tap { p.toast(ZH.notOpen) }.padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(icon, fontSize = 26.sp)
                            PText(name, size = 12.sp, color = PC.value)
                        }
                    }
                }
                PSectionTitle("附近热门 · 必吃榜")
                for (r in w.restaurants) RestaurantRow(r) { nav.push("restaurant", "id" to r.id) }
            }
        }
    }
}

@Composable
private fun Search() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    var q by remember { mutableStateOf("") }
    val t = q.trim()
    val hits = if (t.isEmpty()) emptyList() else w.restaurants.filter { r -> r.name.contains(t) || r.cuisine.contains(t) || r.district.contains(t) || (r.dishes ?: emptyList()).any { it.contains(t) } }
    PScreen("dine-search") {
        PColumn {
            PBar("", onBack = nav::pop)
            Box(Modifier.background(Color.White).padding(horizontal = 12.dp, vertical = 8.dp)) { PSearchBox(q, { q = it }, "搜索商户、地点、菜名", tag = "dine-search-input", autoFocus = true, mic = true) }
            PBody {
                if (t.isNotEmpty()) {
                    if (hits.isEmpty()) PEmpty("没有找到相关商户", "🔍")
                    for (r in hits) RestaurantRow(r) { nav.push("restaurant", "id" to r.id) }
                }
            }
        }
    }
}

@Composable
private fun Restaurant(id: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val r = w.restaurants.first { it.id == id }
    PScreen("dine-restaurant-page") {
        PColumn {
            PBar("", onBack = nav::pop, right = { PBarButton("☆") { p.toast("已收藏") } })
            PBody {
                Column(Modifier.fillMaxWidth().background(Color.White).padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Box(Modifier.size(84.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFFFEFE8)), contentAlignment = Alignment.Center) { Text(r.emoji ?: "🍽", fontSize = 42.sp) }
                    PText(r.name, size = 20.sp, weight = FontWeight.Bold)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        PStars(r.rating)
                        PText(PhoneJs.numStr(r.rating), color = ACCENT, weight = FontWeight.Bold)
                        PText("人均¥${PhoneJs.numStr(r.avgPrice)}", color = PC.value)
                    }
                    r.scores?.let { s -> PText("口味${PhoneJs.numStr(s[0])} 环境${PhoneJs.numStr(s[1])} 服务${PhoneJs.numStr(s[2])}", size = 12.sp, color = PC.muted) }
                    DineTags(r.tags)
                }
                PGroup {
                    PCell(r.address, sub = r.district, icon = "📍", onClick = { p.toast("地图导航：暂未开放") })
                    PCell("营业时间 ${r.hours}", icon = "🕘", arrow = false)
                }
                r.dishes?.let { dishes ->
                    PGroup("推荐菜") { PChips(Modifier.padding(12.dp)) { for (d in dishes) PChip(d) } }
                }
                PGroup("网友点评（${(r.reviews ?: emptyList()).size}）") {
                    for (v in r.reviews ?: emptyList()) {
                        Column(Modifier.fillMaxWidth().hairline().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { PText(v.user, weight = FontWeight.Bold); PStars(v.stars, 12.sp) }
                            PText(v.text, lineHeight = 21.sp)
                        }
                    }
                }
            }
            PFooter {
                Column(Modifier.size(52.dp, 48.dp).tap { if (r.persona != null) nav.push("chat", "id" to r.id) else p.toast("商家暂未开通在线咨询") }.testTag("dine-ask"), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("💬", fontSize = 20.sp)
                    PText("咨询", size = 11.sp, color = PC.value)
                }
                if (r.queue != null) PBtn("排队", Modifier.weight(1f), kind = BtnKind.LINE, accent = ACCENT, tag = "dine-queue") { nav.push("queue", "id" to r.id) }
                if (r.booking != null) PBtn("订座", Modifier.weight(1f), accent = ACCENT, tag = "dine-book") { nav.push("book", "id" to r.id) }
            }
        }
    }
}

@Composable
private fun ShopHead(name: String, sub: String) {
    Column(Modifier.fillMaxWidth().background(Color.White).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        PText(name, size = 18.sp, weight = FontWeight.Bold)
        PText(sub, size = 12.sp, color = PC.muted)
    }
}

@Composable
private fun Queue(id: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val r = w.restaurants.first { it.id == id }
    var people by remember { mutableIntStateOf(2) }
    val table = PhoneDine.queueTableFor(r.queue ?: emptyList(), people)
    val records = p.recordsOf("dine_queue")
    fun take() {
        if (table == null) return p.toast("该人数暂不支持线上取号，请到店咨询")
        if (records.any { PhoneJs.sOrNull(it.data, "restaurant_id") == id && PhoneJs.sOrNull(it.data, "status") == "waiting" }) return p.toast("您已在排队中，请勿重复取号")
        val t = PhoneDine.queueTicket(table, PhoneDine.ticketsTaken(records, id, table.id))
        val qid = p.newId("dine_queue", "Q")
        p.write(
            "dine_queue", qid, "restaurant_id" to id, "restaurant" to r.name, "people" to people, "table_id" to table.id, "table" to "${table.name}(${table.min}-${table.max}人)",
            "number" to t.number, "ahead" to t.ahead, "minutes" to t.minutes, "status" to "waiting",
        )
        nav.resetTo("restaurant" to mapOf("id" to id), "ticket" to mapOf("id" to qid))
    }
    PScreen("dine-queue-page") {
        PColumn {
            PBar("在线排队", onBack = nav::pop)
            PBody {
                ShopHead(r.name, "当前排队人数较多，取号后可先去附近逛逛")
                PGroup("排队情况") {
                    for (t in r.queue ?: emptyList()) {
                        Row(Modifier.fillMaxWidth().background(if (table?.id == t.id) Color(0xFFFFF3EE) else Color.White).hairline().padding(horizontal = 14.dp, vertical = 12.dp).testTag("dine-qtable-${t.id}"), verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                                PText(t.name, weight = FontWeight.Bold)
                                PText("（${t.min}-${t.max}人）", size = 12.sp, color = PC.muted)
                            }
                            PText("前方${t.waiting}桌", size = 13.sp, color = PC.value, modifier = Modifier.width(80.dp))
                            PText("约${t.minutes}分钟", size = 13.sp, color = PC.value)
                        }
                    }
                }
                PGroup {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        PText("用餐人数", size = 15.sp, modifier = Modifier.weight(1f))
                        PStepper(people, min = 1, max = 10, tag = "dine-people") { people = it }
                    }
                    if (table != null) PNote("将为您取号：${table.name}（${table.min}-${table.max}人）")
                }
                PNote("· 叫号时请及时到店，过号作废需重新取号\n· 线上取号与现场排队同步进行")
            }
            PFooter { PBtn("立即取号", Modifier.weight(1f), accent = ACCENT, tag = "dine-queue-take") { take() } }
        }
    }
}

@Composable
private fun TicketCard(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(14.dp).clip(RoundedCornerShape(14.dp)).background(Color.White).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}

@Composable
private fun QueueTicketPage(id: String) {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val q = p.record("dine_queue", id)
    if (q == null) {
        PScreen("dine-ticket") { PEmpty("排队信息不存在") }
        return
    }
    val waiting = PhoneJs.sOrNull(q, "status") == "waiting"
    PScreen("dine-ticket") {
        PColumn {
            PBar("排队详情", onBack = nav::pop)
            PBody {
                TicketCard {
                    PText(PhoneJs.s(q, "restaurant"), size = 13.sp, color = PC.muted)
                    PText(PhoneJs.s(q, "number"), size = 44.sp, weight = FontWeight.Bold, color = ACCENT, modifier = Modifier.testTag("dine-ticket-number"))
                    PText("${PhoneJs.s(q, "table")} · ${PhoneJs.s(q, "people")}人")
                    if (waiting) PText("前方还有 ${PhoneJs.s(q, "ahead")} 桌，预计等待 ${PhoneJs.s(q, "minutes")} 分钟", size = 15.sp, align = TextAlign.Center, modifier = Modifier.testTag("dine-ticket-wait"))
                    else PText("已取消排队", color = PC.muted)
                    PText("叫号时会通过短信提醒，过号作废", size = 12.sp, color = PC.muted)
                }
            }
            if (waiting) PFooter {
                PBtn("取消排队", Modifier.weight(1f), kind = BtnKind.LINE, tag = "dine-queue-cancel") {
                    p.write("dine_queue", id, "status" to "cancelled")
                    p.toast("已取消排队")
                }
            }
        }
    }
}

@Composable
private fun Book(id: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val r = w.restaurants.first { it.id == id }
    val b = r.booking!!
    val key = "book:$id"
    val d = p.getState(APP, key, BookingDraft(date = b.dates.firstOrNull { it >= p.clock.date }, people = 2, area = "大厅", title = "先生"))
    fun set(f: (BookingDraft) -> BookingDraft) = p.setState(APP, key, f(p.getState(APP, key, d)))
    fun submit() {
        val problems = PhoneDine.bookingProblems(r, d)
        if (problems.isNotEmpty()) {
            p.emit("error", mapOf("code" to "booking_form", "app" to APP))
            return p.toast(problems[0])
        }
        val bid = p.newId("dine_booking", "B")
        p.write(
            "dine_booking", bid, "restaurant_id" to id, "restaurant" to r.name, "date" to d.date, "time" to d.time, "people" to d.people, "area" to d.area,
            "name" to d.name?.trim(), "title" to d.title, "phone" to d.phone?.replace(Regex("\\s+"), ""), "note" to (d.note ?: ""), "status" to "pending",
        )
        nav.resetTo("restaurant" to mapOf("id" to id), "booking" to mapOf("id" to bid))
    }
    val today = p.clock.date
    PScreen("dine-book-page") {
        PColumn {
            PBar("预订座位", onBack = nav::pop)
            PBody {
                ShopHead(r.name, "免费预订 · 商家确认后短信通知")
                PGroup("用餐日期") {
                    PChips(Modifier.padding(12.dp)) {
                        for (x in b.dates.filter { it >= today }) {
                            val rel = PhoneDates.zhRelativeDay(x, today)
                            PChip("${if (rel == PhoneDates.zhWeekday(x)) PhoneDates.zhWeekday(x) else rel} ${PhoneDates.zhMonthDay(x)}", on = d.date == x, accent = ACCENT, tag = "dine-date-$x") { set { it.copy(date = x, time = null) } }
                        }
                    }
                }
                PGroup("用餐人数") {
                    PChips(Modifier.padding(12.dp)) {
                        for (n in 1..minOf(12, b.maxPeople)) PChip("${n}人", on = d.people == n, accent = ACCENT, tag = "dine-people-$n") { set { it.copy(people = n) } }
                    }
                }
                PGroup("到店时间") {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (row in b.times.chunked(4)) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (t in row) {
                                val full = d.date != null && PhoneDine.slotFull(r, d.date!!, t)
                                val past = d.date == today && t <= p.clock.time
                                val on = d.time == t
                                Column(
                                    Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).background(if (on) ACCENT else Color(0xFFF6F7F9)).alpha(if (full || past) 0.45f else 1f)
                                        .tap(!full && !past) { set { it.copy(time = t) } }.padding(vertical = 6.dp).testTag("dine-time-$t"),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    PText(t, weight = FontWeight.SemiBold, color = if (on) Color.White else PC.ink)
                                    PText(if (full) "已满" else if (past) "已过" else "可订", size = 11.sp, color = if (on) Color.White else PC.muted)
                                }
                            }
                            repeat(4 - row.size) { Box(Modifier.weight(1f)) }
                        }
                    }
                }
                PGroup("位置") {
                    PChips(Modifier.padding(12.dp)) {
                        for (a in listOf("大厅", "包间")) PChip(a, on = d.area == a, accent = ACCENT, enabled = !(a == "包间" && b.rooms == null), tag = "dine-area-$a") { set { it.copy(area = a) } }
                    }
                    if (d.area == "包间" && b.rooms != null) PNote("包间${b.rooms!!.minPeople}人起订，最低消费¥${PhoneDates.yuan(b.rooms!!.minSpend)}")
                }
                PGroup("联系人") {
                    PField("姓氏", d.name ?: "", { v -> set { it.copy(name = v) } }, "请输入您的姓氏", tag = "dine-name")
                    PFieldRow { PChips { for (t in listOf("先生", "女士")) PChip(t, on = d.title == t, accent = ACCENT, tag = "dine-title-$t") { set { it.copy(title = t) } } } }
                    PField("手机号", d.phone ?: "", { v -> set { it.copy(phone = v.filter { c -> c in '0'..'9' }.take(11)) } }, ZH.phonePlaceholder, numeric = true, tag = "dine-phone", right = {
                        Box(Modifier.heightIn(min = 36.dp).tap { set { it.copy(phone = p.spec.profile.phone) } }.padding(horizontal = 4.dp).testTag("dine-phone-mine"), contentAlignment = Alignment.Center) { PText("本机号码", color = ACCENT, size = 13.sp) }
                    })
                    PField("备注", d.note ?: "", { v -> set { it.copy(note = v.take(40)) } }, "选填，如：靠窗、有老人小孩", mic = true, tag = "dine-note")
                }
            }
            PFooter { PBtn("提交订座", Modifier.weight(1f), accent = ACCENT, tag = "dine-book-submit") { submit() } }
        }
    }
}

@Composable
private fun BookingDone(id: String) {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val b = p.record("dine_booking", id)
    val status = b?.let { PhoneJs.sOrNull(it, "status") }
    LaunchedEffect(status, id) {
        if (status != "pending" || b == null) return@LaunchedEffect
        delay(3000)
        p.write("dine_booking", id, "status" to "confirmed")
        p.sms("10690000", "【吃喝玩乐】您预订的${PhoneJs.s(b, "restaurant")}${PhoneDates.zhMonthDay(PhoneJs.s(b, "date"))} ${PhoneJs.s(b, "time")} ${PhoneJs.s(b, "people")}位（${PhoneJs.s(b, "area")}）已确认，请准时到店，座位保留15分钟。")
    }
    if (b == null) {
        PScreen("dine-booking") { PEmpty("预订不存在") }
        return
    }
    PScreen("dine-booking-$status") {
        PColumn {
            PBar("预订详情", onBack = nav::pop)
            PBody {
                TicketCard {
                    PText(PhoneJs.s(b, "restaurant"), size = 13.sp, color = PC.muted)
                    PText(
                        when (status) { "confirmed" -> "预订成功"; "cancelled" -> "已取消"; else -> "商家确认中…" },
                        size = 26.sp, weight = FontWeight.Bold, color = if (status == "confirmed") PC.green else ACCENT, modifier = Modifier.testTag("dine-booking-status"),
                    )
                    PText("${PhoneDates.zhMonthDay(PhoneJs.s(b, "date"))} ${PhoneDates.zhWeekday(PhoneJs.s(b, "date"))} ${PhoneJs.s(b, "time")} · ${PhoneJs.s(b, "people")}人 · ${PhoneJs.s(b, "area")}")
                    PText("${PhoneJs.s(b, "name")}${PhoneJs.s(b, "title")} ${PhoneJs.s(b, "phone")}", size = 12.sp, color = PC.muted)
                }
                PNote("座位保留15分钟，如需变更请提前联系商家。")
            }
            if (status != "cancelled") PFooter {
                PBtn("取消预订", Modifier.weight(1f), kind = BtnKind.LINE, tag = "dine-booking-cancel") {
                    p.write("dine_booking", id, "status" to "cancelled")
                    p.toast("已取消预订")
                }
            }
        }
    }
}

@Composable
private fun HostChat(restaurantId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val r = w.restaurants.first { it.id == restaurantId }
    val booking = p.recordsOf("dine_booking").lastOrNull { PhoneJs.sOrNull(it.data, "restaurant_id") == restaurantId && PhoneJs.sOrNull(it.data, "status") != "cancelled" }?.data
    val context = if (booking != null) {
        "客人在本店的预订：${PhoneDates.zhMonthDay(PhoneJs.s(booking, "date"))} ${PhoneJs.s(booking, "time")}，${PhoneJs.s(booking, "people")}人，${PhoneJs.s(booking, "area")}，${PhoneJs.s(booking, "name")}${PhoneJs.s(booking, "title")}"
    } else "客人还没有在本店预订"
    AppChat(
        personaId = r.persona!!, title = p.persona(r.persona)?.name ?: r.name, subtitle = "商家客服", context = context, accent = ACCENT, avatar = "店",
        onBack = nav::pop, tip = "商家一般会在几分钟内回复您", quick = listOf("你好，请问还有包间吗？", "好的，谢谢！"),
    )
}

@Composable
private fun Mine() {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val bookings = p.recordsOf("dine_booking").reversed()
    val queues = p.recordsOf("dine_queue").reversed()
    PScreen("dine-mine-page") {
        PColumn {
            PBar("我的订单", onBack = nav::pop)
            PBody {
                PGroup("订座") {
                    if (bookings.isEmpty()) PEmpty("暂无订座", "🪑")
                    for (b in bookings) {
                        PCell(
                            PhoneJs.s(b.data, "restaurant"), sub = "${PhoneDates.zhMonthDay(PhoneJs.s(b.data, "date"))} ${PhoneJs.s(b.data, "time")} · ${PhoneJs.s(b.data, "people")}人",
                            value = mapOf("pending" to "待确认", "confirmed" to "已确认", "cancelled" to "已取消")[PhoneJs.s(b.data, "status")], onClick = { nav.push("booking", "id" to b.id) },
                        )
                    }
                }
                PGroup("排队") {
                    if (queues.isEmpty()) PEmpty("暂无排队", "🎫")
                    for (q in queues) {
                        PCell(PhoneJs.s(q.data, "restaurant"), sub = "${PhoneJs.s(q.data, "number")} · ${PhoneJs.s(q.data, "people")}人", value = if (PhoneJs.s(q.data, "status") == "waiting") "排队中" else "已取消", onClick = { nav.push("ticket", "id" to q.id) })
                    }
                }
            }
        }
    }
}
