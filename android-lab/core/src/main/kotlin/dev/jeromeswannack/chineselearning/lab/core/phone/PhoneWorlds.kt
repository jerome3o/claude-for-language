package dev.jeromeswannack.chineselearning.lab.core.phone

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

/**
 * Port of shared/phone/world.ts: what a scenario starts with in its log (orders the account
 * already holds), lists merging the world with what was added on the phone, record ids, the
 * simulated clock and the stable SMS code.
 */
object PhoneWorlds {
    /** "订单号"-style ids: the prefix + a running number on this phone. */
    fun nextRecordId(events: List<PhoneEvent>, record: String, prefix: String): String {
        val n = PhoneEngine.recordsOf(events, record).size + 1
        return "$prefix${n.toString().padStart(3, '0')}"
    }

    fun railOrderSeedData(world: RailWorld, seedId: String): JsonObject? {
        val orders = world.orders ?: emptyList()
        val o = orders.firstOrNull { it.id == seedId } ?: return null
        val t = PhoneRail.findTrain(world, o.trainNo, o.date) ?: return null
        val pas = o.passengers.mapNotNull { id -> world.passengers.firstOrNull { it.id == id } }
        return PhoneJs.obj(
            "order_id" to PhoneJs.str(o.id),
            "order_no" to PhoneJs.str("E${731_204_118L + orders.indexOf(o) * 7919L}"),
            "train_no" to PhoneJs.str(o.trainNo),
            "date" to PhoneJs.str(o.date),
            "from" to PhoneJs.str(t.from),
            "to" to PhoneJs.str(t.to),
            "depart" to PhoneJs.str(t.depart),
            "arrive" to PhoneJs.str(t.arrive),
            "seat_class" to PhoneJs.str(o.seatClass),
            "passengers" to PhoneJs.strs(pas.map { it.name }),
            "passenger_ids" to PhoneJs.strs(pas.map { it.id }),
            "passenger_nos" to PhoneJs.strs(pas.map { it.idNo }),
            "seats" to PhoneJs.strs(o.seats),
            "window_count" to PhoneJs.num(PhoneRail.windowCount(o.seats)),
            "together" to PhoneJs.bool(true),
            "price_each" to PhoneJs.num(o.priceEach),
            "total" to PhoneJs.num(PhoneDates.round2(o.priceEach * o.seats.size)),
            "status" to PhoneJs.str("paid"),
            "gate" to PhoneJs.str(t.gate ?: ""),
            "seeded" to PhoneJs.bool(true),
        )
    }

    /** The log a scenario starts with. */
    fun seedEvents(spec: ScenarioSpec, at: Long): List<PhoneEvent> {
        val rail = spec.world.rail ?: return emptyList()
        return (rail.orders ?: emptyList()).mapNotNull { o -> railOrderSeedData(rail, o.id)?.let { PhoneEngine.recordEvent("rail_order", o.id, it, at) } }
    }

    /** 常用乘车人: the world's plus those added on the phone (latest version). */
    fun railPassengers(world: RailWorld, events: List<PhoneEvent>): List<RailPassenger> {
        val byId = LinkedHashMap<String, RailPassenger>()
        for (p in world.passengers) byId[p.id] = p
        for (r in PhoneEngine.recordsOf(events, "rail_passenger")) {
            val p = runCatching { PhoneScenarios.json.decodeFromJsonElement<RailPassenger>(r.data) }.getOrNull() ?: continue
            if (p.deleted) byId.remove(p.id) else byId[p.id] = p
        }
        return byId.values.toList()
    }

    fun foodAddresses(saved: List<FoodAddress>, events: List<PhoneEvent>): List<FoodAddress> {
        val byId = LinkedHashMap<String, FoodAddress>()
        for (a in saved) byId[a.id] = a
        for (r in PhoneEngine.recordsOf(events, "food_address")) {
            runCatching { PhoneScenarios.json.decodeFromJsonElement<FoodAddress>(r.data) }.getOrNull()?.let { byId[r.id] = it }
        }
        return byId.values.toList()
    }

    fun addressLine(a: FoodAddress): String = if (!a.room.isNullOrEmpty()) "${a.detail} ${a.room}" else a.detail

    data class Clock(val date: String, val time: String, val minutes: Int)

    /** The scenario's date + time, moving at real speed from when the play started. */
    fun phoneClock(today: String, now: String, startedAt: Long, nowMs: Long): Clock {
        val elapsed = maxOf(0L, Math.floorDiv(nowMs - startedAt, 60_000L)).toInt()
        val total = PhoneDates.minutesOf(now) + elapsed
        return Clock(PhoneDates.addDays(today, Math.floorDiv(total, 1440)), PhoneDates.timeOf(total), total)
    }

    /** A six-digit SMS code, stable for the play. */
    fun smsCodeFor(seed: Long): String {
        // `seed | 0` (ToInt32), Math.imul, Math.abs, % 900000.
        val s = seed.toInt()
        val m = s * (2654435761L.toInt())
        return (100000 + Math.abs(m.toLong()) % 900000).toString()
    }

    /** The record id + data of a JSON record event as `{ type: 'record', … }` (for tests / the shell). */
    fun recordData(e: PhoneEvent): JsonObject? = e["data"] as? JsonObject

    fun atOf(e: PhoneEvent): Long = (e["at"] as? JsonPrimitive)?.content?.toDoubleOrNull()?.toLong() ?: 0L
}
