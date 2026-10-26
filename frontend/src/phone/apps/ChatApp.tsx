/**
 * 微聊 — a fictional messenger in the style of China's everyday chat app: the chat list, a chat
 * (text, 🎤 voice-to-text, ⊕ panel: 转账 / 红包 / 位置…), sending 转账 with a 转账说明, opening a
 * friend's 红包 (開), 扫一扫 a stall's 收款码 and paying, 发现 → 小程序 that open the other apps.
 * A contact with a persona answers (Claude role-play through usePersona); others don't.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PHONE_APPS, ZH, type ChatContact, type ChatQrCode, type ChatSeedMessage, type ChatWorld, type PhoneAppId } from '@shared/phone';
import { yuan2 } from '@shared/phone/dates';
import { recordsOf } from '@shared/phone/engine';
import { amountKey, parseAmount, transferProblem } from '@shared/phone/wallet';
import { useAppNav, useAppState, useBackHandler, usePhone, type Screen } from '../runtime';
import { usePersona } from '../persona';
import { AppBar, Body, Btn, Cell, Dialog, Group, PhoneMic } from '../ui';

const APP = 'chat' as const;

function useWorld(): ChatWorld {
  return usePhone().spec.world.chat ?? { me: { name: '我', id: 'me' }, contacts: [], threads: [] };
}

function contactOf(w: ChatWorld, id: string): ChatContact {
  return w.contacts.find((c) => c.id === id) ?? { id, name: id };
}

export function Avatar({ c, size = 40 }: { c: Pick<ChatContact, 'color' | 'initial' | 'name'>; size?: number }) {
  return (
    <span className="wx-avatar" style={{ background: c.color ?? '#9aa5b1', width: size, height: size, fontSize: size * 0.42 }}>
      {c.initial ?? c.name.slice(0, 1)}
    </span>
  );
}

export function ChatApp({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'chat':
      return <ChatWindow contactId={String(screen.params.contact)} />;
    case 'transfer':
      return <MoneyForm contactId={String(screen.params.contact)} kind="transfer" />;
    case 'red_packet':
      return <MoneyForm contactId={String(screen.params.contact)} kind="red_packet" />;
    case 'scan':
      return <Scan />;
    case 'qr_pay':
      return <QrPay qrId={String(screen.params.qr)} />;
    case 'qr_contact':
      return <QrContact qrId={String(screen.params.qr)} />;
    case 'mini':
      return <MiniPrograms />;
    default:
      return <ChatHome />;
  }
}

interface Row {
  key: string;
  at: number;
  from: 'me' | 'them';
  kind: 'text' | 'transfer' | 'red_packet' | 'mini_program' | 'image' | 'system';
  text?: string;
  english?: string;
  amount?: number;
  app?: PhoneAppId;
  time?: string;
  opened?: boolean;
  seedIndex?: number;
}

function useRows(contactId: string): Row[] {
  const p = usePhone();
  const w = useWorld();
  const c = contactOf(w, contactId);
  return useMemo(() => {
    const thread = w.threads.find((t) => t.contact === contactId);
    const opened = new Set(recordsOf(p.events, 'red_packet_opened').map((r) => r.id));
    const rows: Row[] = (thread?.messages ?? []).map((m: ChatSeedMessage, i) => ({
      key: `seed${i}`,
      at: i - 1000,
      from: m.from,
      kind: m.kind ?? 'text',
      text: m.text,
      amount: m.amount,
      app: m.app,
      time: m.time,
      opened: m.kind === 'red_packet' ? opened.has(`${contactId}-${i}`) || m.opened === true : undefined,
      seedIndex: i,
    }));
    for (const e of p.events) {
      if (e.type === 'chat.message' && e.contact === contactId) rows.push({ key: `e${e.at}${rows.length}`, at: e.at, from: 'me', kind: 'text', text: String(e.text) });
      if (c.persona && e.type === 'persona.message' && e.persona === c.persona && e.system !== true)
        rows.push({ key: `p${e.at}${rows.length}`, at: e.at, from: e.from === 'me' ? 'me' : 'them', kind: 'text', text: String(e.text), english: typeof e.english === 'string' ? e.english : undefined });
    }
    for (const r of recordsOf(p.events, 'transfer')) {
      if (r.data.to_id === contactId) rows.push({ key: `t${r.id}`, at: r.at, from: 'me', kind: r.data.kind === 'red_packet' ? 'red_packet' : 'transfer', amount: Number(r.data.amount), text: String(r.data.note ?? '') });
    }
    return rows.sort((a, b) => a.at - b.at);
  }, [p.events, w, contactId, c.persona]);
}

function ChatHome() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const [tab, setTab] = useAppState<'chats' | 'contacts' | 'discover' | 'me'>(APP, 'tab', 'chats');
  const [menu, setMenu] = useState(false);
  const read = new Set(p.events.filter((e) => e.type === 'chat.read').map((e) => String(e.contact)));
  const unread = w.threads.filter((t) => !read.has(t.contact)).reduce((n, t) => n + (t.unread ?? 0), 0);
  const open = (contact: string) => {
    p.emit({ type: 'chat.read', contact });
    nav.push('chat', { contact });
  };
  const threads = [...w.threads].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const lastText = (contact: string): string => {
    const t = w.threads.find((x) => x.contact === contact);
    const m = t?.messages[t.messages.length - 1];
    if (!m) return '';
    if (m.kind === 'red_packet') return '[红包] ' + (m.text ?? '恭喜发财，大吉大利');
    if (m.kind === 'transfer') return '[转账]';
    if (m.kind === 'mini_program') return '[小程序] ' + (m.text ?? '');
    return m.text ?? '';
  };
  return (
    <div className="ph-col wx" data-testid="chat-home">
      {tab === 'chats' && (
        <>
          <div className="wx-bar">
            <span />
            <b>微聊{unread ? `(${unread})` : ''}</b>
            <span className="wx-bar-right">
              <button type="button" aria-label="搜索" onClick={() => p.toast('搜索：暂未开放')}>
                🔍
              </button>
              <button type="button" aria-label="更多" onClick={() => setMenu((v) => !v)} data-testid="chat-plus">
                ⊕
              </button>
            </span>
          </div>
          {menu && (
            <div className="wx-menu" data-testid="chat-plus-menu">
              <button type="button" onClick={() => { setMenu(false); p.toast(ZH.notOpen); }}>💬 发起群聊</button>
              <button type="button" onClick={() => { setMenu(false); p.toast(ZH.notOpen); }}>👤 添加朋友</button>
              <button type="button" onClick={() => { setMenu(false); nav.push('scan'); }} data-testid="chat-scan">
                ⌗ 扫一扫
              </button>
              <button type="button" onClick={() => { setMenu(false); p.openApp('wallet'); }}>💴 收付款</button>
            </div>
          )}
          <Body className="wx-list">
            {threads.map((t) => {
              const c = contactOf(w, t.contact);
              const n = read.has(t.contact) ? 0 : t.unread ?? 0;
              return (
                <button key={t.contact} type="button" className={`wx-row${t.pinned ? ' wx-row-pinned' : ''}`} onClick={() => open(t.contact)} data-testid="chat-row" data-contact={t.contact}>
                  <span className="wx-row-av">
                    <Avatar c={c} size={44} />
                    {n > 0 && <i className="wx-badge">{n}</i>}
                  </span>
                  <span className="wx-row-main">
                    <span className="wx-row-top">
                      <b>{c.name}</b>
                      <small>{t.messages[t.messages.length - 1]?.time ?? ''}</small>
                    </span>
                    <span className="wx-row-last">{lastText(t.contact)}</span>
                  </span>
                </button>
              );
            })}
          </Body>
        </>
      )}
      {tab === 'contacts' && (
        <Body className="wx-list">
          <div className="wx-bar">
            <span />
            <b>通讯录</b>
            <span />
          </div>
          <Group>
            {w.contacts.map((c) => (
              <Cell key={c.id} icon={<Avatar c={c} size={36} />} label={c.name} onClick={() => open(c.id)} arrow={false} />
            ))}
          </Group>
        </Body>
      )}
      {tab === 'discover' && (
        <Body className="wx-list">
          <div className="wx-bar">
            <span />
            <b>发现</b>
            <span />
          </div>
          <Group>
            <Cell icon="🌈" label="朋友圈" onClick={() => p.toast(ZH.notOpen)} />
          </Group>
          <Group>
            <Cell icon="⌗" label="扫一扫" onClick={() => nav.push('scan')} testId="chat-discover-scan" />
            <Cell icon="〰" label="摇一摇" onClick={() => p.toast(ZH.notOpen)} />
          </Group>
          <Group>
            <Cell icon="▦" label="小程序" onClick={() => nav.push('mini')} testId="chat-mini" />
          </Group>
        </Body>
      )}
      {tab === 'me' && (
        <Body className="wx-list">
          <div className="wx-me">
            <Avatar c={{ name: w.me.name, color: '#5c6bc0' }} size={60} />
            <span>
              <b>{w.me.name}</b>
              <small>微聊号：{w.me.id}</small>
            </span>
          </div>
          <Group>
            <Cell icon="💴" label="服务" onClick={() => p.openApp('wallet')} />
          </Group>
          <Group>
            <Cell icon="⭐" label="收藏" onClick={() => p.toast(ZH.notOpen)} />
            <Cell icon="⚙" label="设置" onClick={() => p.toast(ZH.notOpen)} />
          </Group>
        </Body>
      )}
      <div className="ph-tabbar wx-tabbar">
        {(
          [
            ['chats', '微聊', '💬'],
            ['contacts', '通讯录', '👥'],
            ['discover', '发现', '🧭'],
            ['me', '我', '👤'],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`chat-tab-${id}`}>
            <span>
              {icon}
              {id === 'chats' && unread > 0 && <i className="wx-badge wx-badge-tab">{unread}</i>}
            </span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatWindow({ contactId }: { contactId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const c = contactOf(w, contactId);
  const chat = usePersona(c.persona);
  const rows = useRows(contactId);
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState(false);
  const [packet, setPacket] = useState<Row | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useBackHandler(panel, () => setPanel(false));
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, chat.pending, chat.error]);

  const send = (via: 'typed' | 'voice' = 'typed') => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    if (c.persona) chat.send(t, via);
    else p.emit({ type: 'chat.message', contact: contactId, text: t });
  };

  return (
    <div className="ph-col wx wx-chat" data-testid="chat-window" data-contact={contactId}>
      <AppBar title={c.name} onBack={nav.pop} right={<button type="button" className="ph-bar-icon" onClick={() => p.toast(ZH.notOpen)} aria-label="聊天信息">⋯</button>} />
      <div className="wx-msgs" ref={list}>
        {rows.map((r, i) => (
          <MessageRow key={r.key} r={r.time && rows[i - 1]?.time === r.time ? { ...r, time: undefined } : r} c={c} meName={w.me.name} onPacket={() => setPacket(r)} onMini={(app) => p.openApp(app)} />
        ))}
        {chat.pending && <div className="ph-chat-typing">对方正在输入…</div>}
        {chat.error && (
          <div className="ph-chat-error" data-testid="persona-error">
            {chat.error === 'offline' ? ZH.needsConnection : '消息发送失败'}
            <button type="button" onClick={chat.retry}>
              重试
            </button>
          </div>
        )}
      </div>
      <div className="wx-input">
        <PhoneMic onText={(t) => setDraft((d) => d + t)} testId="chat-mic" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setPanel(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();
          }}
          data-testid="chat-input"
          lang="zh-CN"
          enterKeyHint="send"
        />
        {draft.trim() ? (
          <button type="button" className="wx-send" onClick={() => send()} data-testid="chat-send">
            发送
          </button>
        ) : (
          <button type="button" className="wx-plus" aria-label="更多功能" onClick={() => setPanel((v) => !v)} data-testid="chat-panel-toggle">
            ⊕
          </button>
        )}
      </div>
      {panel && (
        <div className="wx-panel" data-testid="chat-panel">
          {(
            [
              ['相册', '🖼'],
              ['拍摄', '📷'],
              ['视频通话', '📹'],
              ['位置', '📍'],
              ['红包', '🧧'],
              ['转账', '💱'],
              ['语音输入', '🎙'],
              ['收藏', '⭐'],
            ] as const
          ).map(([label, icon]) => (
            <button
              key={label}
              type="button"
              data-testid={`chat-panel-${label}`}
              onClick={() => {
                setPanel(false);
                if (label === '转账') nav.push('transfer', { contact: contactId });
                else if (label === '红包') nav.push('red_packet', { contact: contactId });
                else p.toast(ZH.notOpen);
              }}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}
      {packet && <RedPacketOpen contact={c} row={packet} onClose={() => setPacket(null)} />}
    </div>
  );
}

function MessageRow({ r, c, meName, onPacket, onMini }: { r: Row; c: ChatContact; meName: string; onPacket: () => void; onMini: (app: PhoneAppId) => void }) {
  const [en, setEn] = useState(false);
  const mine = r.from === 'me';
  const av = mine ? <Avatar c={{ name: meName, color: '#5c6bc0' }} size={36} /> : <Avatar c={c} size={36} />;
  let bubble: React.ReactNode;
  if (r.kind === 'transfer') {
    bubble = (
      <div className="wx-money" data-testid="chat-transfer-bubble">
        <span className="wx-money-top">
          <span className="wx-money-icon">⇄</span>
          <span>
            <b>¥{yuan2(r.amount ?? 0)}</b>
            <small>{r.text || (mine ? `转账给${c.name}` : '转账给你')}</small>
          </span>
        </span>
        <span className="wx-money-foot">微聊转账</span>
      </div>
    );
  } else if (r.kind === 'red_packet') {
    bubble = (
      <button type="button" className={`wx-money wx-packet${r.opened ? ' wx-packet-open' : ''}`} onClick={!mine && !r.opened ? onPacket : undefined} data-testid="chat-red-packet">
        <span className="wx-money-top">
          <span className="wx-money-icon">🧧</span>
          <span>
            <b>{r.text || '恭喜发财，大吉大利'}</b>
            {r.opened && <small>已领取</small>}
          </span>
        </span>
        <span className="wx-money-foot">微聊红包</span>
      </button>
    );
  } else if (r.kind === 'mini_program') {
    bubble = (
      <button type="button" className="wx-mini" onClick={() => r.app && onMini(r.app)} data-testid="chat-mini-card">
        <small>{r.app ? PHONE_APPS[r.app].name : '小程序'}</small>
        <b>{r.text}</b>
        <span className="wx-mini-foot">▦ 小程序</span>
      </button>
    );
  } else {
    bubble = (
      <div className="wx-bubble-col">
        <div className={`wx-bubble${mine ? ' wx-bubble-me' : ''}`} lang="zh-CN">
          {r.text}
        </div>
        {!mine && r.english && (
          <button type="button" className="ph-msg-tr" onClick={() => setEn((v) => !v)} data-testid="persona-translate">
            {en ? r.english : '译'}
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      {r.time && <div className="wx-time">{r.time}</div>}
      <div className={`wx-msg${mine ? ' wx-msg-me' : ''}`} data-testid={mine ? 'chat-msg-me' : 'chat-msg-them'}>
        {av}
        {bubble}
      </div>
    </>
  );
}

function RedPacketOpen({ contact, row, onClose }: { contact: ChatContact; row: Row; onClose: () => void }) {
  const p = usePhone();
  const [opened, setOpened] = useState(false);
  useBackHandler(true, onClose);
  const id = `${contact.id}-${row.seedIndex ?? 0}`;
  return (
    <div className="wx-packet-scrim" onClick={onClose} data-testid="red-packet-sheet">
      <div className="wx-packet-card" onClick={(e) => e.stopPropagation()}>
        <Avatar c={contact} size={44} />
        <div className="wx-packet-from">{contact.name}发出的红包</div>
        <div className="wx-packet-wish">{row.text || '恭喜发财，大吉大利'}</div>
        {opened ? (
          <div className="wx-packet-amount" data-testid="red-packet-amount">
            {yuan2(row.amount ?? 0)}
            <small>元</small>
            <div className="wx-packet-note">已存入零钱，可直接消费</div>
          </div>
        ) : (
          <button
            type="button"
            className="wx-packet-open-btn"
            data-testid="red-packet-open"
            onClick={() => {
              setOpened(true);
              p.write('red_packet_opened', id, { from_id: contact.id, amount: row.amount ?? 0 });
              p.write('payment', p.newId('payment', 'P'), { app: APP, title: `${contact.name}的红包`, payee: contact.name, amount: row.amount ?? 0, method: 'balance', direction: 'in', status: 'paid' });
            }}
          >
            開
          </button>
        )}
      </div>
    </div>
  );
}

/** The amount pad (转账 / 红包 / 付款). */
export function AmountPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="ph-keypad ph-keypad-amount" data-testid="amount-keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => (
        <button key={k} type="button" onClick={() => onChange(amountKey(value, k))} aria-label={k === 'del' ? '删除' : k} data-testid={`amount-${k === '.' ? 'dot' : k}`}>
          {k === 'del' ? '⌫' : k}
        </button>
      ))}
    </div>
  );
}

