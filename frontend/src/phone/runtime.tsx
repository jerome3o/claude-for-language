/**
 * The simulated phone's runtime (docs/PHONE_PRACTICE.md): one React context holding the
 * scenario, its EVENT LOG (the only state that matters — records, persona chats, SMS; checked by
 * shared/phone/engine.ts), the per-app navigation stacks (screens stay mounted under the top one,
 * like a native nav stack, so a form keeps its fields while a picker is open), app-level UI
 * state, notifications / toasts, the shared pay sheet, and the clock.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { phoneClock, seedEvents, type PhoneAppId, type PhoneEvent, type PhoneSimpleEvent, type ScenarioSpec } from '@shared/phone';
import { nextRecordId } from '@shared/phone/world';
import type { PayMethod } from '@shared/phone/wallet';

export interface Screen {
  key: string;
  name: string;
  params: Record<string, unknown>;
}

export interface PhoneNotification {
  id: string;
  app: PhoneAppId;
  title: string;
  body: string;
  at: number;
  /** Tap → this app (and screen). */
  open?: { app: PhoneAppId; screen?: string; params?: Record<string, unknown> };
}

export interface PayRequest {
  app: PhoneAppId;
  /** The order line on the sheet (G7311 二等座 1张). */
  title: string;
  /** Who gets the money (铁路出行). */
  payee: string;
  amount: number;
}

export interface PayResult {
  method: PayMethod;
  payment_id: string;
}

interface PendingPay extends PayRequest {
  resolve: (r: PayResult | null) => void;
}

export interface PhoneApi {
  spec: ScenarioSpec;
  events: PhoneEvent[];
  startedAt: number;
  /** Simulated date + time. */
  clock: { date: string; time: string };
  emit: (e: Omit<PhoneSimpleEvent, 'at'>) => void;
  /** Write (or update) a record: the latest version is what goals see. */
  write: (record: string, id: string, data: Record<string, unknown>) => void;
  newId: (record: string, prefix: string) => string;

  current: PhoneAppId | null;
  stacks: Partial<Record<PhoneAppId, Screen[]>>;
  /** Apps opened this play, most recent first (the recents switcher). */
  recents: PhoneAppId[];
  openApp: (app: PhoneAppId, screen?: string, params?: Record<string, unknown>) => void;
  goHome: () => void;
  push: (app: PhoneAppId, name: string, params?: Record<string, unknown>) => void;
  pop: (app: PhoneAppId) => void;
  /** Replace the stack with [root, …screens] (after an order: the order page with back → home). */
  resetTo: (app: PhoneAppId, screens: Array<{ name: string; params?: Record<string, unknown> }>) => void;
  /** System back: an open sheet first (registered with useBackHandler), else the app's stack, else home. */
  back: () => boolean;
  registerBack: (fn: () => boolean) => () => void;

  notifications: PhoneNotification[];
  notify: (n: Omit<PhoneNotification, 'id' | 'at'>) => void;
  dismissNotification: (id: string) => void;
  sms: (from: string, text: string, open?: PhoneNotification['open']) => void;

  toastText: string | null;
  toast: (text: string) => void;

  payRequest: PendingPay | null;
  pay: (req: PayRequest) => Promise<PayResult | null>;
  finishPay: (r: PayResult | null) => void;

  /** App-level UI state (search forms, carts): survives screen changes and app switches. */
  getState: <T>(app: PhoneAppId, key: string, init: T) => T;
  setState: <T>(app: PhoneAppId, key: string, value: T | ((prev: T) => T)) => void;

  online: boolean;
}

const Ctx = createContext<PhoneApi | null>(null);

export function usePhone(): PhoneApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePhone outside PhoneProvider');
  return v;
}

let keySeq = 0;
const screenKey = () => `s${++keySeq}`;

