import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { askedClaudeTodayLabel } from '@shared/claude/visibility';
import { getTutorDashboard, DASHBOARD_STALE_MS } from '../api/tutorDashboard';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiErrorStatus, getMyRelationships } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useNetwork } from '../contexts/NetworkContext';
import { useChatList } from '../hooks/useChatList';
import { useClaudeInbox } from '../hooks/useClaudeInbox';
import { useNavRole } from '../components/nav/useNavRole';
import { track, trackError } from '../services/analytics';
import { CLAUDE_AI_USER_ID, getOtherUserInRelationship } from '../types';
import { chatInitial, chatPersonName, chatRelativeTime, type ChatListRow } from '@shared/chats/inbox';
import {
  claudeRowStatus,
  contextOpenLabel,
  filterInbox,
  inboxRowLabel,
  inboxRowName,
  inboxSections,
  mergeInbox,
  type InboxItem,
} from '@shared/claude/inbox';
import { headerChipFor } from '@shared/claude/contexts';
import type { ClaudeIntent } from '@shared/claude/context';
import { refreshChatListening } from '../services/chatListening';
import { startClaudeThread, wireClaudeOutbox, type LocalClaudeThread } from '../services/claudeThreads';
import { PracticeSituationSheet } from '../components/claude/PracticeSituationSheet';
import { useAskLanguage } from '../services/askClaudeLanguage';
import { ChatsComposer } from '../components/chats/ChatsComposer';
import './ChatsPage.css';

/** The list's avatar size (px): compact one-line rows, ~60px tall. */
const ROW_AVATAR = 40;

