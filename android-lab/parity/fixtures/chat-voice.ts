/**
 * Chat read-aloud voice (shared/chats/voice.ts): chatReadAloudVoice over sender gender ×
 * listener selection × AI persona, chatReadAloudSpeed, parseVoiceGender / pickVoiceGender and
 * the Profile copy. Writes chat-voice.json; checked by core/…/ChatVoiceParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_READ_ALOUD_SPEED,
  VOICE_GENDER_HINT,
  VOICE_GENDER_OPTIONS,
  VOICE_GENDER_TITLE,
  chatReadAloudSpeed,
  chatReadAloudVoice,
  parseVoiceGender,
  pickVoiceGender,
} from '../../../shared/chats/voice';
import { DEFAULT_LESSON_VOICE } from '../../../shared/lesson/voices';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const M = 'Chinese (Mandarin)_';
const genders: Array<string | null> = ['male', 'female', 'other', null, 'MALE', '', 'robot'];
const selections: Array<string[] | null> = [
  null,
  [],
  ['junk'],
  [`${M}News_Anchor`],
  [`${M}News_Anchor`, `${M}Male_Announcer`],
  ['presenter_male', 'audiobook_female_1', `${M}Gentleman`, 'presenter_female'],
  // only female voices (+ junk): the male pool is empty → the app voice
  ['presenter_female', `${M}Sweet_Lady`, 'junk'],
  // only male voices: the female pool is empty → the app voice
  [`${M}Gentle_Youth`, `${M}Radio_Host`, 'male-qn-badao'],
  ['female-yujie', `${M}Humorous_Elder`],
];
const personas: Array<{ fromAi: boolean; personaVoice: string | null }> = [
  { fromAi: false, personaVoice: null },
  { fromAi: false, personaVoice: 'female-yujie' },
  { fromAi: false, personaVoice: `${M}Gentle_Youth` },
  { fromAi: true, personaVoice: null },
  { fromAi: true, personaVoice: '' },
  { fromAi: true, personaVoice: 'not-a-voice' },
  { fromAi: true, personaVoice: `${M}Gentle_Youth` },
  { fromAi: true, personaVoice: 'female-yujie' },
  { fromAi: true, personaVoice: DEFAULT_LESSON_VOICE },
];

const voices = genders.flatMap((senderGender) =>
  selections.flatMap((enabled) =>
    personas.map((p) => ({
      sender_gender: senderGender,
      enabled,
      from_ai: p.fromAi,
      persona_voice: p.personaVoice,
      voice: chatReadAloudVoice({ senderGender: senderGender as never, enabled, fromAi: p.fromAi, personaVoice: p.personaVoice }),
    })),
  ),
);

const speedsIn: Array<number | null> = [null, 0, 0.4, 0.5, 0.6, 0.75, 1, 1.5, 2, 2.01, 9, -1];
const speeds = [false, true].flatMap((fromAi) =>
  speedsIn.map((s) => ({ from_ai: fromAi, persona_speed: s, speed: chatReadAloudSpeed({ fromAi, personaSpeed: s }) })),
);

const values: Array<string | null> = ['male', 'female', 'other', null, '', 'MALE', 'Female', 'x', ' male'];
const parsed = values.map((v) => {
  const p = pickVoiceGender(v);
  return { value: v, parsed: parseVoiceGender(v), pick_set: 'value' in p, pick_value: p.value ?? null, pick_problem: p.problem ?? null };
});

writeFileSync(
  join(OUT, 'chat-voice.json'),
  JSON.stringify({
    title: VOICE_GENDER_TITLE,
    hint: VOICE_GENDER_HINT,
    options: VOICE_GENDER_OPTIONS,
    speed: CHAT_READ_ALOUD_SPEED,
    default_voice: DEFAULT_LESSON_VOICE,
    voices,
    speeds,
    parsed,
  }),
);
