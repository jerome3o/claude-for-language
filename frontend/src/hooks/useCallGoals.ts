/**
 * 🎯 Structures to use in the call (shared/calls/goals.ts, docs/VIDEO_CALLS.md "Structures to use"):
 * the student's device side of auto-ticking.
 *
 * Only on the STUDENT's own device (the list's `student_id`), only while the call is live, a goal is
 * still open and his mic is on: `CallGoalListener` streams his mic to Soniox and every finished
 * utterance holding a goal's words in order (`goalsHeardIn`) is sent to the room as `heard` (both
 * screens show "✓ checking…"). Every goal in `checking` with HIS sentence then gets one model check
 * (`POST /api/calls/:id/goals/check`) → `checked` (✓, or back to a near miss). A check that can't
 * answer (offline, 503) counts the words' match. Never the tutor's voice: her device never listens,
 * and the room refuses `heard` from anyone but the student.
 *
 * E2E seam: a page with `window.__callGoalsTest = true` doesn't open Soniox; the spec says lines with
 * `window.__callGoalsSay(text)` (a stand-in transcript feed).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { goalListenStatus, goalsHeardIn, type CallGoals, type CallGoalsAction, type GoalListenStatus } from '@shared/calls';
import { CallGoalListener, type GoalListenerState } from '../services/calls/goalListener';
import { checkCallGoal } from '../api/calls';
import { getCallListenSession } from '../api/client';
import { track } from '../services/analytics';

type TestWindow = Window & { __callGoalsTest?: boolean; __callGoalsSay?: (text: string) => void };
const testMode = () => typeof window !== 'undefined' && (window as TestWindow).__callGoalsTest === true;

export interface UseCallGoalsInput {
  callId: string;
  live: boolean;
  myUserId: string;
  goals: CallGoals | null;
  goalsAction: (a: CallGoalsAction) => boolean;
  micOn: boolean;
  micTrack: MediaStreamTrack | null;
}

export function useCallGoals(o: UseCallGoalsInput): { isStudent: boolean; listenStatus: GoalListenStatus } {
  const isStudent = !!o.goals?.student_id && o.goals.student_id === o.myUserId;
  const [listenerState, setListenerState] = useState<GoalListenerState>('idle');
  const goalsRef = useRef(o.goals);
  goalsRef.current = o.goals;
  const actionRef = useRef(o.goalsAction);
  actionRef.current = o.goalsAction;

  const listenStatus = goalListenStatus({
    live: o.live,
    isStudent,
    goals: o.goals,
    micOn: o.micOn,
    hasMic: !!o.micTrack,
    unavailable: listenerState === 'unavailable',
  });
  const shouldListen = o.live && isStudent && o.micOn && !!o.micTrack && (listenStatus === 'listening' || listenStatus === 'unavailable');

  /** A finished utterance of his: the goals it holds go to the room as `heard`. */
  const onUtterance = useCallback((text: string) => {
    const goals = goalsRef.current;
    if (!goals) return;
    for (const g of goalsHeardIn(text, goals.goals).slice(0, 2)) actionRef.current({ kind: 'heard', id: g.id, text });
  }, []);

  // The listener: one per page, started / stopped with the conditions above.
  const listenerRef = useRef<CallGoalListener | null>(null);
  useEffect(() => {
    if (testMode()) {
      (window as TestWindow).__callGoalsSay = onUtterance;
      return;
    }
    const listener = new CallGoalListener({
      getSession: getCallListenSession,
      onUtterance,
      onState: (state, reason) => {
        setListenerState(state);
        if (state === 'unavailable' || state === 'listening') track('call.goals_listen', { state, reason: reason ? reason.replace(/[^a-z0-9_]+/gi, '_').slice(0, 24) : null });
      },
    });
    listenerRef.current = listener;
    return () => {
      listener.stop();
      listenerRef.current = null;
    };
  }, [onUtterance]);
  useEffect(() => {
    const l = listenerRef.current;
    if (!l) return;
    if (shouldListen && o.micTrack) l.start(o.micTrack);
    else l.stop();
  }, [shouldListen, o.micTrack]);

  // Every goal being checked with my sentence: one check each (a rejoin re-checks one left hanging).
  const checkedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!isStudent || !o.live || !o.goals) return;
    for (const g of o.goals.goals) {
      if (g.status !== 'checking' || !g.checking) continue;
      const text = g.checking.text;
      const key = `${g.id}\u0000${text}`;
      if (checkedRef.current.has(key)) continue;
      checkedRef.current.add(key);
      const started = Date.now();
      checkCallGoal(o.callId, { name: g.name, line: g.line, meaning: g.meaning, fixed: g.fixed, sentence: text })
        .then((r) => {
          track('call.goals_check', { ok: r.ok, cached: !!r.cached, answered: true, ms: Date.now() - started });
          actionRef.current({ kind: 'checked', id: g.id, text, ok: r.ok });
        })
        .catch(() => {
          // No answer (offline, no model): the words matched in order — count it.
          track('call.goals_check', { ok: true, cached: false, answered: false, ms: Date.now() - started });
          actionRef.current({ kind: 'checked', id: g.id, text, ok: true });
        });
    }
  }, [isStudent, o.live, o.goals, o.callId]);

  return { isStudent, listenStatus: testMode() && listenStatus === 'unavailable' ? 'listening' : listenStatus };
}
