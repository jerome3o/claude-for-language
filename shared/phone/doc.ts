/**
 * PHONE_SCENARIO_DOC: the scenario spec as text, for whoever writes a scenario (a person, or a
 * Claude behind a future MCP `create_phone_scenario`) — what each field means and which record
 * fields each app writes, so goal conditions can be written against them. Kept next to the
 * types so the two change together (docs/PHONE_PRACTICE.md repeats it with examples).
 */
export const PHONE_RECORD_FIELDS: Record<string, string> = {
  rail_order:
    'order_id, order_no, train_no, date, from, to, depart, arrive (HH:MM), seat_class, passengers (names), passenger_ids, passenger_nos (ID numbers), seats ("05车07F"), window_count, together (all in one row on one side of the aisle), price_each, total, status unpaid | paid | refunded | changed | cancelled, changed_from (the old order_id after 改签), refund_fee, gate',
  rail_passenger: 'id, name, id_type, id_no, country, type, phone, self',
  ride_order: 'order_id, from, to, to_id (poi id), car_type, km, price, coupon, status calling | accepted | arrived | in_trip | finished | paid | cancelled, rating (1–5), tags',
  food_order:
    'order_id, shop_id, shop, shop_rating, shop_minutes, lines [{ item_id, name, qty, options }], main_count (dishes from the first menu category), item_count, note, note_tags, cutlery, address_id, address (text), discount, red_packet, red_packet_id, total, status unpaid | paid | accepted | cooking | picked_up | delivering | delivered | cancelled',
  food_address: 'id, label, detail, room, name, phone',
  movie_order: 'order_id, show_id, film_id, film, cinema_id, cinema, cinema_km, date, start, hall, format, language, seat_ids ("7-8"), seats ("7排8座"), seat_count, adjacent, couple (every seat a 情侣座), snacks (names), total, code, status unpaid | paid',
  dine_queue: 'restaurant_id, restaurant, people, table_id, table, number, ahead, status waiting | cancelled',
  dine_booking: 'restaurant_id, restaurant, date, time, people, area 大厅 | 包间, name, title 先生 | 女士, phone, note, status pending | confirmed | cancelled',
  transfer: 'to_id (contact id), to, amount, note, kind transfer | red_packet, status sent',
  qr_payment: 'qr_id, payee, amount, note, status paid',
  red_packet_opened: 'from_id, amount',
  payment: 'app, title, amount, method balance | <card id>, direction out | in, status paid | refunded',
};

export const PHONE_SCENARIO_DOC = `A phone-practice scenario is JSON (shared/phone/types.ts ScenarioSpec), checked by validateScenarioSpec:
- id (lowercase, - _), version 1, title { en, zh }, difficulty easy | medium | hard, apps (rail, ride, food, movie, dine, chat, wallet, sms — the first is where the task starts), minutes.
- situation (English, one paragraph), goal { en, zh } (exactly what to do; the Chinese as a person would say it), facts [{ en, zh }] (things the learner needs: passport number, pay password, an address).
- today (YYYY-MM-DD) and now (HH:MM): the phone's clock.
- profile (the learner's fictional passport name / number / nationality / phone) and wallet { balance, cards [{ id, bank (fictional), kind, last4, balance }], pay_password (six digits) }.
- world: one block per app the task uses — rail { stations, trains, passengers, orders?, logged_out? }, ride { start, pois, cars, driver, coupons?, trips?, arrival_persona? }, food { shops (menu → items with options), addresses, red_packets?, rider_persona? }, movie { city, films, cinemas, shows (seat maps "row-col") , snacks? }, dine { restaurants (queue? booking?) }, chat { me, contacts, threads, qr_codes? }. Everything fictional: shop, cinema, driver, bank and app names are made up; places may be real public places (stations, streets).
- personas: people Claude plays in the in-app chats (id, name, role, personality, knows — every fact they may use —, aim, opening, actions [{ name, description, params }]), referenced from the world (driver.persona, rider_persona, shop / restaurant persona, chat contact persona).
- goals [{ id, label { en, zh }, condition, optional? }]: required goals finish the task, optional ones are bonuses. mistakes [{ id, label, when }] are reported at the end. hints [{ en, zh, done? }] are the 💡 steps in order.
- Conditions: { kind: 'record', record, where?, count? } — a record's latest version (fields below); { kind: 'event', event: 'persona.action', where: { persona, action, 'params.x': … } }; all_of / any_of / not.
- A matcher is a value (equals; for a list: contains) or operators: eq ne in nin gt gte lt lte contains (text or list) size has_all every some match exists. Times and dates compare as text ("10:30" < "11:00").
Records the apps write:
${Object.entries(PHONE_RECORD_FIELDS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}
- vocab [{ hanzi, pinyin (tone marks), english }]: the words of the task, offered as cards at the end.`;