function MoneyForm({ contactId, kind }: { contactId: string; kind: 'transfer' | 'red_packet' }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const c = contactOf(w, contactId);
  const chat = usePersona(c.persona);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const value = parseAmount(amount);
  const go = async () => {
    const problem = transferProblem(value, kind);
    if (problem) {
      p.emit({ type: 'error', code: 'amount', app: APP });
      return p.toast(problem);
    }
    const r = await p.pay({ app: APP, title: kind === 'transfer' ? `转账给${c.name}` : `${c.name}的红包`, payee: c.name, amount: value });
    if (!r) return;
    const id = p.newId('transfer', 'T');
    const text = kind === 'red_packet' ? note || '恭喜发财，大吉大利' : note;
    p.write('transfer', id, { to_id: contactId, to: c.name, amount: value, note: text, kind, status: 'sent', payment_id: r.payment_id });
    if (c.persona) chat.sendEvent(`[${kind === 'transfer' ? '转账' : '红包'}] ¥${yuan2(value)}${text ? ` ${text}` : ''}`);
    nav.pop();
  };
  return (
    <div className="ph-col wx-money-form" data-testid={`chat-${kind}-form`}>
      <AppBar title={kind === 'transfer' ? '' : '发红包'} onBack={nav.pop} />
      <Body>
        {kind === 'transfer' ? (
          <div className="wx-transfer-to">
            <Avatar c={c} size={48} />
            <span>
              转账给 <b>{c.name}</b>
            </span>
          </div>
        ) : null}
        <div className="wx-amount-box">
          <small>{kind === 'transfer' ? '转账金额' : '单个金额'}</small>
          <div className="wx-amount" data-testid="money-amount">
            <span>¥</span>
            {amount || <span className="ph-ph">0.00</span>}
          </div>
          {kind === 'transfer' ? (
            <button type="button" className="wx-note-link" onClick={() => { setNoteDraft(note); setNoteOpen(true); }} data-testid="transfer-note">
              {note ? `${note}　修改` : '添加转账说明'}
            </button>
          ) : (
            <input className="wx-wish" value={note} onChange={(e) => setNote(e.target.value.slice(0, 25))} placeholder="恭喜发财，大吉大利" lang="zh-CN" data-testid="red-packet-wish" />
          )}
        </div>
        <Btn block accent="#19a356" disabled={value <= 0} onClick={() => void go()} testId="money-submit">
          {kind === 'transfer' ? '转账' : '塞钱进红包'}
        </Btn>
        {kind === 'red_packet' && <div className="ph-note">未领取的红包，将于24小时后发起退款</div>}
      </Body>
      <AmountPad value={amount} onChange={setAmount} />
      <Dialog
        open={noteOpen}
        title="添加转账说明"
        onClose={() => setNoteOpen(false)}
        actions={[
          { label: ZH.cancel, onClick: () => setNoteOpen(false) },
          { label: ZH.confirm, primary: true, testId: 'transfer-note-ok', onClick: () => { setNote(noteDraft.trim().slice(0, 20)); setNoteOpen(false); } },
        ]}
      >
        <input className="ph-dialog-input" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="最多20个字" autoFocus lang="zh-CN" data-testid="transfer-note-input" />
      </Dialog>
    </div>
  );
}

