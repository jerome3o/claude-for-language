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
import { chatInitial, chatPersonName, chatRelativeTime, chatRowPreview, type ChatListRow } from '@shared/chats/inbox';
import {
  claudeRowPreview,
  composeRecipients,
  filterInbox,
  inboxFilters,
  inboxRowLabel,
  inboxRowName,
  mergeInbox,
  teacherSections,
  type ComposeRecipient,
  type InboxFilter,
  type InboxItem,
} from '@shared/claude/inbox';
import { headerChipFor } from '@shared/claude/contexts';
import type { ClaudeIntent } from '@shared/claude/context';
import { effectiveListening, listeningPreview } from '@shared/chats/listening';
import { loadRevealed, refreshChatListening, useAllChatListening } from '../services/chatListening';
import { startClaudeThread, wireClaudeOutbox, type LocalClaudeThread } from '../services/claudeThreads';
import { PracticeSituationSheet } from '../components/claude/PracticeSituationSheet';
import { saveDraft } from '../services/chatDrafts';
import { useAskLanguage } from '../services/askClaudeLanguage';
import { ChatsComposer } from '../components/chats/ChatsComposer';
import './ChatsPage.css';

/** Avatar colours for people without a picture, picked by a hash of their id. */
const AVATAR_COLORS = ['#2c6bed', '#0f9d58', '#e8710a', '#a142f4', '#d93025', '#12a4af', '#c2185b', '#5f6368'];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function ChatAvatar({ person, size = 48 }: { person: { id: string; name: string | null; picture_url: string | null }; size?: number }) {
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

function ClaudeAvatar({ size = 48 }: { size?: number }) {
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

/** The word + icon on the row's outline ("🧑‍🏫 Tutor", "✦ Claude"): never colour alone. */
function KindLabel({ item }: { item: Item }) {
  const label = inboxRowLabel(item.kind);
  return (
    <span className={`chats-row-kind chats-row-kind-${item.kind}`} data-testid="chats-row-kind">
      <span aria-hidden="true">{label.icon}</span> {label.text}
    </span>
  );
}

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
  myId: string;
  now: number;
  onOpen: (item: Item) => void;
  /** A student's row (the tutor's view): his chats with Claude she may read, written in today. */
  claudeToday?: number;
}

/** A chat with a person (a tutor / a student): opens THE chat with them. */
function PersonRow({ item, myId, now, onOpen, claudeToday }: RowProps) {
  const row = item.human!;
  const unread = row.unread > 0;
  // Listening mode: never spoil a hidden message here ("🎧 New message").
  const listening = useAllChatListening();
  const setting = effectiveListening(listening.conversations[row.conversation_id] ?? null, listening.default_on);
  const hiddenPreview = setting.on
    ? listeningPreview(row.last_message, { viewerId: myId, setting, readMarker: row.my_read_at ?? null, revealed: loadRevealed(row.conversation_id) })
    : null;
  return (
    <div className={`chats-row-wrap chats-row-wrap-${item.kind}${item.pinned ? ' chats-row-pinned' : ''}`} role="listitem" data-testid="chats-item" data-kind={item.kind}>
      <KindLabel item={item} />
      <Link
        to={`/connections/${row.relationship_id}/chat/${row.conversation_id}`}
        state={{ from: '/chats' }}
        className={`chats-row${unread ? ' chats-row-unread' : ''}`}
        data-testid="chats-row"
        onClick={() => onOpen(item)}
      >
        <ChatAvatar person={row.other_user} />
        <span className="chats-row-body">
          <span className="chats-row-top">
            <span className="chats-row-name">{inboxRowName(item)}</span>
            <span className="chats-row-time">{chatRelativeTime(row.last_activity_at, now, localOffsetMinutes())}</span>
          </span>
          <span className="chats-row-bottom">
            <span className="chats-row-preview">{hiddenPreview ?? chatRowPreview(row, myId)}</span>
            <UnreadBadge n={row.unread} />
          </span>
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

/** A chat with Claude: its title, the last message and where it happened (the context chip). */
function ClaudeRow({ item, now, onOpen }: RowProps) {
  const navigate = useNavigate();
  const thread = item.thread;
  // An old practice chat with no thread on this device yet: it opens the old chat screen.
  const to = thread
    ? `/chats/claude/${encodeURIComponent(thread.id)}`
    : `/connections/${item.human!.relationship_id}/chat/${item.human!.conversation_id}`;
  const chip = thread ? headerChipFor(thread.context) : null;
  // The chip leads where the chat happened: the card, the reader at that page, the lesson.
  const link = chip?.link ?? null;
  const cardLink =
    link?.kind === 'card'
      ? `/cards/${encodeURIComponent(link.note_id)}`
      : link?.kind === 'reader'
        ? `/readers/${encodeURIComponent(link.reader_id)}${link.page ? `?page=${link.page}` : ''}`
        : link?.kind === 'exercise'
          ? `/lessons/${encodeURIComponent(link.lesson_id)}/play?from=claude`
          : null;
  const preview = thread ? claudeRowPreview(thread) : item.human?.last_message?.preview ?? 'No messages yet';
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
    <div className="chats-row-wrap chats-row-wrap-claude" role="listitem" data-testid="chats-item" data-kind="claude">
      <KindLabel item={item} />
      <div
        className={`chats-row chats-row-claude${item.unread > 0 ? ' chats-row-unread' : ''}`}
        role="link"
        tabIndex={0}
        aria-label={`Claude: ${inboxRowName(item)}`}
        data-testid="chats-claude-row"
        onClick={open}
        onKeyDown={onKey}
      >
        <ClaudeAvatar />
        <span className="chats-row-body">
          <span className="chats-row-top">
            <span className="chats-row-name">{inboxRowName(item)}</span>
            <span className="chats-row-time">{chatRelativeTime(item.activity_at, now, localOffsetMinutes())}</span>
          </span>
          <span className="chats-row-bottom">
            <span className={`chats-row-preview${thread?.failed ? ' chats-row-preview-failed' : ''}`}>{preview}</span>
            <UnreadBadge n={item.unread} />
          </span>
          {item.badge &&
            (cardLink ? (
              <button
                type="button"
                className="chats-context-chip chats-context-chip-link"
                data-testid="chats-context-chip"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(cardLink, { state: { from: '/chats' } });
                }}
                aria-label={`${item.badge.text} — open ${link?.kind === 'reader' ? 'the story' : link?.kind === 'exercise' ? 'the lesson' : 'the card'}`}
              >
                <span aria-hidden="true">{item.badge.icon}</span> {item.badge.text} ›
              </button>
            ) : (
              <span className="chats-context-chip" data-testid="chats-context-chip">
                <span aria-hidden="true">{item.badge.icon}</span> {item.badge.text}
              </span>
            ))}
        </span>
      </div>
    </div>
  );
}

