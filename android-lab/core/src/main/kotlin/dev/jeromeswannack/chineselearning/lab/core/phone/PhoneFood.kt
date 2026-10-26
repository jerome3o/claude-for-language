package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/** Port of shared/phone/food.ts — 饭点外卖: 规格 choices, the cart, 起送 / 满减 / 红包 / 包装费 / 配送费, the order timeline. */
object PhoneFood {
    /** One line of the cart: the same dish with other options is another line. */
    @Serializable
    data class CartLine(val key: String, val item_id: String, val name: String, val price: Double, val qty: Int, val options: List<String>)

    /** Picked option names per group name. */
    fun optionProblems(item: FoodItem, picks: Map<String, List<String>>): List<String> {
        val out = mutableListOf<String>()
        for (g in item.options ?: emptyList()) {
            val picked = picks[g.name] ?: emptyList()
            if (g.required && picked.isEmpty()) out.add("请选择${g.name}")
            if (!g.multi && picked.size > 1) out.add("${g.name}只能选一项")
        }
        return out
    }

    fun unitPrice(item: FoodItem, picks: Map<String, List<String>>): Double {
        var p = item.price
        for (g in item.options ?: emptyList()) for (name in picks[g.name] ?: emptyList()) p += g.choices.firstOrNull { it.name == name }?.price ?: 0.0
        return PhoneDates.round2(p)
    }

    /** The picked options in menu order. */
    fun pickedList(item: FoodItem, picks: Map<String, List<String>>): List<String> {
        val out = mutableListOf<String>()
        for (g in item.options ?: emptyList()) for (c in g.choices) if ((picks[g.name] ?: emptyList()).contains(c.name)) out.add(c.name)
        return out
    }

    fun lineKey(itemId: String, options: List<String>): String = "$itemId|${options.joinToString("/")}"

    /** Add one (or [delta]) of a dish with options; lines at 0 are removed. */
    fun changeCart(cart: List<CartLine>, item: FoodItem, options: List<String>, price: Double, delta: Int): List<CartLine> {
        val key = lineKey(item.id, options)
        val found = cart.firstOrNull { it.key == key }
        if (found == null) return if (delta > 0) cart + CartLine(key, item.id, item.name, price, delta, options) else cart.toList()
        return cart.map { if (it.key == key) it.copy(qty = it.qty + delta) else it }.filter { it.qty > 0 }
    }

    fun cartCount(cart: List<CartLine>): Int = cart.sumOf { it.qty }

    fun itemsTotal(cart: List<CartLine>): Double = PhoneDates.round2(cart.fold(0.0) { s, l -> s + l.price * l.qty })

    /** "还差¥5起送" — 0 when the order may be sent. */
    fun minOrderGap(shop: FoodShop, cart: List<CartLine>): Double = PhoneDates.round2(maxOf(0.0, shop.minOrder - itemsTotal(cart)))

    fun bestDiscount(shop: FoodShop, amount: Double): FoodDiscount? {
        val ok = (shop.discounts ?: emptyList()).filter { amount >= it.threshold }
        if (ok.isEmpty()) return null
        return ok.reduce { a, b -> if (b.minus > a.minus) b else a }
    }

    data class NextDiscount(val gap: Double, val minus: Double)

    /** The next 满减 step not reached yet ("再买¥8可减10"). */
    fun nextDiscount(shop: FoodShop, amount: Double): NextDiscount? {
        val above = (shop.discounts ?: emptyList()).filter { amount < it.threshold }.sortedWith { a, b -> a.threshold.compareTo(b.threshold) }
        if (above.isEmpty()) return null
        return NextDiscount(PhoneDates.round2(above[0].threshold - amount), above[0].minus)
    }

    fun packingFee(shop: FoodShop, cart: List<CartLine>): Double = PhoneDates.round2((shop.packingFee ?: 0.0) * cartCount(cart))

    data class CartTotals(
        val items: Double,
        val packing: Double,
        val delivery: Double,
        val discount: Double,
        val redPacket: Double,
        val redPacketId: String?,
        val total: Double,
    )

    fun usableRedPackets(packets: List<FoodRedPacket>?, amount: Double): List<FoodRedPacket> =
        (packets ?: emptyList()).filter { amount >= it.threshold }.sortedWith { a, b -> b.amount.compareTo(a.amount) }

