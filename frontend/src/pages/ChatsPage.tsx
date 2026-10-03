import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMyRelationships } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useNetwork } from '../contexts/NetworkContext';
import { useChatList } from '../hooks/useChatList';
import { track } from '../services/analytics';
import { CLAUDE_AI_USER_ID, getOtherUserInRelationship } from '../types';
import {
  chatInitial,
  chatPersonName,
  chatRelativeTime,
  chatRowPreview,
  chatRowTitle,
  filterChatList,
  groupChatList,
  type ChatListRow,
} from '@shared/chats/inbox';
import { effectiveListening, listeningPreview } from '@shared/chats/listening';
import { loadRevealed, refreshChatListening, useAllChatListening } from '../services/chatListening';
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
  if (person.id === CLAUDE_AI_USER_ID) {
    return <span className="chats-avatar chats-avatar-claude" style={style} aria-hidden="true">✦</span>;
  }
  if (person.picture_url && !broken) {
    return <img className="chats-avatar" style={style} src={person.picture_url} alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className="chats-avatar" style={{ ...style, background: avatarColor(person.id) }} aria-hidden="true">
      {chatInitial(person)}
    </span>
  );
}

function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

function ChatRow({ row, rows, myId, now, onOpen }: { row: ChatListRow; rows: ChatListRow[]; myId: string; now: number; onOpen: (id: string) => void }) {
  const { name, subtitle } = chatRowTitle(row, rows);
  const unread = row.unread > 0;
  // Listening mode: never spoil a hidden message here ("🎧 New message").
  const listening = useAllChatListening();
  const setting = effectiveListening(listening.conversations[row.conversation_id] ?? null, listening.default_on);
  const hiddenPreview = setting.on
    ? listeningPreview(row.last_message, { viewerId: myId, setting, readMarker: row.my_read_at ?? null, revealed: loadRevealed(row.conversation_id) })
    : null;
  return (
    <Link
      to={`/connections/${row.relationship_id}/chat/${row.conversation_id}`}
      state={{ from: '/chats' }}
      className={`chats-row${unread ? ' chats-row-unread' : ''}`}
      data-testid="chats-row"
      onClick={() => onOpen(row.conversation_id)}
    >
      <ChatAvatar person={row.other_user} />
      <span className="chats-row-body">
        <span className="chats-row-top">
          <span className="chats-row-name">
            {name}
            {subtitle && <span className="chats-row-subtitle"> · {subtitle}</span>}
          </span>
          <span className="chats-row-time">{chatRelativeTime(row.last_activity_at, now, localOffsetMinutes())}</span>
        </span>
        <span className="chats-row-bottom">
          <span className="chats-row-preview">{hiddenPreview ?? chatRowPreview(row, myId)}</span>
          {unread && (
            <span className="chats-unread" aria-label={`${row.unread} unread`}>
              {row.unread > 99 ? '99+' : row.unread}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

/**
 * The Chats tab (`/chats`): every conversation across every tutor / student,
 * Signal-style — avatar, name, last message, time, unread badge — newest
 * first, Claude role-play chats in their own section. Cached, so it renders
 * offline; live while open. Rules in `shared/chats/inbox.ts`.
 */
export function ChatsPage() {
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const navigate = useNavigate();
  const { rows, isLoading, error, markOpened } = useChatList({ live: true });
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const now = Date.now();

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

  useEffect(() => {
    void refreshChatListening();
  }, []);

  const filtered = useMemo(() => (rows ? filterChatList(rows, query) : []), [rows, query]);
  const groups = useMemo(() => groupChatList(filtered), [filtered]);

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
    if (rows === null || inboxTracked.current) return;
    inboxTracked.current = true;
    track('chat.inbox_open', { conversations: rows.length, unread: rows.filter((r) => r.unread > 0).length });
  }, [rows]);

  const startNewChat = () => {
    if (people.length === 1) navigate(`/connections/${people[0].relId}/chat/new`, { state: { from: '/chats' } });
    else setPicking(true);
  };

  const myId = user?.id ?? '';
  const noChats = rows !== null && rows.length === 0;
  const noPeople = relationshipsQuery.isSuccess && people.length === 0;

  return (
    <div className="page">
      <div className="container chats-page">
        <div className="chats-header">
          <h1>Chats</h1>
          {people.length > 0 && (
            <button type="button" className="chats-new" onClick={startNewChat} aria-label="New chat" title="New chat">
              ✏️
            </button>
          )}
        </div>

        {rows && rows.length > 0 && (
          <input
            type="search"
            className="chats-search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search chats"
          />
        )}

        {isLoading && <p className="chats-muted">Loading chats…</p>}
        {!rows && error && (
          <p className="chats-muted">
            {isOnline ? `Couldn't load your chats: ${error.message}` : "You're offline — your chats will show once you're back online."}
          </p>
        )}

        {noChats && (
          <div className="chats-empty" data-testid="chats-empty">
            <div className="chats-empty-icon" aria-hidden="true">💬</div>
            {noPeople ? (
              <>
                <p>No chats yet — connect with a tutor or student to start chatting.</p>
                <Link to="/connections" className="btn btn-primary">Connect with someone</Link>
              </>
            ) : (
              <>
                <p>No messages yet.</p>
                {people.length > 0 && <button type="button" className="btn btn-primary" onClick={startNewChat}>Start a chat</button>}
              </>
            )}
          </div>
        )}

        {rows && rows.length > 0 && filtered.length === 0 && (
          <p className="chats-muted">No chats match “{query.trim()}”.</p>
        )}

        {groups.people.length > 0 && (
          <div className="chats-list" role="list" aria-label="Chats">
            {groups.people.map((r) => <ChatRow key={r.conversation_id} row={r} rows={rows!} myId={myId} now={now} onOpen={markOpened} />)}
          </div>
        )}

        {groups.practice.length > 0 && (
          <>
            <h2 className="chats-section-title">Practice with Claude</h2>
            <div className="chats-list" role="list" aria-label="Practice with Claude">
              {groups.practice.map((r) => <ChatRow key={r.conversation_id} row={r} rows={rows!} myId={myId} now={now} onOpen={markOpened} />)}
            </div>
          </>
        )}
      </div>

      {picking && (
        <div className="chats-sheet-backdrop" onClick={() => setPicking(false)}>
          <div className="chats-sheet" role="dialog" aria-label="New chat with" onClick={(e) => e.stopPropagation()}>
            <h2>New chat with…</h2>
            {people.map((p) => (
              <button
                key={p.relId}
                type="button"
                className="chats-sheet-person"
                onClick={() => navigate(`/connections/${p.relId}/chat/new`, { state: { from: '/chats' } })}
              >
                <ChatAvatar person={p.other} size={40} />
                <span>
                  <strong>{chatPersonName(p.other)}</strong>
                  <span className="chats-muted"> · {p.isTutor ? 'your tutor' : 'your student'}</span>
                </span>
              </button>
            ))}
            <button type="button" className="btn btn-secondary chats-sheet-cancel" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
