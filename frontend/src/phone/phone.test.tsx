/**
 * 📱 Phone practice components: long-press word lookup (pure part), and a whole task in the real
 * shell — 微聊 → 小林 → ⊕ → 转账 ¥86 → the pay sheet (a wrong password first, then the right one)
 * → the engine says the task is complete.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { bundledScenario, isComplete, recordsOf, type PhoneEvent } from '@shared/phone';
import { itemAt } from './longPress';
import { PhoneProvider } from './runtime';
import { PhoneShell } from './PhoneShell';

vi.mock('../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

function click(testId: string, within: ParentNode = document) {
  const el = within.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no ${testId}`);
  act(() => el.click());
}

describe('long-press lookup', () => {
  it('picks the word under the finger from the segments, or the character', () => {
    const segs = [{ text: '查询', pinyin: 'cháxún' }, { text: '车票', pinyin: 'chēpiào' }];
    expect(itemAt('查询车票', 3, segs)).toMatchObject({ kind: 'word', hanzi: '车票', pinyin: 'chēpiào' });
    expect(itemAt('查询车票', 0, null)).toEqual({ kind: 'char', char: '查' });
    // The caret just after the last character still finds it.
    expect(itemAt('车票', 2, null)).toMatchObject({ kind: 'char', char: '票' });
    expect(itemAt('G7311', 2, null)).toBeNull();
  });
});

describe('a task in the shell', () => {
  it('pays a friend back by 转账 and completes chat-pay-back', async () => {
    const spec = bundledScenario('chat-pay-back')!;
    let events: PhoneEvent[] = [];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <PhoneProvider spec={spec} startedAt={Date.now()} online onEvents={(e) => (events = e)}>
          <PhoneShell onWord={() => {}} onTask={() => {}} onHint={() => {}} />
        </PhoneProvider>,
      ),
    );
    expect(host.querySelector('[data-testid="phone-home"]')?.textContent).toContain('铁路出行');

    click('home-app-chat');
    const row = host.querySelector('[data-testid="chat-row"][data-contact="xiaolin"]') as HTMLElement;
    act(() => row.click());
    expect(host.querySelector('[data-testid="chat-window"]')?.textContent).toContain('你的那份是86');
    click('chat-panel-toggle');
    click('chat-panel-转账');
    click('amount-8');
    click('amount-6');
    expect(host.querySelector('[data-testid="money-amount"]')?.textContent).toContain('86');
    click('money-submit');
    expect(host.querySelector('[data-testid="pay-amount"]')?.textContent).toContain('86.00');
    click('pay-confirm');

    for (const d of '111111') click(`key-${d}`);
    await wait(200);
    expect(host.querySelector('[data-testid="pay-error"]')?.textContent).toContain('支付密码错误');
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);

    for (const d of spec.wallet.pay_password) click(`key-${d}`);
    await wait(1000);
    expect(host.querySelector('[data-testid="pay-success"]')).not.toBeNull();
    click('pay-done');
    await wait(50);

    expect(recordsOf(events, 'transfer').map((r) => r.data)).toEqual([expect.objectContaining({ to_id: 'xiaolin', amount: 86, kind: 'transfer' })]);
    expect(isComplete(spec, events)).toBe(true);
    expect(host.querySelector('[data-testid="chat-transfer-bubble"]')?.textContent).toContain('86.00');
  });
});
