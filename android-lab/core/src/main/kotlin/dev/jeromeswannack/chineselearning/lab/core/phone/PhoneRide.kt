package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson

/** Port of shared/phone/ride.ts — 招手打车: POI search, price estimates, coupons, the trip's status line. */
object PhoneRide {
    /** 预估价 over [km] (rounded to ¥0.1; at least the base fare). */
    fun estimatePrice(car: RideCarOffer, km: Double): Double = Js.round(maxOf(car.base, car.base + car.perKm * km) * 10) / 10

    /** Minutes at city speed (~25 km/h), at least 3. */
    fun tripMinutes(km: Double): Int = maxOf(3.0, Js.round((km / 25) * 60)).toInt()

    fun searchPois(pois: List<RidePoi>, query: String): List<RidePoi> {
        val q = JsJson.trim(query)
        if (q.isEmpty()) return emptyList()
        val chars = JsJson.replaceSpaceRuns(q, "").let { t -> t.codePoints().toArray().map { String(Character.toChars(it)) } }
        val scored = pois.map { p ->
            val hay = "${p.name}${p.address}${p.district ?: ""}${p.kind ?: ""}"
            val hits = chars.count { hay.contains(it) }
            val whole = if (p.name.contains(q)) 100.0 else if (hay.contains(q)) 50.0 else 0.0
            p to whole + (hits.toDouble() / chars.size) * 40
        }.filter { it.second >= 30 }
        return scored.sortedWith { a, b ->
            val d = b.second - a.second
            if (d != 0.0) (if (d < 0) -1 else 1) else (a.first.km - b.first.km).let { if (it < 0) -1 else if (it > 0) 1 else 0 }
        }.map { it.first }
    }

    /** The best coupon for a car type at a price (the app applies it itself). */
    fun bestCoupon(coupons: List<RideCoupon>?, type: String, price: Double): RideCoupon? {
        val usable = (coupons ?: emptyList()).filter { (it.carType == null || it.carType == type) && price >= (it.minPrice ?: 0.0) }
        if (usable.isEmpty()) return null
        return usable.reduce { a, b -> if (b.amount > a.amount) b else a }
    }

    fun priceAfterCoupon(price: Double, coupon: RideCoupon?): Double = PhoneDates.round2(maxOf(0.0, price - (coupon?.amount ?: 0.0)))

    fun carOffer(world: RideWorld, type: String): RideCarOffer? = world.cars.firstOrNull { it.type == type }

    val RIDE_STATUSES = listOf("calling", "accepted", "arrived", "in_trip", "finished", "paid", "cancelled")

    fun rideStatusLine(status: String, etaMin: Double): String = when (status) {
        "calling" -> "正在为您呼叫附近的司机…"
        "accepted" -> "司机已接单，正在赶来，约${Js.numberToString(etaMin)}分钟"
        "arrived" -> "司机已到达上车点，请尽快上车"
        "in_trip" -> "行程中，请系好安全带"
        "finished" -> "已到达目的地，请确认支付"
        "paid" -> "行程已完成，感谢您的乘坐"
        "cancelled" -> "订单已取消"
        else -> ""
    }

    /** 取消订单 after a driver accepted: the fee once they've driven a while. */
    fun cancelFee(status: String, minutesSinceAccept: Double): Double = when {
        status == "calling" -> 0.0
        status == "arrived" -> 5.0
        minutesSinceAccept >= 2 -> 3.0
        else -> 0.0
    }

    val RATING_TAGS_GOOD = listOf("车内整洁", "驾驶平稳", "服务热情", "准时到达", "路线熟悉")
    val RATING_TAGS_BAD = listOf("绕路", "车内有异味", "驾驶不稳", "态度不好", "迟到")
}
