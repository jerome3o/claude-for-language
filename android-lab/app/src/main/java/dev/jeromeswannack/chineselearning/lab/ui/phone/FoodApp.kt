package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.FoodAddress
import dev.jeromeswannack.chineselearning.lab.core.phone.FoodItem
import dev.jeromeswannack.chineselearning.lab.core.phone.FoodShop
import dev.jeromeswannack.chineselearning.lab.core.phone.FoodWorld
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneFood
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneFood.CartLine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneFood.RedPacketChoice
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneRail
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneWorlds
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/*
 * 饭点外卖 (web apps/FoodApp.tsx) — shops (★ / 月售 / 起送 / 配送费 / 满减), a shop's menu (categories
 * on the left, 选规格 with 必选 groups), the cart bar ("还差¥5起送", "再买¥8可减10"), 去结算 (收货地址
 * incl. 新增收货地址, 满减, 红包, 备注 with quick tags, 餐具数量), pay, and the order page
 * (商家已接单 → 骑手已取餐 → 送达) where the rider may message you.
 */

private const val APP = "food"
private val ACCENT = Color(0xFFF5B400)
private val INK = Color(0xFF222222)
private val CHIP = Color(0xFFE09B00)
private val RED = Color(0xFFF53D3D)

@Composable
private fun world(): FoodWorld = LocalPhone.current.spec.world.food!!

private fun cart(p: PhoneRuntime, shopId: String): List<CartLine> = p.getState(APP, "cart:$shopId", emptyList())
private fun setCart(p: PhoneRuntime, shopId: String, f: (List<CartLine>) -> List<CartLine>) = p.setState(APP, "cart:$shopId", f(cart(p, shopId)))

private fun addresses(p: PhoneRuntime): List<FoodAddress> = PhoneWorlds.foodAddresses(p.spec.world.food!!.addresses, p.events)

private fun selectedAddress(p: PhoneRuntime): FoodAddress? {
    val list = addresses(p)
    val id = p.getState<String?>(APP, "address", null)
    return list.firstOrNull { it.id == id } ?: list.firstOrNull()
}

private data class Extras(val note: String = "", val tags: List<String> = emptyList(), val cutlery: String? = null, val redPacket: RedPacketChoice = RedPacketChoice.Auto, val time: String? = null)

private fun extras(p: PhoneRuntime, shopId: String): Extras = p.getState(APP, "extras:$shopId", Extras())
private fun setExtras(p: PhoneRuntime, shopId: String, f: (Extras) -> Extras) = p.setState(APP, "extras:$shopId", f(extras(p, shopId)))

@Composable
fun FoodApp(screen: PhoneScreen) {
    when (screen.name) {
        "search" -> Search()
        "shop" -> Shop(screen.p("shop"))
        "checkout" -> Checkout(screen.p("shop"))
        "addresses" -> Addresses(screen.p("from") == "checkout")
        "address_add" -> AddAddress(screen.p("back") == "checkout")
        "note" -> NoteEditor(screen.p("shop"))
        "order" -> OrderPage(screen.p("id"))
        "chat" -> {
            val p = LocalPhone.current
            val id = screen.p("persona")
            AppChat(
                personaId = id, title = p.persona(id)?.name ?: "骑手", subtitle = "饭点专送", context = screen.p("context"), accent = CHIP, avatar = "骑",
                onBack = p.nav(APP)::pop, quick = listOf("好的，谢谢", "我马上下来", "放门口就行", "麻烦快一点"),
            )
        }
        else -> FoodHome()
    }
}

private fun sales(n: Int) = if (n > 999) "${n / 1000}000+" else n.toString()

@Composable
private fun ShopRow(shop: FoodShop, match: String? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Color.White).tap(onClick = onClick).hairline().alpha(if (shop.closed) 0.6f else 1f).padding(12.dp).testTag("food-shop-${shop.id}"),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(64.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFFFF4D6)), contentAlignment = Alignment.Center) { Text(shop.emoji ?: "🍱", fontSize = 32.sp) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            PText(shop.name, size = 16.sp, weight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                PText("${PhoneJs.numStr(shop.rating)}分", size = 12.sp, color = Color(0xFFF26B1D), weight = FontWeight.Bold)
                PText(" 月售${sales(shop.monthlySales)}", size = 12.sp, color = PC.value, modifier = Modifier.weight(1f))
                PText("${if (shop.closed) "休息中" else "${shop.deliveryMin}分钟"} ${PhoneJs.numStr(shop.km)}km", size = 12.sp, color = PC.value)
            }
            PText("起送¥${PhoneDates.yuan(shop.minOrder)} 配送¥${PhoneDates.yuan(shop.deliveryFee)}", size = 12.sp, color = PC.value)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (d in shop.discounts ?: emptyList()) PLineTag("${PhoneDates.yuan(d.threshold)}减${PhoneDates.yuan(d.minus)}")
                if (shop.closed) PLineTag("本店休息中 · 明天10:00营业", color = PC.muted, border = PC.chipBorder)
            }
            if (match != null) PText("含：$match", size = 12.sp, color = PC.muted)
        }
    }
}

