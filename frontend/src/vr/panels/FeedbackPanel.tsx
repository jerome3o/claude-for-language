/**
 * 💬 Feedback in VR: the screenshot taken as the window opened (what you were looking at), a
 * message said with 🎤 (or picked from quick chips), Send. No keyboard needed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { UiNode } from '../ui/layout';
import type { PanelHostProps } from './types';

export const FEEDBACK_SHOT_KEY = 'vr-feedback-shot';

export const FEEDBACK_CHIPS = ['Hard to read', 'Too far away', 'Something broke', 'I love this', 'Idea'] as const;

export type FeedbackStatus = 'editing' | 'sending' | 'sent' | 'queued' | 'failed';

export interface FeedbackViewInput {
  hasShot: boolean;
  message: string;
  chips: readonly string[];
  status: FeedbackStatus;
  listening: boolean;
  online: boolean;
}

export function feedbackView(s: FeedbackViewInput): UiNode[] {
  if (s.status === 'sent' || s.status === 'queued') {
    return [
      { t: 'spacer', h: 20 },
      { t: 'text', text: s.status === 'sent' ? '✓ Thanks — feedback sent' : '✓ Saved — it goes when you’re back online', size: 40, weight: 700, color: 'good', align: 'center' },
      { t: 'button', label: 'Close', action: 'close', tone: 'plain' },
    ];
  }
  const nodes: UiNode[] = [];
  if (s.hasShot) nodes.push({ t: 'image', key: FEEDBACK_SHOT_KEY, height: 300 }, { t: 'text', text: '📷 Screenshot of what you were looking at', size: 22, color: 'muted', align: 'center' });
  nodes.push({ t: 'text', text: s.message ? `“${s.message}”` : 'Say what you noticed with 🎤, or pick:', size: s.message ? 30 : 26, color: s.message ? 'ink' : 'muted' });
  nodes.push({ t: 'row', mode: 'wrap', children: FEEDBACK_CHIPS.map((c) => ({ t: 'button' as const, label: c, action: `chip:${c}`, tone: 'chip' as const, size: 24, selected: s.chips.includes(c) })) });
  if (s.status === 'failed') nodes.push({ t: 'text', text: 'Couldn’t send — try again.', color: 'bad', size: 26 });
  nodes.push({
    t: 'row',
    mode: 'fill',
    children: [
      { t: 'button', label: s.listening ? '■ Stop' : '🎤 Say it', action: 'speak', tone: 'plain', disabled: !s.online },
      { t: 'button', label: s.status === 'sending' ? 'Sending…' : 'Send', action: 'send', tone: 'primary', disabled: s.status === 'sending' || (!s.message && s.chips.length === 0 && !s.hasShot) },
    ],
  });
  return nodes;
}

export interface FeedbackPanelExtra {
  hasShot: boolean;
  listening: boolean;
  /** sent / queued (offline: the outbox sends it later) / failed. */
  send(message: string, kind: 'feedback' | 'bug'): Promise<'sent' | 'queued' | 'failed'>;
}

export function FeedbackPanel({ ctx, report, extra }: PanelHostProps<{ kind: 'feedback' }> & { extra: FeedbackPanelExtra }) {
  const [message, setMessage] = useState('');
  const [chips, setChips] = useState<string[]>([]);
  const [status, setStatus] = useState<FeedbackStatus>('editing');

  const view = useMemo(() => ({
    title: 'Feedback',
    nodes: feedbackView({ hasShot: extra.hasShot, message, chips, status, listening: extra.listening, online: ctx.online }),
  }), [extra.hasShot, extra.listening, message, chips, status, ctx.online]);

  const onAction = (action: string) => {
    if (action.startsWith('chip:')) {
      const c = action.slice(5);
      setChips((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
    } else if (action === 'speak') ctx.startSpeech();
    else if (action === 'close') ctx.close();
    else if (action === 'send' && status !== 'sending') {
      setStatus('sending');
      const text = [chips.length ? `[${chips.join(', ')}]` : '', message].filter(Boolean).join(' ');
      void extra.send(text, chips.includes('Something broke') ? 'bug' : 'feedback').then(setStatus);
    }
  };

  const onSpeech = (text: string): string | null => {
    const t = text.trim();
    if (!t) return null;
    setMessage((m) => (m ? `${m} ${t}` : t));
    if (status === 'failed') setStatus('editing');
    return 'feedback_message';
  };

  const latest = useRef({ onAction, onSpeech });
  latest.current = { onAction, onSpeech };
  useEffect(() => {
    report({ view, onAction: (a) => latest.current.onAction(a), onSpeech: (t) => latest.current.onSpeech(t) });
  }, [view, report]);
  return null;
}
