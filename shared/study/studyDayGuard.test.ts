/**
 * Guard: no new raw-midnight / UTC "today" (docs/STUDY_SESSION.md "When does a new day start").
 *
 * Every "today" of study — what is due, reviews / cards / time today, introduced-today, the budget
 * and the review load, the celebration, the daily reader, streaks, progress days — goes through the
 * study day (shared/study/studyDay.ts; web services/studyDay.ts, Lab data/StudyDayClock.kt, the
 * worker's services/study-day.ts → `studyDaySql` for SQL), which turns over at the account's
 * "New day starts at" (4 am by default), in the learner's zone. A calendar midnight or the UTC date
 * is wrong for Jerome from 00:00 to 04:00 every night (17 Nov 2026: the Lab Progress chart ended on
 * an empty bar for "tomorrow"; the server's "studied today" counted from 00:00 UTC).
 *
 * This test scans the apps' sources for the usual ways a plain day sneaks in and fails on any match
 * outside the allow-list below — each entry a file that is NOT study data (chat day pills, tutor-side
 * calendar dates, backup file names, date-string arithmetic …) with the number of matches it may
 * have. A new match: use the study-day helpers; if it really isn't study data, add it here with why.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const TS_PATTERNS: RegExp[] = [
  /setHours\(0\s*,/, // local midnight
  /toDateString\(\)/, // a calendar-day key
  /date\(\s*'now'\s*\)/, // SQLite: the UTC date
  /'start of day'/, // SQLite: UTC midnight
  /toISOString\(\)\.(slice\(0,\s*10\)|split\('T'\)\[0\])/, // the UTC date of an instant
];
const KT_PATTERNS: RegExp[] = [
  /LocalDate\.now\(/, // the calendar date
  /\.atStartOfDay\(/, // local midnight
  /LocalDate\.ofInstant\(/, // a calendar / UTC date of an instant
];

/** path (from the repo root) → [allowed matches, why it isn't study data]. */
const ALLOWED: Record<string, [number, string]> = {
  // TypeScript
  'frontend/src/services/studyDay.ts': [1, 'date-key arithmetic on a study-day key (T12:00Z)'],
  'frontend/src/pages/SettingsPage.tsx': [1, 'the backup file name'],
  'frontend/src/pages/ChatPage.tsx': [2, 'chat day separators (calendar days)'],
  'frontend/src/pages/tutor/tutor-shared.tsx': [2, 'tutor-side "Today / Yesterday" of a timestamp'],
  'shared/chats/bubbles.ts': [1, 'chat day pills at a fixed offset'],
  'shared/calls/pages.ts': [1, 'call board pages: same calendar day'],
  'shared/progress/daily.ts': [2, "the progress SQL's date(): already shifted by offset − rollover"],
  'shared/meme-review/validate.ts': [1, 'monthly issue coverage window'],
  'shared/meme-review/rules.ts': [1, 'monthly issue coverage window'],
  'shared/homework/due.ts': [2, 'date-string arithmetic / validation (T12:00Z)'],
  'shared/study/studyDay.ts': [2, 'the rule itself'],
  'worker/src/index.ts': [1, 'the backup file name'],
  'worker/src/services/tutor-dashboard.ts': [3, 'dayKey / addDays helpers; summarizeHomework default (callers pass the study day)'],
  'worker/src/services/lesson-revision.ts': [1, 'dayIn fallback (calendar day, no longer used for "today")'],
  'worker/src/services/prepared-activities/run.ts': [1, 'nightly job idempotency key'],
  'worker/src/services/meme-review/job.ts': [1, 'monthly issue'],
  'worker/src/services/homework-emails/index.ts': [1, 'a window wide enough for every zone'],
  'worker/src/services/claude-agent/learner.ts': [1, 'prompt-cache key for the known-words sample'],
  'worker/src/db/queries.ts': [6, 'the legacy grammar-practice "daily status" (no current client); fallbacks when the client sends no local_date (both apps send their study-day key)'],
  'worker/src/routes/calls.ts': [1, 'a call title date'],
  'worker/src/routes/study-time.ts': [1, 'default range start (rows are keyed by the device\'s study day)'],
  'mcp-server/src/index.ts': [1, 'a comment naming what not to use'],
  // Kotlin
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/teaching/DatePickerSheet.kt': [2, 'date picker (UTC millis by contract)'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/teaching/TutorPagesKit.kt': [1, 'tutor-side relative dates'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/teaching/TeachingFormat.kt': [2, 'tutor-side relative dates'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/teaching/StudentPageSections.kt': [2, 'tutor-side labels (the server sends the student\'s day)'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/teaching/HomeworkDraftScreens.kt': [3, 'tutor-side due-date pickers'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/teaching/InsightsScreen.kt': [3, 'tutor-side date ranges'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/teaching/StudentProgressScreens.kt': [2, 'tutor-side labels'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/library/AssignSheet.kt': [2, 'due-date picker (UTC millis by contract)'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/library/LibraryViewModel.kt': [1, 'tutor library dates'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/chat/ChatLogic.kt': [1, 'chat day groups'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/chat/ChatViewModel.kt': [1, 'chat "Today" message pick'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/settings/SettingsViewModel.kt': [1, 'the backup file name'],
  'android-lab/app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/cardcontrols/ForgetLeechSheets.kt': [1, 'a date label\'s year'],
  'android-lab/core/src/main/kotlin/dev/jeromeswannack/chineselearning/lab/core/Homework.kt': [1, 'localDate(today) — callers pass StudyDayClock.today()'],
  'android-lab/core/src/main/kotlin/dev/jeromeswannack/chineselearning/lab/core/JsCompat.kt': [1, 'parsing a bare date string'],
};

const SCAN: Array<[string, RegExp, RegExp[]]> = [
  ['frontend/src', /\.tsx?$/, TS_PATTERNS],
  ['shared', /\.ts$/, TS_PATTERNS],
  ['worker/src', /\.ts$/, TS_PATTERNS],
  ['mcp-server/src', /\.ts$/, TS_PATTERNS],
  ['android-lab/app/src/main', /\.kt$/, KT_PATTERNS],
  ['android-lab/core/src/main', /\.kt$/, KT_PATTERNS],
];

function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '__tests__' || name === 'test' || name === 'build' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

describe('no raw-midnight "today" in study code', () => {
  it('every match is in the allow-list (study data goes through the study day)', () => {
    const found = new Map<string, string[]>();
    for (const [dir, ext, patterns] of SCAN) {
      const files: string[] = [];
      walk(join(ROOT, dir), files);
      for (const file of files) {
        if (!ext.test(file) || /\.test\.tsx?$/.test(file) || /\.spec\.tsx?$/.test(file) || /app-html\.ts$/.test(file)) continue;
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (isComment(line)) return;
          if (patterns.some((re) => re.test(line))) {
            const rel = relative(ROOT, file).split('\\').join('/');
            const list = found.get(rel) ?? [];
            list.push(`${rel}:${i + 1}: ${line.trim()}`);
            found.set(rel, list);
          }
        });
      }
    }
    const problems: string[] = [];
    for (const [file, hits] of found) {
      const allowed = ALLOWED[file]?.[0] ?? 0;
      if (hits.length > allowed) problems.push(...hits);
    }
    expect(problems, `A plain calendar / UTC "today" — use the study day (shared/study/studyDay.ts) or allow-list it with a reason:\n${problems.join('\n')}`).toEqual([]);
  });
});
