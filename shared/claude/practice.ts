/**
 * Practice with Claude — role-play threads (docs/CHAT.md "Practice with Claude"; the
 * unified-Claude-chats plan §6.5). A `practice` thread is a Claude thread in which Claude PLAYS a
 * person in a situation (a waiter, a taxi driver, a new friend) and the learner talks to them in
 * Chinese. Started from:
 *   - the Chats tab: ✏️ → "🎭 Practice a situation…" (a preset or his own situation, his role, Claude's
 *     role, a level),
 *   - a study card: ⋯ → "🎭 Roleplay this word" (`practiceFromCard`),
 *   - the old Claude page (Connections → Claude → New practice chat).
 * Claude speaks first (the thread is created with no message: the server writes the opener).
 *
 * Pure; used by the worker (validation, the voice, the reply language), the web app and ported to
 * the Lab app (core `claude/ClaudePractice.kt`, parity-tested by android-lab/parity/fixtures/claude-practice.ts).
 */
import { LESSON_VOICE_IDS, LESSON_VOICE_POOLS, DEFAULT_LESSON_VOICE } from '../lesson/voices';
import type { AskLanguage } from '../study/askClaude';
import type { ClaudeContextSnapshot, ClaudeThreadContext } from './context';

export type PracticeContext = Extract<ClaudeThreadContext, { kind: 'practice' }>;

// ---------- Levels ----------

export type PracticeLevel = 'beginner' | 'intermediate' | 'advanced';

export const PRACTICE_LEVELS: ReadonlyArray<{ id: PracticeLevel; label: string; hint: string }> = [
  { id: 'beginner', label: 'Beginner', hint: 'Very short, slow, everyday words' },
  { id: 'intermediate', label: 'Intermediate', hint: 'Natural, HSK 3–4' },
  { id: 'advanced', label: 'Advanced', hint: 'Like a native speaker' },
];

export const DEFAULT_PRACTICE_LEVEL: PracticeLevel = 'intermediate';

export function parsePracticeLevel(v: unknown): PracticeLevel | null {
  return v === 'beginner' || v === 'intermediate' || v === 'advanced' ? v : null;
}

// ---------- Situations ----------

/** A ready-made situation for the "Practice a situation" sheet. */
export interface PracticeScenario {
  id: string;
  icon: string;
  /** What the row says (English). */
  label: string;
  /** The situation as Claude reads it (and the badge: "🎭 Practice · 在饭店点菜"). */
  scenario: string;
  ai_role: string;
  user_role: string;
}

export const PRACTICE_SCENARIOS: readonly PracticeScenario[] = [
  { id: 'restaurant', icon: '🍜', label: 'Ordering at a restaurant', scenario: '在饭店点菜', ai_role: '服务员 (a waiter)', user_role: '客人 (a customer)' },
  { id: 'taxi', icon: '🚕', label: 'Taking a taxi', scenario: '打车去火车站', ai_role: '出租车司机 (a taxi driver)', user_role: '乘客 (a passenger)' },
  { id: 'directions', icon: '🗺️', label: 'Asking the way', scenario: '在街上问路', ai_role: '路人 (a friendly passer-by)', user_role: '游客 (a visitor)' },
  { id: 'market', icon: '🍎', label: 'Buying fruit at a market', scenario: '在市场买水果，还可以讲价', ai_role: '水果摊老板 (the stall owner)', user_role: '顾客 (a customer)' },
  { id: 'hotel', icon: '🏨', label: 'Checking in at a hotel', scenario: '在酒店办入住', ai_role: '前台 (the receptionist)', user_role: '客人 (a guest)' },
  { id: 'doctor', icon: '🩺', label: 'Seeing a doctor', scenario: '去医院看病', ai_role: '医生 (a doctor)', user_role: '病人 (a patient)' },
  { id: 'friend', icon: '☕', label: 'Chatting with a new friend', scenario: '跟新朋友聊天：爱好、工作、周末', ai_role: '新朋友 (a new friend)', user_role: '你自己 (yourself)' },
];

/** Most characters a learner-written situation / role keeps (the descriptor's text cap). */
export const PRACTICE_TEXT_MAX = 200;