@Composable
private fun FoodHome() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val tab = p.getState(APP, "tab", "home")
    var sort by remember { mutableStateOf("all") }
    var cat by remember { mutableStateOf<String?>(null) }
    val addr = selectedAddress(p)
    val shops = w.shops
        .filter { s -> cat == null || (if (cat == "甜点饮品") s.category == "奶茶" else s.category != "奶茶") }
        .sortedWith(
            compareBy<FoodShop> { if (it.closed) 1 else 0 }.thenComparator { a, b ->
                when (sort) {
                    "sales" -> b.monthlySales.compareTo(a.monthlySales)
                    "km" -> a.km.compareTo(b.km)
                    "rating" -> b.rating.compareTo(a.rating)
                    else -> 0
                }
            },
        )
    PScreen("food-home") {
        PColumn {
            when (tab) {
                "home" -> PBody {
                    Column(Modifier.fillMaxWidth().background(ACCENT).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.heightIn(min = 36.dp).tap { nav.push("addresses") }.testTag("food-addr"), contentAlignment = Alignment.CenterStart) {
                            PText("📍 ${if (addr != null) "${addr.label ?: ""} ${addr.detail}" else "请选择收货地址"} ▾", size = 15.sp, weight = FontWeight.Bold, color = INK, maxLines = 1)
                        }
                        Box(Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).background(Color.White).tap { nav.push("search") }.padding(horizontal = 14.dp).testTag("food-search-open"), contentAlignment = Alignment.CenterStart) {
                            PText("🔍 搜索商家、商品名称", color = PC.ph)
                        }
                    }
                    val cats = listOf("美食" to "🍜", "甜点饮品" to "🧋", "超市便利" to "🛒", "蔬菜水果" to "🥬", "看病买药" to "💊", "跑腿代购" to "🛵", "早餐" to "🥟", "夜宵" to "🍢")
                    Column(Modifier.fillMaxWidth().background(Color.White).padding(vertical = 8.dp)) {
                        for (row in cats.chunked(4)) {
                            Row(Modifier.fillMaxWidth()) {
                                for ((name, icon) in row) {
                                    val i = cats.indexOfFirst { it.first == name }
                                    Column(
                                        Modifier.weight(1f).heightIn(min = 64.dp).tap { if (i < 2) cat = if (cat == name) null else name else p.toast(ZH.notOpen) }.padding(4.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                    ) {
                                        Text(icon, fontSize = 26.sp)
                                        PText(name, size = 12.sp, color = if (cat == name) INK else PC.value, weight = if (cat == name) FontWeight.Bold else null)
                                    }
                                }
                            }
                        }
                    }
                    PText("新用户专享 · 下单立减红包已放入账户", size = 13.sp, color = Color(0xFF8A5A00), modifier = Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFFFF1C9)).padding(10.dp))
                    PChipsBar {
                        for ((id, label) in listOf("all" to "综合排序", "sales" to "销量最高", "km" to "距离最近", "rating" to "评分最高")) PChip(label, on = sort == id, accent = INK) { sort = id }
                    }
                    for (s in shops) ShopRow(s) { nav.push("shop", "shop" to s.id) }
                }
                "orders" -> FoodOrders()
                else -> PBody {
                    PBar("我的")
                    PGroup {
                        PCell("我的地址", icon = "📍", onClick = { nav.push("addresses") })
                        PCell("红包卡券", icon = "🧧", value = "${(w.redPackets ?: emptyList()).size}个", onClick = { p.toast("结算时可选择使用") })
                        PCell("我的收藏", icon = "⭐", onClick = { p.toast(ZH.notOpen) })
                        PCell("客服中心", icon = "🎧", onClick = { p.toast(ZH.notOpen) })
                    }
                }
            }
            PTabBar(listOf(Triple("home", "首页", "🏠"), Triple("orders", "订单", "📄"), Triple("me", "我的", "👤")), tab, INK, "food") { p.setState(APP, "tab", it) }
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
    val hits = if (t.isEmpty()) emptyList() else w.shops.mapNotNull { s ->
        val dish = s.menu.flatMap { it.items }.firstOrNull { it.name.contains(t) }
        if (s.name.contains(t) || s.category.contains(t) || dish != null) s to dish?.name else null
    }
    PScreen("food-search") {
        PColumn {
            PBar("", onBack = nav::pop)
            Box(Modifier.background(Color.White).padding(horizontal = 12.dp, vertical = 8.dp)) {
                PSearchBox(q, { q = it }, "搜索商家、商品名称", tag = "food-search-input", autoFocus = true, mic = true)
            }
            PBody {
                if (t.isNotEmpty()) {
                    if (hits.isNotEmpty()) for ((s, match) in hits) ShopRow(s, match) { nav.push("shop", "shop" to s.id) }
                    else PEmpty("没有找到相关商家", "🔍")
                } else {
                    PSectionTitle("热门搜索")
                    PChips(Modifier.padding(horizontal = 12.dp)) {
                        for (k in listOf("牛肉面", "奶茶", "杨枝甘露", "盖饭", "饺子", "汉堡")) PChip(k, tag = "food-hot-$k") { q = k }
                    }
                }
            }
        }
    }
}