function InboxRow(props: RowProps) {
  return props.item.kind === 'claude' ? <ClaudeRow {...props} /> : <PersonRow {...props} />;
}

const CLAUDE_SECTION_KEY = 'chats-claude-section-open-v1';

function readSectionOpen(): boolean {
  try {
    return localStorage.getItem(CLAUDE_SECTION_KEY) === '1';
  } catch {
    return false;
  }
}

function sendErrorText(err: unknown): string {
  const status = apiErrorStatus(err);
  const message = err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : '';
  if (status === 429) return message || 'Too many requests just now — try again in a minute.';
  return message || "Couldn't send that — try again.";
}

/**
 * The Chats tab (`/chats`; docs/CHAT.md "Chats tab — one list for people and Claude"): ONE list of
 * the chats with people and the chats with Claude (`mergeInbox`, shared/claude/inbox.ts). Every row
 * carries its kind as an icon + a word on its outline (🧑‍🏫 Tutor in blue, ✦ Claude in orange — never
 * colour alone), a Claude row its context chip (📇 Asked on card · 银行 → the card). A learner's unread
 * tutor chats are pinned on top; filter chips All · Tutor · Claude. At the bottom, the box: anything
 * typed or said goes to Claude by default — Ask (Enter), ✏️ Check or 🔍 Explain for Chinese, Translate
 * for English — and "To: ✦ Claude ▾" switches to a tutor (her chat opens with the text as a draft).
 *
 * A tutor account / an account with students gets the student-centric view: the people first, then
 * "Your Claude chats" folded away, and a smaller box (Ask · Translate).
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
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [picking, setPicking] = useState(false);
  const [practising, setPractising] = useState(false);
  const [claudeOpen, setClaudeOpen] = useState(readSectionOpen);
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
  const chips = useMemo(() => (teacher ? [] : inboxFilters(allItems)), [allItems, teacher]);
  const activeFilter: InboxFilter = chips.some((c) => c.id === filter) ? filter : 'all';
  const shown = useMemo(() => {
    const byFilter = activeFilter === 'all' ? allItems : allItems.filter((i) => (activeFilter === 'claude' ? i.kind === 'claude' : i.kind !== 'claude'));
    return filterInbox(byFilter, query);
  }, [allItems, activeFilter, query]);
  const sections = useMemo(() => teacherSections(shown), [shown]);
  const recipients = useMemo(() => composeRecipients(humans), [humans]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

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

  const pickFilter = (f: InboxFilter) => {
    setFilter(f);
    track('chats.filter', { filter: f });
  };

  const toggleClaudeSection = () => {
    setClaudeOpen((open) => {
      try {
        localStorage.setItem(CLAUDE_SECTION_KEY, open ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !open;
    });
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

  const sendToPerson = (to: ComposeRecipient, text: string) => {
    if (text.trim()) saveDraft(to.conversation_id, text);
    track('chats.compose_to_person', { had_text: !!text.trim() });
    navigate(`/connections/${to.relationship_id}/chat/${to.conversation_id}`, { state: { from: '/chats' } });
  };

  const newClaudeChat = () => {
    setPicking(false);
    setComposeRequest((n) => n + 1);
  };

  const myId = user?.id ?? '';
  const nothing = rows !== null && threads !== null && allItems.length === 0;
  const noPeople = relationshipsQuery.isSuccess && people.length === 0;
  const peopleTitle = sections.people.every((i) => i.kind === 'student') ? 'Students' : 'People';
  const claudeShown = claudeOpen || !!query.trim();

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

        {chips.length > 0 && (
          <div className="chats-filters" role="group" aria-label="Show">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={activeFilter === c.id}
                className={`chats-filter chats-filter-${c.id}${activeFilter === c.id ? ' chats-filter-on' : ''}`}
                onClick={() => pickFilter(c.id)}
                data-testid={`chats-filter-${c.id}`}
              >
                {c.label}
              </button>
            ))}
          </div>
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

        {!teacher && shown.length > 0 && (
          <div className="chats-list" role="list" aria-label="Chats">
            {shown.map((item) => <InboxRow key={item.key} item={item} myId={myId} now={now} onOpen={onOpen} />)}
          </div>
        )}

        {teacher && sections.people.length > 0 && (
          <>
            <h2 className="chats-section-title">{peopleTitle}</h2>
            <div className="chats-list" role="list" aria-label={peopleTitle}>
              {sections.people.map((item) => (
                <InboxRow key={item.key} item={item} myId={myId} now={now} onOpen={onOpen} claudeToday={item.human ? claudeTodayByRel.get(item.human.relationship_id) : undefined} />
              ))}
            </div>
          </>
        )}

        {teacher && sections.claude.length > 0 && (
          <>
            <button
              type="button"
              className="chats-section-toggle"
              aria-expanded={claudeShown}
              onClick={toggleClaudeSection}
              data-testid="chats-claude-section"
            >
              <span aria-hidden="true">{claudeShown ? '▾' : '▸'}</span>
              <span>✦ Your Claude chats</span>
              <span className="chats-section-count">{sections.claude.length}</span>
              {!claudeShown && sections.claude.some((i) => i.unread > 0) && <span className="chats-dot" aria-label="unread replies" />}
            </button>
            {claudeShown && (
              <div className="chats-list" role="list" aria-label="Your Claude chats">
                {sections.claude.map((item) => <InboxRow key={item.key} item={item} myId={myId} now={now} onOpen={onOpen} />)}
              </div>
            )}
          </>
        )}

        <div ref={composerRef} className={`page-footer chats-compose${teacher ? ' chats-compose-teacher' : ''}`} data-testid="chats-compose">
          <ChatsComposer
            value={draft}
            onChange={setDraft}
            onSendToClaude={sendToClaude}
            onSendToPerson={sendToPerson}
            recipients={recipients}
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