/** The "Practice a situation" form → a practice context (null = nothing to practise yet). */
export function practiceContext(input: { scenario?: string | null; ai_role?: string | null; user_role?: string | null; level?: string | null }): PracticeContext | null {
  const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, PRACTICE_TEXT_MAX) : undefined);
  const scenario = clean(input.scenario);
  if (!scenario) return null;
  const out: PracticeContext = { kind: 'practice', scenario };
  const aiRole = clean(input.ai_role);
  const userRole = clean(input.user_role);
  if (aiRole) out.ai_role = aiRole;
  if (userRole) out.user_role = userRole;
  out.level = parsePracticeLevel(input.level) ?? DEFAULT_PRACTICE_LEVEL;
  return out;
}

/** "🎭 Roleplay this word" on a study card: a conversation that naturally uses the word. */
export function practiceFromCard(note: { id: string; hanzi: string }, level?: PracticeLevel | null): PracticeContext & ClaudeContextSnapshot {
  const hanzi = note.hanzi.replace(/\s+/g, ' ').trim().slice(0, 40);
  return {
    kind: 'practice',
    note_id: note.id,
    scenario: `用「${hanzi}」聊天`,
    ai_role: '聊天的朋友 (a friendly conversation partner)',
    user_role: `学中文的人，在练习「${hanzi}」 (a learner practising this word)`,
    level: level ?? DEFAULT_PRACTICE_LEVEL,
    label: hanzi,
  };
}

/** The badge snapshot of a new practice thread: the situation, and who Claude plays. */
export function practiceSnapshot(ctx: PracticeContext): ClaudeContextSnapshot {
  const label = ctx.scenario?.slice(0, 80);
  const sublabel = ctx.ai_role?.slice(0, 80);
  return { ...(label ? { label } : {}), ...(sublabel ? { sublabel } : {}) };
}

// ---------- The persona's voice ----------

/** Read-aloud speed of Claude's lines in a role-play (slow and clear, like every chat read-aloud). */
export const PRACTICE_VOICE_SPEED = 0.7;

const FEMALE_HINT = /女|她|阿姨|小姐|妈妈|姐|奶奶|waitress|woman|female|lady|mother|girl|aunt/i;
const MALE_HINT = /男|他|先生|叔叔|爸爸|哥|爷爷|\bman\b|male|father|boy|uncle|waiter\b/i;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The voice Claude's lines are read in: the thread's own `voice_id` when it is one of the app's voices
 * (the server stores one at creation), else picked from the shipped conversation voices — by a gender
 * the role names (她 / 阿姨 / waitress → female, 他 / 先生 → male), otherwise across both — stable per
 * situation + role, so one role-play always has one voice.
 */
export function practiceVoiceFor(ctx: Pick<PracticeContext, 'voice_id' | 'scenario' | 'ai_role'>): string {
  if (ctx.voice_id && LESSON_VOICE_IDS.has(ctx.voice_id)) return ctx.voice_id;
  const role = ctx.ai_role ?? '';
  const female = FEMALE_HINT.test(role);
  const male = !female && MALE_HINT.test(role);
  const pool = female ? LESSON_VOICE_POOLS.female : male ? LESSON_VOICE_POOLS.male : [...LESSON_VOICE_POOLS.female, ...LESSON_VOICE_POOLS.male];
  if (pool.length === 0) return DEFAULT_LESSON_VOICE;
  return pool[hash(`${ctx.scenario ?? ''}|${role}`) % pool.length];
}

// ---------- Asking for help mid-role-play ----------

const HELP_MARKS = ['💡', '🆘', '✏️'];
const HELP_TEXT = /^\s*(how (do|would|can) (i|you) say\b|what (should|could) i say\b|hint\b|help\b|correct (me|my)\b)|怎么说|提示|纠正|改一下我/i;

/**
 * A message that steps OUT of the role-play (a chip — 💡 hint, 🆘 how do I say…, ✏️ correct me — or
 * "how do I say …", 怎么说): Claude helps as a tutor, then carries on in character.
 */
export function isPracticeHelpRequest(text: string): boolean {
  const t = text.trim();
  return HELP_MARKS.some((m) => t.startsWith(m)) || HELP_TEXT.test(t);
}

/**
 * The language a practice reply is stored / shown in: a role-play line is Chinese (word chips, 🎧,
 * read aloud in the persona's voice); help is in the learner's Ask Claude language ("in English please"
 * already made `askLanguage` English for that turn).
 */
export function practiceReplyLanguage(text: string, askLanguage: AskLanguage): AskLanguage {
  return isPracticeHelpRequest(text) ? askLanguage : 'zh';
}
