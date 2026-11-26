# 🥽 VR worlds (语言世界) — how they work and how to build one

VR worlds are small, detailed places you walk into with a headset (or the flat 3D preview on any
screen): a kitchen, a restaurant, a street, an airport… Every thing in them has its Chinese name —
point at it to see and hear 杯子 / bēizi / cup, add it as a card in one tap — and the world gives you
mini tasks in Chinese (把杯子放在桌子上。) that you carry out by picking things up, putting them down,
throwing them and using them. Real physics (Rapier): things bump, fall, stack, roll; impacts sound
like what they're made of.

- **Picker:** `/vr/worlds` (More → Practice → 🌏 VR worlds, or 🌏 Worlds on the /vr room's tray).
- **A world:** `/vr/worlds/<id>` — Enter VR in a WebXR browser (docs/VR.md "Using it on the Valve
  Steam Frame"), else the flat preview.
- **Web only**, like the /vr room (android-lab/PARITY.md "VR"). The only Lab change is the `vr`
  source deck key (parity-tested) and the analytics catalogue mirror.

This document is the contract for building a world. The kitchen (`frontend/src/vr/worlds/kitchen/`)
is the reference: copy it.

**The worlds:**

- 🍳 **厨房 Kitchen** (`kitchen/`, 33 objects, 9 tasks) — the reference world.
- 🏠 **家 Apartment** (`home/`, 56 objects, 12 tasks) — living room, bedroom, bathroom off a hallway.
- ✈️ **机场 Airport** (`airport/`, 49 objects, 12 tasks) — a departures hall: check-in (a 秤 that weighs, a 传送带 that carries bags), security (托盘, the 安检机's running belt, 不能带水), gate 12, a café, a plane outside the glass; ambience `airport` + `conveyor` / `xray` / `coffee` loops.
- 🥬 **菜市场 Wet market** (`market/`, 54 objects, 11 tasks) — a covered market aisle: 菜摊 / 水果摊 / 豆腐摊 / 干货摊 with
  produce from lathes and instanced heaps, price tags in 斤, a 电子秤 and a hanging 秤 that really weigh what's on them
  (`market/weigh.ts`: a Rapier shape query over the pan, held things don't count), an invented 二维码, a 钱箱, a 电风扇;
  ambience `market` (murmur, vendors calling out, a cleaver on a board, bags, the scale's beep) + the `fan` loop.
- 🚦 **街上 On the street** (`street/`, 50 objects, 12 tasks) — a street corner at dusk: a zebra crossing whose button
  turns the walkers' signals green (they tick), a 便利店 you open and walk into (柜台, 老板, 货架, 冰柜, 取款机), a fruit
  stall, a 煎饼 cart that sizzles, sorted bins, a bus stop with a lost wallet; ambience `city` + `crossing` / `sizzle` loops.

---

## Playing

| | Headset (controllers) | Hands | Flat preview (mouse / touch) |
|---|---|---|---|
| See a thing's name | point at it: a label floats over it (✓ when you know the word) | point | hover |
| Its card (inspect) | trigger — a quick click | pinch, quick | click / tap |
| Pick up | squeeze (grip), or hold the trigger ~¼ s | hold the pinch | hold the mouse on it ~¼ s / press and hold |
| Carry | it comes to your hand (distance grab) and turns with it | | it follows the pointer, resting OVER whatever the pointer is on (a table, the floor); wheel = higher / lower |
| Drop / throw | let go — you throw at the speed your hand moves | let go | let go (a flick throws forward), **Space** / **F** / right-click throws ahead |
| Use (open the fridge, turn on the tap) | the inspect panel's verb button (✋ 打开 dǎkāi · open) | | same |
| Move | thumbstick forward → teleport arc (green = you can stand there), let go to jump; stick left / right = snap turn 30° | — | **WASD** / arrows walk, **Q / E** turn, click the floor to walk there, drag empty space to look, ▲▼⟲⟳ pad on touch screens |
| Task panel | on your left wrist (else low on the left, following lazily) | | top-left corner |

The task panel: 任务 3 / 9, the instruction in Chinese (each word tappable → the explorer), 拼 / EN
toggles (remembered on the device), ▶ 再听 (read it again), 💡 hint (the things to use glow — also
after 40 s on one task), ⏭ Skip, 🎮 Free play (no tasks: just explore), ↺ Reset room, 🪑 Seated (in the
headset: lifts the world view to standing eye height), 🚪 Leave. The instruction is read aloud once
(practice TTS, cached on the device — every task and every object word is prefetched when a world
opens, so it plays offline afterwards). A done task: chime, sparkles at the thing, "✓ 做得好！", the
next task. All done: 🎉 the time (best time kept), Play again / Free play.

The inspect panel: the word big (tap a character → the explorer), pinyin, meaning, the measure word
(一个杯子), the thing's states (关着 guānzhe + ✋ 打开 dǎkāi · open), ▶ Listen, **＋ Add as card** — or
**📚 In your decks · HSK 1 + ⚡ Study it today** when he has it, **✓ You know this word** when a card of
it is mature —, 🔍 Explore (the /vr room's explorer window, beside the panel).

**"+ Add as card"** saves into the **"From VR"** source deck (`shared/decks/source-decks.ts` key
`vr`; docs/STUDY_SESSION.md "Source decks") in one request, with the object's `fun_facts` and
`example` sentence when the world gives them. Online only (the panel says so offline); ⚡ works
offline.

Progress (tasks done at least once, best time, runs finished) is per device: IndexedDB `vr-worlds`.

---

## The contract

A world is ONE folder:

```
frontend/src/vr/worlds/<id>/
  meta.ts      WorldMeta — the picker's card. No 3D imports (the picker loads it eagerly).
  index.tsx    export default defineWorld({ …spec, Scene, objects with models, lighting, ambience })
  Scene.tsx    the static world (room, decor, signs) + <Solid> colliders
  models.tsx   one component per object model (or glTF files, below)
frontend/public/vr/worlds/<id>/
  thumb.jpg    640×360 screenshot of the flat preview (~20–40 KB)
  *.glb        optional CC0 models + LICENSES.md
```

and ONE line in `frontend/src/vr/worlds/registry.ts`:

```ts
{ meta: restaurantMeta, load: () => import('./restaurant') },
```

Each world is its own lazy chunk; nothing loads until someone enters it.

### `WorldDefinition` (frontend/src/vr/worlds/types.ts)

```ts
interface WorldDefinition extends WorldSpec {        // shared/vr-worlds/types.ts — pure data
  objects: WorldObjectDef[];                          // WorldObjectSpec + model (+ loops)
  lighting: 'indoor_day' | 'indoor_warm' | 'indoor_hall' | 'outdoor_day' | 'outdoor_evening';
  shadowArea?: number;                                // metres the shadow map covers around the origin (default 8)
  ambience: 'kitchen' | 'house' | 'street' | 'restaurant' | 'airport' | 'apartment' | 'market' | 'city' | 'none';
  Scene: ComponentType;                               // static geometry + colliders
}

interface WorldSpec {
  id: string;                    // lowercase token, = the folder name
  title_zh: string; title_en: string; blurb: string;
  bounds: { min: Vec3; max: Vec3 };   // the playable box; floor at y = 0
  spawn: { at: Vec3; yaw: number };   // feet on the floor; yaw 0 looks down −Z
  objects: WorldObjectSpec[];
  zones?: WorldZoneSpec[];
  tasks: WorldTaskSpec[];        // 5–12, easiest first
}

interface WorldObjectSpec {
  id: string;                    // lowercase token (cup, cup_2)
  word: WorldWord;               // { hanzi, pinyin, english, measure?, fun_facts?, example? }
  tags?: string[];               // tasks may say '#fruit'
  material: 'wood' | 'glass' | 'metal' | 'plastic' | 'cloth' | 'paper' | 'ceramic' | 'food' | 'stone';
  mass: number;                  // kg; 0 = fixed (inspectable, not grabbable: furniture, appliances)
  at: Vec3;                      // where its CENTRE starts
  yaw?: number;
  collider: Part | Part[];       // { box: [w,h,d] } | { ball: r } | { cylinder: [r, h] }, each + offset?, when?
  states?: WorldObjectState[];   // e.g. door: closed ⇄ open (the panel's verb button cycles them)
  surface?: boolean;             // things can be put ON it (`on` may name it)
  inside?: { min: Vec3; max: Vec3 };  // things can be put IN it (it is a zone: in_zone / count_in_zone / thrown_into)
}

interface WorldObjectDef extends WorldObjectSpec {
  model: ComponentType<{ states }> | { gltf: string; scale?: number; offset?: Vec3 };
  loops?: Record<string, string>;     // { 'water=on': 'water' } — a sound loop while a state holds
}
```

Conventions: metres, Y up, the floor at **y = 0**, yaw 0 looks down **−Z**, positive yaw turns left.
**Centre the world on the origin** (the shadow camera is centred there). An object's model is drawn
in its own frame: **the origin is the middle of its collider** (a mug with `collider: { cylinder:
[0.042, 0.095] }` spans y −0.0475 … +0.0475), and its `at` is where that centre starts — so a thing
resting on a counter whose top is 0.9 has `at[1] = 0.9 + half its height` (+ 1–2 mm).

**Colliders.** Small things: one shape (a cup a cylinder, an apple a ball, chopsticks a box). Hollow
things (a basket, a bin, a sink, a fridge): several thin boxes, so things go in. A fixed object's
part may carry `when: { door: 'closed' }` — the fridge door is a wall while closed and a separate
part while open. Only fixed objects may switch parts by state. Rays pick an object by its collider
parts (each at least 7 cm), so a fridge's inside stays reachable.

**Everything with a name is an object** (even fixed furniture: 桌子, 冰箱, 窗户, 灯, 钟). The Scene is
for what isn't: walls, floor, cupboards with no task, signs, plants. Give the Scene `<Solid>`s where
things should bump or rest (counters, shelves, walls if not using `<Room>`).

### Zones

`zones: [{ id, word?, min, max }]` — axis-aligned boxes in world coordinates for `player_in`
(walk to the door) or "put it by the window". Containers are better as an object's `inside` (it
moves with the object: a basket you carry still holds its apples).

### Words (the card standard — `shared/cards/standard.ts`)

- `hanzi` ONE clean simplified form, Han characters only (no punctuation, slashes, brackets).
- `pinyin` tone marks (bēizi), never numbers; spaces between words; 一 / 不 tone changes written.
- `english` ONE meaning (no slashes or "/").
- `measure` one character (个 / 张 / 把 / 双 / 根 / 盒 / 台 / 扇 / 盏 / 口 / 块 …) — the panel shows 一个杯子.
- `fun_facts` (recommended, it becomes the card's explanation): each character, then usage, then the
  common mistake / register — 2–4 short lines.
- `example` (recommended): one short natural sentence containing the word exactly, with pinyin and
  English — it becomes the card's sentence.
- Several instances share a word (`apple`, `apple_2` both 苹果): define the word once (`WORDS.apple`).

## The task language (shared/vr-worlds/engine.ts)

Tasks are checked live (~10 Hz) against a snapshot of the world. One task at a time, in order.

| Condition | True when |
|---|---|
| `{ holding: T }` | he holds T (any hand / the mouse) |
| `{ in_zone: T, zone: Z }` | T lies (not held, slower than 0.6 m/s) with its centre in Z (a zone, or an object's `inside`) |
| `{ on: T, surface: S }` | T rests (not held, < 0.25 m/s) on S: a `surface` object's top (up to 32 cm above it), or a zone |
| `{ near: T, to: U, within?: 0.3 }` | some T within `within` m of some U (centre to centre) |
| `{ state: O, key, value }` | object O's state is that value |
| `{ thrown_into: T, zone: Z }` | T was thrown (released faster than 1.4 m/s) and passed through Z before anyone caught it |
| `{ count_in_zone: '#tag', zone: Z, n }` | at least n tagged things lie in Z |
| `{ player_in: Z }` | his head is over zone Z (floor plan) |
| `{ performed: 'grab' \| 'release' \| 'throw' \| 'use' \| 'inspect', target?: T }` | he did that (to T) during this task |
| `{ not: C }`, `{ all_of: [C…] }`, `{ any_of: [C…] }` | as named |
| `{ sequence: [C…] }` | each step in order; a step counts once reached (先…然后…) |

`T` is an object id (`cup`) or a tag (`#cup` = any object tagged cup). A task:

```ts
{ id: 'cup_on_table', zh: '把杯子放在桌子上。', pinyin: 'Bǎ bēizi fàng zài zhuōzi shang.',
  en: 'Put a cup on the table.', done: { on: '#cup', surface: 'table' }, hint?: ['cup'] }
```

Examples from the kitchen: `拿起一个苹果。` `{ holding: '#apple' }` · `打开冰箱。` `{ state: 'fridge',
key: 'door', value: 'open' }` · `请把三个苹果放进篮子里。` `{ count_in_zone: '#apple', zone: 'basket', n: 3 }` ·
`先把锅放在炉子上，然后打开炉子。` `{ sequence: [{ on: 'pot', surface: 'stove' }, { state: 'stove', key: 'fire',
value: 'on' }] }` · `把香蕉扔进垃圾桶里！` `{ thrown_into: 'banana', zone: 'bin' }`.

Write instructions as natural imperatives a teacher would say: 把…放在…上 / 放进…里 / 拿起 / 拿出来 /
打开 / 关上 / 扔进 / 先…然后… / 请…. Mix verbs, measure words (三个苹果, 一双筷子) and directions
(上 / 里 / 旁边 / 前面). Rising difficulty: one action → put X on Y → states → counting → sequences →
throwing. Pinyin of the instruction with tone marks, sentence-cased.

## The helper library (frontend/src/vr/worlds/kit/)

```ts
import { mat, RBox, Box, Cyl, Ball, Lathe, cupProfile, bowlProfile, plateProfile, bottleProfile, potProfile,
  Table, Chair, Counter, WallCabinet, Shelf, WindowPane, PendantLamp, Plant, Rug, Sign, WallClock, Room,
  Solid, SolidCylinder, FloorCollider, WorldLighting, woodTexture, tileTexture, plankTexture, checkerTexture,
  noiseTexture, stripeTexture, labelTexture, signTexture, seeded } from '../kit';
```

- **Materials** `mat(preset, colour?, opts?)` → ONE shared MeshStandardMaterial per preset + colour +
  options (never mutate it). Presets: wood, wood_planks, painted, metal, steel, chrome, ceramic,
  glass, plastic, rubber, fabric, paper, plaster, tile, stone, food, leaf, glow, liquid. Options:
  `repeat`, `tiles`, `grout`, `map` (a label texture), `doubleSide`, `roughness`, `metalness`,
  `opacity`, `emissive`. Wood / planks / tile / plaster / stone / fabric / paper get a procedural
  texture automatically; reflections come from the generated environment map.
- **Shapes** (cached geometry): `RBox` (rounded box), `Box`, `Cyl` (or cone / frustum with `rTop`,
  `open`), `Ball`, `Lathe` with the profile helpers (cups, bowls, plates, bottles, pots — centred on
  their own height). Props: `material`, `position`, `rotation`, `scale`, `cast` (default on),
  `receive`.
- **Furniture** (visual only, centred on their bounding box, `size` = [w, h, d], facing +Z): `Table`,
  `Chair`, `Counter` (`withTop={false}` to cut a sink), `WallCabinet`, `Shelf`, `WindowPane` (with a
  sky), `PendantLamp`, `Plant`, `Rug`, `Sign` (Chinese text, the VR font), `WallClock`, and `Room`
  (floor, four walls seen from inside, ceiling, skirting AND their colliders).
- **Colliders** for the Scene: `<Solid size at yaw?>`, `<SolidCylinder r h at>`, `<FloorCollider size>`.
- **Textures** (canvas, cached, seeded): wood, tiles, planks, checker, noise, stripes, a packaging
  `labelTexture('牛奶')`, `signTexture('出口')` — Chinese drawn in the self-hosted Noto Sans SC.
- **Lighting** `<WorldLighting preset shadowArea>` is added by the scene from the definition; add at
  most 1–2 small point lights of your own (a lamp), ALWAYS mounted (toggle `intensity`, never
  mount / unmount a light: that recompiles every material).
- **Animated models**: a model gets `states` — animate towards them in `useFrame` (the fridge door
  eases open, the hob's flames flicker, the tap's water stream).

### Assets: glTF (optional)

Procedural is preferred (small, no licences). If a world needs a model code can't make well:

- **CC0 only** (Kenney, Quaternius, Poly Haven, or made for this app) — never from a game, never a
  brand or logo. List every file with its source and licence in `frontend/public/vr/worlds/<id>/LICENSES.md`.
- `.glb`, compressed with meshopt (`gltfpack -cc`): the decoder ships inside three.js
  (`three/examples/jsm/libs/meshopt_decoder.module.js`), so nothing is fetched elsewhere. No Draco
  (its decoder is a separate download).
- `model: { gltf: '/vr/worlds/<id>/teapot.glb', scale: 0.01, offset: [0, -0.05, 0] }` — scaled / moved
  so it fills the collider around its origin. Cached by the service worker on first use.
- **Nothing from third-party hosts at runtime** (the CSP in `frontend/public/_headers` would block it).

## Sound

- **Impacts** per `material` (`/vr/sfx/impact-<material>.mp3`), volume and pitch scaled by the speed
  things meet at, ≥ 70 ms apart per object; a dynamic thing hitting a fixed object of another
  material plays both (a glass bottle on a wooden table). Silent for the first 1.5 s (things settle).
- **pickup / drop / throw / use / open / teleport / click / hint / success / finish** — the engine
  plays them.
- **Ambience**: `ambience: 'kitchen' | 'house' | 'street' | 'restaurant' | 'airport' | 'apartment' | 'market' | 'city' | 'none'` — 20 s
  loops (room tone + fridge hum + clock + birds; traffic + a bicycle bell; murmur + dishes + a sizzle;
  a hall + the announcement chimes + rolling suitcases + a far-off take-off; a flat over the city: traffic far below, a horn, a door;
  `city` = the street world at dusk: cars and a bus with air brakes, an e-bike's whine and beep, a far
  horn, people passing, sparrows).
- **Loops on states**: `loops: { 'water=on': 'water' }` (positional, at the object). Others made so far:
  `crossing` (the walkers' signal ticking while green), `sizzle` (a hot griddle), `tv-chatter`, `ac-hum`, `fan`,
  `conveyor` / `xray` (the airport's belts), `coffee` (an espresso machine).
- All synthesised by `scripts/audio/generate-vr-sfx.mjs` (CC0, deterministic; ffmpeg + libmp3lame).
  A new ambience = a function in its `AMBIENCES` + the name in `types.ts` `AMBIENCES`; run
  `node scripts/audio/generate-vr-sfx.mjs amb-<name>`. Keep loops ≤ 120 KB.

## Performance budget (a standalone headset at 72–90 Hz)

| | Budget |
|---|---|
| Draw calls | ≤ 250 (each `<mesh>` is one; reuse geometry + materials — the kit caches both) |
| Triangles | ≤ 300 k (`segments` 12–28 on round things; small things fewer) |
| Dynamic bodies | ≤ 40 (physics sleeps when still); fixed: as many as needed |
| Lights | the preset's 2 + at most 2 point lights, no extra shadow casters |
| Textures | procedural canvases ≤ 512², few distinct ones; glTF textures ≤ 1024², ≤ 5 MB per world |
| Shadows | one 1024² map over `shadowArea` m — keep the world compact around the origin |

## Tests a world must pass

`frontend/src/vr/worlds/worlds.test.ts` runs on every registered world:

- `validateWorld` (`shared/vr-worlds/validate.ts`) returns no problems: every word follows the card
  standard; ids are tokens and unique; materials known; masses ≥ 0 (≤ 60 kg, else fixed);
  everything (objects, zones, spawn) inside the bounds and above the floor; collider sizes positive,
  `when` names real states; every task's targets exist, can be picked up when the condition needs
  it, `on` names a surface / zone, `in_zone` a zone / an object with `inside`, `count_in_zone` asks
  no more than exist, state values are declared, sequences non-empty; no task is already done before
  the learner moves (unless an earlier task changes the same object — "close the fridge" after "open
  it"); instructions end with 。！？ and carry toned pinyin.
- The meta matches the definition (`taskCount`, `objectCount`, titles); 5–12 tasks; the thumbnail,
  the ambience, every material's impact sound, every loop and glTF file exist.

Run `cd frontend && npx vitest run src/vr ../shared/vr-worlds`.

## Running it / screenshots

1. `cd e2e && bash setup-test-env.sh ../worker` and apply the local migrations (CLAUDE.md "Quick Start").
2. Start the worker (`npm exec -w worker -- wrangler dev --port 8798`) and Vite
   (`VITE_DEV_PORT=3011 VITE_API_PROXY=http://localhost:8798 npm run dev:frontend`).
3. Sign in: `POST /api/test/auth` → `/decks?session_token=…`, then open `/vr/worlds/<id>`.
4. Headless Chromium needs WebGL: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
5. Dev builds expose `window.__vrWorld`: `objects()` (id, screen x / y, visible, position, held),
   `targets()` (every panel button on screen), `run()`, `inspect(id)`, `inspectTexts()`,
   `hudTexts()`, `place(id, [x, y, z])`, `screenOf([x, y, z])`, `hideHud(true)` (the thumbnail),
   `presenting()`, `head()`, `rig()`, `stand(x, z, yaw, pitch?)` (stand in another room — screenshots; walking a few metres takes
   minutes in swiftshader). Click real pixels (`page.mouse.click(o.x, o.y)`): it goes
   through the same raycast as a controller. Keys: W A S D / Q E to walk and turn.
6. The thumbnail: hide the HUD and the top bar, 1280×720 at spawn, scale to 640×360 JPEG.
7. E2E: `e2e/tests/vr-worlds.spec.ts` (`E2E_WEB_PORT=3011 E2E_API_PORT=8798 npx playwright test tests/vr-worlds.spec.ts`).

The immersive path was smoke-tested with Meta's IWER (an emulated Quest 3, loaded from a scratch
script — not a dependency): Enter VR, the right controller's trigger held on an apple picks it up
and completes the task, distance grab brings it to the hand. IWER 2.7 ignores offset reference
spaces, so teleport / snap turn (which move the play space through `getOffsetReferenceSpace`, the
standard way) can't be checked there; their maths is unit-tested (`shared/vr-worlds/rig.ts`).

## How it's built

```
shared/vr-worlds/          pure, unit-tested (vr-worlds.test.ts)
  types.ts                 WorldSpec, objects, zones, tasks, the condition language, snapshots, events
  geometry.ts              collider bounds, boxes turned about Y, surfaces, insides
  engine.ts                startRun / stepRun / skipTask, hints, conditionHolds, initialSnapshot
  validate.ts              validateWorld (+ wordProblems)
  rig.ts                   the play space: teleport, snap turn, the offset transform, the teleport arc
frontend/src/vr/worlds/
  WorldsPage.tsx           /vr/worlds — the picker (no 3D code)
  WorldPage.tsx            /vr/worlds/:id — the run, states, inspect / add card / ⚡, explorer, progress, sound, analytics
  panels.ts                the task panel, inspect panel, hover label as UI nodes (pure)
  words.ts                 his cards for a word (new / in decks / known), add to "From VR", ⚡
  progress.ts              IndexedDB `vr-worlds`
  sound.ts                 SoundEngine: pooled PositionalAudio, impacts, loops, ambience
  grabMath.ts              velocity tracking, carry steering, release / throw velocities (pure)
  registry.ts, types.ts    the world list and the contract
  kit/                     the helper library
  scene/WorldScene.tsx     Canvas + Physics, lighting, objects, panels, burst, the XR rig (offset reference space)
  scene/WorldObject.tsx    one object: RigidBody + colliders by state + model + pick boxes + outline + impact sounds
  scene/grabber.ts         holds per input source: pending press → click or grab; velocity-steered carry; release / throw
  scene/live.ts            bodies by object id → snapshots for the engine
  scene/WorldXrInput.tsx   controllers / hands → the interaction hub; thumbstick teleport arc + snap turn; wrist mount
  scene/WorldFlatControls.tsx  mouse / keys / touch: look, walk (blocked by walls), click-to-walk, carry, throw
  scene/physicsQuery.ts    floor / wall ray casts (Rapier)
  scene/Burst.tsx          the success sparkles
  kitchen/                 the reference world
  home/                    家 Apartment: living room + entry, bedroom, bathroom off a hallway; 56 things, 12 tasks (TV, curtains, slippers by the door, laundry), ambience `apartment` + TV / AC loops
  airport/                 机场: check-in (秤 weighs what's on it, 传送带 carries bags), security (托盘, the 安检机 belt carries trays), gate 12, café — 49 objects, 12 tasks; its own belt drive / weigher / mesh baking in airport/parts.tsx
  street/                  街上 On the street (dusk): crossing button + signals, the 便利店 inside, stalls, sorted bins, bus stop — 50 objects, 12 tasks
```

- Physics: `@react-three/rapier` 1.5.0 (the React 18 / fiber 8 line; Rapier 0.14 with its WASM inlined)
  — its own lazy chunk (`react-three-rapier.esm-*.js`, ~770 KB gzip), left out of the service
  worker's precache and cached on first use (`vite.config.ts` `vr-worlds`, with `/vr/sfx/` and
  `/vr/worlds/`). The WASM is instantiated from bytes: the CSP's existing `'wasm-unsafe-eval'`
  (added for sql.js / pdf.js) covers it — no CSP change.
- A held thing stays a DYNAMIC body steered by velocity towards the hand (frame-rate safe: never more
  than ~85 % of the gap per frame), so it still collides with tables and walls; gravity off while
  held. Letting go keeps the hand's velocity (least-squares over the last ~90 ms), capped at 12 m/s.
- The flat preview carries things over the surface under the pointer (a Rapier ray cast excluding the
  carried body) — placing is pointing.
- Panels are the /vr room's canvas panels (`vr/ui/layout.ts`, `scene/PanelMesh.tsx` with `overlay`:
  drawn over the scene so walls never hide them; `interactive={false}` for the hover label).
- Teleport / snap turn / seated move the headset's play space through `XRReferenceSpace.getOffsetReferenceSpace`
  (`rigOffsetTransform`); controllers and the head follow. Nothing ever moves you otherwise.

## Analytics

`vr_world.picker` (worlds), `vr_world.enter` (world, mode flat / immersive), `vr_world.task_done`
(world, task_index, ms, hinted, mode), `vr_world.task_skip`, `vr_world.finish` (world, ms, done,
total), `vr_world.inspect` (world, status new / in_decks / known, grabbable), `vr_world.use`,
`vr_world.add_card` (world, ok), `vr_world.bump` — ids / enums / counts only (shared/analytics/events.ts,
Kotlin mirror in step).

## Known limits / next

- Untested on the Steam Frame itself; teleport not testable in IWER (above).
- No hand-tracking grab poses (a pinch grabs like a trigger; no finger physics).
- Objects turn only about Y for zones / surfaces (fine for "in the basket", not for "upside down").
- Progress is per device; nothing synced or shown to the tutor.
- Next worlds: restaurant, house, street, airport (one agent each, on this contract).