function Scan() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const [scanning, setScanning] = useState<string | null>(null);
  const codes = w.qr_codes ?? [];
  useEffect(() => {
    if (!scanning) return;
    const t = window.setTimeout(() => {
      const q = codes.find((x) => x.id === scanning);
      setScanning(null);
      if (!q) return;
      p.emit({ type: 'qr.scan', qr: q.id });
      nav.pop();
      nav.push(q.kind === 'pay' ? 'qr_pay' : 'qr_contact', { qr: q.id });
    }, 900);
    return () => window.clearTimeout(t);
  }, [scanning, codes, nav, p]);
  return (
    <div className="ph-col wx-scan" data-testid="chat-scan-view">
      <AppBar title="扫一扫" onBack={nav.pop} tone="accent" accent="#111" />
      <div className="wx-scan-view">
        <div className="wx-scan-hint">将二维码放入框内，即可自动扫描</div>
        <div className="wx-scan-codes">
          {codes.length === 0 && <div className="wx-scan-empty">附近没有可扫描的二维码</div>}
          {codes.map((q: ChatQrCode) => (
            <button key={q.id} type="button" className={`wx-qr-card${scanning === q.id ? ' scanning' : ''}`} onClick={() => setScanning(q.id)} data-testid="qr-code" data-qr={q.id}>
              <span className="wx-qr-label">{q.label}</span>
              <span className="wx-qr-img" aria-hidden>
                {Array.from({ length: 49 }, (_, i) => (
                  <i key={i} className={qrCell(q.id, i) ? 'on' : ''} />
                ))}
              </span>
              <span className="wx-qr-name">{q.kind === 'pay' ? q.payee : `${q.payee} · 微聊`}</span>
            </button>
          ))}
        </div>
        <div className="wx-scan-tools">
          <span>🔦 轻触照亮</span>
          <span onClick={() => p.toast(ZH.notOpen)}>🖼 相册</span>
        </div>
      </div>
    </div>
  );
}

