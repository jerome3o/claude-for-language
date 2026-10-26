/**
 * The phone's own apps: 信息 (SMS — 验证码 and order texts the other apps send, with the
 * "复制验证码" chip phones offer) and 安付钱包 (a fictional wallet: 零钱, cards, 账单, 付款码).
 */
import { useMemo, useState } from 'react';
import { ZH } from '@shared/phone';
import { yuan2 } from '@shared/phone/dates';
import { recordsOf } from '@shared/phone/engine';
import { walletBalances } from '@shared/phone/wallet';
import { useAppNav, usePhone, type Screen } from '../runtime';
import { AppBar, Body, Cell, Empty, Group } from '../ui';

export function SmsApp({ screen }: { screen: Screen }) {
  const p = usePhone();
  const nav = useAppNav('sms');
  const msgs = useMemo(() => p.events.filter((e) => e.type === 'sms').map((e) => ({ from: String(e.from), text: String(e.text), at: e.at })), [p.events]);
  const senders = [...new Set(msgs.map((m) => m.from))].reverse();
  if (screen.name === 'thread') {
    const from = String(screen.params.from);
    return (
      <div className="ph-col sms" data-testid="sms-thread">
        <AppBar title={from} onBack={nav.pop} />
        <Body className="sms-thread">
          {msgs
            .filter((m) => m.from === from)
            .map((m, i) => {
              const code = /验证码为?(\d{4,6})/.exec(m.text)?.[1];
              return (
                <div key={i} className="sms-msg">
                  <div className="sms-bubble" data-testid="sms-text">
                    {m.text}
                  </div>
                  {code && (
                    <button type="button" className="sms-copy" data-testid="sms-copy-code" onClick={() => {
                      void navigator.clipboard?.writeText(code).catch(() => undefined);
                      p.toast('已复制验证码');
                    }}>
                      复制验证码 {code}
                    </button>
                  )}
                </div>
              );
            })}
        </Body>
      </div>
    );
  }
  return (
    <div className="ph-col sms" data-testid="sms-home">
      <AppBar title="信息" />
      <Body>
        {senders.length === 0 ? (
          <Empty icon="✉️" text="暂无信息" />
        ) : (
          senders.map((from) => {
            const last = [...msgs].reverse().find((m) => m.from === from)!;
            return (
              <button key={from} type="button" className="sms-row" onClick={() => nav.push('thread', { from })} data-testid="sms-row">
                <span className="sms-av">✉</span>
                <span>
                  <b>{from}</b>
                  <small>{last.text}</small>
                </span>
              </button>
            );
          })
        )}
      </Body>
    </div>
  );
}

export function WalletApp() {
  const p = usePhone();
  const [code, setCode] = useState(false);
  const b = walletBalances(p.spec.wallet, p.events);
  const bills = recordsOf(p.events, 'payment').reverse();
  return (
    <div className="ph-col wallet" data-testid="wallet-home">
      <AppBar title="安付钱包" />
      <Body>
        <div className="wallet-card">
          <small>零钱（元）</small>
          <b data-testid="wallet-balance">{yuan2(b.balance)}</b>
          <span className="wallet-actions">
            <button type="button" onClick={() => p.toast(ZH.notOpen)}>充值</button>
            <button type="button" onClick={() => p.toast(ZH.notOpen)}>提现</button>
            <button type="button" onClick={() => setCode((v) => !v)} data-testid="wallet-paycode">付款码</button>
          </span>
        </div>
        {code && (
          <div className="wallet-code" data-testid="wallet-code">
            <div className="wallet-barcode" aria-hidden>
              {Array.from({ length: 48 }, (_, i) => (
                <i key={i} style={{ width: `${1 + ((i * 7) % 3)}px` }} />
              ))}
            </div>
            <small>向商家出示付款码 · 每分钟自动更新</small>
          </div>
        )}
        <Group title="银行卡">
          {p.spec.wallet.cards.map((c) => (
            <Cell key={c.id} icon="💳" label={`${c.bank} ${c.kind}`} sub={`尾号 ${c.last4}`} />
          ))}
        </Group>
        <Group title="账单">
          {bills.length === 0 ? (
            <Empty icon="🧾" text="本月暂无交易" />
          ) : (
            bills.map((r) => (
              <Cell key={r.id} label={String(r.data.title)} sub={String(r.data.payee ?? '')} value={<span className={r.data.direction === 'in' ? 'wallet-in' : ''}>{r.data.direction === 'in' ? '+' : '-'}{yuan2(Number(r.data.amount))}</span>} />
            ))
          )}
        </Group>
      </Body>
    </div>
  );
}
