/**
 * Word chips for older chat messages (docs/CHAT.md PR 3): a Chinese message
 * without `words` asks `POST /api/messages/:id/words` once it scrolls into
 * view — once per message per session, a few at a time, failures ignored
 * (the message just stays plain text). New messages get their words from the
 * server in the background and arrive as `message_updated`.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { requestMessageWords } from '../api/chat';
import { needsWords } from '../services/chatLearning';
import type { ChatWord, MessageWithSender } from '../types';

const asked = new Set<string>();
const MAX_IN_FLIGHT = 3;

export function useLazyMessageWords(
  containerRef: RefObject<HTMLElement | null>,
  messages: MessageWithSender[],
  enabled: boolean,
  onWords: (messageId: string, words: ChatWord[], source: 'content' | 'transcript') => void,
): void {
  const onWordsRef = useRef(onWords);
  onWordsRef.current = onWords;
  const queue = useRef<string[]>([]);
  const inFlight = useRef(0);
  const observer = useRef<IntersectionObserver | null>(null);

  const pump = useRef(() => {});
  pump.current = () => {
    while (inFlight.current < MAX_IN_FLIGHT && queue.current.length > 0) {
      const id = queue.current.shift()!;
      inFlight.current++;
      requestMessageWords(id)
        .then((res) => {
          if (res.words && res.words.length && res.source) onWordsRef.current(id, res.words, res.source);
        })
        .catch(() => {})
        .finally(() => {
          inFlight.current--;
          pump.current();
        });
    }
  };

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return;
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.msgId;
          io.unobserve(entry.target);
          if (!id || asked.has(id)) continue;
          asked.add(id);
          queue.current.push(id);
        }
        pump.current();
      },
      { root, rootMargin: '200px 0px' },
    );
    observer.current = io;
    return () => {
      io.disconnect();
      observer.current = null;
    };
  }, [enabled, containerRef]);

  useEffect(() => {
    const io = observer.current;
    const root = containerRef.current;
    if (!io || !root || !enabled) return;
    const want = new Set(messages.filter((m) => !asked.has(m.id) && needsWords(m)).map((m) => m.id));
    if (want.size === 0) return;
    root.querySelectorAll<HTMLElement>('[data-msg-id]').forEach((el) => {
      if (want.has(el.dataset.msgId || '')) io.observe(el);
    });
  }, [messages, enabled, containerRef]);
}
