/**
 * Golden vectors for the take lock (shared/voice/takeLock.ts): every phase from the recorder flags, combinations of
 * several takes, the footer / may-proceed / leave rules per phase, and the copy. Writes take-lock.json; checked by
 * core/…/TakeLockParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  combineTakePhases, takeLockFooter, takeLockLeave, takeLockMayProceed, takePhase, TAKE_PHASES, TAKE_LOCK_CHECKING, TAKE_LOCK_STOP,
  type TakePhase,
} from '../../../shared/voice/takeLock';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: take-lock <out-dir>');
mkdirSync(OUT, { recursive: true });

const flags = [false, true].flatMap(recording => [false, true].map(checking => ({ recording, checking, phase: takePhase(recording, checking) })));
const lists: TakePhase[][] = [[], ['idle'], ['checking'], ['recording'], ['idle', 'checking'], ['checking', 'idle', 'idle'], ['idle', 'recording', 'checking'], ['checking', 'checking'], ['recording', 'recording']];
const combined = lists.map(phases => ({ phases, phase: combineTakePhases(phases) }));
const rules = TAKE_PHASES.map(phase => ({ phase, footer: takeLockFooter(phase), mayProceed: takeLockMayProceed(phase), leave: takeLockLeave(phase) }));

writeFileSync(join(OUT, 'take-lock.json'), JSON.stringify({
  copy: { stop: TAKE_LOCK_STOP, checking: TAKE_LOCK_CHECKING },
  phases: TAKE_PHASES, flags, combined, rules,
}, null, 1));
