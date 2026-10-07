/**
 * Conversation audio (shared/tts/conversation.ts + shared/lesson/conversationAudio.ts +
 * PROVIDER_RATE_RANGE / conversation_rate in shared/tts/config.ts): the provider rate clamp and
 * speed steps, the per-provider conversation voices, owners and pools, deliveries, the
 * preference merge / parse, resolveConversationAudio, speakerVoiceUpdate and
 * lessonConversationClips. Writes conversation-audio.json; checked by
 * core/…/ConversationAudioParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AZURE_VOICE_STYLES,
  CONVERSATION_DELIVERIES,
  CONVERSATION_SPEED_STEPS,
  DEFAULT_CONVERSATION_RATE,
  DELIVERY_LABELS,
  clampConversationRate,
  conversationProviderVoices,
  conversationSpeedSteps,
  conversationVoiceGender,
  conversationVoiceProvider,
  deliveryParams,
  isConversationDelivery,
  providerVoicePools,
  supportedDeliveries,
} from '../../../shared/tts/conversation';
import { DEFAULT_TTS_CONFIG, PROVIDER_RATE_RANGE, TTS_PROVIDERS, TTS_PROVIDER_NAMES } from '../../../shared/tts/config';
import {
  DEFAULT_CONVERSATION_AUDIO_PREFS,
  MAX_EXERCISE_VOICE_ENTRIES,
  conversationAudioKey,
  lessonConversationClips,
  mergeConversationAudioPrefs,
  parseConversationAudioPrefs,
  resolveConversationAudio,
  speakerVoiceUpdate,
  type ConversationAudioPrefs,
} from '../../../shared/lesson/conversationAudio';
import { resolveConversationVoices } from '../../../shared/lesson/voices';
import type { ConversationExerciseSpec, ConversationSpeaker } from '../../../shared/lesson/types';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

// Deterministic PRNG (mulberry32) so the vectors never change between runs.
let s = 0x5eed_c0de;
function rnd(): number {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

const M = 'Chinese (Mandarin)_';
const providers = [...TTS_PROVIDERS];

// ---------- constants + the tts/conversation.ts helpers ----------
const speeds = [0, 0.3, 0.5, 0.55, 0.6, 0.62, 0.749, 0.755, 0.8, 0.85, 0.9, 1, 1.15, 1.2, 1.25, 2, 4, -1];
const clamp = [...providers, 'unknown'].flatMap((p) =>
  speeds.map((speed) => ({ provider: p, speed, rate: clampConversationRate(p as never, speed) })),
);

const allVoiceIds = [
  ...providers.flatMap((p) => conversationProviderVoices(p).map((v) => v.id)),
  'zh-CN-Xiaoxiao:DragonHDFlashLatestNeural',
  'zh-cn-Yunfan:DragonHDLatestNeural',
  `${M}Radio_Host`,
  'nope',
  '',
];
const owners = allVoiceIds.map((id) => ({ id, provider: conversationVoiceProvider(id), gender: conversationVoiceGender(id) }));

const deliveryVoices = [...allVoiceIds, 'zh-CN-YunyangNeural', 'zh-CN-XiaochenNeural'];
const deliveries = [...providers, 'unknown'].flatMap((p) =>
  deliveryVoices.flatMap((voice) => [
    ...CONVERSATION_DELIVERIES.map((d) => ({ provider: p, voice, delivery: d, params: deliveryParams(p as never, voice, d) })),
  ]),
);
const supported = [...providers, 'unknown'].flatMap((p) =>
  deliveryVoices.map((voice) => ({ provider: p, voice, deliveries: supportedDeliveries(p as never, voice) })),
);

// ---------- the preference merge ----------
const mmVoices = conversationProviderVoices('minimax');
const azVoices = conversationProviderVoices('azure');
const ggVoices = conversationProviderVoices('google');
const voiceOf = (p: string) => pick(p === 'minimax' ? mmVoices : p === 'azure' ? azVoices : ggVoices);
const key13 = () => int(0, 2 ** 31).toString(36);

function randomUpdate(): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (rnd() < 0.4) u.speed = pick([null, 0.5, 0.6, 0.75, 0.8, 0.853, 1, 1.2, 0.4, 1.3, '0.8', true]);
  if (rnd() < 0.3) u.delivery = pick(['natural', 'chat', 'calm', 'cheerful', 'angry', 3, null]);
  if (rnd() < 0.5) {
    const v: Record<string, unknown> = {};
    for (let k = 0; k < int(1, 3); k++) {
      const p = rnd() < 0.08 ? 'acme' : pick(providers);
      if (rnd() < 0.15) { v[p] = null; continue; }
      if (rnd() < 0.08) { v[p] = pick(['x', 3, ['a']]); continue; }
      const g: Record<string, unknown> = {};
      for (let j = 0; j < int(1, 2); j++) {
        const gender = rnd() < 0.06 ? 'other' : pick(['female', 'male']);
        const r = rnd();
        if (r < 0.2) g[gender] = null;
        else if (r < 0.3) g[gender] = voiceOf(pick(providers)).id; // maybe another provider's
        else if (r < 0.35) g[gender] = 7;
        else {
          const prov = p === 'acme' ? 'minimax' : p;
          const list = (prov === 'minimax' ? mmVoices : prov === 'azure' ? azVoices : ggVoices).filter((x) => x.gender === gender);
          g[gender] = list.length ? pick(list).id : 'nope';
        }
      }
      v[p] = g;
    }
    u.voices = rnd() < 0.05 ? pick([null, [], 'x']) : v;
  }
  if (rnd() < 0.6) {
    const e: Record<string, unknown> = {};
    for (let k = 0; k < int(1, 4); k++) {
      const p = rnd() < 0.08 ? 'acme' : pick(providers);
      const key = rnd() < 0.1 ? pick(['minimax:', 'minimax:ABC', `azure:${'z'.repeat(14)}`, 'nokey']) : `${p}:${key13()}`;
      const r = rnd();
      if (r < 0.15) e[key] = null;
      else if (r < 0.2) e[key] = 'x';
      else if (r < 0.25) e[key] = new Array(7).fill(null);
      else {
        const prov = p === 'acme' ? 'minimax' : p;
        e[key] = Array.from({ length: int(1, 3) }, () => {
          const q = rnd();
          if (q < 0.3) return null;
          if (q < 0.35) return 5;
          if (q < 0.42) return voiceOf(pick(providers)).id;
          return voiceOf(prov).id;
        });
      }
    }
    u.exercise_voices = rnd() < 0.05 ? pick([null, ['a'], 4]) : e;
  }
  return u;
}

const merges: Array<{ base: ConversationAudioPrefs; input: unknown; prefs: ConversationAudioPrefs; problems: string[] }> = [];
const special: unknown[] = [null, [], 'x', 3, {}, { speed: null }, { exercise_voices: { 'minimax:abc': [null, null] } }];
let base: ConversationAudioPrefs = JSON.parse(JSON.stringify(DEFAULT_CONVERSATION_AUDIO_PREFS));
for (const input of special) {
  const r = mergeConversationAudioPrefs(base, input);
  merges.push({ base, input, prefs: r.prefs, problems: r.problems });
}
for (let i = 0; i < 400; i++) {
  if (i % 50 === 0) base = JSON.parse(JSON.stringify(DEFAULT_CONVERSATION_AUDIO_PREFS));
  const input = randomUpdate();
  const r = mergeConversationAudioPrefs(base, input);
  merges.push({ base, input, prefs: r.prefs, problems: r.problems });
  if (!r.problems.length || rnd() < 0.5) base = r.prefs;
}
// The trim: more than MAX_EXERCISE_VOICE_ENTRIES per-conversation choices keeps the newest.
{
  const many: Record<string, unknown> = {};
  for (let i = 0; i < MAX_EXERCISE_VOICE_ENTRIES + 7; i++) many[`minimax:k${i.toString(36)}`] = [mmVoices[i % mmVoices.length].id];
  const b: ConversationAudioPrefs = { ...JSON.parse(JSON.stringify(DEFAULT_CONVERSATION_AUDIO_PREFS)), exercise_voices: { 'azure:old1': [azVoices[0].id], 'minimax:k3': [null, mmVoices[1].id] } };
  const r = mergeConversationAudioPrefs(b, { exercise_voices: many });
  merges.push({ base: b, input: { exercise_voices: many }, prefs: r.prefs, problems: r.problems });
}

// ---------- parse ----------
const parses = [
  null,
  '',
  'not json',
  'null',
  '3',
  '[]',
  '{}',
  '{"speed":0.7}',
  '{"speed":"fast","delivery":"calm"}',
  '{"speed":2,"delivery":"loud","voices":{"azure":{"female":"zh-CN-XiaoyiNeural","male":"bad"}}}',
  `{"voices":{"minimax":{"male":"presenter_male"}},"exercise_voices":{"minimax:abc":["presenter_female",null],"bad":["x"]}}`,
  `{"speed":0.856,"delivery":"cheerful","voices":{"google":{"female":"cmn-CN-Wavenet-A"}},"exercise_voices":{"google:zz":[null,"cmn-CN-Wavenet-D"]}}`,
  ...merges.slice(10, 40).map((m) => JSON.stringify(m.prefs)),
].map((raw) => ({ raw, prefs: parseConversationAudioPrefs(raw) }));

// ---------- resolve ----------
const situations = ['在咖啡店点咖啡', '问路去火车站', '周末的计划', '买水果', ''];
const hanzi = ['你好！', '请问，火车站怎么走？', '一直往前走，然后左转。', '谢谢你！', '不客气。', '我要一杯拿铁。', '多少钱？', '二十五块。'];
const selections: Array<string[] | null> = [
  null,
  [],
  ['presenter_female', 'presenter_male'],
  [`${M}News_Anchor`],
  ['audiobook_female_1', `${M}Kind-hearted_Antie`, `${M}Gentleman`, `${M}Sincere_Adult`, `${M}Gentle_Youth`],
  [`${M}Wise_Women`, 'female-yujie', `${M}Humorous_Elder`],
];

function randomConversation(): Pick<ConversationExerciseSpec, 'situation' | 'lines' | 'speakers'> {
  const n = int(1, 4);
  const speakers: ConversationSpeaker[] = Array.from({ length: n }, (_, k) => {
    const v = pick(['female', 'male', undefined, undefined]);
    return v ? { name: `S${k}`, voice: v as never } : { name: `S${k}` };
  });
  const lines = Array.from({ length: int(1, 6) }, () => ({ speaker: int(0, n - 1), hanzi: pick(hanzi) }));
  return { situation: pick(situations), speakers, lines };
}

function randomPrefsFor(ex: Pick<ConversationExerciseSpec, 'situation' | 'lines' | 'speakers'>, provider: string): ConversationAudioPrefs {
  const update: Record<string, unknown> = {};
  if (rnd() < 0.5) update.speed = pick([0.5, 0.6, 0.7, 0.8, 1, 1.2]);
  if (rnd() < 0.5) update.delivery = pick(CONVERSATION_DELIVERIES);
  const r = rnd();
  if (r < 0.6) {
    const v: Record<string, Record<string, string>> = {};
    for (const p of providers) {
      if (rnd() < 0.5) continue;
      const g: Record<string, string> = {};
      for (const gender of ['female', 'male'] as const) {
        if (rnd() < 0.5) continue;
        const list = conversationProviderVoices(p).filter((x) => x.gender === gender);
        g[gender] = pick(list).id;
      }
      v[p] = g;
    }
    update.voices = v;
  }
  if (rnd() < 0.6) {
    const key = `${rnd() < 0.8 ? provider : pick(providers)}:${conversationAudioKey(ex)}`;
    const prov = key.slice(0, key.indexOf(':'));
    const list = conversationProviderVoices(prov as never);
    update.exercise_voices = { [key]: ex.speakers.map(() => (rnd() < 0.4 ? null : pick(list).id)) };
  }
  return mergeConversationAudioPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS, update).prefs;
}

const resolves = Array.from({ length: 500 }, () => {
  const ex = randomConversation();
  const provider = pick(providers);
  const ctx = {
    provider,
    default_speed: pick([0.75, 0.8, 0.85, 1, 0.4, 1.5]),
    enabled: pick(selections),
    prefs: rnd() < 0.15 ? null : randomPrefsFor(ex, provider),
  };
  const result = resolveConversationAudio(ex, ctx);
  // A pick per speaker, as the ⚙︎ menu sends it.
  const index = int(0, ex.speakers.length - 1);
  const voice = rnd() < 0.3 ? null : pick(conversationProviderVoices(provider)).id;
  const update = speakerVoiceUpdate(result, ex.speakers, index, voice, ctx.prefs ?? undefined);
  return { ex, ctx, result, pick_index: index, pick_voice: voice, update };
});

// resolveConversationVoices with explicit pools (the Azure / Google rotation).
const poolResolves = Array.from({ length: 120 }, () => {
  const ex = randomConversation();
  const provider = pick(providers);
  const pools = rnd() < 0.2 ? { female: [pick(azVoices).id], male: [] } : providerVoicePools(provider);
  const seed = int(0, 2 ** 32 - 1);
  const enabled = pick(selections);
  return { speakers: ex.speakers, seed, enabled, pools, voices: resolveConversationVoices(ex.speakers, { enabled, seed, pools }) };
});

// ---------- lessonConversationClips ----------
const lessonSpec = {
  sections: [
    { exercises: [{ type: 'note' }, { type: 'conversation', ...randomConversation(), questions: [] }] },
    { exercises: [{ type: 'conversation', ...randomConversation(), questions: [] }, { type: 'choice' }] },
    { exercises: [{ type: 'conversation', situation: '', speakers: [{ name: 'A' }], lines: [{ speaker: 3, hanzi: '你好' }], questions: [] }] },
  ],
};
const clipCtxs = providers.map((provider) => ({ provider, default_speed: DEFAULT_TTS_CONFIG.providers[provider].conversation_rate, enabled: null, prefs: randomPrefsFor(lessonSpec.sections[0].exercises[1] as never, provider) }));
const clips = clipCtxs.map((ctx) => ({
  ctx,
  clips: lessonConversationClips(lessonSpec, (ex) => resolveConversationAudio(ex, ctx)).map((c) => ({ ...c, voice: c.voice ?? null })),
}));

writeFileSync(
  join(OUT, 'conversation-audio.json'),
  JSON.stringify({
    providers,
    provider_names: TTS_PROVIDER_NAMES,
    rate_range: PROVIDER_RATE_RANGE,
    conversation_rate: Object.fromEntries(providers.map((p) => [p, DEFAULT_TTS_CONFIG.providers[p].conversation_rate])),
    speed_steps_all: CONVERSATION_SPEED_STEPS,
    default_rate: DEFAULT_CONVERSATION_RATE,
    steps: Object.fromEntries([...providers, 'unknown'].map((p) => [p, conversationSpeedSteps(p as never)])),
    clamp,
    voices: Object.fromEntries([...providers, 'unknown'].map((p) => [p, conversationProviderVoices(p as never)])),
    pools: Object.fromEntries(providers.map((p) => [p, providerVoicePools(p)])),
    owners,
    deliveries_all: CONVERSATION_DELIVERIES,
    delivery_labels: DELIVERY_LABELS,
    azure_styles: AZURE_VOICE_STYLES,
    delivery_params: deliveries,
    supported,
    is_delivery: ['natural', 'chat', 'calm', 'cheerful', 'angry', '', 'Natural'].map((v) => ({ v, ok: isConversationDelivery(v) })),
    default_prefs: DEFAULT_CONVERSATION_AUDIO_PREFS,
    max_entries: MAX_EXERCISE_VOICE_ENTRIES,
    merges,
    parses,
    resolves,
    pool_resolves: poolResolves,
    lesson_spec: lessonSpec,
    clips,
  }),
);
console.log(`conversation-audio: ${clamp.length} clamps, ${merges.length} merges, ${parses.length} parses, ${resolves.length} resolutions`);
