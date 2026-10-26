package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * Port of shared/phone/rail.ts — 铁路出行: train kinds, the station search (汉字 / 拼音 / 简拼),
 * the train list, seats left, the seat map letters, seat assignment, passenger checks, 退票 fees
 * and 改签 — the real system's rules.
 */
object PhoneRail {
    fun trainKind(no: String): String = when (no.take(1).uppercase()) {
        "G" -> "高铁"
        "C" -> "城际"
        "D" -> "动车"
        "Z" -> "直达"
        "T" -> "特快"
        "K" -> "快速"
        else -> "普通"
    }

    /** G / C / D trains (the list's 高铁动车 filter). */
    fun isHighSpeed(no: String): Boolean = no.isNotEmpty() && no[0].uppercaseChar() in "GCD"

    fun stationInitials(s: RailStation): String =
        splitSpaces(s.pinyin).filter { it.isNotEmpty() }.joinToString("") { it.take(1) }.lowercase()

    /** `s.split(/\s+/)`. */
    private fun splitSpaces(s: String): List<String> {
        val out = mutableListOf<String>()
        val cur = StringBuilder()
        var i = 0
        while (i < s.length) {
            if (JsJson.isJsSpace(s[i])) {
                out.add(cur.toString()); cur.clear()
                while (i < s.length && JsJson.isJsSpace(s[i])) i++
            } else { cur.append(s[i]); i++ }
        }
        out.add(cur.toString())
        return out
    }

    /** The station picker's search: 汉字 (name or city), full pinyin, or 简拼 initials. */
    fun searchStations(stations: List<RailStation>, query: String): List<RailStation> {
        val q = JsJson.replaceSpaceRuns(JsJson.trim(query).lowercase(), "")
        if (q.isEmpty()) return emptyList()
        val t = JsJson.trim(query)
        return stations.filter { s ->
            if (s.name.contains(t) || s.city.contains(t)) return@filter true
            val full = JsJson.replaceSpaceRuns(s.pinyin, "").lowercase()
            full.startsWith(q) || stationInitials(s).startsWith(q)
        }
    }

    /** A place typed in 出发地 / 到达地 is a station or a whole city (上海 = every 上海 station). */
    fun stationMatches(stations: List<RailStation>, place: String, station: String): Boolean {
        if (place == station) return true
        val s = stations.firstOrNull { it.name == station }
        return s != null && s.city == place
    }

    fun cityOf(stations: List<RailStation>, place: String): String = stations.firstOrNull { it.name == place }?.city ?: place

    data class TrainFilter(val highSpeedOnly: Boolean = false, val availableOnly: Boolean = false, val sort: String = "depart")

    fun trainMinutes(t: RailTrain): Int = PhoneDates.spanMinutes(t.depart, t.arrive)

    fun cheapestPrice(t: RailTrain): Double = t.seats.minOf { it.price }

    /** The 车次列表 for a search. */
    fun searchTrains(world: RailWorld, from: String, to: String, date: String, filter: TrainFilter = TrainFilter(), records: List<PhoneRecord> = emptyList()): List<RailTrain> {
        var list = world.trains.filter { it.date == date && stationMatches(world.stations, from, it.from) && stationMatches(world.stations, to, it.to) }
        if (filter.highSpeedOnly) list = list.filter { isHighSpeed(it.no) }
        if (filter.availableOnly) list = list.filter { t -> t.seats.any { seatsLeft(t, it.cls, records) > 0 } }
        val dep = Comparator<RailTrain> { a, b -> PhoneDates.minutesOf(a.depart) - PhoneDates.minutesOf(b.depart) }
        val cmp: Comparator<RailTrain> = when (filter.sort) {
            "duration" -> Comparator { a, b -> (trainMinutes(a) - trainMinutes(b)).takeIf { it != 0 } ?: dep.compare(a, b) }
            "price" -> Comparator { a, b ->
                val d = cheapestPrice(a) - cheapestPrice(b)
                if (d != 0.0 && !d.isNaN()) (if (d < 0) -1 else 1) else dep.compare(a, b)
            }
            else -> dep
        }
        return list.sortedWith(cmp)
    }

    private fun holdsSeats(r: PhoneRecord): Boolean {
        val st = JsJson.str(r.data["status"])
        return r.record == "rail_order" && (st == "paid" || st == "unpaid")
    }

    /** Seats left of a class, after the orders made on this phone. */
    fun seatsLeft(t: RailTrain, cls: String, records: List<PhoneRecord> = emptyList()): Int {
        val offer = t.seats.firstOrNull { it.cls == cls } ?: return 0
        val booked = records
            .filter { holdsSeats(it) && JsJson.str(it.data["train_no"]) == t.no && JsJson.str(it.data["date"]) == t.date && JsJson.str(it.data["seat_class"]) == cls }
            .sumOf { (it.data["passengers"] as? JsonArray)?.size ?: 0 }
        return maxOf(0, offer.left - booked)
    }

    /** 有 (20+), 12张, 候补, 无. */
    fun seatsLabel(left: Int, waitlist: Boolean = false): String = when {
        left >= 20 -> "有"
        left > 0 -> "${left}张"
        waitlist -> "候补"
        else -> "无"
    }