    /** The 红包 choice: [Auto] = the best usable one, [None] = none, [Id] = that one. */
    sealed class RedPacketChoice {
        object Auto : RedPacketChoice()
        object None : RedPacketChoice()
        data class Id(val id: String) : RedPacketChoice()
    }

    /** The checkout's money: dishes + 包装费, minus the best 满减, minus the 红包, plus 配送费. */
    fun cartTotals(shop: FoodShop, cart: List<CartLine>, packets: List<FoodRedPacket>? = null, choice: RedPacketChoice = RedPacketChoice.Auto): CartTotals {
        val items = itemsTotal(cart)
        val packing = packingFee(shop, cart)
        val goods = PhoneDates.round2(items + packing)
        val discount = bestDiscount(shop, goods)?.minus ?: 0.0
        val afterDiscount = PhoneDates.round2(goods - discount)
        val usable = usableRedPackets(packets, afterDiscount)
        val rp = when (choice) {
            RedPacketChoice.None -> null
            RedPacketChoice.Auto -> usable.firstOrNull()
            is RedPacketChoice.Id -> usable.firstOrNull { it.id == choice.id }
        }
        val red = rp?.amount ?: 0.0
        return CartTotals(items, packing, shop.deliveryFee, discount, red, rp?.id, PhoneDates.round2(maxOf(0.01, afterDiscount - red + shop.deliveryFee)))
    }

    val FOOD_STATUSES = listOf("unpaid", "paid", "accepted", "cooking", "picked_up", "delivering", "delivered", "cancelled")

    val STATUS_ZH = mapOf(
        "unpaid" to "待支付", "paid" to "等待商家接单", "accepted" to "商家已接单", "cooking" to "商家正在备餐",
        "picked_up" to "骑手已取餐", "delivering" to "骑手正在送货", "delivered" to "订单已送达", "cancelled" to "订单已取消",
    )

    /** The status steps after payment, in order. */
    val TIMELINE = listOf("paid", "accepted", "cooking", "picked_up", "delivering", "delivered")

    val CUTLERY = listOf("无需餐具", "1份", "2份", "3份", "4份", "5份及以上")

    val DEFAULT_NOTE_TAGS = listOf("不要香菜", "不要葱", "少辣", "多放辣", "少放盐", "不要洋葱", "饭多一点", "汤分开装")

    /** The record an order writes (food_order). */
    fun foodOrderData(
        shop: FoodShop,
        cart: List<CartLine>,
        totals: CartTotals,
        note: String,
        noteTags: List<String>,
        cutlery: String,
        address: FoodAddress,
        orderId: String,
        status: String,
    ): JsonObject {
        val firstCategory = (shop.menu.firstOrNull()?.items ?: emptyList()).map { it.id }.toSet()
        return PhoneJs.obj(
            "order_id" to PhoneJs.str(orderId),
            "shop_id" to PhoneJs.str(shop.id),
            "shop" to PhoneJs.str(shop.name),
            "shop_rating" to PhoneJs.num(shop.rating),
            "shop_minutes" to PhoneJs.num(shop.deliveryMin),
            "lines" to JsonArray(cart.map { l -> PhoneJs.obj("item_id" to PhoneJs.str(l.item_id), "name" to PhoneJs.str(l.name), "qty" to PhoneJs.num(l.qty), "options" to PhoneJs.strs(l.options)) }),
            "main_count" to PhoneJs.num(cart.filter { it.item_id in firstCategory }.sumOf { it.qty }),
            "item_count" to PhoneJs.num(cartCount(cart)),
            "note" to PhoneJs.str((noteTags + JsJson.trim(note)).filter { it.isNotEmpty() }.joinToString("，")),
            "note_tags" to PhoneJs.strs(noteTags),
            "cutlery" to PhoneJs.str(cutlery),
            "address_id" to PhoneJs.str(address.id),
            "address_label" to PhoneJs.str(address.label ?: ""),
            "address" to PhoneJs.str(if (!address.room.isNullOrEmpty()) "${address.detail} ${address.room}" else address.detail),
            "discount" to PhoneJs.num(totals.discount),
            "red_packet" to PhoneJs.num(totals.redPacket),
            "red_packet_id" to (totals.redPacketId?.let(PhoneJs::str) ?: JsonNull),
            "total" to PhoneJs.num(totals.total),
            "status" to PhoneJs.str(status),
        )
    }
}