@Composable
private fun Shop(shopId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val shop = w.shops.first { it.id == shopId }
    val cart = cart(p, shopId)
    var tab by remember { mutableStateOf("menu") }
    var cat by remember { mutableIntStateOf(0) }
    var spec by remember { mutableStateOf<FoodItem?>(null) }
    var cartOpen by remember { mutableStateOf(false) }
    val gap = PhoneFood.minOrderGap(shop, cart)
    val goods = PhoneFood.itemsTotal(cart) + PhoneFood.packingFee(shop, cart)
    val next = PhoneFood.nextDiscount(shop, goods)
    val got = PhoneFood.bestDiscount(shop, goods)
    fun add(item: FoodItem) {
        when {
            shop.closed -> p.toast("商家休息中，暂不接单")
            item.soldOut -> p.toast("该商品已售罄")
            !item.options.isNullOrEmpty() -> spec = item
            else -> setCart(p, shopId) { PhoneFood.changeCart(it, item, emptyList(), item.price, 1) }
        }
    }
    fun qtyOf(item: FoodItem) = cart.filter { it.item_id == item.id }.sumOf { it.qty }
    PScreen("food-shop-page") {
        PColumn {
            PBar("", onBack = nav::pop, right = { PBarButton("☆") { p.toast("已收藏") } })
            Row(Modifier.fillMaxWidth().background(Color.White).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFFFF4D6)), contentAlignment = Alignment.Center) { Text(shop.emoji ?: "🍱", fontSize = 38.sp) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    PText(shop.name, size = 18.sp, weight = FontWeight.Bold)
                    PText("${PhoneJs.numStr(shop.rating)}分 月售${shop.monthlySales} · 约${shop.deliveryMin}分钟 · 距离${PhoneJs.numStr(shop.km)}km", size = 12.sp, color = PC.value)
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { for (d in shop.discounts ?: emptyList()) PLineTag("满${PhoneDates.yuan(d.threshold)}减${PhoneDates.yuan(d.minus)}") }
                }
            }
            if (shop.closed) PText("本店休息中，明天10:00开始营业，可以先看看其他商家", size = 13.sp, color = Color(0xFF8A5A00), modifier = Modifier.fillMaxWidth().background(Color(0xFFFFF1C9)).padding(10.dp))
            PTabs(listOf("menu" to "点菜", "reviews" to "评价", "info" to "商家"), tab, INK) { tab = it }
            when (tab) {
                "menu" -> Row(Modifier.weight(1f).fillMaxWidth()) {
                    Column(Modifier.width(88.dp).fillMaxHeight().background(Color(0xFFF6F7F9)).verticalScroll(rememberScrollState())) {
                        shop.menu.forEachIndexed { i, c ->
                            Box(Modifier.fillMaxWidth().heightIn(min = 52.dp).background(if (i == cat) Color.White else Color.Transparent).tap { cat = i }.padding(horizontal = 8.dp, vertical = 10.dp), contentAlignment = Alignment.CenterStart) {
                                PText(c.category, size = 13.sp, weight = if (i == cat) FontWeight.Bold else null, color = if (i == cat) INK else PC.value)
                            }
                        }
                    }
                    Column(Modifier.weight(1f).fillMaxHeight().background(Color.White).verticalScroll(rememberScrollState()).padding(horizontal = 10.dp)) {
                        PText(shop.menu.getOrNull(cat)?.category ?: "", size = 13.sp, color = PC.muted, modifier = Modifier.padding(vertical = 8.dp))
                        for (item in shop.menu.getOrNull(cat)?.items ?: emptyList()) {
                            Row(Modifier.fillMaxWidth().alpha(if (item.soldOut) 0.55f else 1f).padding(vertical = 8.dp).testTag("food-item-${item.id}"), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Box(Modifier.size(70.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFF7F3EA)), contentAlignment = Alignment.Center) { Text(item.emoji ?: "🍽", fontSize = 34.sp) }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    PText(item.name, size = 15.sp, weight = FontWeight.Bold)
                                    if (item.desc != null) PText(item.desc!!, size = 12.sp, color = PC.muted, maxLines = 2)
                                    PText("月售${item.sales ?: 0}", size = 12.sp, color = PC.muted)
                                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                        PPrice(item.price, color = RED, modifier = Modifier.weight(1f))
                                        val q = qtyOf(item)
                                        when {
                                            item.soldOut -> PText("已售罄", size = 12.sp, color = PC.muted)
                                            !item.options.isNullOrEmpty() -> Box {
                                                Box(Modifier.heightIn(min = 30.dp).clip(RoundedCornerShape(15.dp)).background(ACCENT).tap { add(item) }.padding(horizontal = 12.dp).testTag("food-spec-open-${item.id}"), contentAlignment = Alignment.Center) {
                                                    PText("选规格", size = 13.sp, color = INK, weight = FontWeight.SemiBold)
                                                }
                                                if (q > 0) Badge(q, Modifier.align(Alignment.TopEnd).offset(6.dp, (-6).dp))
                                            }
                                            else -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                if (q > 0) {
                                                    Box(Modifier.size(30.dp).clip(CircleShape).border(1.dp, Color(0xFFD0D4DA), CircleShape).tap { setCart(p, shopId) { PhoneFood.changeCart(it, item, emptyList(), item.price, -1) } }.testTag("food-minus-${item.id}"), contentAlignment = Alignment.Center) { Text("−", fontSize = 16.sp) }
                                                    PText(q.toString(), weight = FontWeight.SemiBold)
                                                }
                                                Box(Modifier.size(30.dp).clip(CircleShape).background(ACCENT).tap { add(item) }.testTag("food-add-${item.id}"), contentAlignment = Alignment.Center) { Text("＋", fontSize = 16.sp, color = INK) }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Gap(20.dp)
                    }
                }
                "reviews" -> PBody {
                    for ((stars, who, text) in listOf(Triple(5.0, "吃***货", "分量很足，送得也快，汤还是热的！"), Triple(4.0, "上班***族", "味道不错，就是中午人多要等一会儿。"))) {
                        Column(Modifier.fillMaxWidth().background(Color.White).hairline().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) { PStars(stars); PText(who, weight = FontWeight.Bold) }
                            PText(text)
                        }
                    }
                }
                else -> PBody {
                    PGroup {
                        PCell("商家地址", value = "静安区（距您约1公里）")
                        PCell("营业时间", value = "10:00-21:30")
                        PCell("配送服务", value = "由饭点专送提供配送")
                    }
                }
            }
            if (cart.isNotEmpty() && (next != null || got != null)) {
                PText(
                    if (next != null) "再买¥${PhoneDates.yuan(next.gap)}可减${PhoneDates.yuan(next.minus)}" else "已满${PhoneDates.yuan(got!!.threshold)}减${PhoneDates.yuan(got.minus)}",
                    size = 12.sp, color = Color(0xFF8A5A00), align = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().background(Color(0xFFFFF4D6)).padding(6.dp).testTag("food-discount-tip"),
                )
            }
            Row(Modifier.fillMaxWidth().background(Color(0xFF333333)).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(48.dp).tap { if (cart.isNotEmpty()) cartOpen = true }.testTag("food-cart"), contentAlignment = Alignment.Center) {
                    Text("🛒", fontSize = 24.sp)
                    if (PhoneFood.cartCount(cart) > 0) Badge(PhoneFood.cartCount(cart), Modifier.align(Alignment.TopEnd))
                }
                Column(Modifier.weight(1f)) {
                    if (cart.isNotEmpty()) PPrice(PhoneFood.itemsTotal(cart), color = Color.White) else PText("未选购商品", color = Color(0xFFAAAAAA))
                    PText("另需配送费¥${PhoneDates.yuan(shop.deliveryFee)}", size = 11.sp, color = Color(0xFFAAAAAA))
                }
                val ready = cart.isNotEmpty() && gap == 0.0 && !shop.closed
                Box(
                    Modifier.heightIn(min = 52.dp).widthIn(min = 110.dp).background(if (ready) ACCENT else Color(0xFF555555)).tap(ready) { nav.push("checkout", "shop" to shop.id) }.padding(horizontal = 14.dp).testTag("food-checkout"),
                    contentAlignment = Alignment.Center,
                ) {
                    PText(
                        when {
                            shop.closed -> "休息中"
                            cart.isEmpty() -> "¥${PhoneDates.yuan(shop.minOrder)}起送"
                            gap > 0 -> "还差¥${PhoneDates.yuan(gap)}起送"
                            else -> "去结算"
                        },
                        color = if (ready) INK else Color(0xFFBBBBBB), weight = FontWeight.Bold,
                    )
                }
            }
        }
        spec?.let { item -> SpecSheet(item, onClose = { spec = null }) { opts, price -> setCart(p, shopId) { PhoneFood.changeCart(it, item, opts, price, 1) }; spec = null } }
        PSheet(cartOpen, { cartOpen = false }, "已选商品") {
            for (l in cart) {
                val item = shop.menu.flatMap { it.items }.first { it.id == l.item_id }
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp).testTag("food-cart-line"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        PText(l.name, weight = FontWeight.Bold)
                        if (l.options.isNotEmpty()) PText(l.options.joinToString("/"), size = 12.sp, color = PC.muted)
                    }
                    PPrice(l.price * l.qty)
                    PStepper(l.qty, min = 0, tag = "food-cart-qty") { n -> setCart(p, shopId) { PhoneFood.changeCart(it, item, l.options, l.price, n - l.qty) } }
                }
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).tap { setCart(p, shopId) { emptyList() }; cartOpen = false }, contentAlignment = Alignment.Center) { PText("🗑 清空购物车", color = PC.muted) }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.SpecSheet(item: FoodItem, onClose: () -> Unit, onAdd: (List<String>, Double) -> Unit) {
    val p = LocalPhone.current
    var picks by remember(item.id) { mutableStateOf(mapOf<String, List<String>>()) }
    fun toggle(group: String, name: String, multi: Boolean) {
        val now = picks[group] ?: emptyList()
        picks = picks + (group to if (multi) (if (name in now) now - name else now + name) else (if (now.firstOrNull() == name) emptyList() else listOf(name)))
    }
    val price = PhoneFood.unitPrice(item, picks)
    PSheet(true, onClose, item.name, tag = "food-spec-sheet") {
        for (g in item.options ?: emptyList()) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    PText(g.name, weight = FontWeight.Bold)
                    if (g.required) PLineTag("必选") else PText(if (g.multi) "可多选" else "可选", size = 12.sp, color = PC.muted)
                }
                PChips(Modifier.padding(top = 6.dp)) {
                    for (c in g.choices) {
                        PChip("${c.name}${if (c.price != null && c.price != 0.0) " +¥${PhoneDates.yuan(c.price!!)}" else ""}", on = c.name in (picks[g.name] ?: emptyList()), accent = CHIP, tag = "food-spec-choice-${c.name}") { toggle(g.name, c.name, g.multi) }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                PPrice(price, big = true, color = RED)
                PText(PhoneFood.pickedList(item, picks).joinToString("，").ifEmpty { "请选择规格" }, size = 12.sp, color = PC.muted)
            }
            PBtn("加入购物车", accent = ACCENT, textColor = INK, tag = "food-spec-add") {
                val problems = PhoneFood.optionProblems(item, picks)
                if (problems.isNotEmpty()) {
                    p.emit("error", mapOf("code" to "food_options", "app" to APP))
                    p.toast(problems[0])
                } else onAdd(PhoneFood.pickedList(item, picks), price)
            }
        }
    }
}