export function PhoneProvider(props: {
  spec: ScenarioSpec;
  startedAt: number;
  initialEvents?: PhoneEvent[];
  online: boolean;
  onEvents?: (events: PhoneEvent[]) => void;
  children: ReactNode;
}) {
  const { spec } = props;
  const [events, setEvents] = useState<PhoneEvent[]>(() => (props.initialEvents && props.initialEvents.length ? props.initialEvents : seedEvents(spec, props.startedAt)));
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [stacks, setStacks] = useState<Partial<Record<PhoneAppId, Screen[]>>>({});
  const [current, setCurrent] = useState<PhoneAppId | null>(null);
  const [recents, setRecents] = useState<PhoneAppId[]>([]);
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  const [toastText, setToastText] = useState<string | null>(null);
  const [payRequest, setPayRequest] = useState<PendingPay | null>(null);
  const [appState, setAppState] = useState<Record<string, unknown>>({});
  const [now, setNow] = useState(() => Date.now());
  const backHandlers = useRef<Array<() => boolean>>([]);
  const onEvents = useRef(props.onEvents);
  onEvents.current = props.onEvents;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const append = useCallback((e: PhoneEvent) => {
    setEvents((prev) => {
      const next = [...prev, e];
      eventsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    onEvents.current?.(events);
  }, [events]);

  const emit = useCallback((e: Omit<PhoneSimpleEvent, 'at'>) => append({ ...e, at: Date.now() } as PhoneEvent), [append]);
  const write = useCallback((record: string, id: string, data: Record<string, unknown>) => append({ type: 'record', record, id, data, at: Date.now() }), [append]);
  const newId = useCallback((record: string, prefix: string) => nextRecordId(eventsRef.current, record, prefix), []);

  const openApp = useCallback((app: PhoneAppId, screen?: string, params?: Record<string, unknown>) => {
    setStacks((s) => {
      const stack = s[app] ?? [{ key: screenKey(), name: 'home', params: {} }];
      if (!screen) return { ...s, [app]: stack };
      const root = stack[0];
      return { ...s, [app]: screen === 'home' ? [root] : [root, { key: screenKey(), name: screen, params: params ?? {} }] };
    });
    setCurrent(app);
    setRecents((r) => [app, ...r.filter((x) => x !== app)]);
    append({ type: 'app.open', app, at: Date.now() });
  }, [append]);

  const goHome = useCallback(() => setCurrent(null), []);

  const push = useCallback((app: PhoneAppId, name: string, params?: Record<string, unknown>) => {
    setStacks((s) => ({ ...s, [app]: [...(s[app] ?? [{ key: screenKey(), name: 'home', params: {} }]), { key: screenKey(), name, params: params ?? {} }] }));
  }, []);

  const pop = useCallback((app: PhoneAppId) => {
    setStacks((s) => {
      const stack = s[app] ?? [];
      return stack.length > 1 ? { ...s, [app]: stack.slice(0, -1) } : s;
    });
  }, []);

  const resetTo = useCallback((app: PhoneAppId, screens: Array<{ name: string; params?: Record<string, unknown> }>) => {
    setStacks((s) => {
      const root = (s[app] ?? [])[0] ?? { key: screenKey(), name: 'home', params: {} };
      return { ...s, [app]: [root, ...screens.map((x) => ({ key: screenKey(), name: x.name, params: x.params ?? {} }))] };
    });
  }, []);

  const stacksRef = useRef(stacks);
  stacksRef.current = stacks;
  const currentRef = useRef(current);
  currentRef.current = current;

  const back = useCallback((): boolean => {
    const handlers = backHandlers.current;
    for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return true;
    const app = currentRef.current;
    if (!app) return false;
    const stack = stacksRef.current[app] ?? [];
    if (stack.length > 1) pop(app);
    else setCurrent(null);
    return true;
  }, [pop]);

  const registerBack = useCallback((fn: () => boolean) => {
    backHandlers.current.push(fn);
    return () => {
      backHandlers.current = backHandlers.current.filter((f) => f !== fn);
    };
  }, []);

  const notify = useCallback((n: Omit<PhoneNotification, 'id' | 'at'>) => {
    const item = { ...n, id: `n${++keySeq}`, at: Date.now() };
    setNotifications((list) => [item, ...list].slice(0, 4));
    window.setTimeout(() => setNotifications((list) => list.filter((x) => x.id !== item.id)), 4500);
  }, []);

  const dismissNotification = useCallback((id: string) => setNotifications((list) => list.filter((x) => x.id !== id)), []);

  const sms = useCallback((from: string, text: string, open?: PhoneNotification['open']) => {
    append({ type: 'sms', from, text, at: Date.now() } as PhoneEvent);
    notify({ app: 'sms', title: from, body: text, open: open ?? { app: 'sms' } });
  }, [append, notify]);

  const toastTimer = useRef<number | null>(null);
  const toast = useCallback((text: string) => {
    setToastText(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(null), 2200);
  }, []);

  const pay = useCallback((req: PayRequest) => new Promise<PayResult | null>((resolve) => setPayRequest({ ...req, resolve })), []);
  const finishPay = useCallback((r: PayResult | null) => {
    setPayRequest((p) => {
      p?.resolve(r);
      return null;
    });
  }, []);

  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  const getState = useCallback(<T,>(app: PhoneAppId, key: string, init: T): T => {
    const k = `${app}:${key}`;
    return (k in appStateRef.current ? appStateRef.current[k] : init) as T;
  }, []);
  const setStateFn = useCallback(<T,>(app: PhoneAppId, key: string, value: T | ((prev: T) => T)) => {
    const k = `${app}:${key}`;
    setAppState((s) => {
      const prev = s[k] as T;
      const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
      const out = { ...s, [k]: next };
      appStateRef.current = out;
      return out;
    });
  }, []);

  const clock = useMemo(() => {
    const c = phoneClock(spec, props.startedAt, now);
    return { date: c.date, time: c.time };
  }, [spec, props.startedAt, now]);

  const api: PhoneApi = {
    spec,
    events,
    startedAt: props.startedAt,
    clock,
    emit,
    write,
    newId,
    current,
    stacks,
    recents,
    openApp,
    goHome,
    push,
    pop,
    resetTo,
    back,
    registerBack,
    notifications,
    notify,
    dismissNotification,
    sms,
    toastText,
    toast,
    payRequest,
    pay,
    finishPay,
    getState,
    setState: setStateFn,
    online: props.online,
  };
  // appState is read through getState; listing it keeps consumers re-rendering on change.
  void appState;
  return <Ctx.Provider value={api}>{props.children}</Ctx.Provider>;
}

/** An app's own navigation. */
export function useAppNav(app: PhoneAppId) {
  const p = usePhone();
  return {
    push: (name: string, params?: Record<string, unknown>) => p.push(app, name, params),
    pop: () => p.pop(app),
    resetTo: (screens: Array<{ name: string; params?: Record<string, unknown> }>) => p.resetTo(app, screens),
    home: () => p.resetTo(app, []),
  };
}

/** App-level state as a [value, set] pair. */
export function useAppState<T>(app: PhoneAppId, key: string, init: T): [T, (v: T | ((prev: T) => T)) => void] {
  const p = usePhone();
  const value = p.getState<T>(app, key, init);
  const set = useCallback((v: T | ((prev: T) => T)) => p.setState<T>(app, key, (prev) => (typeof v === 'function' ? (v as (x: T) => T)(prev === undefined ? init : prev) : v)), [p, app, key, init]);
  return [value, set];
}

/** While `active`, system back calls `onBack` first (a sheet closes instead of the screen). */
export function useBackHandler(active: boolean, onBack: () => void) {
  const { registerBack } = usePhone();
  const fn = useRef(onBack);
  fn.current = onBack;
  useEffect(() => {
    if (!active) return;
    return registerBack(() => {
      fn.current();
      return true;
    });
  }, [active, registerBack]);
}
