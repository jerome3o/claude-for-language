import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ChatPersonLink } from '@shared/chats/personLinks';
import { track } from '../../services/analytics';

/**
 * The chat header's avatar + name. With a person on the other side it is a link to their page
 * (`/connections/:relId` — the learner's tutor page, the tutor's student page): the learner's
 * Tutor tab went in Nov 2026 and the chat is the way in. Claude chats stay plain.
 */
export function ChatHeaderPerson({ path, name, children }: { path: string | null; name: string | null | undefined; children: ReactNode }) {
  if (!path) return <div className="chat-header-user">{children}</div>;
  return (
    <Link
      to={path}
      className="chat-header-user chat-header-person"
      data-testid="chat-header-person"
      aria-label={`${name || 'Their'} page`}
      onClick={() => track('chat.person_link', { link: 'header' })}
    >
      {children}
    </Link>
  );
}

/** The ⋯ menu's rows for the person's page and its parts (`chatPersonLinks`), after a divider. */
export function ChatPersonMenuLinks({ links, onPick }: { links: ChatPersonLink[]; onPick: () => void }) {
  if (links.length === 0) return null;
  return (
    <>
      <div className="chat-header-menu-divider" role="separator" />
      {links.map((link) => (
        <Link
          key={link.id}
          role="menuitem"
          className="chat-header-menu-item"
          to={link.section ? `${link.path}#${link.section}` : link.path}
          data-testid={`chat-person-link-${link.id}`}
          onClick={() => {
            onPick();
            track('chat.person_link', { link: link.id });
          }}
        >
          <span aria-hidden="true">{link.icon}</span>
          <span>
            {link.label}
            <span className="chat-menu-desc">{link.desc}</span>
          </span>
        </Link>
      ))}
    </>
  );
}