@Composable
private fun Checkout(shopId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val shop = w.shops.first { it.id == shopId }
    val cart = cart(p, shopId)
    val ex = extras(p, shopId)
    val addr = selectedAddress(p)
    var sheet by remember { mutableStateOf<String?>(null) }
    val totals = PhoneFood.cartTotals(shop, cart, w.redPackets, ex.redPacket)
    val goods = PhoneDates.round2(totals.items + totals.packing - totals.discount)
    val usable = PhoneFood.usableRedPackets(w.redPackets, goods)
    val eta = PhoneDates.timeOf(PhoneDates.minutesOf(p.clock.time) + shop.deliveryMin)
    fun submit() {
        if (addr == null) return p.toast("请选择收货地址")
        val cutlery = ex.cutlery
        if (cutlery == null) {
            p.emit("error", mapOf("code" to "cutlery", "app" to APP))
            return p.toast("请选择餐具数量")
        }
        val id = p.newId("food_order", "F")
        val data = PhoneFood.foodOrderData(shop, cart, totals, ex.note, ex.tags, cutlery, addr, id, "unpaid")
        p.write("food_order", id, JsonObject(data + ("deliver_at" to JsonPrimitive(ex.time ?: eta))))
        p.scope.launch {
            val r = p.pay(PayRequest(APP, shop.name, "饭点外卖", totals.total))
            if (r == null) {
                p.toast("订单待支付，可在订单页继续支付")
                nav.resetTo("order" to mapOf("id" to id))
                return@launch
            }
            p.write("food_order", id, "status" to "paid", "paid_at" to p.now(), "pay_method" to r.method)
            setCart(p, shopId) { emptyList() }
            setExtras(p, shopId) { Extras() }
            nav.resetTo("order" to mapOf("id" to id))
        }
    }
    PScreen("food-checkout-page") {
        PColumn {
            PBar("提交订单", onBack = nav::pop)
            PBody {
                Row(Modifier.fillMaxWidth().padding(10.dp).clip(RoundedCornerShape(10.dp)).background(Color.White).tap { nav.push("addresses", "from" to "checkout") }.padding(14.dp).testTag("food-checkout-addr"), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (addr != null) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                addr.label?.let { PTag(it) }
                                PText(PhoneWorlds.addressLine(addr), size = 16.sp, weight = FontWeight.Bold)
                            }
                            PText("${addr.name} ${addr.phone}", size = 13.sp, color = PC.muted)
                        } else PText("＋ 请添加收货地址", size = 16.sp, weight = FontWeight.Bold)
                    }
                    Text("›", color = PC.arrow, fontSize = 20.sp)
                }
                PGroup { PCell("立即送出", value = if (ex.time != null) "预计 ${ex.time} 送达" else "大约 $eta 送达", onClick = { sheet = "time" }) }
                PGroup(shop.name) {
                    for (l in cart) CoLine(l.name, l.options, l.qty, l.price * l.qty)
                    PCell("包装费", value = "¥${PhoneDates.yuan(totals.packing)}")
                    PCell("配送费", value = "¥${PhoneDates.yuan(totals.delivery)}")
                    if (totals.discount > 0) PCell("减 满减优惠", value = "-¥${PhoneDates.yuan(totals.discount)}", valueColor = RED, tag = "food-discount")
                    PCell(
                        "红 红包",
                        value = when {
                            totals.redPacket > 0 -> "-¥${PhoneDates.yuan(totals.redPacket)}"
                            usable.isNotEmpty() -> "${usable.size}个可用"
                            else -> "暂无可用"
                        },
                        valueColor = if (totals.redPacket > 0) RED else PC.muted,
                        tag = "food-red-packet",
                        onClick = { sheet = "red" },
                    )
                    Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                        PText("已优惠¥${PhoneDates.yuan(totals.discount + totals.redPacket)}　小计 ", size = 13.sp, color = PC.value)
                        PPrice(totals.total, big = true)
                    }
                }
                PGroup {
                    PCell("备注", value = (ex.tags + ex.note).filter { it.isNotEmpty() }.joinToString("，").ifEmpty { "口味、偏好等要求" }, valueColor = if (ex.tags.isEmpty() && ex.note.isEmpty()) PC.ph else PC.value, tag = "food-note", onClick = { nav.push("note", "shop" to shopId) })
                    PCell("餐具数量", value = ex.cutlery ?: "请选择", valueColor = if (ex.cutlery == null) RED else PC.value, tag = "food-cutlery", onClick = { sheet = "cutlery" })
                    PCell("发票", value = "本单不支持开发票", arrow = false)
                }
            }
            PFooter {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { PText("实付 ", size = 13.sp); PPrice(totals.total, big = true, color = RED) }
                    PText("已优惠¥${PhoneDates.yuan(totals.discount + totals.redPacket)}", size = 11.sp, color = PC.muted)
                }
                PBtn(ZH.submitOrder, accent = ACCENT, textColor = INK, tag = "food-submit") { submit() }
            }
        }
        PSheet(sheet == "red", { sheet = null }, "选择红包", tag = "food-red-sheet") {
            for (r in w.redPackets ?: emptyList()) {
                val ok = goods >= r.threshold
                val on = totals.redPacketId == r.id
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 5.dp).clip(RoundedCornerShape(10.dp)).background(if (on) Color(0xFFFFF0F0) else Color(0xFFFFF8F5)).border(1.dp, if (on) RED else Color(0xFFFBD9D0), RoundedCornerShape(10.dp))
                        .alpha(if (ok) 1f else 0.45f).tap(ok) { setExtras(p, shopId) { it.copy(redPacket = RedPacketChoice.Id(r.id)) }; sheet = null }.padding(12.dp).testTag("food-rp-option-${r.id}"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.Bottom) { PText("¥", color = RED, size = 13.sp); PText(PhoneDates.yuan(r.amount), color = RED, size = 24.sp, weight = FontWeight.Bold) }
                    Column(Modifier.weight(1f)) {
                        PText(r.name, weight = FontWeight.Bold)
                        PText("满${PhoneDates.yuan(r.threshold)}可用${if (ok) "" else " · 还差¥${PhoneDates.yuan(PhoneDates.round2(r.threshold - goods))}"}", size = 12.sp, color = PC.muted)
                    }
                    PText(if (on) "✓" else "", color = RED)
                }
            }
            PCell("不使用红包", value = if (ex.redPacket == RedPacketChoice.None) "✓" else "", arrow = false, tag = "food-rp-none", onClick = { setExtras(p, shopId) { it.copy(redPacket = RedPacketChoice.None) }; sheet = null })
        }
        PSheet(sheet == "cutlery", { sheet = null }, "餐具数量", tag = "food-cutlery-sheet") {
            PNote("为减少资源浪费，请按需选择餐具数量")
            for (c in PhoneFood.CUTLERY) {
                PCell(if (c == "无需餐具") "🌱 无需餐具" else c, value = if (ex.cutlery == c) "✓" else "", arrow = false, tag = "food-cutlery-option-$c", onClick = { setExtras(p, shopId) { it.copy(cutlery = c) }; sheet = null })
            }
        }
        PSheet(sheet == "time", { sheet = null }, "选择送达时间") {
            for (m in listOf(0, 20, 40, 60, 80)) {
                val t = PhoneDates.timeOf(PhoneDates.minutesOf(eta) + m)
                PCell(if (m == 0) "立即送出（约$t）" else t, arrow = false, onClick = { setExtras(p, shopId) { it.copy(time = if (m == 0) null else t) }; sheet = null })
            }
        }
    }
}

