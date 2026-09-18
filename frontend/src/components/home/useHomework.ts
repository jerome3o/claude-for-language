import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { getMyRelationships, getSharedDecks, getCustomLessons, getNotifications } from '../../api/client';
import { db, LocalDeck } from '../../db/database';
import { useNetwork } from '../../contexts/NetworkContext';
import {
  pickHomework,
  summarizeHomeworkDeck,
  HomeworkPick,
  HomeworkTutor,
  HomeworkDeckSource,
  DeckProgressSummary,
} from './homework';

const SNAPSHOT_KEY = 'homeworkSnapshot';

function readSnapshot(): HomeworkPick | null {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeSnapshot(pick: HomeworkPick | null) {
  try {
    if (pick) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(pick));
    else localStorage.removeItem(SNAPSHOT_KEY);
  } catch { /* storage unavailable */ }
}

export interface HomeworkView {
  pick: HomeworkPick | null;
  /** Progress of the picked deck, computed from the local cards/events. */
  progress: DeckProgressSummary | null;
  /** Word count of the picked deck (local notes). */
  wordCount: number | null;
}

/**
 * Everything the "From <tutor>" card needs: the tutor relationships, what they
 * sent (shared decks, assigned lessons), unread tutor messages, and the local
 * progress on the picked deck. Network reads are cached and the last pick is
 * snapshotted so the card still renders offline.
 */
export function useHomework(localDecks: LocalDeck[]): HomeworkView {
  const { isOnline } = useNetwork();

  const relationshipsQuery = useQuery({
    queryKey: ['relationships'],
    queryFn: getMyRelationships,
    enabled: isOnline,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const tutors = useMemo<HomeworkTutor[]>(() => {
    const rels = relationshipsQuery.data?.tutors ?? [];
    return rels.map(rel => {
      const tutor = rel.requester_role === 'tutor' ? rel.requester : rel.recipient;
      return {
        relationshipId: rel.id,
        tutorId: tutor.id,
        tutorName: tutor.name || tutor.email || 'Your tutor',
      };
    });
  }, [relationshipsQuery.data]);

  const tutorRelIds = tutors.map(t => t.relationshipId).join(',');

  const sharedDecksQuery = useQuery({
    queryKey: ['homeworkSharedDecks', tutorRelIds],
    queryFn: async (): Promise<HomeworkDeckSource[]> => {
      const lists = await Promise.all(
        tutors.map(t => getSharedDecks(t.relationshipId).catch(() => []))
      );
      return lists.flatMap((decks, i) =>
        decks.map(d => ({ relationshipId: tutors[i].relationshipId, targetDeckId: d.target_deck_id, sharedAt: d.shared_at }))
      );
    },
    enabled: isOnline && tutors.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const lessonsQuery = useQuery({
    queryKey: ['customLessons', 'active'],
    queryFn: () => getCustomLessons('active'),
    enabled: isOnline && tutors.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    enabled: isOnline && tutors.length > 0,
    staleTime: 60 * 1000,
    retry: false,
  });

  const livePick = useMemo<HomeworkPick | null | undefined>(() => {
    if (!relationshipsQuery.data) return undefined; // not loaded yet
    if (tutors.length === 0) return null;
    if (!sharedDecksQuery.data && !lessonsQuery.data && !notificationsQuery.data) return undefined;
    return pickHomework({
      tutors,
      sharedDecks: sharedDecksQuery.data ?? [],
      lessons: (lessonsQuery.data ?? []).map(l => ({
        id: l.id,
        title: l.title,
        assignedBy: l.assigned_by ?? null,
        assignedRelationshipId: l.assigned_relationship_id ?? null,
        createdAt: l.created_at,
        status: l.status,
      })),
      unreadMessages: (notificationsQuery.data ?? [])
        .filter(n => !n.is_read && n.type === 'new_chat_message' && n.conversation_id)
        .map(n => ({
          conversationId: n.conversation_id!,
          relationshipId: n.relationship_id,
          text: n.message,
          createdAt: n.created_at,
        })),
      localDecks: new Map(localDecks.map(d => [d.id, d.name])),
    });
  }, [relationshipsQuery.data, tutors, sharedDecksQuery.data, lessonsQuery.data, notificationsQuery.data, localDecks]);

  useEffect(() => {
    if (livePick !== undefined) writeSnapshot(livePick);
  }, [livePick]);

  const pick = livePick === undefined ? readSnapshot() : livePick;
  // A snapshotted deck that has since disappeared locally must not be shown.
  const effectivePick = pick && pick.item?.kind === 'deck' && !localDecks.some(d => d.id === (pick.item as { deckId: string }).deckId)
    ? { ...pick, item: null }
    : pick;

  const pickedDeckId = effectivePick?.item?.kind === 'deck' ? effectivePick.item.deckId : null;

  const local = useLiveQuery(async () => {
    if (!pickedDeckId) return null;
    const [cards, notes] = await Promise.all([
      db.cards.where('deck_id').equals(pickedDeckId).toArray(),
      db.notes.where('deck_id').equals(pickedDeckId).toArray(),
    ]);
    const cardIds = cards.map(c => c.id);
    const events = cardIds.length > 0
      ? await db.reviewEvents.where('card_id').anyOf(cardIds).toArray()
      : [];
    return {
      progress: summarizeHomeworkDeck(cards, notes, events),
      wordCount: notes.length,
    };
  }, [pickedDeckId]);

  if (!effectivePick || (effectivePick.item === null && !effectivePick.unreadMessage)) {
    return { pick: null, progress: null, wordCount: null };
  }
  return {
    pick: effectivePick,
    progress: local?.progress ?? null,
    wordCount: local?.wordCount ?? null,
  };
}
