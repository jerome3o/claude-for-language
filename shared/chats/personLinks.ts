/**
 * The chat with a person is the way in to everything about them (Jerome, Nov 2026: "this page
 * doesn't really give me much beyond the messages page"). The learner's Tutor tab is gone; what
 * the tutor page offered is reached from the chat instead:
 *  - the header's name / avatar opens their page (`/connections/:relId`, kept as a page);
 *  - the chat ⋯ menu lists the page's main parts (`chatPersonLinks`).
 * Connection requests and connections management live in More → "Tutors & connections"
 * (`/connections`), and a request someone sent me is announced on Home (`connectionRequestsLine`).
 *
 * Pure rules shared by both apps: web pages/ChatPage.tsx + components/home/ConnectionRequestsBanner.tsx,
 * Lab core `ChatPersonLinks.kt` (parity-tested by android-lab/parity/fixtures/chat-person-links.ts).
 */

export type ChatPersonLinkId = 'person' | 'lesson_board' | 'homework' | 'flags' | 'tutor_notes';

export interface ChatPersonLink {
  id: ChatPersonLinkId;
  icon: string;
  label: string;
  desc: string;
  /** An app path without the section: the web adds `#<section>`, the Lab app `?section=<section>`. */
  path: string;
  /** A section of the person's page to scroll to (`homework`, `flags`), or null. */
  section: string | null;
}

export interface ChatPersonLinksInput {
  /** The chat's relationship; null (a chat without one) = no links. */
  relationshipId: string | null | undefined;
  /** The other person's display name. */
  otherName: string | null | undefined;
  /** My role in the relationship. */
  viewerRole: 'tutor' | 'student' | string | null | undefined;
  /** A Claude chat / the Claude practice partner: no person page. */
  isAi: boolean;
}

/** "Minghui Li" → "Minghui"; "明慧" → "明慧"; blank → null. */
export function personFirstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first || null;
}

/** Where a tap on the chat header's name / avatar goes: the person's page, or null (Claude). */
export function chatPersonPath(relationshipId: string | null | undefined, isAi: boolean): string | null {
  if (isAi || !relationshipId) return null;
  return `/connections/${relationshipId}`;
}

/**
 * The chat ⋯ menu's links to the person's page and what hangs off it, in order. A learner (my
 * tutor on the other side) gets About · Lesson board · Homework · Cards you flagged · Notes; a
 * tutor (my student) gets the student page and the Lesson board — the rest is on that page.
 * Claude chats get none. 📹 Video call is not here: it is the header's 📹 already.
 */
export function chatPersonLinks(input: ChatPersonLinksInput): ChatPersonLink[] {
  const page = chatPersonPath(input.relationshipId, input.isAi);
  if (!page) return [];
  const first = personFirstName(input.otherName);
  const board: ChatPersonLink = {
    id: 'lesson_board',
    icon: '📝',
    label: 'Lesson board',
    desc: 'What you wrote together in video lessons',
    path: `${page}/board`,
    section: null,
  };
  if (input.viewerRole === 'tutor') {
    return [
      { id: 'person', icon: '👤', label: first ? `${first}’s page` : 'Student page', desc: 'Progress, homework, needs attention', path: page, section: null },
      board,
    ];
  }
  const who = first ?? 'your tutor';
  return [
    { id: 'person', icon: '👤', label: `About ${who}`, desc: 'Their profile, local time and everything you share', path: page, section: null },
    board,
    { id: 'homework', icon: '📚', label: `Homework from ${who}`, desc: 'What they sent you, to do and done', path: page, section: 'homework' },
    { id: 'flags', icon: '🚩', label: 'Cards you flagged', desc: `Cards you asked ${who} about, with their replies`, path: page, section: 'flags' },
    { id: 'tutor_notes', icon: '🗒', label: `Notes from ${who}`, desc: 'Comments on your recordings and flagged cards', path: '/tutor-notes', section: null },
  ];
}

/** A connection request someone sent me (GET /api/relationships → pending_incoming, requester ≠ me). */
export interface IncomingRequest {
  /** The requester's display name. */
  name: string | null | undefined;
  /** The requester's role in the relationship ('tutor' = they want to teach me). */
  requesterRole: 'tutor' | 'student' | string | null | undefined;
}

/**
 * Home's line for connection requests waiting on me (the Tutor tab used to be where they
 * showed): "🤝 Minghui wants to be your tutor", "🤝 Anna wants you to be their tutor",
 * "🤝 3 connection requests"; null when there are none.
 */
export function connectionRequestsLine(requests: IncomingRequest[]): string | null {
  if (requests.length === 0) return null;
  if (requests.length > 1) return `🤝 ${requests.length} connection requests`;
  const r = requests[0];
  const name = (r.name ?? '').trim() || 'Someone';
  return r.requesterRole === 'tutor' ? `🤝 ${name} wants to be your tutor` : `🤝 ${name} wants you to be their tutor`;
}

/** The More row / page title for connections management on a learner account. */
export const CONNECTIONS_TITLE = 'Tutors & connections';