@Composable
private fun CoLine(name: String, options: List<String>, qty: Int, price: Double?) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f)) {
            PText(name, weight = FontWeight.Bold)
            if (options.isNotEmpty()) PText(options.joinToString("/"), size = 12.sp, color = PC.muted)
        }
        PText("×$qty", color = PC.muted)
        if (price != null) PPrice(price)
    }
}

@Composable
private fun NoteEditor(shopId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val ex = extras(p, shopId)
    var tags by remember { mutableStateOf(ex.tags) }
    var note by remember { mutableStateOf(ex.note) }
    PScreen("food-note-page") {
        PColumn {
            PBar("添加备注", onBack = nav::pop, right = { PBarButton("完成", size = 15.sp, tag = "food-note-done") { setExtras(p, shopId) { it.copy(tags = tags, note = note.trim()) }; nav.pop() } })
            PBody(Modifier.padding(12.dp)) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color.White).padding(12.dp)) {
                    PInput(note, { note = it.take(50) }, "请输入口味、偏好等要求，不支持额外加菜哦", Modifier.fillMaxWidth().heightIn(min = 90.dp), tag = "food-note-text", singleLine = false)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                        PhoneMic(tag = "food-note-mic") { t -> note = (note + t).take(50) }
                        PText("${note.length}/50", size = 12.sp, color = PC.muted)
                    }
                }
                PSectionTitle("快捷标签")
                PChips {
                    for (t in w.noteTags ?: PhoneFood.DEFAULT_NOTE_TAGS) PChip(t, on = t in tags, accent = CHIP, tag = "food-note-tag-$t") { tags = if (t in tags) tags - t else tags + t }
                }
            }
        }
    }
}