    data class SeatLayout(val letters: List<String>, val aisleAfter: String)

    /** Seat letters per class, left to right (no E; no B outside 二等座); null = no 选座. */
    fun seatLetters(cls: String): SeatLayout? = when (cls) {
        "二等座" -> SeatLayout(listOf("A", "B", "C", "D", "F"), "C")
        "一等座" -> SeatLayout(listOf("A", "C", "D", "F"), "C")
        "商务座" -> SeatLayout(listOf("A", "C", "F"), "C")
        else -> null
    }

    val WINDOW_LETTERS = listOf("A", "F")

    fun isWindow(letter: String): Boolean = letter.uppercase() in WINDOW_LETTERS

    /** FNV-1a over UTF-16 units, `>>> 0`. */
    fun hash(s: String): Long {
        var h = 2166136261L.toInt()
        for (c in s) {
            h = h xor c.code
            h *= 16777619
        }
        return h.toLong() and 0xFFFFFFFFL
    }

    private val COACH_RANGE = mapOf(
        "商务座" to (1 to 1), "一等座" to (2 to 3), "二等座" to (4 to 8),
        "软卧" to (9 to 10), "硬卧" to (11 to 14), "硬座" to (4 to 8), "无座" to (4 to 8),
    )

    /**
     * Seats for an order: "05车07F". Chosen letters are kept (one row, like the real 选座); with no
     * choice the system picks aisle / middle seats. Deterministic for the order id.
     */
    fun assignSeats(train: RailTrain, cls: String, count: Int, chosen: List<String>, orderId: String): List<String> {
        val (lo, hi) = COACH_RANGE[cls] ?: (4 to 8)
        val h = hash("${train.no}|${train.date}|$orderId")
        val coach = (lo + (h % (hi - lo + 1)).toInt()).toString().padStart(2, '0')
        if (cls == "无座") return List(count) { "${coach}车 无座" }
        val layout = seatLetters(cls)
        if (layout == null) {
            val start = 1 + (h % 40).toInt()
            return List(count) { i -> "${coach}车${(start + i).toString().padStart(3, '0')}号" }
        }
        val row = 1 + (h % 16).toInt()
        val picked = chosen.filter { it in layout.letters }.take(count)
        val pool = layout.letters.filter { !isWindow(it) && it !in picked } + layout.letters.filter { isWindow(it) && it !in picked }
        val out = picked.map { "${coach}车${row.toString().padStart(2, '0')}$it" }.toMutableList()
        var k = 0
        while (out.size < count) {
            val r = row + (picked.size + k) / layout.letters.size
            val l = if (k < pool.size) pool[k] else layout.letters[(k - pool.size) % layout.letters.size]
            out.add("${coach}车${r.toString().padStart(2, '0')}$l")
            k++
        }
        return out
    }

    fun seatLetterOf(seat: String): String? = seat.lastOrNull()?.takeIf { it in 'A'..'F' }?.toString()

    // ── passengers ──

