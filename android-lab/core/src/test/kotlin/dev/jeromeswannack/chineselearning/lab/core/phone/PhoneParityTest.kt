package dev.jeromeswannack.chineselearning.lab.core.phone

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 📱 Phone practice must behave exactly like the web: parity/fixtures/phone.ts runs shared/phone
 * (the validator over every bundled scenario + ~1,000 broken variants, the matchers, the golden
 * play-through of every scenario built with the apps' own record builders, and every per-app
 * rule over seeded inputs) and this replays each case on the Kotlin port.
 */
class PhoneParityTest {
    private val dir: String by lazy { System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle") }
    private val fx: JsonObject by lazy { Json.parseToJsonElement(File(dir, "phone.json").readText()).jsonObject }
    private val json = PhoneScenarios.json

    private fun s(e: JsonElement?): String = (e as JsonPrimitive).content
    private fun strOrNull(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun strs(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }
    private fun d(e: JsonElement?): Double = e!!.jsonPrimitive.double
    private fun i(e: JsonElement?): Int = e!!.jsonPrimitive.int
    private fun events(e: JsonElement?): List<PhoneEvent> = e!!.jsonArray.map { it.jsonObject }
    private fun section(name: String): JsonObject = fx[name]!!.jsonObject

    private fun same(expected: JsonElement?, actual: JsonElement?, msg: () -> String) {
        if (!PhoneJs.same(expected, actual)) fail("${msg()}\n expected: $expected\n   actual: $actual")
    }

    private fun recordsJson(rs: List<PhoneRecord>): JsonArray = JsonArray(rs.map { PhoneJs.obj("record" to JsonPrimitive(it.record), "id" to JsonPrimitive(it.id), "data" to it.data, "at" to JsonPrimitive(it.at)) })

    private val railWorlds by lazy { PhoneScenarios.all.mapNotNull { it.world.rail } }
    private val rideWorlds by lazy { PhoneScenarios.all.mapNotNull { it.world.ride } }
    private val foodWorlds by lazy { PhoneScenarios.all.mapNotNull { it.world.food } }
    private val movieWorlds by lazy { PhoneScenarios.all.mapNotNull { it.world.movie } }
    private val dineWorlds by lazy { PhoneScenarios.all.mapNotNull { it.world.dine } }

    @Test
    fun shipsTheBundledScenariosByteForByte() {
        val expected = File(dir, "phone-scenarios.json").readText()
        val shipped = PhoneScenarios::class.java.getResourceAsStream("/phone/scenarios.json")!!.bufferedReader(Charsets.UTF_8).readText()
        assertEquals(expected, shipped, "core/src/main/resources/phone/scenarios.json is stale — cp $dir/phone-scenarios.json android-lab/core/src/main/resources/phone/scenarios.json")
        assertEquals(18, PhoneScenarios.all.size)
        // Every scenario decodes into the data classes the screens use, and round-trips its ids.
        assertEquals(PhoneScenarios.raw.map { it["id"]!!.jsonPrimitive.content }, PhoneScenarios.all.map { it.id })
    }

    @Test
    fun validatesLikeTheWeb() {
        val cases = fx["validate"]!!.jsonArray
        assertTrue(cases.size > 500)
        for (c in cases) {
            val o = c.jsonObject
            val got = PhoneValidate.validate(o["spec"])
            assertEquals(strs(o["problems"]), got, "validate: ${s(o["name"])}")
        }
    }

    @Test
    fun matchesValuesLikeTheWeb() {
        for (c in fx["matchers"]!!.jsonArray) {
            val o = c.jsonObject
            val value = if (o["has_value"]!!.jsonPrimitive.boolean) o["value"] else null
            assertEquals(o["result"]!!.jsonPrimitive.boolean, PhoneEngine.matches(value, o["matcher"]!!), "matches(${o["value"]}, ${o["matcher"]})")
        }
        val cond = section("conditions")
        val evs = events(cond["events"])
        same(cond["records"], recordsJson(PhoneEngine.recordsFrom(evs))) { "recordsFrom" }
        val snap = PhoneEngine.snapshot(evs)
        for (c in cond["cases"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonPrimitive.boolean, PhoneEngine.checkCondition(o["condition"], snap), "checkCondition ${o["condition"]}")
        }
    }

    @Test
    fun playsEveryGoldenPathIdentically() {
        val plays = fx["plays"]!!.jsonArray
        assertTrue(plays.size >= 40)
        var golden = 0
        for (p in plays) {
            val o = p.jsonObject
            val spec = PhoneScenarios.byId(s(o["scenario"]))!!
            val evs = events(o["events"])
            val name = "${spec.id} / ${s(o["name"])}"
            assertEquals(o["complete"]!!.jsonPrimitive.boolean, PhoneEngine.isComplete(spec, evs), "complete: $name")
            assertEquals(o["goals"]!!.jsonArray.map { listOf(s(it.jsonArray[0]), it.jsonArray[1].jsonPrimitive.boolean) }, PhoneEngine.goalStates(spec, evs).map { listOf(it.goal.id, it.done) }, "goals: $name")
            assertEquals(strs(o["mistakes"]), PhoneEngine.mistakesMade(spec, evs).map { it.id }, "mistakes: $name")
            assertEquals(o["hints"]!!.jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.int }, (0 until spec.hints.size + 2).map { PhoneEngine.nextHintIndex(spec, evs, it) }, "hints: $name")
            assertEquals(i(o["slips"]), PhoneEngine.slipCount(evs), "slips: $name")
            same(o["records"], recordsJson(PhoneEngine.recordsFrom(evs))) { "records: $name" }
            val r = o["result"]!!.jsonObject
            val got = PhoneEngine.scenarioResult(spec, evs, 5_000, 5_000 + 185_000 + evs.size * 1000L)
            same(r, json.encodeToJsonElement(PhoneEngine.ScenarioResult.serializer(), got)) { "result: $name" }
            if (s(o["name"]) == "golden") {
                golden++
                assertTrue(got.success, "golden path completes: $name")
            }
        }
        assertEquals(18, golden, "a golden path per scenario")
    }

    @Test
    fun railRules() {
        val r = section("rail")
        val w0 = railWorlds[0]
        for (c in r["stations"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(strs(o["hits"]), PhoneRail.searchStations(w0.stations, s(o["q"])).map { it.name }, "searchStations(${o["q"]})")
        }
        assertEquals(strs(r["initials"]), w0.stations.map(PhoneRail::stationInitials))
        for (k in r["kinds"]!!.jsonArray) {
            val a = k.jsonArray
            assertEquals(s(a[1]), PhoneRail.trainKind(s(a[0])))
            assertEquals(a[2].jsonPrimitive.boolean, PhoneRail.isHighSpeed(s(a[0])))
        }
        var n = 0
        for (c in r["searches"]!!.jsonArray) {
            val o = c.jsonObject
            val w = railWorlds[i(o["world"])]
            val recs = PhoneEngine.recordsFrom(events(o["records"]))
            val got = PhoneRail.searchTrains(w, s(o["from"]), s(o["to"]), s(o["date"]), PhoneRail.TrainFilter(o["highSpeedOnly"]!!.jsonPrimitive.boolean, o["availableOnly"]!!.jsonPrimitive.boolean, s(o["sort"])), recs)
            assertEquals(strs(o["result"]), got.map { "${it.no}|${it.date}" }, "searchTrains $o")
            n++
        }
        assertTrue(n > 100)
        for (c in r["left"]!!.jsonArray) {
            val o = c.jsonObject
            val t = PhoneRail.findTrain(railWorlds[i(o["world"])], s(o["no"]), s(o["date"]))!!
            val left = PhoneRail.seatsLeft(t, s(o["cls"]), PhoneEngine.recordsFrom(events(o["events"])))
            assertEquals(i(o["left"]), left, "seatsLeft $o")
            assertEquals(s(o["label"]), PhoneRail.seatsLabel(left, t.seats.first { it.cls == s(o["cls"]) }.waitlist))
            assertEquals(s(o["label_plain"]), PhoneRail.seatsLabel(left))
        }
        for (c in r["letters"]!!.jsonArray) {
            val a = c.jsonArray
            val got = PhoneRail.seatLetters(s(a[0]))
            if (a[1] is JsonNull) assertEquals(null, got)
            else {
                assertEquals(strs(a[1].jsonObject["letters"]), got!!.letters)
                assertEquals(s(a[1].jsonObject["aisleAfter"]), got.aisleAfter)
            }
        }
        for (c in r["assigns"]!!.jsonArray) {
            val o = c.jsonObject
            val t = PhoneRail.findTrain(railWorlds[i(o["world"])], s(o["no"]), s(o["date"]))!!
            val seats = PhoneRail.assignSeats(t, s(o["cls"]), i(o["count"]), strs(o["chosen"]), s(o["order_id"]))
            assertEquals(strs(o["seats"]), seats, "assignSeats $o")
            assertEquals(i(o["window"]), PhoneRail.windowCount(seats))
            assertEquals(o["together"]!!.jsonPrimitive.boolean, PhoneRail.seatsTogether(seats), "together $seats")
            assertEquals(o["letters"]!!.jsonArray.map(::strOrNull), seats.map(PhoneRail::seatLetterOf))
        }
        for (c in r["together"]!!.jsonArray) {
            val a = c.jsonArray
            assertEquals(a[1].jsonPrimitive.boolean, PhoneRail.seatsTogether(strs(a[0])), "together ${a[0]}")
            assertEquals(i(a[2]), PhoneRail.windowCount(strs(a[0])))
        }
        for (c in r["ids"]!!.jsonArray) assertEquals(c.jsonArray[1].jsonPrimitive.boolean, PhoneRail.validChineseId(s(c.jsonArray[0])), "id ${c.jsonArray[0]}")
        for (c in r["phones"]!!.jsonArray) assertEquals(c.jsonArray[1].jsonPrimitive.boolean, PhoneRail.validPhone(s(c.jsonArray[0])), "phone ${c.jsonArray[0]}")
        for (c in r["passengers"]!!.jsonArray) {
            val o = c.jsonObject
            val p = json.decodeFromJsonElement<RailPassenger>(o["p"]!!)
            assertEquals(strs(o["problems"]), PhoneRail.passengerProblems(p, w0.passengers), "passengerProblems ${o["p"]}")
            assertEquals(strs(o["problems_none"]), PhoneRail.passengerProblems(p))
        }
        for (c in r["names"]!!.jsonArray) assertEquals(s(c.jsonArray[1]), PhoneRail.normalizePassportName(s(c.jsonArray[0])))
        for (c in r["refunds"]!!.jsonArray) {
            val o = c.jsonObject
            val fee = PhoneRail.refundFee(d(o["price"]), s(o["today"]), s(o["now"]), s(o["date"]), s(o["depart"]))
            assertEquals(o["fee"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }, fee, "refundFee $o")
            assertEquals(s(o["label"]), PhoneRail.refundRateLabel(s(o["today"]), s(o["now"]), s(o["date"]), s(o["depart"])))
        }
        for (c in r["changes"]!!.jsonArray) {
            val o = c.jsonObject
            val got = PhoneRail.changeOptions(railWorlds[i(o["world"])], s(o["train_no"]), s(o["date"]), s(o["from"]), s(o["to"]), s(o["today"]), s(o["now"]))
            assertEquals(strs(o["result"]), got.map { "${it.no}|${it.date}" }, "changeOptions $o")
        }
        for (c in r["differences"]!!.jsonArray) assertEquals(d(c.jsonArray[2]), PhoneRail.changeDifference(d(c.jsonArray[0]), d(c.jsonArray[1])))
        for (c in r["orders"]!!.jsonArray) {
            val o = c.jsonObject
            val w = railWorlds[i(o["world"])]
            val t = PhoneRail.findTrain(w, s(o["no"]), s(o["date"]))!!
            val pas = strs(o["passenger_ids"]).map { id -> w.passengers.first { it.id == id } }
            val data = PhoneRail.railOrderData(t, s(o["cls"]), pas, strs(o["seats"]), s(o["order_id"]), s(o["order_no"]), s(o["status"]), strOrNull(o["changed_from"]))
            same(o["data"], data) { "railOrderData $o" }
        }
    }

    @Test
    fun rideRules() {
        val r = section("ride")
        for (c in r["estimates"]!!.jsonArray) {
            val o = c.jsonObject
            val car = rideWorlds[i(o["world"])].cars[i(o["car"])]
            assertEquals(d(o["price"]), PhoneRide.estimatePrice(car, d(o["km"])), "estimate $o")
            assertEquals(i(o["minutes"]), PhoneRide.tripMinutes(d(o["km"])))
        }
        for (c in r["pois"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(strs(o["hits"]), PhoneRide.searchPois(rideWorlds[i(o["world"])].pois, s(o["q"])).map { it.id }, "searchPois ${o["q"]}")
        }
        for (c in r["coupons"]!!.jsonArray) {
            val o = c.jsonObject
            val cp = PhoneRide.bestCoupon(rideWorlds[i(o["world"])].coupons, s(o["type"]), d(o["price"]))
            assertEquals(strOrNull(o["coupon"]), cp?.id, "coupon $o")
            assertEquals(d(o["after"]), PhoneRide.priceAfterCoupon(d(o["price"]), cp))
        }
        val extra = r["extra_coupons"]!!.jsonObject
        val coupons = json.decodeFromJsonElement<List<RideCoupon>>(extra["coupons"]!!)
        for (c in extra["cases"]!!.jsonArray) {
            val o = c.jsonObject
            val cp = PhoneRide.bestCoupon(coupons, s(o["type"]), d(o["price"]))
            assertEquals(strOrNull(o["coupon"]), cp?.id, "coupon $o")
            assertEquals(d(o["after"]), PhoneRide.priceAfterCoupon(d(o["price"]), cp))
        }
        for (c in r["status"]!!.jsonArray) assertEquals(s(c.jsonArray[2]), PhoneRide.rideStatusLine(s(c.jsonArray[0]), d(c.jsonArray[1])))
        for (c in r["cancel"]!!.jsonArray) assertEquals(d(c.jsonArray[2]), PhoneRide.cancelFee(s(c.jsonArray[0]), d(c.jsonArray[1])))
    }

    private fun picks(e: JsonElement?): Map<String, List<String>> = e!!.jsonObject.mapValues { strs(it.value) }

    @Test
    fun foodRules() {
        val r = section("food")
        for (c in r["options"]!!.jsonArray) {
            val o = c.jsonObject
            val item = foodWorlds[i(o["world"])].shops.first { it.id == s(o["shop"]) }.menu.flatMap { it.items }.first { it.id == s(o["item"]) }
            val p = picks(o["picks"])
            assertEquals(strs(o["problems"]), PhoneFood.optionProblems(item, p), "optionProblems $o")
            assertEquals(d(o["price"]), PhoneFood.unitPrice(item, p))
            assertEquals(strs(o["picked"]), PhoneFood.pickedList(item, p))
        }
        for (c in r["carts"]!!.jsonArray) {
            val o = c.jsonObject
            val w = foodWorlds[i(o["world"])]
            val shop = w.shops.first { it.id == s(o["shop"]) }
            val items = shop.menu.flatMap { it.items }
            var cart = emptyList<PhoneFood.CartLine>()
            for (st in o["steps"]!!.jsonArray) {
                val so = st.jsonObject
                cart = PhoneFood.changeCart(cart, items.first { it.id == s(so["item"]) }, strs(so["options"]), d(so["price"]), i(so["delta"]))
            }
            same(o["cart"], json.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(PhoneFood.CartLine.serializer()), cart)) { "cart $o" }
            assertEquals(i(o["count"]), PhoneFood.cartCount(cart))
            assertEquals(d(o["items_total"]), PhoneFood.itemsTotal(cart))
            assertEquals(d(o["gap"]), PhoneFood.minOrderGap(shop, cart))
            assertEquals(d(o["packing"]), PhoneFood.packingFee(shop, cart))
            val goods = PhoneFood.itemsTotal(cart) + PhoneFood.packingFee(shop, cart)
            val best = PhoneFood.bestDiscount(shop, goods)
            if (o["best"] is JsonNull) assertEquals(null, best) else assertEquals(d(o["best"]!!.jsonObject["minus"]) to d(o["best"]!!.jsonObject["threshold"]), best!!.minus to best.threshold)
            val next = PhoneFood.nextDiscount(shop, goods)
            if (o["next"] is JsonNull) assertEquals(null, next) else assertEquals(d(o["next"]!!.jsonObject["gap"]) to d(o["next"]!!.jsonObject["minus"]), next!!.gap to next.minus)
            assertEquals(strs(o["usable"]), PhoneFood.usableRedPackets(w.redPackets, goods).map { it.id })
            val choice = when (s(o["choice"])) {
                "auto" -> PhoneFood.RedPacketChoice.Auto
                "none" -> PhoneFood.RedPacketChoice.None
                else -> PhoneFood.RedPacketChoice.Id(s(o["red_packet_id"]))
            }
            val totals = PhoneFood.cartTotals(shop, cart, w.redPackets, choice)
            val t = o["totals"]!!.jsonObject
            assertEquals(listOf(d(t["items"]), d(t["packing"]), d(t["delivery"]), d(t["discount"]), d(t["red_packet"]), d(t["total"])), listOf(totals.items, totals.packing, totals.delivery, totals.discount, totals.redPacket, totals.total), "totals $o")
            assertEquals(strOrNull(t["red_packet_id"]), totals.redPacketId)
            val inp = o["inputs"]!!.jsonObject
            val address = json.decodeFromJsonElement<FoodAddress>(inp["address"]!!)
            val got = PhoneFood.foodOrderData(shop, cart, totals, s(inp["note"]), strs(inp["tags"]), s(inp["cutlery"]), address, s(inp["order_id"]), s(inp["status"]))
            same(o["data"], got) { "foodOrderData $o" }
        }
    }

    @Test
    fun movieRules() {
        val r = section("movie")
        for (c in r["labels"]!!.jsonArray) {
            val a = c.jsonArray
            assertEquals(s(a[1]), PhoneMovie.seatLabel(s(a[0])))
            val p = PhoneMovie.parseSeat(s(a[0]))
            if (a[2] is JsonNull) assertEquals(null, p) else assertEquals(i(a[2].jsonObject["row"]) to i(a[2].jsonObject["col"]), p!!.row to p.col)
        }
        for (c in r["seats"]!!.jsonArray) {
            val o = c.jsonObject
            val w = movieWorlds[i(o["world"])]
            val show = w.shows.first { it.id == s(o["show"]) }
            val sold = PhoneMovie.soldSeats(show, PhoneEngine.recordsFrom(events(o["events"])))
            assertEquals(strs(o["sold"]), sold.toList(), "soldSeats ${show.id}")
            var sel = emptyList<String>()
            val taps = strs(o["taps"])
            o["steps"]!!.jsonArray.forEachIndexed { k, st ->
                val t = PhoneMovie.toggleSeat(show.seats, sold, sel, taps[k])
                assertEquals(strs(st.jsonObject["selected"]), t.selected, "toggleSeat ${show.id} #$k ${taps[k]}")
                assertEquals(strOrNull(st.jsonObject["problem"]), t.problem)
                sel = t.selected
            }
            for (pr in o["probes"]!!.jsonArray) {
                val po = pr.jsonObject
                val ids = strs(po["ids"])
                assertEquals(strOrNull(po["gap"]), PhoneMovie.singleGapProblem(show.seats, sold, ids), "gap ${show.id} $ids")
                assertEquals(po["adjacent"]!!.jsonPrimitive.boolean, PhoneMovie.seatsAdjacent(show.seats, ids), "adjacent $ids")
                assertEquals(po["couple"]!!.jsonArray.map { it.jsonPrimitive.boolean }, ids.map { PhoneMovie.isCoupleSeat(show.seats, it) })
                assertEquals(po["pair"]!!.jsonArray.map { if (it is JsonNull) null else strs(it) }, ids.map { PhoneMovie.couplePair(show.seats, it)?.toList() })
                assertEquals(po["exists"]!!.jsonArray.map { it.jsonPrimitive.boolean }, ids.map { PhoneMovie.seatExists(show.seats, it) })
            }
            assertEquals(s(o["end"]), PhoneMovie.showEnd(w, show))
        }
        val extra = r["extra_map"]!!.jsonObject
        val map = json.decodeFromJsonElement<MovieSeatMap>(extra["map"]!!)
        for (c in extra["sels"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(strOrNull(o["gap"]), PhoneMovie.singleGapProblem(map, map.sold!!.toSet(), strs(o["s"])), "gap ${o["s"]}")
            assertEquals(o["adjacent"]!!.jsonPrimitive.boolean, PhoneMovie.seatsAdjacent(map, strs(o["s"])))
        }
        for (c in r["shows"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(strs(o["result"]), PhoneMovie.showsFor(movieWorlds[i(o["world"])], s(o["film"]), s(o["date"]), strOrNull(o["cinema"])).map { it.id })
        }
        for (c in r["codes"]!!.jsonArray) assertEquals(s(c.jsonArray[1]), PhoneMovie.ticketCode(s(c.jsonArray[0])), "ticketCode ${c.jsonArray[0]}")
        for (c in r["orders"]!!.jsonArray) {
            val o = c.jsonObject
            val w = movieWorlds[i(o["world"])]
            val show = w.shows.first { it.id == s(o["show"]) }
            val snacks = o["snacks"]!!.jsonArray.map { val so = it.jsonObject; PhoneMovie.SnackLine(s(so["name"]), d(so["price"]), i(so["qty"])) }
            val data = o["data"]!!.jsonObject
            same(data, PhoneMovie.movieOrderData(w, show, strs(o["seat_ids"]), snacks, s(data["order_id"]), s(data["status"]))) { "movieOrderData $o" }
        }
    }

    @Test
    fun dineRules() {
        val r = section("dine")
        for (c in r["queue"]!!.jsonArray) {
            val o = c.jsonObject
            val rest = dineWorlds[i(o["world"])].restaurants.first { it.id == s(o["restaurant"]) }
            val t = PhoneDine.queueTableFor(rest.queue!!, i(o["people"]))
            assertEquals(strOrNull(o["table"]), t?.id)
            if (t != null) assertEquals(o["tickets"]!!.jsonArray.map { listOf(s(it.jsonObject["number"]), i(it.jsonObject["ahead"]).toString(), i(it.jsonObject["minutes"]).toString()) }, listOf(0, 1, 3).map { PhoneDine.queueTicket(t, it).let { q -> listOf(q.number, q.ahead.toString(), q.minutes.toString()) } })
        }
        val t1 = DineQueueTable("C", "大桌", 7, 12, 0, 0)
        val t2 = DineQueueTable("B", "中桌", 3, 4, 7, 50)
        assertEquals(r["extra_tables"]!!.jsonArray.map { s(it.jsonObject["number"]) + "/" + i(it.jsonObject["ahead"]) + "/" + i(it.jsonObject["minutes"]) }, listOf(0, 1, 2, 5).flatMap { k -> listOf(PhoneDine.queueTicket(t1, k), PhoneDine.queueTicket(t2, k)) }.map { "${it.number}/${it.ahead}/${it.minutes}" })
        val taken = r["taken"]!!.jsonObject
        val recs = PhoneEngine.recordsFrom(events(taken["events"]))
        for (c in taken["cases"]!!.jsonArray) assertEquals(i(c.jsonArray[2]), PhoneDine.ticketsTaken(recs, s(c.jsonArray[0]), s(c.jsonArray[1])))
        for (c in r["bookings"]!!.jsonArray) {
            val o = c.jsonObject
            val rest = dineWorlds[i(o["world"])].restaurants.first { it.id == s(o["restaurant"]) }
            val dr = o["draft"]!!.jsonObject
            val draft = PhoneDine.BookingDraft(strOrNull(dr["date"]), strOrNull(dr["time"]), dr["people"]?.jsonPrimitive?.int, strOrNull(dr["area"]), strOrNull(dr["name"]), strOrNull(dr["title"]), strOrNull(dr["phone"]))
            assertEquals(strs(o["problems"]), PhoneDine.bookingProblems(rest, draft), "bookingProblems $o")
            if (o["full"] !is JsonNull) assertEquals(o["full"]!!.jsonPrimitive.boolean, PhoneDine.slotFull(rest, draft.date!!, draft.time!!))
        }
        for (c in r["stars"]!!.jsonArray) {
            val a = c.jsonArray
            assertEquals(i(a[1].jsonObject["full"]) to a[1].jsonObject["half"]!!.jsonPrimitive.boolean, PhoneDine.starParts(d(a[0])))
        }
    }

    @Test
    fun walletRules() {
        val r = section("wallet")
        for (c in r["cases"]!!.jsonArray) {
            val o = c.jsonObject
            val spec = PhoneScenarios.byId(s(o["scenario"]))!!
            val evs = events(o["events"])
            val b = PhoneWallet.walletBalances(spec.wallet, evs)
            val eb = o["balances"]!!.jsonObject
            assertEquals(d(eb["balance"]), b.balance, "balance $o")
            assertEquals(eb["cards"]!!.jsonObject.mapValues { d(it.value) }, b.cards)
            assertEquals(i(o["failures"]), PhoneWallet.passwordFailures(evs))
            val amounts = listOf(0.01, 18.5, 86.0, 600.0, 6500.0, 9000.0)
            val methods = listOf("balance") + spec.wallet.cards.map { it.id } + "nocard"
            assertEquals(o["can"]!!.jsonArray.map { row -> row.jsonArray.map { it.jsonPrimitive.boolean } }, amounts.map { a -> methods.map { m -> PhoneWallet.canPay(spec.wallet, evs, m, a) } })
            assertEquals(strs(o["default"]), amounts.map { PhoneWallet.defaultMethod(spec.wallet, evs, it) })
        }
        val landlord = PhoneScenarios.byId("chat-landlord")!!.wallet
        for (c in r["labels"]!!.jsonArray) assertEquals(s(c.jsonArray[1]), PhoneWallet.methodLabel(landlord, s(c.jsonArray[0])))
        for (c in r["transfer"]!!.jsonArray) {
            val a = c.jsonArray
            val amount = if (a[0].jsonPrimitive.isString) Double.POSITIVE_INFINITY else d(a[0])
            assertEquals(strOrNull(a[2]), PhoneWallet.transferProblem(amount, s(a[1])), "transferProblem $a")
        }
        for (c in r["parse"]!!.jsonArray) assertEquals(d(c.jsonArray[1]), PhoneWallet.parseAmount(s(c.jsonArray[0])), "parseAmount ${c.jsonArray[0]}")
        for (c in r["pad"]!!.jsonArray) {
            val o = c.jsonObject
            var t = ""
            val states = strs(o["keys"]).map { k -> t = PhoneWallet.amountKey(t, k); t }
            assertEquals(strs(o["states"]), states, "amountKey ${o["keys"]}")
        }
    }

    @Test
    fun datesWorldCopyPersona() {
        val dts = section("dates")
        for (c in dts["isDate"]!!.jsonArray) assertEquals(c.jsonArray[1].jsonPrimitive.boolean, PhoneDates.isDate(s(c.jsonArray[0])), "isDate ${c.jsonArray[0]}")
        for (c in dts["isTime"]!!.jsonArray) assertEquals(c.jsonArray[1].jsonPrimitive.boolean, PhoneDates.isTime(s(c.jsonArray[0])))
        for (c in dts["days"]!!.jsonArray) {
            val o = c.jsonObject
            val dd = s(o["d"])
            assertEquals(s(o["add"]), PhoneDates.addDays(dd, i(o["n"])), "addDays $o")
            assertEquals(i(o["between"]), PhoneDates.daysBetween(dd, s(o["add"])))
            assertEquals(i(o["weekday"]), PhoneDates.weekday(dd))
            assertEquals(s(o["md"]), PhoneDates.zhMonthDay(dd))
            assertEquals(s(o["wk"]), PhoneDates.zhWeekday(dd))
            assertEquals(s(o["wkl"]), PhoneDates.zhWeekdayLong(dd))
            assertEquals(s(o["rel"]), PhoneDates.zhRelativeDay(s(o["add"]), dd))
            assertEquals(s(o["label"]), PhoneDates.zhDateLabel(dd))
        }
        for (c in dts["times"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(i(o["ma"]), PhoneDates.minutesOf(s(o["a"])))
            assertEquals(i(o["span"]), PhoneDates.spanMinutes(s(o["a"]), s(o["b"])))
            assertEquals(s(o["dur"]), PhoneDates.zhDuration(i(o["span"])))
        }
        for (c in dts["timeOf"]!!.jsonArray) assertEquals(s(c.jsonArray[1]), PhoneDates.timeOf(i(c.jsonArray[0])))
        for (c in dts["money"]!!.jsonArray) {
            val a = c.jsonArray
            assertEquals(s(a[1]), PhoneDates.yuan(d(a[0])), "yuan ${a[0]}")
            assertEquals(s(a[2]), PhoneDates.yuan2(d(a[0])), "yuan2 ${a[0]}")
            assertEquals(d(a[3]), PhoneDates.round2(d(a[0])), "round2 ${a[0]}")
        }

        val w = section("world")
        val idEvents = listOf(
            PhoneEngine.recordEvent("rail_order", "R001", JsonObject(emptyMap()), 1), PhoneEngine.recordEvent("rail_order", "R001", PhoneJs.obj("status" to PhoneJs.str("paid")), 2),
            PhoneEngine.recordEvent("rail_order", "R002", JsonObject(emptyMap()), 3), PhoneEngine.recordEvent("payment", "P001", JsonObject(emptyMap()), 4),
        )
        for (c in w["ids"]!!.jsonArray) assertEquals(s(c.jsonArray[2]), PhoneWorlds.nextRecordId(idEvents, s(c.jsonArray[0]), s(c.jsonArray[1])))
        for (c in w["seeds"]!!.jsonArray) {
            val o = c.jsonObject
            same(o["events"], JsonArray(PhoneWorlds.seedEvents(PhoneScenarios.byId(s(o["scenario"]))!!, 42))) { "seedEvents ${o["scenario"]}" }
        }
        w["passengers"]!!.jsonArray.forEachIndexed { k, c ->
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonArray.map { strs(it) }, PhoneWorlds.railPassengers(railWorlds[k], events(o["events"])).map { listOf(it.id, it.name) })
        }
        w["addresses"]!!.jsonArray.forEachIndexed { k, c ->
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonArray.map { strs(it) }, PhoneWorlds.foodAddresses(foodWorlds[k].addresses, events(o["events"])).map { listOf(it.id, it.detail, PhoneWorlds.addressLine(it)) })
        }
        for (c in w["clock"]!!.jsonArray) {
            val o = c.jsonObject
            val got = PhoneWorlds.phoneClock(s(o["today"]), s(o["now"]), o["started"]!!.jsonPrimitive.long, o["now_ms"]!!.jsonPrimitive.long)
            val e = o["clock"]!!.jsonObject
            assertEquals(listOf(s(e["date"]), s(e["time"]), i(e["minutes"]).toString()), listOf(got.date, got.time, got.minutes.toString()), "phoneClock $o")
        }
        for (c in w["sms"]!!.jsonArray) assertEquals(s(c.jsonArray[1]), PhoneWorlds.smsCodeFor(c.jsonArray[0].jsonPrimitive.double.toLong()), "smsCodeFor ${c.jsonArray[0]}")

        val copy = section("copy")
        for (c in copy["sms"]!!.jsonArray) assertEquals(s(c.jsonArray[1]), PhoneCopy.smsCode(s(c.jsonArray[0]), "123456"))
        assertEquals(strs(copy["wrong"]), listOf(4, 1, 0).map(PhoneCopy.ZH::wrongPassword))
        assertEquals(strs(copy["sent"]), listOf(60, 9).map(PhoneCopy.ZH::smsSent))
        val zh = copy["zh"]!!.jsonObject
        assertEquals(s(zh["needsConnection"]), PhoneCopy.ZH.needsConnection)
        assertEquals(s(zh["notOpen"]), PhoneCopy.ZH.notOpen)
        assertEquals(s(zh["insufficient"]), PhoneCopy.ZH.insufficient)
        assertEquals(s(zh["locked"]), PhoneCopy.ZH.locked)
        assertEquals(s(zh["voiceListening"]), PhoneCopy.ZH.voiceListening)

        val persona = section("persona")
        for (c in persona["trim"]!!.jsonArray) {
            val o = c.jsonObject
            val input = o["input"]!!.jsonArray.map { val m = it.jsonObject; PersonaMessage(s(m["from"]), s(m["text"])) }
            assertEquals(o["result"]!!.jsonArray.map { val m = it.jsonObject; PersonaMessage(s(m["from"]), s(m["text"])) }, PhonePersonas.trim(input))
        }
        for (c in persona["fake"]!!.jsonArray) {
            val o = c.jsonObject
            val p = PhoneScenarios.persona(PhoneScenarios.byId(s(o["scenario"]))!!, s(o["persona"]))!!
            val input = o["input"]!!.jsonArray.map { val m = it.jsonObject; PersonaMessage(s(m["from"]), s(m["text"])) }
            assertEquals(json.decodeFromJsonElement<PersonaReply>(o["result"]!!), PhonePersonas.fakeReply(p, input))
        }

        val eng = section("engine")
        for (c in eng["buckets"]!!.jsonArray) assertEquals(s(c.jsonArray[1]), PhoneEngine.durationBucket(c.jsonArray[0].jsonPrimitive.long))
        for (c in eng["durations"]!!.jsonArray) assertEquals(s(c.jsonArray[1]), PhoneEngine.formatDuration(c.jsonArray[0].jsonPrimitive.long))
    }
}
