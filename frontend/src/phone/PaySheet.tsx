/**
 * The one pay sheet every simulated app opens (安付钱包): the amount and payee, 付款方式 (零钱
 * or a bank card — 零钱 that doesn't cover it is greyed "余额不足"), the six-digit 支付密码 on a
 * number pad (5 tries), then 支付成功. A payment is a `payment` record in the log (balances
 * are derived from those, shared/phone/wallet.ts); a wrong password is an `error` event (a slip).
 */
import { useEffect, useState } from 'react';
import { PHONE_APPS, ZH } from '@shared/phone/copy';
import { yuan2 } from '@shared/phone/dates';
import { canPay, defaultMethod, MAX_PASSWORD_TRIES, methodLabel, walletBalances, type PayMethod } from '@shared/phone/wallet';
import { useBackHandler, usePhone } from './runtime';

type Step = 'confirm' | 'methods' | 'password' | 'processing' | 'success';

export function PaySheet() {
  const p = usePhone();
  const req = p.payRequest;
  const [step, setStep] = useState<Step>('confirm');
  const [method, setMethod] = useState<PayMethod>('balance');
  const [digits, setDigits] = useState('');
  const [fails, setFails] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState('');

  useEffect(() => {
    if (!req) return;
    setStep('confirm');
    setDigits('');
    setFails(0);
    setError(null);
    setMethod(defaultMethod(p.spec.wallet, p.events, req.amount));
    // A new request only (not every event).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  useBackHandler(!!req && step !== 'processing', () => {
    if (step === 'methods') setStep('confirm');
    else if (step === 'success') done();
    else p.finishPay(null);
  });

  if (!req) return null;
  const wallet = p.spec.wallet;
  const balances = walletBalances(wallet, p.events);
  const enough = canPay(wallet, p.events, method, req.amount);

  function done() {
    p.finishPay({ method, payment_id: paymentId });
  }

  function press(key: string) {
    if (step !== 'password') return;
    setError(null);
    if (key === 'del') {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    const next = (digits + key).slice(0, 6);
    setDigits(next);
    if (next.length < 6) return;
    window.setTimeout(() => {
      if (next !== wallet.pay_password) {
        const n = fails + 1;
        setFails(n);
        setDigits('');
        p.emit({ type: 'error', code: 'pay_password', app: req!.app });
        if (n >= MAX_PASSWORD_TRIES) {
          p.toast(ZH.locked);
          p.finishPay(null);
          return;
        }
        setError(ZH.wrongPassword(MAX_PASSWORD_TRIES - n));
        return;
      }
      setStep('processing');
      const id = p.newId('payment', 'P');
      setPaymentId(id);
      window.setTimeout(() => {
        p.write('payment', id, { app: req!.app, title: req!.title, payee: req!.payee, amount: req!.amount, method, direction: 'out', status: 'paid' });
        setStep('success');
      }, 700);
    }, 120);
  }

  return (
    <div className="ph-pay-scrim" data-testid="pay-sheet">
      <div className="ph-pay">
        {step !== 'success' && step !== 'processing' && (
          <div className="ph-pay-head">
            <button type="button" className="ph-pay-x" aria-label={ZH.cancel} onClick={() => (step === 'methods' ? setStep('confirm') : p.finishPay(null))}>
              {step === 'methods' ? '‹' : '✕'}
            </button>
            <span>{step === 'methods' ? '选择付款方式' : step === 'password' ? ZH.enterPassword : '确认付款'}</span>
            <span />
          </div>
        )}
        {(step === 'confirm' || step === 'password') && (
          <>
            <div className="ph-pay-payee">{req.payee}</div>
            <div className="ph-pay-amount" data-testid="pay-amount">
              <small>¥</small>
              {yuan2(req.amount)}
            </div>
            <div className="ph-pay-title">{req.title}</div>
            <button type="button" className="ph-pay-method" onClick={() => step === 'confirm' && setStep('methods')} data-testid="pay-method">
              <span>{ZH.payMethod}</span>
              <span className={enough ? '' : 'ph-pay-short'}>
                {methodLabel(wallet, method)}
                {!enough && ' · 余额不足'} ›
              </span>
            </button>
          </>
        )}
        {step === 'confirm' && (
          <button
            type="button"
            className="ph-pay-go"
            data-testid="pay-confirm"
            onClick={() => {
              if (!enough) {
                p.toast(ZH.insufficient);
                setStep('methods');
                return;
              }
              setStep('password');
            }}
          >
            {ZH.payNow}
          </button>
        )}
        {step === 'methods' && (
          <div className="ph-pay-methods">
            {[{ id: 'balance', label: `零钱（剩余¥${yuan2(balances.balance)}）` }, ...wallet.cards.map((c) => ({ id: c.id, label: `${c.bank}${c.kind}（${c.last4}）` }))].map((m) => {
              const ok = canPay(wallet, p.events, m.id, req.amount);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`ph-pay-mrow${method === m.id ? ' on' : ''}`}
                  disabled={!ok}
                  data-testid={`pay-method-${m.id}`}
                  onClick={() => {
                    setMethod(m.id);
                    setStep('confirm');
                  }}
                >
                  <span>{m.id === 'balance' ? '💰' : '💳'}</span>
                  <span className="ph-pay-mlabel">
                    {m.label}
                    {!ok && <small>余额不足</small>}
                  </span>
                  <span>{method === m.id ? '✓' : ''}</span>
                </button>
              );
            })}
            <button type="button" className="ph-pay-mrow" onClick={() => p.toast(ZH.notOpen)}>
              <span>＋</span>
              <span className="ph-pay-mlabel">添加银行卡</span>
              <span />
            </button>
          </div>
        )}
        {step === 'password' && (
          <>
            <div className="ph-pay-dots" data-testid="pay-dots">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={i < digits.length ? 'on' : ''} />
              ))}
            </div>
            {error ? (
              <div className="ph-pay-error" data-testid="pay-error">
                {error}
              </div>
            ) : (
              <button type="button" className="ph-pay-forgot" onClick={() => p.toast('请在“安付钱包 → 我的 → 支付设置”中找回')}>
                {ZH.forgotPassword}
              </button>
            )}
            <div className="ph-keypad" data-testid="pay-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) =>
                k ? (
                  <button key={i} type="button" onClick={() => press(k)} aria-label={k === 'del' ? '删除' : k} data-testid={`key-${k}`}>
                    {k === 'del' ? '⌫' : k}
                  </button>
                ) : (
                  <span key={i} />
                ),
              )}
            </div>
          </>
        )}
        {step === 'processing' && <div className="ph-pay-processing">支付中…</div>}
        {step === 'success' && (
          <div className="ph-pay-success" data-testid="pay-success">
            <div className="ph-pay-check">✓</div>
            <div>{ZH.paySuccess}</div>
            <div className="ph-pay-amount">
              <small>¥</small>
              {yuan2(req.amount)}
            </div>
            <div className="ph-pay-title">
              {req.payee} · {PHONE_APPS.wallet.name}
            </div>
            <button type="button" className="ph-pay-go" onClick={done} data-testid="pay-done">
              {ZH.done}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
