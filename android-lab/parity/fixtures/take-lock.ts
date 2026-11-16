/**
 * Golden vectors for the take lock (shared/voice/takeLock.ts, docs/STUDY_SESSION.md "While a take is
 * recording"): every phase → lock phase / locked / footer / guard, merges of several takes, and the words.
 * Writes take-lock.json; checked by core/…/TakeLockParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeTakePhases, takeFooter, takeGuard, takeLocked, takeLockPhase,
  TAKE_CHECKING, TAKE_LOCKED_HINT, TAKE_STOP_RECORDING,
} from '../../../shared/voice/takeLock';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const PHASES = [
  'idle', 'listening', 'recording', 'starting', 'finishing', 'checking', 'transcribing',
  'review', 'editing', 'failed', 'done', '', ' listening ', 'LISTENING', 'stop',
];

const single = PHASES.map((phase) => ({
  phase,
  lock: takeLockPhase(phase),
  locked: takeLocked(phase),
  footer: takeFooter(phase),
  guard: takeGuard(phase),
}));

// Merges: every pair and a few triples (seeded walk over the list, no randomness needed).
const merges: { phases: string[]; merged: string }[] = [{ phases: [], merged: mergeTakePhases([]) }];
for (let i = 0; i < PHASES.length; i++) {
  for (let j = i; j < PHASES.length; j += 3) {
    const phases = [PHASES[i], PHASES[j]];
    merges.push({ phases, merged: mergeTakePhases(phases) });
    const triple = [PHASES[j], PHASES[(i + j) % PHASES.length], PHASES[i]];
    merges.push({ phases: triple, merged: mergeTakePhases(triple) });
  }
}

writeFileSync(join(OUT, 'take-lock.json'), JSON.stringify({
  single,
  merges,
  copy: { stop: TAKE_STOP_RECORDING, checking: TAKE_CHECKING, hint: TAKE_LOCKED_HINT },
}, null, 1));
