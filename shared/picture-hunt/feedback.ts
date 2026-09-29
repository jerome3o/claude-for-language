/**
 * The line shown under the answer box for a match (shared so the web and Lab
 * apps say the same thing). A near miss never gives the answer away.
 */
import type { HuntMatch } from './match';
import type { HuntObject } from './types';

export interface HuntFeedback {
  tone: 'found' | 'close' | 'miss' | 'info';
  text: string;
}

export function huntFeedback(match: HuntMatch, objects: HuntObject[]): HuntFeedback | null {
  const obj = 'objectId' in match ? objects.find((o) => o.id === match.objectId) : undefined;
  switch (match.kind) {
    case 'empty':
      return null;
    case 'found':
      if (!obj) return null;
      if (match.via === 'alternative') return { tone: 'found', text: `✓ ${obj.hanzi} (also ${match.typed.trim()}) · ${obj.pinyin} · ${obj.english}` };
      if (match.via === 'pinyin') return { tone: 'found', text: `✓ ${obj.hanzi} · ${obj.pinyin} · ${obj.english} — try typing the characters next time` };
      return { tone: 'found', text: `✓ ${obj.hanzi} · ${obj.pinyin} · ${obj.english}` };
    case 'already':
      return { tone: 'info', text: `Already found ${obj?.hanzi ?? 'that one'}` };
    case 'close':
      return match.reason === 'missing_tones'
        ? { tone: 'close', text: 'Right sound — add the tones, or type the characters' }
        : { tone: 'close', text: `So close — something here has ${match.shared} in its name` };
    case 'none':
      return { tone: 'miss', text: 'Not one of the things I found — try another' };
  }
}