@Composable
private fun Addresses(fromCheckout: Boolean) {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val list = addresses(p)
    val addr = selectedAddress(p)
    PScreen("food-addresses") {
        PColumn {
            PBar("选择收货地址", onBack = nav::pop)
            PBody {
                if (list.isEmpty()) PEmpty("还没有收货地址", "📍")
                for (a in list) {
                    Row(Modifier.fillMaxWidth().background(Color.White).tap { p.setState(APP, "address", a.id); nav.pop() }.hairline().padding(14.dp).testTag("food-addr-row-${a.id}"), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                a.label?.let { PTag(it) }
                                PText(PhoneWorlds.addressLine(a), size = 15.sp, weight = FontWeight.Bold)
                            }
                            PText("${a.name} ${a.phone}", size = 13.sp, color = PC.muted)
                        }
                        PText(if (addr?.id == a.id) "✓" else "", color = CHIP, size = 18.sp)
                    }
                }
            }
            PFooter {
                PBtn("＋ 新增收货地址", Modifier.weight(1f), accent = ACCENT, textColor = INK, tag = "food-addr-add") { if (fromCheckout) nav.push("address_add", "back" to "checkout") else nav.push("address_add") }
            }
        }
    }
}

@Composable
private fun AddAddress(backToCheckout: Boolean) {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    var detail by remember { mutableStateOf("") }
    var room by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("先生") }
    var phone by remember { mutableStateOf("") }
    var label by remember { mutableStateOf("") }
    fun save() {
        val problem = when {
            detail.isBlank() -> "请填写收货地址"
            room.isBlank() -> "请填写门牌号"
            name.isBlank() -> "请填写联系人"
            !PhoneRail.validPhone(phone) -> ZH.badPhone
            else -> null
        }
        if (problem != null) {
            p.emit("error", mapOf("code" to "address_form", "app" to APP))
            return p.toast(problem)
        }
        val id = "addr_${p.recordsOf("food_address").size + 1}"
        p.write("food_address", id, "id" to id, "detail" to detail.trim(), "room" to room.trim(), "name" to "${name.trim()}（$title）", "phone" to phone, "label" to label.ifEmpty { null })
        p.setState(APP, "address", id)
        p.toast("保存成功")
        nav.pop()
        // Added from the checkout: straight back to it with the new address chosen.
        if (backToCheckout) nav.pop()
    }
    PScreen("food-address-form") {
        PColumn {
            PBar("新增收货地址", onBack = nav::pop)
            PBody {
                PGroup {
                    PField("收货地址", detail, { detail = it }, "小区/写字楼/学校等", tag = "food-addr-detail", mic = true)
                    PField("门牌号", room, { room = it }, "例：3号楼1202室", tag = "food-addr-room")
                    PField("联系人", name, { name = it }, "请填写收货人的姓名", tag = "food-addr-name")
                    PFieldRow { PChips { for (t in listOf("先生", "女士")) PChip(t, on = title == t, accent = CHIP, tag = "food-addr-title-$t") { title = t } } }
                    PField("手机号", phone, { phone = it.filter { c -> c in '0'..'9' }.take(11) }, "请填写收货手机号", numeric = true, tag = "food-addr-phone")
                    PFieldRow("标签") { PChips { for (t in listOf("家", "公司", "学校")) PChip(t, on = label == t, accent = CHIP, tag = "food-addr-label-$t") { label = if (label == t) "" else t } } }
                }
            }
            PFooter { PBtn("保存地址", Modifier.weight(1f), accent = ACCENT, textColor = INK, tag = "food-addr-save") { save() } }
        }
    }
}