    /** 18-digit 身份证 check digit. */
    fun validChineseId(id: String): Boolean {
        if (id.length != 18 || !id.take(17).all(PhoneJs::isDigit) || !(PhoneJs.isDigit(id[17]) || id[17] == 'X' || id[17] == 'x')) return false
        val w = intArrayOf(7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
        val codes = "10X98765432"
        var sum = 0
        for (i in 0 until 17) sum += w[i] * (id[i] - '0')
        return codes[sum % 11] == id[17].uppercaseChar()
    }

    fun validPhone(phone: String): Boolean = PhoneJs.isMobile(JsJson.replaceSpaceRuns(phone, ""))

    private val NAME_ZH = Regex("^[一-龥·]{2,15}$")
    private val NAME_PASSPORT = Regex("^[A-Za-z一-龥][A-Za-z一-龥 .·'-]{1,40}$")
    private val ID_NO = Regex("^[A-Za-z0-9]{5,17}$")

    /** Form errors in the order the app shows them (the first one is the toast). */
    fun passengerProblems(p: RailPassenger, existing: List<RailPassenger> = emptyList()): List<String> {
        val out = mutableListOf<String>()
        val name = JsJson.trim(p.name)
        val type = p.idType.ifEmpty { null }
        if (type == null) out.add("请选择证件类型")
        if (name.isEmpty()) out.add("请输入姓名")
        else if (type == "中国居民身份证" && !NAME_ZH.matches(name)) out.add("姓名填写有误，请输入证件上的姓名")
        else if (type == "护照" && !NAME_PASSPORT.matches(name)) out.add("姓名填写有误，请输入证件上的姓名")
        val no = JsJson.trim(p.idNo)
        if (no.isEmpty()) out.add("请输入证件号码")
        else if (type == "中国居民身份证" && !validChineseId(no)) out.add("请输入正确的身份证号码")
        else if (type != "中国居民身份证" && !ID_NO.matches(no)) out.add("请输入正确的证件号码")
        if ((type == "护照" || type == "外国人永久居留身份证") && p.country.isNullOrEmpty()) out.add("请选择国家/地区")
        if (!p.phone.isNullOrEmpty() && !validPhone(p.phone)) out.add("请输入正确的手机号码")
        if (no.isNotEmpty() && existing.any { it.idNo.uppercase() == no.uppercase() && it.id != p.id }) out.add("该乘车人已存在，请勿重复添加")
        return out
    }

    /** Passport names are upper case, surname first (SMITH ANNA). */
    fun normalizePassportName(name: String): String = JsJson.replaceSpaceRuns(JsJson.trim(name), " ").uppercase()

    // ── 退票 / 改签 ──

    /** 退票费 by time before departure; null = the train has left. */
    fun refundFee(price: Double, today: String, now: String, date: String, depart: String): Double? {
        val mins = PhoneDates.minutesUntil(today, now, date, depart)
        if (mins <= 0) return null
        val hours = mins / 60.0
        val rate = if (hours >= 192) 0.0 else if (hours >= 48) 0.05 else if (hours >= 24) 0.1 else 0.2
        if (rate == 0.0) return 0.0
        val fee = Math.floor(price * rate * 2) / 2
        return minOf(price, maxOf(2.0, fee))
    }

    fun refundRateLabel(today: String, now: String, date: String, depart: String): String {
        val mins = PhoneDates.minutesUntil(today, now, date, depart)
        val hours = mins / 60.0
        return when {
            mins <= 0 -> "已过开车时间"
            hours >= 192 -> "开车前8天（含）以上，不收取退票费"
            hours >= 48 -> "开车前48小时以上不足8天，按票价5%计收退票费"
            hours >= 24 -> "开车前24小时以上不足48小时，按票价10%计收退票费"
            else -> "开车前不足24小时，按票价20%计收退票费"
        }
    }

    /** Trains a ticket can be changed to: same stations, not yet departed, within 14 days. */
    fun changeOptions(world: RailWorld, trainNo: String, date: String, from: String, to: String, today: String, now: String): List<RailTrain> =
        world.trains.filter { t ->
            t.from == from && t.to == to && !(t.no == trainNo && t.date == date) &&
                PhoneDates.minutesUntil(today, now, t.date, t.depart) > 0 && PhoneDates.daysBetween(today, t.date) <= 14
        }

    /** 改签 money: positive = pay the difference, negative = refunded. */
    fun changeDifference(oldTotal: Double, newTotal: Double): Double = PhoneDates.round2(newTotal - oldTotal)

    fun findTrain(world: RailWorld, no: String, date: String): RailTrain? = world.trains.firstOrNull { it.no == no && it.date == date }

    fun windowCount(seats: List<String>): Int = seats.count { s -> seatLetterOf(s)?.let(::isWindow) == true }

    private val SEAT_FULL = Regex("^([0-9]+)车([0-9]+)([A-F])$")

    /** Two or more seats in one row, all on one side of the aisle (A–C or D–F). */
    fun seatsTogether(seats: List<String>): Boolean {
        if (seats.size < 2) return seats.size == 1
        val parsed = seats.map { SEAT_FULL.matchEntire(it) }
        if (parsed.any { it == null }) return false
        val coach = parsed[0]!!.groupValues[1]
        val row = parsed[0]!!.groupValues[2]
        if (parsed.any { it!!.groupValues[1] != coach || it.groupValues[2] != row }) return false
        return parsed.map { if (it!!.groupValues[3] in listOf("A", "B", "C")) "L" else "R" }.toSet().size == 1
    }

    /** The record an order writes (rail_order). */
    fun railOrderData(
        train: RailTrain,
        seatClass: String,
        passengers: List<RailPassenger>,
        seats: List<String>,
        orderId: String,
        orderNo: String,
        status: String,
        changedFrom: String? = null,
    ): JsonObject {
        val each = train.seats.firstOrNull { it.cls == seatClass }?.price ?: 0.0
        return PhoneJs.obj(
            "order_id" to PhoneJs.str(orderId),
            "order_no" to PhoneJs.str(orderNo),
            "train_no" to PhoneJs.str(train.no),
            "date" to PhoneJs.str(train.date),
            "from" to PhoneJs.str(train.from),
            "to" to PhoneJs.str(train.to),
            "depart" to PhoneJs.str(train.depart),
            "arrive" to PhoneJs.str(train.arrive),
            "seat_class" to PhoneJs.str(seatClass),
            "passengers" to PhoneJs.strs(passengers.map { it.name }),
            "passenger_ids" to PhoneJs.strs(passengers.map { it.id }),
            "passenger_nos" to PhoneJs.strs(passengers.map { it.idNo }),
            "seats" to PhoneJs.strs(seats),
            "window_count" to PhoneJs.num(windowCount(seats)),
            "together" to PhoneJs.bool(seatsTogether(seats)),
            "price_each" to PhoneJs.num(each),
            "total" to PhoneJs.num(PhoneDates.round2(each * passengers.size)),
            "status" to PhoneJs.str(status),
            "gate" to PhoneJs.str(train.gate ?: ""),
            "changed_from" to changedFrom?.ifEmpty { null }?.let(PhoneJs::str),
        )
    }
}
