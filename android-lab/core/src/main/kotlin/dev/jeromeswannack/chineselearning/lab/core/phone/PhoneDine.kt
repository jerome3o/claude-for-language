package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson

/** Port of shared/phone/dine.ts — 吃喝玩乐: 排队取号 (table type, ticket number, the wait) and 订座 (full slots, party size, 包间). */
object PhoneDine {
    fun queueTableFor(tables: List<DineQueueTable>, people: Int): DineQueueTable? = tables.firstOrNull { people >= it.min && people <= it.max }

    data class QueueTicket(val number: String, val ahead: Int, val minutes: Int)

    /** "B024": the table type's letter and the next number after those waiting (+ tickets taken here). */
    fun queueTicket(table: DineQueueTable, takenHere: Int): QueueTicket {
        val ahead = table.waiting + takenHere
        val n = 10 + table.waiting * 2 + takenHere + 1
        val per = if (table.waiting > 0) table.minutes.toDouble() / table.waiting else 3.0
        return QueueTicket("${table.id}${n.toString().padStart(3, '0')}", ahead, Js.round(ahead * per).toInt())
    }

    fun slotFull(r: DineRestaurant, date: String, time: String): Boolean = "$date $time" in (r.booking?.full ?: emptyList())

    fun ticketsTaken(records: List<PhoneRecord>, restaurantId: String, tableId: String): Int =
        records.count { it.record == "dine_queue" && JsJson.str(it.data["restaurant_id"]) == restaurantId && JsJson.str(it.data["table_id"]) == tableId }

    data class BookingDraft(
        val date: String? = null,
        val time: String? = null,
        val people: Int? = null,
        val area: String? = null,
        val name: String? = null,
        val title: String? = null,
        val phone: String? = null,
        val note: String? = null,
    )

    fun bookingProblems(r: DineRestaurant, d: BookingDraft): List<String> {
        val out = mutableListOf<String>()
        val b = r.booking ?: return listOf("该商家暂不支持在线订座")
        if (d.date.isNullOrEmpty()) out.add("请选择用餐日期")
        if (d.time.isNullOrEmpty()) out.add("请选择到店时间")
        else if (!d.date.isNullOrEmpty() && slotFull(r, d.date, d.time)) out.add("该时段已订满，请选择其他时间")
        if (d.people == null || d.people < 1) out.add("请选择用餐人数")
        else if (d.people > b.maxPeople) out.add("在线最多预订${b.maxPeople}人，更多人数请致电商家")
        if (d.area == "包间") {
            if (b.rooms == null) out.add("该商家暂无包间")
            else if ((d.people ?: 0) < b.rooms.minPeople) out.add("包间${b.rooms.minPeople}人起订")
        }
        if (JsJson.trim(d.name ?: "").isEmpty()) out.add("请填写联系人姓名")
        if (d.phone.isNullOrEmpty() || !PhoneJs.isMobile(JsJson.replaceSpaceRuns(d.phone, ""))) out.add("请输入正确的手机号码")
        return out
    }

    /** 4.6 → full stars + half. */
    fun starParts(rating: Double): Pair<Int, Boolean> {
        val r = maxOf(0.0, minOf(5.0, rating))
        val full = Math.floor(r).toInt()
        return full to (r - full >= 0.5)
    }
}