/** Avatar colours for people without a picture, picked by a hash of their id. */
const AVATAR_COLORS = ['#2c6bed', '#0f9d58', '#e8710a', '#a142f4', '#d93025', '#12a4af', '#c2185b', '#5f6368'];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function ChatAvatar({ person, size = ROW_AVATAR }: { person: { id: string; name: string | null; picture_url: string | null }; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (person.id === CLAUDE_AI_USER_ID) return <ClaudeAvatar size={size} />;
  if (person.picture_url && !broken) {
    return <img className="chats-avatar" style={style} src={person.picture_url} alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className="chats-avatar" style={{ ...style, background: avatarColor(person.id) }} aria-hidden="true">
      {chatInitial(person)}
    </span>
  );
}

function ClaudeAvatar({ size = ROW_AVATAR }: { size?: number }) {
  return (
    <span className="chats-avatar chats-avatar-claude" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      ✦
    </span>
  );
}

function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

type Item = InboxItem<ChatListRow, LocalClaudeThread>;

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="chats-unread" aria-label={`${n} unread`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

interface RowProps {
  item: Item;
  now: number;
  onOpen: (item: Item) => void;
  /** A student's row (the tutor's view): his chats with Claude she may read, written in today. */
  claudeToday?: number;
  /** This Claude row's context popover is open. */
  infoOpen?: boolean;
  onInfo?: (key: string | null) => void;
}

/** The kind in words for screen readers (the section + the avatar show it on screen). */
function KindWord({ item }: { item: Item }) {
  return <span className="sr-only" data-testid="chats-row-kind">{`, ${inboxRowLabel(item.kind).text}`}</span>;
}

/** A chat with a person (a tutor / a student): opens THE chat with them. One line: avatar, name, time, unread. */
function PersonRow({ item, now, onOpen, claudeToday }: RowProps) {
  const row = item.human!;
  const unread = row.unread > 0;
  return (
    <div className={`chats-row-wrap${item.pinned ? ' chats-row-pinned' : ''}`} role="listitem" data-testid="chats-item" data-kind={item.kind}>
      <Link
        to={`/connections/${row.relationship_id}/chat/${row.conversation_id}`}
        state={{ from: '/chats' }}
        className={`chats-row${unread ? ' chats-row-unread' : ''}`}
        data-testid="chats-row"
        onClick={() => onOpen(item)}
      >
        <ChatAvatar person={row.other_user} />
        <span className="chats-row-title">
          <span className="chats-row-name">{inboxRowName(item)}</span>
          <KindWord item={item} />
        </span>
        <span className="chats-row-meta">
          <span className="chats-row-time">{chatRelativeTime(row.last_activity_at, now, localOffsetMinutes())}</span>
          <UnreadBadge n={row.unread} />
        </span>
      </Link>
      {item.kind === 'student' && askedClaudeTodayLabel(claudeToday ?? 0) && (
        // "✦ Asked Claude 3× today" → his chats with Claude she may read (shared/claude/visibility.ts).
        <Link to={`/connections/${row.relationship_id}/claude-chats`} className="chats-row-claude-today" data-testid="chats-claude-today">
          {askedClaudeTodayLabel(claudeToday ?? 0)}
        </Link>
      )}
    </div>
  );
}

/** Where a Claude row's context leads (the card, the reader at that page, the lesson), with its action's words. */
function contextTarget(item: Item): { to: string; label: string } | null {
  const link = item.thread ? headerChipFor(item.thread.context)?.link ?? null : null;
  const label = contextOpenLabel(link?.kind);
  if (!link || !label) return null;
  const to =
    link.kind === 'card'
      ? `/cards/${encodeURIComponent(link.note_id)}`
      : link.kind === 'reader'
        ? `/readers/${encodeURIComponent(link.reader_id)}${link.page ? `?page=${link.page}` : ''}`
        : link.kind === 'exercise'
          ? `/lessons/${encodeURIComponent(link.lesson_id)}/play?from=claude`
          : null;
  return to ? { to, label } : null;
}

/**
 * A chat with Claude: ONE line — ✦, the title, ONE context emoji (📇 / 📖 / 🧩 / 🎭 / ✏️ …) and the time
 * (or "Writing…" / "Failed"). The emoji opens a small popover: the full text and, with a target,
 * "Open card ›".
 */
function ClaudeRow({ item, now, onOpen, infoOpen = false, onInfo }: RowProps) {
  const navigate = useNavigate();
  const thread = item.thread;
  // An old practice chat with no thread on this device yet: it opens the old chat screen.
  const to = thread
    ? `/chats/claude/${encodeURIComponent(thread.id)}`
    : `/connections/${item.human!.relationship_id}/chat/${item.human!.conversation_id}`;
  const target = item.badge ? contextTarget(item) : null;
  const status = thread ? claudeRowStatus(thread) : null;
  const open = () => {
    onOpen(item);
    navigate(to, { state: { from: '/chats' } });
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };
  return (
    <div className={`chats-row-wrap${infoOpen ? ' chats-row-info-open' : ''}`} role="listitem" data-testid="chats-item" data-kind="claude">
      <div
        className={`chats-row chats-row-claude${item.unread > 0 ? ' chats-row-unread' : ''}`}
        role="link"
        tabIndex={0}
        aria-label={`Claude: ${inboxRowName(item)}${item.badge ? ` (${item.badge.text})` : ''}`}
        data-testid="chats-claude-row"
        onClick={open}
        onKeyDown={onKey}
      >
        <ClaudeAvatar />
        <span className="chats-row-title">
          <span className="chats-row-name">{inboxRowName(item)}</span>
          {item.badge && (
            <button
              type="button"
              className="chats-context-emoji"
              data-testid="chats-context-chip"
              aria-label={`${item.badge.text} — more`}
              aria-expanded={infoOpen}
              title={item.badge.text}
              onClick={(e) => {
                e.stopPropagation();
                onInfo?.(infoOpen ? null : item.key);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <span aria-hidden="true">{item.badge.icon}</span>
            </button>
          )}
        </span>
        <span className="chats-row-meta">
          {status ? (
            <span className={`chats-row-status${thread?.failed && !thread.pending ? ' chats-row-status-failed' : ''}`} title={status.text} aria-label={status.text} data-testid="chats-row-status">
              <span aria-hidden="true">{status.icon} {status.short}</span>
            </span>
          ) : (
            <span className="chats-row-time">{chatRelativeTime(item.activity_at, now, localOffsetMinutes())}</span>
          )}
          <UnreadBadge n={item.unread} />
        </span>
      </div>
      {infoOpen && item.badge && (
        <div className="chats-context-pop" role="dialog" aria-label={item.badge.text} data-testid="chats-context-pop">
          <span className="chats-context-pop-text">
            <span aria-hidden="true">{item.badge.icon}</span> {item.badge.text}
          </span>
          {target && (
            <button
              type="button"
              className="chats-context-pop-open"
              data-testid="chats-context-open"
              onClick={() => {
                onInfo?.(null);
                track('chats.context_info', { context_kind: thread?.context.kind ?? 'practice', action: 'open' });
                navigate(target.to, { state: { from: '/chats' } });
              }}
            >
              {target.label} ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function InboxRow(props: RowProps) {
  return props.item.kind === 'claude' ? <ClaudeRow {...props} /> : <PersonRow {...props} />;
}

function sendErrorText(err: unknown): string {
  const status = apiErrorStatus(err);
  const message = err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : '';
  if (status === 429) return message || 'Too many requests just now — try again in a minute.';
  return message || "Couldn't send that — try again.";
}

/**
 * The Chats tab (`/chats`; docs/CHAT.md "Chats tab — one list for people and Claude"): the chats with
 * people first (a learner's unread tutor chats on top), a thin divider, then the chats with Claude
 * (`mergeInbox` + `inboxSections`, shared/claude/inbox.ts). Compact one-line rows (~60px): avatar,
 * name, time, unread — a Claude row adds ONE context emoji (📇 Asked on card · 银行 → a popover with
 * "Open card ›"). No previews, no filter chips, no outlines (Jerome, Nov 2026: "compress things down").
 * At the bottom, the box: always to Claude (✏️ New chat reaches a person) — ✏️ Type · 🎤 Say it, then
 * Ask (Enter) and, once there is text, ✏️ Check / 🔍 Explain for Chinese, Translate for English.
 *
 * A tutor account / an account with students: the same layout (her students, the divider, her Claude
 * chats), no pinning, and a box with Ask · Translate only.
 *
 * Offline: both lists come from the device (localStorage / Dexie), a message to Claude is queued.
 */
export function ChatsPage() {
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const role = useNavRole();
  const teacher = role.isTutorAccount || role.hasStudents;
  const { rows, isLoading, error, markOpened } = useChatList({ live: true });
  const { threads } = useClaudeInbox(user?.id);
  const [language] = useAskLanguage();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [practising, setPractising] = useState(false);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [composeRequest, setComposeRequest] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const now = Date.now();

  useEffect(() => {
    wireClaudeOutbox();
    void refreshChatListening();
  }, []);

  // ?compose=1 (More → Ask Claude, /coach) and ?text= (a sentence handed over): the box comes into
  // view, typing, with the text; the URL is cleaned. ?practice=1 (an old "new chat with Claude" link):
  // the "Practice a situation" sheet.
  useEffect(() => {
    if (params.get('practice') === '1') {
      setPractising(true);
      setParams({}, { replace: true });
      return;
    }
    const text = params.get('text');
    if (params.get('compose') !== '1' && !text) return;
    if (text) setDraft(text);
    setComposeRequest((n) => n + 1);
    setParams({}, { replace: true });
  }, [params, setParams]);
  useEffect(() => {
    if (composeRequest) composerRef.current?.scrollIntoView?.({ block: 'end' });
  }, [composeRequest]);

  const relationshipsQuery = useQuery({
    queryKey: ['nav-relationships'],
    queryFn: getMyRelationships,
    staleTime: 30_000,
    retry: false,
  });
  const people = useMemo(() => {
    const rels = relationshipsQuery.data;
    if (!rels || !user) return [];
    return [...rels.tutors, ...rels.students]
      .filter((r) => r.status === 'active')
      .map((r) => ({ relId: r.id, other: getOtherUserInRelationship(r, user.id), isTutor: rels.tutors.includes(r) }))
      .filter((p) => p.other.id !== CLAUDE_AI_USER_ID);
  }, [relationshipsQuery.data, user]);

  // The tutor's Students rows: "✦ Asked Claude 3× today" (the dashboard's numbers, cached 60 s).
  const dashboardQuery = useQuery({ queryKey: ['tutor-dashboard'], queryFn: getTutorDashboard, staleTime: DASHBOARD_STALE_MS, enabled: teacher && role.hasStudents, retry: false });
  const claudeTodayByRel = useMemo(
    () => new Map((dashboardQuery.data?.students ?? []).map((st) => [st.relationship_id, st.claude_today ?? 0] as const)),
    [dashboardQuery.data],
  );
  const humans = useMemo(() => rows ?? [], [rows]);
  const allItems = useMemo(() => mergeInbox(humans, threads ?? [], { pinUnreadTutors: !teacher }), [humans, threads, teacher]);
  const shown = useMemo(() => filterInbox(allItems, query), [allItems, query]);
  const sections = useMemo(() => inboxSections(shown), [shown]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  // The context popover: Escape / a tap anywhere else closes it.
  useEffect(() => {
    if (!infoKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInfoKey(null);
    };
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('.chats-context-pop, .chats-context-emoji')) return;
      setInfoKey(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [infoKey]);

  // Analytics: chat.inbox_open once, when the list first has rows (cached or fetched).
  const inboxTracked = useRef(false);
  useEffect(() => {
    if (rows === null || threads === null || inboxTracked.current) return;
    inboxTracked.current = true;
    track('chat.inbox_open', { conversations: allItems.length, unread: allItems.filter((r) => r.unread > 0).length });
  }, [rows, threads, allItems]);

  const onOpen = (item: Item) => {
    track('chats.open', { kind: item.kind });
    if (item.human) markOpened(item.human.conversation_id);
  };

  const onInfo = (key: string | null) => {
    setInfoKey(key);
    if (!key) return;
    const item = allItems.find((i) => i.key === key);
    track('chats.context_info', { context_kind: item?.thread?.context.kind ?? 'practice', action: 'show' });
  };

  const sendToClaude = async (text: string, intent: ClaudeIntent, spoken: boolean) => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await startClaudeThread({ context: { kind: 'general' }, text: msg, intent, language });
      track('chats.compose_send', { intent, offline: res.queued, spoken });
      track('claude.message_send', { context_kind: 'general', intent, offline: res.queued, chip: false, spoken });
      setDraft('');
      navigate(`/chats/claude/${encodeURIComponent(res.threadId)}?source=chats`, { state: { from: '/chats' } });
    } catch (err) {
      setSendError(err);
      trackError('chats_compose_send', err);
    } finally {
      setSending(false);
    }
  };

  const newClaudeChat = () => {
    setPicking(false);
    setComposeRequest((n) => n + 1);
  };

  const nothing = rows !== null && threads !== null && allItems.length === 0;
  const noPeople = relationshipsQuery.isSuccess && people.length === 0;
  const row = (item: Item) => (
    <InboxRow
      key={item.key}
      item={item}
      now={now}
      onOpen={onOpen}
      claudeToday={item.human ? claudeTodayByRel.get(item.human.relationship_id) : undefined}
      infoOpen={infoKey === item.key}
      onInfo={onInfo}
    />
  );

  return (
    <div className="page">
      <div className={`container chats-page${teacher ? ' chats-page-teacher' : ''}`}>
        <div className="chats-header">
          <h1>Chats</h1>
          <button type="button" className="chats-new" onClick={() => setPicking(true)} aria-label="New chat" title="New chat">
            ✏️
          </button>
        </div>

        {allItems.length > 0 && (
          <input
            type="search"
            className="chats-search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search chats"
          />
        )}

        {isLoading && allItems.length === 0 && <p className="chats-muted">Loading chats…</p>}
        {!rows && error && (
          <p className="chats-muted">
            {isOnline ? `Couldn't load your chats with people: ${error.message}` : "You're offline — your chats with people will show once you're back online."}
          </p>
        )}

        {nothing && (
          <div className="chats-empty" data-testid="chats-empty">
            <div className="chats-empty-icon" aria-hidden="true">✦</div>
            <p>Ask Claude anything in the box below — in Chinese or English.</p>
            {noPeople && (
              <p className="chats-muted">
                No chats with people yet — <Link to="/connections">connect with a tutor or student</Link>.
              </p>
            )}
          </div>
        )}

        {allItems.length > 0 && shown.length === 0 && (
          <p className="chats-muted">{query.trim() ? `No chats match “${query.trim()}”.` : 'Nothing here yet.'}</p>
        )}

        {sections.people.length > 0 && (
          <div className="chats-list" role="list" aria-label={teacher && sections.people.every((i) => i.kind === 'student') ? 'Students' : 'People'} data-testid="chats-people">
            {sections.people.map(row)}
          </div>
        )}
        {sections.people.length > 0 && sections.claude.length > 0 && <hr className="chats-divider" data-testid="chats-divider" />}
        {sections.claude.length > 0 && (
          <div className="chats-list" role="list" aria-label="Chats with Claude" data-testid="chats-claude">
            {sections.claude.map(row)}
          </div>
        )}

        <div ref={composerRef} className={`page-footer chats-compose${teacher ? ' chats-compose-teacher' : ''}`} data-testid="chats-compose">
          <ChatsComposer
            value={draft}
            onChange={setDraft}
            onSendToClaude={sendToClaude}
            busy={sending}
            error={sendError ? sendErrorText(sendError) : null}
            language={language}
            online={isOnline}
            compact={teacher}
            openRequest={composeRequest}
          />
        </div>
      </div>
      {picking && (
        <div className="chats-sheet-backdrop" onClick={() => setPicking(false)}>
          <div className="chats-sheet" role="dialog" aria-label="New chat with" onClick={(e) => e.stopPropagation()}>
            <h2>New chat with…</h2>
            <button type="button" className="chats-sheet-person" onClick={newClaudeChat} data-testid="chats-new-claude">
              <ClaudeAvatar size={40} />
              <span>
                <strong>✦ Claude</strong>
                <span className="chats-muted"> · ask anything</span>
              </span>
            </button>
            <button
              type="button"
              className="chats-sheet-person"
              onClick={() => {
                setPicking(false);
                setPractising(true);
              }}
              data-testid="chats-new-practice"
            >
              <span className="chats-avatar chats-avatar-claude" style={{ width: 40, height: 40, fontSize: 18 }} aria-hidden="true">
                🎭
              </span>
              <span>
                <strong>🎭 Practice a situation…</strong>
                <span className="chats-muted"> · a role-play with Claude</span>
              </span>
            </button>
            {people.map((p) => (
              <button
                key={p.relId}
                type="button"
                className="chats-sheet-person"
                onClick={() => navigate(`/connections/${p.relId}/chat`, { state: { from: '/chats' } })}
              >
                <ChatAvatar person={p.other} size={40} />
                <span>
                  <strong>{chatPersonName(p.other)}</strong>
                  <span className="chats-muted"> · {p.isTutor ? '🧑‍🏫 your tutor' : '🎓 your student'}</span>
                </span>
              </button>
            ))}
            {noPeople && (
              <Link to="/connections" className="chats-sheet-link">Connect with a tutor or student →</Link>
            )}
            <button type="button" className="btn btn-secondary chats-sheet-cancel" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      )}
      {practising && <PracticeSituationSheet source="chats" onClose={() => setPractising(false)} />}
    </div>
  );
}
