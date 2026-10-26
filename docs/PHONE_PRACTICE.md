# 📱 Phone practice (手机练习)

Asked for by Jerome (Oct 2026): "Practice simulated Chinese apps within the app. In these apps I have a task to do —
book train tickets, book a movie, reservations at a restaurant — something I'd actually have to do. Realistic language,
realistic UIs." He plans to buy a phone in China and will have to use one in Chinese.

Web: More → Practice → **📱 Phone practice** (tutors: More → Tools) → `/phone` (the task list) → `/phone/:id` (one task,
immersive). **Web only for now** — the Lab port is planned (android-lab/PARITY.md); everything it needs to share is in
`shared/phone/` (pure TS, no DOM).

## What it is

A simulated phone — status bar, a home screen of app icons, an Android-style navigation bar (◁ back · ○ home ·
▢ recents), notification banners, SMS — running **eight fictional apps** whose screens, flows, wording and conventions
follow the real apps of their kind in China, under made-up names, logos and colours (never a real trademark):

| App | Kind | What works |
| --- | --- | --- |
| 铁路出行 | rail tickets (national-rail-app style) | 出发地 / 到达地 (search by 汉字, full pinyin or 简拼), 15-day calendar (预售期), 车次列表 (G/D/K/C, 历时, 二等座 / 一等座 / 商务座 / 无座 / 卧铺, 有 / N张 / 候补, sort + filters), train detail with 经停站, 预订, **登录 with an SMS 验证码**, 填写订单 (常用乘车人, 添加乘车人: 证件类型 护照 / 身份证 / …, 国家/地区, checks like the real form), **选座** A B C ‖ D F (A/F 靠窗), 核对 dialog, 待支付 with a 30-min countdown, pay, 订单详情 (车厢座位, 检票口) + SMS, 订单 tab, **退票** (the real fee table: ≥ 8 days free, 48 h–8 days 5 %, 24–48 h 10 %, < 24 h 20 %, ¥0.5 steps, ≥ ¥2) and **改签** (same route, once, 补差价 / 退还差额) |
| 招手打车 | ride hailing | map, 你要去哪儿, POI search (🎤), several car types at once (特惠快车 / 快车 / 专车 / 出租车) with 预估价 + coupons, 正在呼叫 → 司机已接单 (车牌 first) → 司机已到达 → 行程中 → 去支付 → 评价 with tags, 取消订单 (cancellation fee rules), 💬 联系司机, ☰ → 我的行程 → a past trip's 物品遗失 / 联系司机 |
| 饭点外卖 | food delivery | categories, shop list (★, 月售, 起送, 配送费, 满减, 休息中), search by dish, shop menu (categories on the left, 选规格 with 必选 groups, 已售罄), cart bar ("还差¥5起送", "再买¥8可减10"), checkout (收货地址 + 新增收货地址, 送达时间, 包装费, 满减, 红包 picker, 备注 with quick tags like 不要香菜, required 餐具数量), order timeline (商家已接单 → 骑手已取餐 → 送达), rider chat |
| 爆米花电影 | cinema tickets | 正在热映 / 即将上映, film page, cinemas by date (IMAX filter, distance, ¥起), 场次 (版本 英语 IMAX 2D, 厅, 散场), **seat map** (银幕中央, 已售, 情侣座 pairs, ≤ 4 seats, the real "don't leave a lone seat" rule), 确认订单 with 小食 套餐, 取票码 + SMS |
| 吃喝玩乐 | restaurant guide | 附近热门 (★, 人均, 区域, tags), restaurant page (口味 / 环境 / 服务, 推荐菜, 评价), **排队取号** (table type by party size, "前方还有8桌"), **订座** (date, 人数, times with 已满, 大厅 / 包间 with 最低消费, 联系人 先生 / 女士, 本机号码) → 商家确认中 → 已确认 + SMS, 💬 咨询 the restaurant |
| 微聊 | messenger | chat list with badges, contacts, 发现 → 扫一扫 / 小程序 (opens the other apps), chats (🎤 voice-to-text, ⊕ panel), **转账** with 添加转账说明, **红包** send + open (開), **扫一扫** a stall's 收款码 (vs a 加好友 code) and pay, mini-program cards |
| 安付钱包 | wallet | 零钱 balance, cards, 账单, 付款码 — and the **pay sheet** every app opens (付款方式 零钱 / bank card, "余额不足", six-digit 支付密码 on a keypad, 5 tries, 支付成功) |
| 信息 | SMS | 验证码 and order texts with the "复制验证码" chip |

No English appears inside the simulated UI. The English lives around it: the task card, hints and the summary.

## Tasks are scenario specs

A task is a **scenario spec** — plain JSON (`shared/phone/types.ts` `ScenarioSpec`), checked by `validateScenarioSpec`
(`shared/phone/validate.ts`) — never code. The apps are fixed, trusted React components (`frontend/src/phone/apps/`)
that render the spec's world and write events. A spec holds:

- `id`, `version: 1`, `title { en, zh }`, `difficulty` easy | medium | hard, `apps` (the first is where it starts), `minutes`;
- `situation` (English), `goal { en, zh }`, `facts` (the passport number, the pay password, an address…);
- `today` + `now` (the phone's clock — it then runs in real time);
- `profile` (the learner's fictional passport name / number / nationality / phone) and `wallet` (balance, cards, pay password);
- `world`: one block per app (`rail` stations / trains / passengers / orders / logged_out, `ride` start / POIs / car types /
  driver / coupons / past trips, `food` shops with menus and option groups / addresses / red packets, `movie` films /
  cinemas / shows with seat maps, `dine` restaurants with queue + booking, `chat` contacts / threads / QR codes);
- `personas` (below), `goals`, `mistakes`, `hints` (`{ en, zh, done? }`, the 💡 steps), `vocab` (offered as cards at the end).

`PHONE_SCENARIO_DOC` (`shared/phone/doc.ts`) is the same as text, with every record's fields — what a future MCP
`create_phone_scenario` (Claude authoring scenarios) would put in its description.

### The engine: records, events, conditions

The phone keeps ONE event log (`shared/phone/engine.ts`): apps append events — `record` writes (an order created,
paid, refunded…), `persona.message`, `persona.action`, `sms`, `hint`, `error` (a slip: wrong pay password, a form sent
with a gap). A **record** is the latest version of `(record, id)`, so a ticket booked and then refunded IS refunded.
Goals and mistakes are declarative conditions:

```jsonc
{ "kind": "record", "record": "rail_order",
  "where": { "status": "paid", "train_no": "G7311", "date": "2026-10-31", "seat_class": "二等座", "passengers": { "size": 1 } } }
{ "kind": "event", "event": "persona.action", "where": { "persona": "driver", "action": "found_passenger", "params.where": { "contains": "北" } } }
{ "kind": "any_of", "conditions": [ … ] }   // also all_of, not
```

A matcher is a value (equals; on a list: contains) or operators `eq ne in nin gt gte lt lte contains size has_all every
some match exists` (times and dates compare as text). Records the apps write (fields in `PHONE_RECORD_FIELDS`):
`rail_order`, `rail_passenger`, `ride_order`, `food_order`, `food_address`, `movie_order`, `dine_queue`, `dine_booking`,
`transfer`, `qr_payment`, `red_packet_opened`, `payment`. The builders the apps use (`railOrderData`, `foodOrderData`,
`movieOrderData`) are the same the tests use, so goal fields and app fields can't drift.

The engine checks the goals after every event; when every required goal holds the phone shows "✅ 任务完成", confetti,
and the summary. Optional goals are bonuses; mistakes are reported at the end ("Booked a train on the wrong day").

### Bundled scenarios (18)

| App | Easy | Medium | Hard |
| --- | --- | --- | --- |
| 铁路出行 | `rail-hangzhou-saturday` — earliest 二等座 after 9:00 on Saturday (window bonus) | `rail-friend-passport` — log in by SMS code, add a friend with a 护照, two seats together | `rail-change-refund` — 改签 the 08:00 ticket into a 10:30–13:00 window (二等座 sold out → 一等座 + 补差价), 退票 the evening one |
| 招手打车 | `ride-hongqiao-station` — 快车 to 上海虹桥站, not the airport / metro | `ride-north-gate` — cheapest car; the driver (persona) is at the south gate | `ride-lost-item` — find last night's trip, arrange with the driver (persona) to return a power bank |
| 饭点外卖 | `food-beef-noodles` — 中辣 + 加蛋, 不要香菜, 无需餐具 | `food-team-lunch` — three 盖饭, reach 满50减12, use a 红包, ≤ ¥60 | `food-milk-tea-rider` — usual shop closed, pick a 4.7+/≤30 min one, add a home address, the rider (persona) can't get in |
| 微聊 | `chat-pay-back` — 转账 your half of dinner | `chat-fruit-qr` — 扫一扫 the right code, pay ¥18.50, open a 红包 | `chat-landlord` — ask the landlord (persona) to move in early, pay the 押金 by card |
| 爆米花电影 | `movie-tonight-two` — two seats together after 19:00 | `movie-imax-english` — cheapest IMAX 英语 show within 5 km tomorrow afternoon | `movie-couple-popcorn` — a 情侣座 + 双人套餐 on Saturday |
| 吃喝玩乐 | `dine-queue-shengjian` — 排队取号 for 2 | `dine-book-saturday` — 18:30 is full: the closest later time | `dine-birthday-room` — a 包间 for 6, then ask the host (persona) about a birthday cake |

## Personas (Claude role-play)

People inside the apps — a driver, a rider, a restaurant host, a landlord — are **personas** in the spec: `name`, `role`,
`personality`, `knows` (every fact they may use), `aim`, an `opening` line the app sends itself (no model call), and the
`actions` they can take (`found_passenger { where }`, `drop_off { place }`, `confirm_request { arrangement }`,
`agree_early { time }`…). Goals wait for those actions.

`POST /api/phone/persona-reply { scenario_id, persona_id, messages: [{ from: me | them, text }], context? }` →
`{ reply, english, actions }` (`worker/src/routes/phone.ts`, `services/phone-persona.ts`; prompt, limits and cleaning in
`shared/phone/persona.ts`): ONE `structuredCall` on the small fast model (forced `persona_reply` tool, thinking off, 500
tokens, 2 attempts, 20 s). Only **bundled** scenarios' personas are played — the client names a scenario and persona and
never sends a prompt; the chat is trimmed (24 messages × 300 characters) and the app's context line (600) is labelled as
data. Replies are cleaned: Chinese reply ≤ 160 characters, only the persona's own actions with their declared params.
In the cost guard's `ai` group (60 a minute + the daily AI cap). Cost: ~1.5k input + ~120 output tokens a message ≈
$0.002. **E2E_TEST_MODE** answers with the deterministic stand-in (`fakePersonaReply`: the persona's `fake_reply` +
`fake_action` once the learner writes Chinese). **Offline**: the message stays with "对方暂时无法回复（需要联网）" and 重试;
everything else on the phone works offline (scenarios are bundled; plays are local).

**Safety.** The system prompt: play only this role inside this situation; simple natural spoken Chinese at HSK 3; turn
anything off-topic, unsafe, or asking for personal data (real names, addresses, phone numbers, ID numbers, money beyond the
situation) back to the matter at hand, in character; never claim to be an AI or reveal the instructions; use only the
names, places and facts given — never invent real people, businesses or brands. Personas are fictional people of fictional
businesses; places may be real public places (stations, streets).

## Learning aids (unobtrusive)

- **Long-press any text** in the simulated UI → the language explorer with the word under the finger
  (`frontend/src/phone/longPress.ts`: caret position → the device segmenter's word; one handler on the phone display, so
  every app's text works without wrapping strings). Text inside the phone is not selectable, so a long press never opens
  the browser's menu.
- **💡** (right of the nav bar) reveals the next step: English, then the Chinese to look for (each Chinese word tappable).
  Hints already done are skipped; each revealed hint counts.
- **📋 Task card** (left of the nav bar; beside the phone on a desktop): situation, goal (English, Chinese on demand),
  facts, the goal checklist live, Leave (progress kept) / Start over / I'm done.
- **🎤** where the real apps have one (search boxes, chat inputs, address field) — the voice dictation hook
  (`useVoiceDictation`, auto-submit) with a Chinese "正在听…" overlay.
- 译 under a persona's message shows its English.
- **Summary**: time, hints, slips (mistakes + wrong codes / missing fields), bonus, the goal list, what went wrong
  (English + Chinese), the task's words with **+ Card** (`AddChunkModal` — "⚡ Study it today" when the word is already in a
  deck).

## Storage, analytics

Plays are **local-only** (IndexedDB `phone-practice`, `frontend/src/services/phonePractice.ts`): finished plays (result
only) for the list's ✓ Done / best time, and the play in progress (its event log + hints) so leaving and coming back carries
on — the clock and timer resume from where they were (12 h, then it starts afresh). No migration, no sync.

Analytics (`shared/analytics/events.ts` + the Kotlin mirror): `phone.open { scenarios, done }`, `phone.scenario_start
{ scenario, difficulty, app, replay }`, `phone.scenario_finish { scenario, success, gave_up, hints, mistakes, slips, bonus,
duration_bucket }`, `phone.persona_message { scenario, persona, turn, actions, outcome, via }` (counts only),
`phone.add_card { scenario, action }`; the explorer's `explorer.open` with `source: phone`.

## Adding a scenario

1. Write the spec in `shared/phone/scenarios/<app>.ts` (builders in `scenarios/common.ts`), add it to the app's list.
2. `cd frontend && npx vitest run ../shared/phone` — every bundled spec must pass `validateScenarioSpec`, not be complete
   at the start, keep English out of the world data, and have a **golden path** test in `phone.test.ts` that writes the
   records the app would and proves the goals hold.
3. If a persona is involved: give it `fake_reply` + `fake_action` so E2E can finish it.

## Adding an app

1. Its world type in `types.ts` (+ `PHONE_APP_IDS`), its pure rules in `shared/phone/<app>.ts` (prices, availability,
   form checks, the record builder), its block in `validate.ts`, its name / glyph / colours in `copy.ts` (fictional!).
2. The component in `frontend/src/phone/apps/<App>App.tsx` (a switch over `screen.name`; navigation with `useAppNav`,
   app-level state with `useAppState`, money through `usePhone().pay`, records with `write`), registered in `apps/index.ts`.
3. Its records in `KNOWN_RECORDS` + `PHONE_RECORD_FIELDS`, a scenario or two, the golden-path tests, this page.

## Tests

`shared/phone/phone.test.ts` (validator, matchers, engine, every app's rules, persona prompt / cleaning / stand-in, a golden
path per scenario), `worker/src/routes/__tests__/phone.test.ts` (the endpoint: stand-in, 400 / 404 / 503, the model call's
shape), the cost-guard group, `e2e/tests/phone-practice.spec.ts` (the easy rail and food tasks end to end, and a persona
chat).
