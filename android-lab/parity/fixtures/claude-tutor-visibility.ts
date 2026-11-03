/**
 * What a tutor can read of her student's Claude chats (shared/claude/visibility.ts): the account
 * setting, THE rule, the ⋯ toggle, the words. Writes claude-tutor-visibility.json; checked by
 * core/…/claude/TutorVisibilityParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  askedClaudeTodayLabel, CLAUDE_TUTOR_VISIBILITIES, DEFAULT_CLAUDE_TUTOR_VISIBILITY, nextTutorVisible, parseTutorVisibility, sharedLine,
  shareMenuLabel, tutorEmptyText, TUTOR_VISIBILITY_EXPLAINER, TUTOR_VISIBILITY_OPTIONS, tutorCanSee, tutorReadOnlyLine, visibleByDefault,
} from '../../../shared/claude/visibility';
import { CLAUDE_CONTEXT_KINDS } from '../../../shared/claude/context';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: claude-tutor-visibility <out-dir>');
mkdirSync(OUT, { recursive: true });

const KINDS = [...CLAUDE_CONTEXT_KINDS, null, 'something_new'];
const cases = [];
for (const setting of CLAUDE_TUTOR_VISIBILITIES) {
  for (const kind of KINDS) {
    for (const tutor_visible of [null, true, false]) {
      const t = { context_kind: kind, tutor_visible };
      cases.push({
        setting, kind, tutor_visible,
        byDefault: visibleByDefault(kind, setting),
        canSee: tutorCanSee(t, setting),
        next: nextTutorVisible(t, setting),
        menu: shareMenuLabel(t, setting),
        line: sharedLine(t, setting, 'Minghui'),
        lineNoName: sharedLine(t, setting, '  '),
      });
    }
  }
}

writeFileSync(
  join(OUT, 'claude-tutor-visibility.json'),
  JSON.stringify({
    values: CLAUDE_TUTOR_VISIBILITIES,
    defaultValue: DEFAULT_CLAUDE_TUTOR_VISIBILITY,
    explainer: TUTOR_VISIBILITY_EXPLAINER,
    options: TUTOR_VISIBILITY_OPTIONS,
    parse: ['card_only', 'all', 'none', 'cards', '', null].map((v) => ({ in: v, out: parseTutorVisibility(v) })),
    cases,
    today: [0, 1, 3, 12, -1].map((n) => ({ in: n, out: askedClaudeTodayLabel(n) })),
    readOnly: ['Jerome', '  ', null].map((n) => ({ in: n, out: tutorReadOnlyLine(n) })),
    empty: ['Jerome', null].flatMap((n) => [...CLAUDE_TUTOR_VISIBILITIES, undefined].map((v) => ({ name: n, visibility: v ?? null, out: tutorEmptyText(n, v) }))),
  }, null, 1),
);