private val STEP_MS = mapOf("paid" to 2000L, "accepted" to 2500L, "cooking" to 3500L, "picked_up" to 3000L, "delivering" to 4000L)

@Composable
private fun OrderPage(id: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val o = p.record("food_order", id)
    val status = o?.let { PhoneJs.sOrNull(it, "status") }
    val riderId = w.riderPersona
    val rider = p.persona(riderId)
    val dropped = p.events.firstOrNull { PhoneEngine.type(it) == "persona.action" && PhoneJs.sOrNull(it, "persona") == riderId && PhoneJs.sOrNull(it, "action") == "drop_off" }
    LaunchedEffect(status, dropped != null, id) {
        val step = STEP_MS[status ?: return@LaunchedEffect] ?: return@LaunchedEffect
        // The rider at the gate waits for an answer before the order can be delivered.
        if (status == "delivering" && riderId != null && dropped == null) return@LaunchedEffect
        delay(if (status == "delivering" && dropped != null) 2500L else step)
        val next = PhoneFood.TIMELINE.getOrNull(PhoneFood.TIMELINE.indexOf(status) + 1) ?: return@LaunchedEffect
        p.write("food_order", id, "status" to next)
        val open = OpenTarget(APP, "order", mapOf("id" to id))
        when (next) {
            "accepted" -> p.notify(APP, "商家已接单", "${PhoneJs.s(o!!, "shop")}正在为您备餐", open)
            "picked_up" -> p.notify(APP, "骑手已取餐", "骑手正在火速赶来，请保持电话畅通", open)
            "delivering" -> if (riderId != null) {
                p.personaStart(riderId)
                rider?.opening?.let { p.notify(APP, rider.name, it, OpenTarget(APP, "chat", mapOf("persona" to riderId))) }
            }
            "delivered" -> {
                val place = (dropped?.get("params") as? JsonObject)?.get("place")?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
                p.notify(APP, "订单已送达", if (dropped != null) "您的外卖已放在${place ?: "指定位置"}，祝您用餐愉快" else "祝您用餐愉快，记得给骑手好评哦")
            }
        }
    }
    val unread = p.personaLines(riderId).count { it.from == "them" }
    if (o == null || status == null) {
        PScreen("food-order") { PEmpty("订单不存在") }
        return
    }
    val lines = (o["lines"] as? JsonArray ?: JsonArray(emptyList())).map { it as JsonObject }
    val idx = PhoneFood.TIMELINE.indexOf(status)
    val statusZh = PhoneFood.STATUS_ZH[status] ?: status
    val context = "外卖订单：${PhoneJs.s(o, "shop")}，送到${PhoneJs.s(o, "address")}；状态：$statusZh"
    PScreen("food-order-$status") {
        PColumn {
            PBar("订单详情", onBack = nav::home)
            PBody {
                Column(Modifier.fillMaxWidth().background(ACCENT).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    PText(statusZh, size = 22.sp, weight = FontWeight.Bold, color = INK, modifier = Modifier.testTag("food-order-status"))
                    if (status != "delivered" && status != "unpaid") PText("预计${PhoneJs.sOrNull(o, "deliver_at") ?: ""}送达", size = 13.sp, color = INK)
                    if (status == "unpaid") {
                        PBtn("去支付", small = true, kind = BtnKind.LINE, accent = INK, tag = "food-pay-again") {
                            p.scope.launch {
                                val res = p.pay(PayRequest(APP, PhoneJs.s(o, "shop"), "饭点外卖", PhoneJs.n(o, "total")))
                                if (res != null) p.write("food_order", id, "status" to "paid", "paid_at" to p.now(), "pay_method" to res.method)
                            }
                        }
                    }
                }
                if (idx >= 0) {
                    Row(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 8.dp, vertical = 12.dp)) {
                        PhoneFood.TIMELINE.forEachIndexed { i, s ->
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Box(Modifier.size(10.dp).clip(CircleShape).background(if (i <= idx) CHIP else Color(0xFFDDDDDD)))
                                PText((PhoneFood.STATUS_ZH[s] ?: s).replace("订单", ""), size = 10.sp, color = if (i <= idx) INK else PC.muted, align = androidx.compose.ui.text.style.TextAlign.Center)
                            }
                        }
                    }
                }
                if (status in listOf("picked_up", "delivering", "delivered")) {
                    Row(Modifier.fillMaxWidth().padding(10.dp).clip(RoundedCornerShape(10.dp)).background(Color.White).padding(12.dp).testTag("food-rider"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.size(42.dp).clip(CircleShape).background(Color(0xFFFFF4D6)), contentAlignment = Alignment.Center) { Text("🛵", fontSize = 22.sp) }
                        Column(Modifier.weight(1f)) {
                            PText(rider?.name ?: "骑手小王", weight = FontWeight.Bold)
                            PText("饭点专送", size = 12.sp, color = PC.muted)
                        }
                        Box(Modifier.size(44.dp).tap { if (riderId != null) nav.push("chat", "persona" to riderId, "context" to context) else p.toast("骑手正在送餐中，请稍后") }.testTag("food-rider-chat"), contentAlignment = Alignment.Center) {
                            Text("💬", fontSize = 22.sp)
                            if (unread > 0) Badge(unread, Modifier.align(Alignment.TopEnd))
                        }
                        Box(Modifier.size(44.dp).tap { p.toast("正在通过隐私号码呼叫…对方正在通话中") }, contentAlignment = Alignment.Center) { Text("📞", fontSize = 22.sp) }
                    }
                }
                PGroup(PhoneJs.s(o, "shop")) {
                    for (l in lines) CoLine(PhoneJs.s(l, "name"), PhoneJs.list(l, "options"), PhoneJs.n(l, "qty").toInt(), null)
                    PCell("实付", arrow = false, valueContent = { PPrice(PhoneJs.n(o, "total")) })
                }
                PGroup("配送信息") {
                    PCell("收货地址", value = PhoneJs.s(o, "address"), arrow = false)
                    PCell("备注", value = PhoneJs.s(o, "note").ifEmpty { "无" }, arrow = false)
                    PCell("餐具", value = PhoneJs.s(o, "cutlery"), arrow = false)
                    PCell("订单号", value = id.replace("F", "2610290"), arrow = false)
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.FoodOrders() {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val list = p.recordsOf("food_order").reversed()
    PBody(tag = "food-orders") {
        PBar("订单")
        if (list.isEmpty()) PEmpty("还没有订单，快去点一份吧", "🥡")
        for (r in list) {
            val lines = (r.data["lines"] as? JsonArray ?: JsonArray(emptyList())).map { it as JsonObject }
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp).clip(RoundedCornerShape(10.dp)).background(Color.White).tap { nav.push("order", "id" to r.id) }.padding(14.dp).testTag("food-order-row-${r.id}"), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    PText(PhoneJs.s(r.data, "shop"), weight = FontWeight.Bold)
                    PText(lines.joinToString("，") { "${PhoneJs.s(it, "name")}×${PhoneJs.numStr(PhoneJs.n(it, "qty"))}" }, size = 12.sp, color = PC.muted, maxLines = 1)
                }
                Column(horizontalAlignment = Alignment.End) {
                    PText(PhoneFood.STATUS_ZH[PhoneJs.s(r.data, "status")] ?: "", size = 12.sp, color = PC.muted)
                    PPrice(PhoneJs.n(r.data, "total"))
                }
            }
        }
    }
}

