/**
 * The chat as the way in to the person (shared/chats/personLinks.ts): chatPersonPath,
 * chatPersonLinks, personFirstName and connectionRequestsLine over seeded cases. Writes
 * chat-person-links.json; checked by core/…/ChatPersonLinksParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONNECTIONS_TITLE,
  chatPersonLinks,
  chatPersonPath,
  connectionRequestsLine,
  personFirstName,
} from '../../../shared/chats/personLinks';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const names: Array<string | null> = ['明慧', 'Minghui Li', '  Anna  ', '', '   ', null, '王　明慧', 'Jerome\tSwannack', 'Zoë-Ann O’Neil'];
const rels: Array<string | null> = ['r1', 'rel-abc', null, ''];
const roles: Array<string | null> = ['student', 'tutor', null, 'other'];

const links = rels.flatMap((rel) =>
  names.flatMap((name) =>
    roles.flatMap((role) =>
      [false, true].map((isAi) => ({
        relationship_id: rel,
        other_name: name,
        viewer_role: role,
        is_ai: isAi,
        path: chatPersonPath(rel, isAi),
        links: chatPersonLinks({ relationshipId: rel, otherName: name, viewerRole: role, isAi }),
      })),
    ),
  ),
);

const firstNames = names.map((name) => ({ name, first: personFirstName(name) }));

const requestSets: Array<Array<{ name: string | null; requesterRole: string | null }>> = [
  [],
  [{ name: '明慧', requesterRole: 'tutor' }],
  [{ name: 'Anna', requesterRole: 'student' }],
  [{ name: '  ', requesterRole: 'tutor' }],
  [{ name: null, requesterRole: null }],
  [{ name: 'A', requesterRole: 'tutor' }, { name: 'B', requesterRole: 'student' }],
  [{ name: 'A', requesterRole: 'tutor' }, { name: 'B', requesterRole: 'tutor' }, { name: 'C', requesterRole: 'tutor' }],
];
const requests = requestSets.map((set) => ({ requests: set, line: connectionRequestsLine(set) }));

writeFileSync(join(OUT, 'chat-person-links.json'), JSON.stringify({ title: CONNECTIONS_TITLE, links, first_names: firstNames, requests }, null, 1));
