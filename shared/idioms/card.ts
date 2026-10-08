/**
 * "+ Add as card" from an idiom page: the card-standard fields built from the entry. Ported to
 * the Lab app (Idioms.kt `idiomCardFields`) and parity-tested.
 */
import { IDIOM_ROLES, type IdiomEntry } from './types';

export interface IdiomCardFields {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
}

const SENTIMENT_LABEL: Record<IdiomEntry['usage']['sentiment'], string> = {
  praise: '褒义 (approving)',
  criticism: '贬义 (critical)',
  neutral: '中性 (neutral)',
};
const REGISTER_LABEL: Record<IdiomEntry['usage']['register'], string> = {
  written: '书面 (written)',
  spoken: '口语 (spoken)',
  both: 'written and spoken',
};

/** "谓语 (predicate), 定语 (attributive)". */
export function idiomRolesLabel(roles: readonly string[]): string {
  return roles.map((r) => (IDIOM_ROLES[r] ? `${r} (${IDIOM_ROLES[r]})` : r)).join(', ');
}

export function idiomSentimentLabel(s: IdiomEntry['usage']['sentiment']): string {
  return SENTIMENT_LABEL[s] ?? s;
}

export function idiomRegisterLabel(r: IdiomEntry['usage']['register']): string {
  return REGISTER_LABEL[r] ?? r;
}

/** The origin in one line: "《战国策·齐策二》, 战国: <summary>" / "Origin uncertain: <summary>". */
export function idiomOriginLine(entry: IdiomEntry): string {
  const o = entry.origin;
  const where = [o.source, o.era].filter((x): x is string => !!x).join(', ');
  if (o.kind === 'uncertain') return `Origin uncertain${o.summary ? `: ${o.summary}` : ''}`;
  if (o.kind === 'modern') return `A modern idiom${o.summary ? `: ${o.summary}` : ''}`;
  return where ? `Origin: ${where} — ${o.summary}` : `Origin: ${o.summary}`;
}

/**
 * The card: hanzi / pinyin / the figurative meaning; fun_facts = the literal breakdown, the
 * meaning, the origin in one line, usage + register, the common mistake; sentence_clue = the
 * easiest example (examples are ordered easiest → hardest).
 */
export function idiomCardFields(entry: IdiomEntry): IdiomCardFields {
  const literal = entry.literal.map((c) => `${c.hanzi} (${c.pinyin}) ${c.gloss}`).join(' · ');
  const lines = [
    `${literal}${entry.literal_english ? ` — literally “${entry.literal_english}”` : ''}.`,
    `Means: ${entry.meaning}`,
    idiomOriginLine(entry),
    `Usage: ${[idiomRolesLabel(entry.usage.roles), idiomSentimentLabel(entry.usage.sentiment), idiomRegisterLabel(entry.usage.register)].filter(Boolean).join(' · ')}${entry.usage.note ? `. ${entry.usage.note}` : ''}`,
  ];
  if (entry.usage.mistake) lines.push(`Common mistake: ${entry.usage.mistake}`);
  const first = entry.usage.examples[0];
  return {
    hanzi: entry.hanzi,
    pinyin: entry.pinyin,
    english: entry.meaning,
    fun_facts: lines.join('\n'),
    ...(first ? { sentence_clue: first.hanzi, sentence_clue_pinyin: first.pinyin, sentence_clue_translation: first.english } : {}),
  };
}