/** A QR-looking 7×7 pattern: three corner finders + cells from a hash of the id. */
export function qrCell(id: string, i: number): boolean {
  if ([0, 1, 7, 8, 5, 6, 12, 13, 35, 36, 42, 43].includes(i)) return true;
  let h = 2166136261;
  for (const ch of `${id}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 5 < 2;
}

function QrPay({ qrId }: { qrId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const q = (w.qr_codes ?? []).find((x) => x.id === qrId);
  const [amount, setAmount] = useState(q?.amount ? String(q.amount) : '');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<number | null>(null);
  if (!q) return null;
  const value = parseAmount(amount);
  const go = async () => {
    const problem = transferProblem(value, 'transfer');
    if (problem) return p.toast(problem);
    const r = await p.pay({ app: APP, title: `付款给${q.payee}`, payee: q.payee, amount: value });
    if (!r) return;
    p.write('qr_payment', p.newId('qr_payment', 'Q'), { qr_id: q.id, payee: q.payee, amount: value, note, status: 'paid', payment_id: r.payment_id });
    setDone(value);
  };
  if (done !== null) {
    return (
      <div className="ph-col" data-testid="qr-pay-done">
        <AppBar title="" onBack={nav.pop} />
        <Body className="wx-paid">
          <div className="ph-pay-check">✓</div>
          <b>支付成功</b>
          <div className="wx-paid-amount">¥{yuan2(done)}</div>
          <small>收款方：{q.payee}</small>
          <Btn kind="line" accent="#19a356" onClick={nav.pop}>
            完成
          </Btn>
        </Body>
      </div>
    );
  }
  return (
    <div className="ph-col wx-money-form" data-testid="qr-pay">
      <AppBar title="" onBack={nav.pop} />
      <Body>
        <div className="wx-transfer-to">
          <Avatar c={{ name: q.payee, color: '#ff9800', initial: '张' }} size={48} />
          <span>
            付款给个人 <b>{q.payee}</b>
          </span>
        </div>
        <div className="wx-amount-box">
          <small>付款金额</small>
          <div className="wx-amount" data-testid="money-amount">
            <span>¥</span>
            {amount || <span className="ph-ph">0.00</span>}
          </div>
          <input className="wx-wish" value={note} onChange={(e) => setNote(e.target.value.slice(0, 20))} placeholder="添加备注（选填）" lang="zh-CN" />
        </div>
        <Btn block accent="#19a356" disabled={value <= 0} onClick={() => void go()} testId="qr-pay-submit">
          付款
        </Btn>
      </Body>
      {!q.amount && <AmountPad value={amount} onChange={setAmount} />}
    </div>
  );
}

function QrContact({ qrId }: { qrId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const q = (w.qr_codes ?? []).find((x) => x.id === qrId);
  if (!q) return null;
  return (
    <div className="ph-col" data-testid="qr-contact">
      <AppBar title="" onBack={nav.pop} />
      <Body>
        <div className="wx-me">
          <Avatar c={{ name: q.payee, color: '#ff9800', initial: '张' }} size={60} />
          <span>
            <b>{q.payee}</b>
            <small>地区：上海 静安</small>
          </span>
        </div>
        <div className="ph-pad">
          <Btn block accent="#19a356" onClick={() => p.toast('已发送添加朋友申请')}>
            添加到通讯录
          </Btn>
        </div>
        <div className="ph-note">这是添加好友的二维码，不能用来付款。</div>
      </Body>
    </div>
  );
}

function MiniPrograms() {
  const p = usePhone();
  const nav = useAppNav(APP);
  const apps: PhoneAppId[] = ['rail', 'ride', 'food', 'movie', 'dine'];
  return (
    <div className="ph-col" data-testid="chat-mini-list">
      <AppBar title="小程序" onBack={nav.pop} />
      <Body>
        <div className="ph-section-title">最近使用</div>
        <div className="wx-minis">
          {apps.map((a) => (
            <button key={a} type="button" onClick={() => p.openApp(a)} data-testid={`mini-${a}`}>
              <span className="ph-icon ph-icon-small" style={{ background: `linear-gradient(145deg, ${PHONE_APPS[a].colors[0]}, ${PHONE_APPS[a].colors[1]})` }}>
                {PHONE_APPS[a].glyph}
              </span>
              {PHONE_APPS[a].name}
            </button>
          ))}
        </div>
      </Body>
    </div>
  );
}
